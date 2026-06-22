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
 * Link-operator regex.  Matches all Mermaid flowchart edge syntaxes in one
 * alternation, consuming inline text labels where present so they never end up
 * in a node-group token.
 *
 * Alternation order (most-specific first to avoid partial matches):
 *   1. Dotted with text:  `-. text .->`  or  `-. text .-`
 *   2. Dotted plain:      `-.->` or `-.-`
 *   3. Thick with text:   `== text ==>` (space + word required to avoid `==`)
 *   4. Thick plain:       `===` or `==>` or `==`
 *   5. Invisible:         `~~~`
 *   6. Dashed with text:  `-- text -->` (space + word required to avoid `--`)
 *   7. Dashed plain:      `-->` or `---` or `--`
 *
 * For inline-text forms the pattern requires `\s+\w` after the opening dashes
 * so bare `--` and `==` never accidentally consume a following word token.
 *
 * The `g` flag is required so callers can use `split` (which interleaves
 * capture groups) or `exec` in a loop.
 */
const LINK_OP_RE =
  /(-\.[^.>]*\.->|-\.[^.>]*\.-|-\.->|-\.-|==\s+\w[^=]*==>|===|==>|==\s+\w[^=]*==|==|~~~|--\s+\w[^-]*-->|-->|--\s+\w[^-]*--|---|--)/g;

/**
 * Pipe-label regex: `|...|` that appears immediately before or after a node
 * group (after bracket-stripping has already removed node-shape brackets).
 * Must be removed so the `|` is not mis-parsed as an id character.
 */
const PIPE_LABEL_RE = /\|[^|]*\|/g;

/**
 * A valid Mermaid node id is `\w[\w-]*`.  After de-bracketing we extract just
 * the leading id token from a (possibly padded) group segment.
 */
const ID_RE = /^[\w][\w-]*/;

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
// Core extraction logic
// ---------------------------------------------------------------------------

/**
 * Extract directed node-to-node edges from the lines of a flowchart/graph body.
 *
 * `lines` is the body already split on `'\n'` (1-indexed by array position + 1).
 * Comment lines (`%%`...) are skipped entirely.  Returns one {@link Edge} per
 * source→target pair, expanding multi-node `&`-groups and chains.
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

    // Strip shape-bracket contents so operators/pipes inside labels vanish.
    let clean = stripBrackets(trimmed);

    // Strip pipe labels (|...|) that follow a link operator or precede a node.
    clean = clean.replace(PIPE_LABEL_RE, '');

    // Check whether any link operator is present; if not, nothing to do.
    LINK_OP_RE.lastIndex = 0;
    if (!LINK_OP_RE.test(clean)) continue;

    // Split on link operators to get node-group tokens.
    LINK_OP_RE.lastIndex = 0;
    const groups = clean.split(LINK_OP_RE).filter((_, idx) => idx % 2 === 0);
    // `split` with a capturing group interleaves [group, op, group, op, group, …].
    // Even indices (0, 2, 4, …) are the node-group tokens; odd indices are the
    // matched operators (which we discard).

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
    for (let g = 0; g + 1 < groupIds.length; g++) {
      const sources = groupIds[g];
      const targets = groupIds[g + 1];
      for (const source of sources) {
        for (const target of targets) {
          result.push({ source, target, line: lineNum });
        }
      }
    }
  }

  return result;
}
