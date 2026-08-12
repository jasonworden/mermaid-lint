import type { Block } from '../../extract.js';
import type { Rule, RuleFinding } from '../types.js';

/**
 * An ER relationship line: `LEFT <cardinality> RIGHT : label`. The cardinality
 * is two "outer" symbols (`|`, `}`, `o`) + the identifying/non-identifying line
 * (`--` or `..`) + two "inner" symbols (`|`, `{`, `o`) — e.g. `||--o{`,
 * `}o..o{`. Entity names are bare tokens (alphanumerics, `_`, `-`) or quoted.
 * The trailing `:` label is required by Mermaid, so this never matches a
 * declaration. Captures [1]=left entity, [2]=right entity.
 */
const ER_RELATIONSHIP_RE =
  /^\s*("[^"]*"|[A-Za-z0-9_-]+)\s+[|}o]{2}(?:--|\.\.)[o|{]{2}\s+("[^"]*"|[A-Za-z0-9_-]+)\s*:/;

/**
 * The prose-cardinality relationship form Mermaid also accepts, e.g.
 * `CUSTOMER one to zero or more ORDER : places` (equivalent to `||--o{`). The
 * `to` keyword separates the two cardinality phrases; `[^:]*` keeps the match
 * on the relationship's own line and anchors to the first `:` (the label).
 * Captures [1]=left entity, [2]=right entity.
 */
const ER_PROSE_RELATIONSHIP_RE =
  /^\s*("[^"]*"|[A-Za-z0-9_-]+)\s+[^:]*\bto\b[^:]*\s+("[^"]*"|[A-Za-z0-9_-]+)\s*:/;

/**
 * Opening line of an entity attribute block: `ENTITY {` (brace ends the line).
 * The single-line form (`ENTITY { string name }`) and the v11 alias-bracket
 * form (`ENTITY["Display"] { … }`) are intentionally not matched — they are
 * uncommon and only cause missed detections (never false positives).
 */
const ER_BLOCK_OPEN_RE = /^\s*("[^"]*"|[A-Za-z0-9_-]+)\s*\{\s*$/;

/** A lone closing brace for an entity block. */
const ER_BLOCK_CLOSE_RE = /^\s*\}\s*$/;

/**
 * An attribute line inside an entity block: `type name [keys] [comment]`. The
 * second token is the attribute name (the first is its type). Names may contain
 * hyphens (`string first-name`), matching the entity-name charset.
 */
const ER_ATTRIBUTE_RE = /^\s*\S+\s+([A-Za-z0-9_-]+)/;

/** A relationship endpoint pair, or `null` when the line is not a relationship. */
function parseErRelationship(
  line: string,
): { left: string; right: string } | null {
  const m =
    ER_RELATIONSHIP_RE.exec(line) ?? ER_PROSE_RELATIONSHIP_RE.exec(line);
  if (m === null) return null;
  return { left: unquoteEntity(m[1]), right: unquoteEntity(m[2]) };
}

/** Strip surrounding double-quotes from a quoted entity name. */
function unquoteEntity(token: string): string {
  return token.replace(/^"|"$/g, '');
}

function isEr(block: Block): boolean {
  return block.type === 'erDiagram';
}

export const erDuplicateAttribute: Rule = {
  id: 'er-duplicate-attribute',
  appliesTo: isEr,
  evaluate: ({ lines, fileLine }) => {
    const findings: RuleFinding[] = [];
    let entity: string | null = null;
    let attrs = new Map<string, number>(); // attribute name -> first line
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (raw.trimStart().startsWith('%%')) continue;

      if (entity === null) {
        const open = ER_BLOCK_OPEN_RE.exec(raw);
        if (open !== null) {
          entity = unquoteEntity(open[1]);
          attrs = new Map();
        }
        continue;
      }

      // Inside an entity block (ER entities don't nest).
      if (ER_BLOCK_CLOSE_RE.test(raw)) {
        entity = null;
        continue;
      }
      const attr = ER_ATTRIBUTE_RE.exec(raw);
      if (attr === null) continue;
      const name = attr[1];
      const first = attrs.get(name);
      if (first === undefined) {
        attrs.set(name, i + 1);
      } else {
        findings.push({
          message: `attribute \`${name}\` is declared more than once on entity \`${entity}\` (first on line ${fileLine(first)}).`,
          line: i + 1,
        });
      }
    }
    return findings;
  },
};

export const erDuplicateEntity: Rule = {
  id: 'er-duplicate-entity',
  appliesTo: isEr,
  evaluate: ({ lines, fileLine }) => {
    const seen = new Map<string, number>(); // entity -> first block-open line
    const findings: RuleFinding[] = [];
    let inBlock = false;
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (raw.trimStart().startsWith('%%')) continue;
      if (inBlock) {
        if (ER_BLOCK_CLOSE_RE.test(raw)) inBlock = false;
        continue;
      }
      const open = ER_BLOCK_OPEN_RE.exec(raw);
      if (open === null) continue;
      inBlock = true;
      const entity = unquoteEntity(open[1]);
      const first = seen.get(entity);
      if (first === undefined) {
        seen.set(entity, i + 1);
      } else {
        findings.push({
          message: `entity \`${entity}\` has its attribute block defined more than once (first on line ${fileLine(first)}); Mermaid merges them, so this is usually a copy-paste mistake.`,
          line: i + 1,
        });
      }
    }
    return findings;
  },
};

// Mirror of `no-orphan-nodes` for ER: an entity with a defined attribute block
// that never appears in a relationship renders as an isolated box. Off by
// default (opt-in) — a lone reference table is sometimes intentional.
export const erStandaloneEntity: Rule = {
  id: 'er-standalone-entity',
  appliesTo: isEr,
  evaluate: ({ lines }) => {
    const related = new Set<string>();
    const blocks = new Map<string, number>(); // entity -> first block-open line
    let inBlock = false;
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (raw.trimStart().startsWith('%%')) continue;
      if (inBlock) {
        if (ER_BLOCK_CLOSE_RE.test(raw)) inBlock = false;
        continue;
      }
      const rel = parseErRelationship(raw);
      if (rel !== null) {
        related.add(rel.left);
        related.add(rel.right);
        continue;
      }
      const open = ER_BLOCK_OPEN_RE.exec(raw);
      if (open !== null) {
        inBlock = true;
        const entity = unquoteEntity(open[1]);
        if (!blocks.has(entity)) blocks.set(entity, i + 1);
      }
    }
    return [...blocks.entries()]
      .filter(([entity]) => !related.has(entity))
      .sort(([, a], [, b]) => a - b)
      .map(([entity, line]) => ({
        message: `entity \`${entity}\` has a defined attribute block but no relationship; it renders as an isolated box.`,
        line,
      }));
  },
};
