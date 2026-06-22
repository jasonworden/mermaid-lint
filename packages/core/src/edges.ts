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
 * Link-operator regex with a capturing group so `split` interleaves the full
 * matched operator text (including inline labels) between node-group tokens.
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
 *  11. Dashed with text:        `-- text --->` or `-- text ---`  (allows 2+ trailing dashes/arrow)
 *  12. Dashed plain:            `-{2,}>` `-{3,}` (longest first)
 *
 * The `g` flag is required so callers can use `split` (which interleaves
 * capture groups) or `exec` in a loop.
 *
 * Note: bare `==` is intentionally omitted (not a valid Mermaid flowchart link).
 */
const LINK_OP_RE =
  /(o--+o|x--+x|<--+>|<--+|--+o|--+x|o--+|x--+|-\.\s*\S.*?\.->|-\.\s*\S.*?\.-(?!>)|-\.\.+->|-\.\.+-(?!>)|-\.->|-\.-|==\s+\S.*?==>|==\s+\S.*?===|={3,}>|={3,}|==>|~~~|--\s+\S.*?-{2,}>|--\s+\S.*?-{3,}(?!>)|-{2,}>|-{3,})/g;

/**
 * Pipe-label regex: `|...|` that appears immediately before or after a node
 * group (after bracket-stripping has already removed node-shape brackets).
 * We need both the capturing and non-capturing form:
 * - `PIPE_LABEL_SCAN_RE` is used with `exec` to collect labels in order.
 * - `PIPE_LABEL_RE` strips them from the cleaned line.
 */
const PIPE_LABEL_RE = /\|([^|]*)\|/g;

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
 * Extract the inline-text label from an operator token, if present.
 * Returns the trimmed label text, or `undefined` if the operator has no label.
 *
 * Inline-text operators have the form:
 *   `-- text -->` / `-- text ---`   → captures `text`
 *   `-. text .->` / `-. text .-`    → captures `text`
 *   `== text ==>` / `== text ===`   → captures `text`
 */
function inlineLabelFromOp(op: string): string | undefined {
  // Dashed: `-- <label> -->` or `-- <label> ---+`
  let m = /^--\s+(.+?)\s*-{2,}>?$/.exec(op);
  if (m) return m[1].trim();
  // Also match `-- <label> ---` (undirected dashed)
  m = /^--\s+(.+?)\s*-{3,}$/.exec(op);
  if (m) return m[1].trim();

  // Dotted: `-. <label> .->` or `-. <label> .-`
  m = /^-\.\s+(.+?)\s*\.-(?:>)?$/.exec(op);
  if (m) return m[1].trim();

  // Thick: `== <label> ==>` or `== <label> ===`
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

    // Strip shape-bracket contents so operators/pipes inside labels vanish.
    const bracketStripped = stripBrackets(trimmed);

    // Collect pipe labels in the order they appear (before stripping them),
    // so we can zip them with the connectors that precede each one.
    // Pipe labels appear immediately after a connector operator, e.g.:
    //   A -->|label| B   or   A ---|label| B
    // We scan the bracket-stripped text for `|...|` and record their text.
    const pipeLabels: string[] = [];
    PIPE_LABEL_RE.lastIndex = 0;
    for (
      let pm = PIPE_LABEL_RE.exec(bracketStripped);
      pm !== null;
      pm = PIPE_LABEL_RE.exec(bracketStripped)
    ) {
      pipeLabels.push(pm[1]);
    }

    // Strip pipe labels (|...|) so the `|` is not mis-parsed as an id character.
    const clean = bracketStripped.replace(PIPE_LABEL_RE, '');

    // Check whether any link operator is present; if not, nothing to do.
    LINK_OP_RE.lastIndex = 0;
    if (!LINK_OP_RE.test(clean)) continue;

    // Split on link operators to get interleaved [group, op, group, op, group, …].
    LINK_OP_RE.lastIndex = 0;
    const parts = clean.split(LINK_OP_RE);
    // Even indices (0, 2, 4, …) are node-group tokens; odd indices are matched operators.
    const groups = parts.filter((_, idx) => idx % 2 === 0);
    const ops = parts.filter((_, idx) => idx % 2 === 1);

    // Determine the label for each operator (connector N → edge between group N and N+1):
    // - If the operator has an inline text label, use that.
    // - Otherwise, if there is a pipe label at position N in pipeLabels, use that.
    // - Otherwise, label is undefined.
    //
    // Pipe labels always follow the operator token: `A -->|label| B`.
    // After bracket-stripping and before pipe-label stripping, each `|...|` belongs
    // to the immediately preceding operator. Since we stripped brackets first,
    // `|...|` inside node labels are already gone. The Nth pipe label corresponds
    // to the Nth connector (op index N-1... actually the operator at index N in ops
    // is followed by the pipe label at ops index N in pipeLabels if there are no
    // inline-text ops before it). However, inline-text ops consume their label inside
    // the operator token itself and produce NO pipe label. So we need to pair pipe
    // labels with operators that don't have inline labels, in order.
    const connectorLabels: (string | undefined)[] = [];
    let pipeIdx = 0;
    for (const op of ops) {
      const inlineLabel = inlineLabelFromOp(op);
      if (inlineLabel !== undefined) {
        connectorLabels.push(inlineLabel);
        // This connector had an inline label; no pipe label consumed.
      } else {
        // Check if the next pipe label belongs to this connector.
        // A pipe label belongs to an operator if pipeLabels[pipeIdx] was found
        // between this operator and the next group in the original text.
        // Since we process left-to-right and pipe labels also appear left-to-right,
        // a pipe label at pipeLabels[pipeIdx] belongs to ops[pipeIdx minus any
        // already-inline consumed]. But since inline-text ops embed their label
        // inside the op string and produce NO pipe-label occurrence in the text,
        // the remaining pipe labels align 1:1 with non-inline operators.
        if (pipeIdx < pipeLabels.length) {
          connectorLabels.push(pipeLabels[pipeIdx]);
          pipeIdx++;
        } else {
          connectorLabels.push(undefined);
        }
      }
    }

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
      const label = connectorLabels[g];
      for (const source of sources) {
        for (const target of targets) {
          result.push({ source, target, line: lineNum, label });
        }
      }
    }
  }

  return result;
}
