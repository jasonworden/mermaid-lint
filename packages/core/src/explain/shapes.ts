/**
 * Node-shape delimiter analysis for the Tier 1 explain rules.
 *
 * `rules.ts` is a declarative catalogue; this is the one piece of it with real
 * state and invariants of its own — a delimiter stack, index arithmetic that
 * has to survive quoting, and two rewrites that must produce source mermaid
 * still parses. It lives here so it can be tested directly rather than only
 * through the rule table.
 */

/**
 * Where a mermaid flowchart link begins.
 *
 * The single definition of that notion for the explain layer: this module uses
 * it to decide where a node's label has to end, and `rules.ts` builds its
 * `end`-as-node-id pattern from `.source` rather than re-spelling it.
 *
 * Headed links (`-->`, `==>`, `--x`) come first so they win at a given index,
 * but the headless ones (`--`, `---`, `===`, `-.-`) have to be here too: they
 * are real mermaid links, and without them `A[Start -- B` got its closer
 * appended at end of line, yielding `A[Start -- B]` — a single node labelled
 * "Start -- B" that parses cleanly and means something the author never wrote.
 *
 * Deliberately written `-{1,2}>` rather than with a literal two-dash arrow: a
 * CodeQL rule fails CI on the literal form.
 */
export const LINK_START_RE =
  /(?:-{1,2}|={1,2})(?:>|[ox])|-\.-{0,2}>|-{2,}|={2,}|-\.-/;

/**
 * Complete double-quoted segments.
 *
 * Only `"` counts. Mermaid quotes labels with `"`; `'` is ordinary label text,
 * and `A[don't]` is a perfectly good node. Treating `'` as a delimiter made a
 * pair of apostrophes on one line blank everything between them — including
 * real arrows and real brackets — so the scanner silently went blind on a
 * common label form.
 */
const QUOTED_SEGMENT_RE = /("[^"]*")/;

/**
 * The line with every *complete* quoted segment replaced by spaces, so scans
 * see label text as inert while every index still lines up with the original.
 *
 * An unterminated quote leaves the line untouched, which is what makes the
 * shape rules decline on it rather than blame a bracket.
 */
export function blankQuoted(line: string): string {
  return line
    .split(QUOTED_SEGMENT_RE)
    .map((part, i) => (i % 2 === 1 ? ' '.repeat(part.length) : part))
    .join('');
}

const CLOSER_FOR = new Map([
  ['[', ']'],
  ['(', ')'],
  ['{', '}'],
]);
const CLOSERS = new Set(CLOSER_FOR.values());

export interface ShapeDefect {
  kind: 'unclosed' | 'mismatched';
  opener: string;
  openerIndex: number;
  /** The disagreeing closer; empty for `'unclosed'`. */
  closer: string;
  /** Index of that closer; `-1` for `'unclosed'`. */
  closerIndex: number;
  /**
   * How many openers were still unmatched when the scan stopped. More than one
   * means a single inserted closer cannot repair the line.
   */
  unclosedCount: number;
}

/**
 * The first unbalanced node-shape delimiter on a line, or `undefined` when
 * every opener pairs with its own closer.
 *
 * Shape *multiplicity* is deliberately ignored — `[[`, `[(` and `[` all count
 * as one `[`, and mermaid's expected-token list already said a closer was
 * wanted. A surplus closer with nothing open is not a defect: on
 * `A[Start]] --> B` the pair really does agree and the extra `]` is the
 * surplus, so both shape rules stand down rather than name delimiters that
 * match.
 */
export function scanShapes(line: string): ShapeDefect | undefined {
  const blanked = blankQuoted(line);
  const stack: { char: string; index: number }[] = [];

  for (let i = 0; i < blanked.length; i++) {
    const char = blanked[i];
    if (CLOSER_FOR.has(char)) {
      stack.push({ char, index: i });
      continue;
    }
    if (!CLOSERS.has(char)) continue;
    const open = stack.pop();
    if (open === undefined) continue;
    if (CLOSER_FOR.get(open.char) !== char)
      return {
        kind: 'mismatched',
        opener: open.char,
        openerIndex: open.index,
        closer: char,
        closerIndex: i,
        unclosedCount: stack.length,
      };
  }

  const unclosed = stack[stack.length - 1];
  if (unclosed === undefined) return undefined;
  return {
    kind: 'unclosed',
    opener: unclosed.char,
    openerIndex: unclosed.index,
    closer: '',
    closerIndex: -1,
    unclosedCount: stack.length,
  };
}

/**
 * The line with the missing closer inserted — before the first link if one
 * follows the opener, so `A[Start --> B` becomes `A[Start] --> B` rather than
 * a single node labelled "Start --> B".
 *
 * Returns `undefined` rather than a broken guess when the repair is not a
 * single insertion: more than one opener is still unmatched (one `]` would
 * leave the outer one open), or there is no label text to close around, since
 * `C[]` is no better than `C[`.
 *
 * The link is located in the *blanked* line. Searching the raw line let an
 * arrow inside a quoted label choose the cut point, splitting the label and
 * producing a suggestion mermaid rejects.
 */
export function withCloserInserted(
  line: string,
  defect: ShapeDefect,
): string | undefined {
  if (defect.kind !== 'unclosed' || defect.unclosedCount > 1) return undefined;
  const closer = CLOSER_FOR.get(defect.opener);
  if (closer === undefined) return undefined;

  const after = blankQuoted(line).slice(defect.openerIndex + 1);
  const link = LINK_START_RE.exec(after);
  const cut = link === null ? line.length : defect.openerIndex + 1 + link.index;
  const head = line.slice(0, cut).trimEnd();
  if (head.length <= defect.openerIndex + 1) return undefined;

  const tail = line.slice(cut);
  return tail.length === 0 ? `${head}${closer}` : `${head}${closer} ${tail}`;
}

/** The line with a disagreeing closer replaced by the opener's own. */
export function withCloserCorrected(
  line: string,
  defect: ShapeDefect,
): string | undefined {
  if (defect.kind !== 'mismatched') return undefined;
  const closer = CLOSER_FOR.get(defect.opener);
  if (closer === undefined) return undefined;
  const before = line.slice(0, defect.closerIndex);
  const after = line.slice(defect.closerIndex + 1);
  return `${before}${closer}${after}`;
}
