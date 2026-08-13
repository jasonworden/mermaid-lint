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
 * but the headless ones (`---`, `===`, `-.-`) have to be here too: they are
 * real mermaid links, and without them `A[Start --- B` got its closer appended
 * at end of line, yielding `A[Start --- B]` — a single node labelled
 * "Start --- B" that parses cleanly and means something the author never wrote.
 *
 * The headless runs require *three* characters, not two. A bare `--` or `==`
 * is not a link — mermaid's shortest open link is `---`, and `A -- B` is a
 * parse error — so two dashes inside a label are just text. Accepting `-{2,}`
 * cut `A[Start--End` into `A[Start] --End`, which mermaid rejects; with the
 * run required to be complete, no link is found and the closer is appended to
 * give `A[Start--End]`, which it accepts.
 *
 * Deliberately written `-{1,2}>` rather than with a literal two-dash arrow: a
 * CodeQL rule fails CI on the literal form.
 */
export const LINK_START_RE =
  /(?:-{1,2}|={1,2})(?:>|[ox])|-\.-{0,2}>|-{3,}|={3,}|-\.-/;

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

/**
 * The opening tokens of every mermaid node shape spelled with these three
 * bracket pairs alone.
 *
 * A node shape is a *token*, not generic nesting: `([` opens a stadium and is
 * closed only by `])`, `[[` opens a subroutine and is closed only by `]]`.
 * Balance is therefore necessary but nowhere near sufficient —
 * `A([foo] bar) --> B` nests perfectly and mermaid rejects it. Anything not in
 * this set is a bracket run mermaid has no shape for, so a rewrite around it
 * cannot be vouched for.
 *
 * Shapes that involve other characters (`>...]`, `[/.../]`, `[\...\]`) are
 * deliberately absent: they are outside what this scanner tracks, and leaving
 * them out costs declines rather than lies.
 */
const SHAPE_OPENINGS = new Set([
  '[', // rectangle
  '(', // round
  '{', // rhombus
  '([', // stadium
  '[[', // subroutine
  '[(', // cylinder
  '((', // circle
  '{{', // hexagon
  '(((', // double circle
]);

/**
 * The closing token for a shape opening — the run *mirrored*, not merely each
 * delimiter paired: `([` closes with `])`, and `[(` with `)]`.
 */
function closingFor(opening: string): string {
  return [...opening]
    .reverse()
    .map((char) => CLOSER_FOR.get(char) ?? '')
    .join('');
}

const isOpener = (char: string) => CLOSER_FOR.has(char);
const isCloser = (char: string) => CLOSERS.has(char);

/**
 * `[start, end)` of the run of like delimiters that `index` sits inside.
 *
 * Shape tokens are runs — `([`, `]]`, `)))` — so every question this module
 * asks about one is a question about the run around a position, never about the
 * single character there.
 */
function runAround(
  text: string,
  index: number,
  member: (char: string) => boolean,
): [number, number] {
  let start = index;
  while (start > 0 && member(text[start - 1])) start--;
  let end = index + 1;
  while (end < text.length && member(text[end])) end++;
  return [start, end];
}

/**
 * The shape opening `openerIndex` belongs to, or `''` when some delimiter still
 * open at that moment sits outside it.
 *
 * The run is taken from the *text*, not from the stack, because a compound
 * opening can be half closed already: on `A([foo]] --> B` the `[` was matched
 * by the first `]` and only `(` is still open, yet the shape being repaired is
 * still the stadium `([`. Requiring every live opener to fall inside the run is
 * what keeps this a claim about one node — on `A[x ([foo} --> B` the `[` of
 * `A[x` is live and outside, so there is no single shape to reason about.
 */
function shapeOpeningAt(
  blanked: string,
  openerIndex: number,
  live: { index: number }[],
): string {
  const [start, end] = runAround(blanked, openerIndex, isOpener);
  for (const entry of live)
    if (entry.index < start || entry.index >= end) return '';
  return blanked.slice(start, end);
}

export interface ShapeDefect {
  kind: 'unclosed' | 'mismatched';
  opener: string;
  openerIndex: number;
  /** The disagreeing closer; empty for `'unclosed'`. */
  closer: string;
  /** Index of that closer; `-1` for `'unclosed'`. */
  closerIndex: number;
  /**
   * The shape opening `opener` belongs to — the run of openers around it — or
   * `''` when anything else was still open at that point, so the run is not the
   * whole story.
   *
   * Measured *at* the defect, which for a mismatch is the only place it can be
   * measured: the scan stops there, so this deliberately says nothing about the
   * rest of the line. Balance on the rewritten line is the separate check that
   * covers that.
   */
  openerRun: string;
}

/**
 * The first unbalanced node-shape delimiter on a line, or `undefined` when
 * every opener pairs with its own closer.
 *
 * *Pairing* deliberately ignores shape multiplicity — `[[`, `[(` and `[` all
 * push one `[`, and mermaid's expected-token list already said a closer was
 * wanted — so the delimiter this blames is the one a human would point at.
 * `openerRun` carries the multiplicity alongside, for the rewrites that need to
 * know which shape they are inside without changing which one is blamed.
 *
 * A surplus closer with nothing open is not a defect: on `A[Start]] --> B` the
 * pair really does agree and the extra `]` is the surplus, so both shape rules
 * stand down rather than name delimiters that match.
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
        openerRun: shapeOpeningAt(blanked, open.index, [...stack, open]),
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
    openerRun: shapeOpeningAt(blanked, unclosed.index, stack),
  };
}

/**
 * A rewrite is only worth offering if it leaves the line balanced.
 *
 * Both rewrites below repair exactly one delimiter, so the honest test of
 * whether that was enough is to re-scan the result rather than to count what
 * the original scan happened to have on its stack. Counting is what went
 * wrong twice: `scanShapes` stops at the first defect, so on the mismatch
 * branch its stack depth cannot see an opener further right — `A[foo} --> B[bar`
 * measured zero survivors and produced `A[foo] --> B[bar`, which mermaid
 * rejects. Checking the postcondition needs no per-branch threshold and cannot
 * miss a delimiter the scan never reached.
 *
 * Necessary, though, is not sufficient: balance is generic nesting and a
 * mermaid shape is a specific token, so `withCloserCorrected` ANDs this with a
 * shape check rather than resting on it. `withCloserInserted` needs nothing
 * more — one inserted closer cannot clear two unmatched openers, so balance
 * alone already implies the opener it repairs was the only one live.
 */
function ifBalanced(candidate: string): string | undefined {
  return scanShapes(candidate) === undefined ? candidate : undefined;
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
  if (defect.kind !== 'unclosed') return undefined;
  const closer = CLOSER_FOR.get(defect.opener);
  if (closer === undefined) return undefined;

  const after = blankQuoted(line).slice(defect.openerIndex + 1);
  const link = LINK_START_RE.exec(after);
  const cut = link === null ? line.length : defect.openerIndex + 1 + link.index;
  const head = line.slice(0, cut).trimEnd();
  if (head.length <= defect.openerIndex + 1) return undefined;

  const tail = line.slice(cut);
  return ifBalanced(
    tail.length === 0 ? `${head}${closer}` : `${head}${closer} ${tail}`,
  );
}

/**
 * The line with a disagreeing closer replaced by the opener's own.
 *
 * Two independent things have to hold, and neither implies the other:
 *
 * 1. **The rewritten line balances** (`ifBalanced`). This is what catches an
 *    opener the scan never reached, since it stops at the first defect: on
 *    `A[foo} --> B[bar`, `A[foo] --> B[bar` is still short a `]`.
 * 2. **The repaired node is spelled with a shape mermaid actually has.**
 *    Balance is only nesting, and mermaid's shapes are tokens: on
 *    `A([foo} bar) --> B` the rewrite `A([foo] bar) --> B` nests perfectly and
 *    mermaid rejects it, because a stadium's `([` is closed by `])` and by
 *    nothing else. So the opener run must be a known shape opening
 *    (`defect.openerRun` — `''` when another opener is live outside it), the
 *    closer run around the repaired delimiter must be exactly that shape's
 *    closing token, and the label between them must hold no bare delimiter.
 *
 * Each clause is load-bearing on a different input: `A[foo} --> B[bar` fails
 * only (1); `A([foo} bar) --> B` and `A[foo}] --> B` fail only the closing-token
 * half of (2); `A[x ([foo} --> B` fails only its opener-run half; and
 * `A[foo (bar) baz) --> B` fails only its label half.
 *
 * What the two together guarantee is narrow but real: the one node this touches
 * comes out spelled as a shape mermaid has, and the rest of the line is left
 * balanced. It is not a promise that mermaid accepts the whole line — a *second*
 * defect elsewhere on it is still a second defect, and `A[foo} bar --> B`
 * corrects to `A[foo] bar --> B`, where the stray `bar` was never this rule's to
 * see — but every way of getting the *brackets* wrong is ruled out.
 */
export function withCloserCorrected(
  line: string,
  defect: ShapeDefect,
): string | undefined {
  if (defect.kind !== 'mismatched') return undefined;
  const closer = CLOSER_FOR.get(defect.opener);
  if (closer === undefined) return undefined;
  if (!SHAPE_OPENINGS.has(defect.openerRun)) return undefined;

  const before = line.slice(0, defect.closerIndex);
  const after = line.slice(defect.closerIndex + 1);
  const candidate = `${before}${closer}${after}`;

  // Runs are located in the blanked line so a bracket inside a label can neither
  // pad a run nor split one; swapping one delimiter for another cannot move a
  // quote, so the blanked candidate has these same boundaries.
  const blanked = blankQuoted(line);
  const [, openEnd] = runAround(blanked, defect.openerIndex, isOpener);
  const [closeStart, closeEnd] = runAround(
    blanked,
    defect.closerIndex,
    isCloser,
  );
  if (candidate.slice(closeStart, closeEnd) !== closingFor(defect.openerRun))
    return undefined;

  // Delimiters left in the label mean the two tokens just matched are not the
  // whole shape after all: on `A[foo (bar) baz) --> B` the `[` and the `)`
  // mirror as a rectangle, but `A[foo (bar) baz]` is a label mermaid will not
  // take with the parens unquoted. Quoted brackets are blanked, so a properly
  // quoted label passes.
  if (/[[\](){}]/.test(blanked.slice(openEnd, closeStart))) return undefined;

  return ifBalanced(candidate);
}
