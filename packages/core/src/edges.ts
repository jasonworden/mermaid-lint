/**
 * Edge-extraction helper for Mermaid flowchart/graph diagrams.
 *
 * Consumed by higher-level semantic rules (no-duplicate-edges, no-self-loop,
 * no-orphan-nodes) that need a clean list of directed node→node pairs without
 * having to re-implement operator parsing individually.
 *
 * @module edges
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A single directed edge extracted from a flowchart/graph body line.
 *
 * @public
 */
export interface Edge {
  /** Source node id. */
  source: string;
  /** Target node id. */
  target: string;
  /** 1-indexed line within the diagram body where the edge appears. */
  line: number;
  /**
   * Edge label text (pipe label `|...|` or inline text `-- text -->` /
   * `-. text .->` / `== text ==>`), trimmed. `undefined` when the edge has
   * no label. Used by `no-duplicate-edges` to distinguish edges that differ
   * only in label from true duplicates.
   */
  label?: string;
}

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

/**
 * Structural keywords that begin a line but never contain a link operator.
 * Any line whose first whitespace-trimmed token matches one of these is skipped
 * without further parsing (most are excluded naturally since they carry no
 * operator, but being explicit makes the guard cheap and clear).
 */
const SKIP_KEYWORDS = new Set([
  'flowchart',
  'graph',
  'subgraph',
  'end',
  'direction',
  'click',
  'style',
  'classDef',
  'class',
  'linkStyle',
]);

/**
 * Optional trailing pipe label: `|...|` that may follow a connector operator.
 * Appended to each connector alternative in LINK_OP_RE so the full token —
 * connector plus its pipe label (if any) — is consumed as a single delimiter
 * by `split`. This gives every operator token its own label without any
 * cross-operator ordering assumption.
 */
const PIPE_SUFFIX = '(?:\\s*\\|[^|]*\\|)?';

/**
 * Link-operator regex with a capturing group so `split` interleaves the full
 * matched operator text (including inline labels and an optional trailing pipe
 * label) between node-group tokens.
 *
 * Each alternative matches the connector PLUS `PIPE_SUFFIX` so that a
 * following `|label|` is consumed as part of the delimiter rather than left
 * as a node-group fragment. This means:
 *   - `line.split(LINK_OP_RE)` yields clean node-group segments at even indices.
 *   - Each odd-index token is the full operator string, which may include the
 *     pipe label (extracted by `labelFromOp`).
 *
 * Alternation order (most-specific first to avoid partial matches):
 *   1. Circle/cross both-ends:  `o--+o` `x--+x`
 *   2. Bidirectional:           `<--+>`
 *   3. Left arrow:              `<--+`  (must come before plain dashes)
 *   4. Circle/cross one-end:    `--+o` `--+x` `o--+` `x--+`
 *   5. Dotted with text:        `-. text .->` or `-. text .-`
 *   6. Dotted extended:         `-..+->` `-..+-`
 *   7. Dotted plain:            `-.->` `-.-`
 *   8. Thick with text:         `== text ==>` or `== text ===`
 *   9. Thick plain:             `={3,}` `={2,}>`
 *  10. Invisible:               `~~~`
 *  11. Dashed with text:        `-- text --->` or `-- text ---`
 *  12. Dashed plain:            `-{2,}>` `-{3,}` (longest first)
 *
 * The `g` flag is required so callers can use `split` (which interleaves
 * capture groups) or `test` in a guard.
 *
 * Note: bare `==` is intentionally omitted (not a valid Mermaid flowchart link).
 */
const LINK_OP_RE = new RegExp(
  `(${[
    `o--+o${PIPE_SUFFIX}`,
    `x--+x${PIPE_SUFFIX}`,
    `<--+>${PIPE_SUFFIX}`,
    `<--+${PIPE_SUFFIX}`,
    `--+o${PIPE_SUFFIX}`,
    `--+x${PIPE_SUFFIX}`,
    `o--+${PIPE_SUFFIX}`,
    `x--+${PIPE_SUFFIX}`,
    // Dotted with inline text
    `-\\.\\s*\\S.*?\\.->${PIPE_SUFFIX}`,
    `-\\.\\s*\\S.*?\\.-(?!>)${PIPE_SUFFIX}`,
    // Extended dotted (must come before plain dotted): `-..->`, `-...->` etc.
    `-\\.\\.+->${PIPE_SUFFIX}`,
    `-\\.\\.+(?!>)${PIPE_SUFFIX}`,
    // Plain dotted
    `-\\.->${PIPE_SUFFIX}`,
    `-\\.-${PIPE_SUFFIX}`,
    // Thick with inline text
    `==\\s+\\S.*?==>${PIPE_SUFFIX}`,
    `==\\s+\\S.*?===${PIPE_SUFFIX}`,
    // Thick plain (longest first)
    `={3,}>${PIPE_SUFFIX}`,
    `={3,}${PIPE_SUFFIX}`,
    `==>${PIPE_SUFFIX}`,
    // Invisible
    `~~~${PIPE_SUFFIX}`,
    // Dashed with inline text
    `--\\s+\\S.*?-{2,}>${PIPE_SUFFIX}`,
    `--\\s+\\S.*?-{3,}(?!>)${PIPE_SUFFIX}`,
    // Dashed plain (longest first)
    `-{2,}>${PIPE_SUFFIX}`,
    `-{3,}${PIPE_SUFFIX}`,
  ].join('|')})`,
  'g',
);

/**
 * A valid Mermaid node id is `\w[\w-]*`.  After de-bracketing we extract just
 * the leading id token from a (possibly padded) group segment.
 */
const ID_RE = /^\w[\w-]*/;

// ---------------------------------------------------------------------------
// Bracket stripping
// ---------------------------------------------------------------------------

/**
 * Remove all shape-bracket contents from `line`, keeping only the bare node
 * id before each bracket.  Strips iteratively (innermost first) until no more
 * shape brackets remain, so nested forms like `A([...])` collapse correctly.
 *
 * Shapes handled (in order, innermost brackets resolved first):
 *   `[[...]]`  subroutine
 *   `((...))` circle
 *   `([...])` stadium
 *   `{{...}}` hexagon
 *   `[...]`   rectangle
 *   `(...)` rounded
 *   `{...}`   rhombus
 *
 * A quoted string inside brackets (e.g. `["a --> b"]`) is stripped along with
 * the rest of the bracket content, which is the whole point: operators and
 * pipes inside labels must vanish before operator scanning.
 */
function stripBrackets(line: string): string {
  // Iterate until stable — handles nesting like `A([ Stadium ])`.
  let current = line;
  for (;;) {
    const next = current
      // double brackets first (most specific)
      .replace(/\[\[[^\]]*\]\]/g, '')
      .replace(/\(\([^)]*\)\)/g, '')
      .replace(/\(\[[^\]]*\]\)/g, '')
      .replace(/\{\{[^}]*\}\}/g, '')
      // single brackets
      .replace(/\[[^\]]*\]/g, '')
      .replace(/\([^()]*\)/g, '')
      .replace(/\{[^{}]*\}/g, '');
    if (next === current) break;
    current = next;
  }
  return current;
}

// ---------------------------------------------------------------------------
// Label extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extract the label from a single operator token (which may include a trailing
 * pipe label captured by LINK_OP_RE).
 *
 * Priority:
 *   1. Trailing pipe label `|...|` at the end of the token — this is the
 *      per-operator pipe label consumed by LINK_OP_RE's PIPE_SUFFIX.
 *   2. Inline-text label embedded in the connector itself:
 *      `-- text -->` / `-- text ---+`  → `text`
 *      `-. text .->` / `-. text .-`    → `text`
 *      `== text ==>` / `== text ===`   → `text`
 *   3. `undefined` if the operator has no label.
 *
 * Returns the trimmed label text, or `undefined`.
 */
function labelFromOp(op: string): string | undefined {
  // Trailing pipe label (added by PIPE_SUFFIX in LINK_OP_RE).
  const pipe = /\|([^|]*)\|\s*$/.exec(op);
  if (pipe) return pipe[1].trim();

  // Dashed inline: `-- <label> -->` or `-- <label> ---+` (directed or undirected).
  let m = /^--\s+(.+?)\s*-{2,}>?$/.exec(op);
  if (m) return m[1].trim();

  // Dotted inline: `-. <label> .->` or `-. <label> .-`.
  m = /^-\.\s+(.+?)\s*\.-(?:>)?$/.exec(op);
  if (m) return m[1].trim();

  // Thick inline: `== <label> ==>` or `== <label> ===`.
  m = /^==\s+(.+?)\s*={2,}>?$/.exec(op);
  if (m) return m[1].trim();

  return undefined;
}

// ---------------------------------------------------------------------------
// Core extraction logic
// ---------------------------------------------------------------------------

/**
 * Extract directed node-to-node edges from the lines of a flowchart/graph body.
 *
 * `lines` is the body already split on `'\n'` (1-indexed by array position + 1).
 * Comment lines (`%%`...) are skipped entirely.  Returns one {@link Edge} per
 * source→target pair, expanding multi-node `&`-groups and chains.
 *
 * Each edge carries an optional {@link Edge.label} — the pipe label or inline
 * text label of its connector, trimmed, or `undefined` for unlabelled edges.
 *
 * @param lines - Body lines (0-indexed array, 1-indexed for `Edge.line`).
 * @returns All directed edges found in the body.
 * @public
 */
export function extractEdges(lines: string[]): Edge[] {
  const result: Edge[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1; // 1-indexed
    const raw = lines[i];
    const trimmed = raw.trim();

    // Skip blank and comment lines.
    if (trimmed.length === 0 || trimmed.startsWith('%%')) continue;

    // Skip structural keyword lines (they never carry link operators).
    const firstToken = trimmed.split(/\s+/)[0];
    if (SKIP_KEYWORDS.has(firstToken)) continue;

    // Strip shape-bracket contents so operators/pipes inside node labels vanish.
    // This MUST happen before any pipe-label or operator scanning.
    const bracketStripped = stripBrackets(trimmed);

    // Check whether any link operator is present; if not, nothing to do.
    LINK_OP_RE.lastIndex = 0;
    if (!LINK_OP_RE.test(bracketStripped)) continue;

    // Split on link operators to get interleaved [group, op, group, op, group, …].
    // Each operator token already includes its trailing pipe label (if any) via
    // PIPE_SUFFIX, so no separate pipe-label pass is needed.
    LINK_OP_RE.lastIndex = 0;
    const parts = bracketStripped.split(LINK_OP_RE);
    // Even indices (0, 2, 4, …) are node-group tokens; odd indices are matched operators.
    const groups = parts.filter((_, idx) => idx % 2 === 0);
    const ops = parts.filter((_, idx) => idx % 2 === 1);

    // Parse each group token into its constituent ids (split on `&`).
    const groupIds: string[][] = groups.map((seg) =>
      seg
        .split('&')
        .map((part) => {
          const m = part.trim().match(ID_RE);
          return m ? m[0] : '';
        })
        .filter((id) => id.length > 0),
    );

    // Emit cartesian product edges for each consecutive pair of groups.
    // Each operator carries its own label (pipe or inline), derived independently.
    for (let g = 0; g + 1 < groupIds.length; g++) {
      const sources = groupIds[g];
      const targets = groupIds[g + 1];
      const label = labelFromOp(ops[g]);
      for (const source of sources) {
        for (const target of targets) {
          result.push({ source, target, line: lineNum, label });
        }
      }
    }
  }

  return result;
}
