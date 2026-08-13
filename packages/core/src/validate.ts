import { FLOWCHART_DIRECTIONS } from './directions.js';
import { explainParseError } from './explain/index.js';
import { parseRawError } from './explain/parse-raw.js';
import type { Block } from './extract.js';
import { locateHeader } from './header.js';
import { validateWithMerman } from './merman.js';
import { parsedLineToBodyLine } from './preprocess.js';
import { RULE_DEFAULTS, type ResolvedRules } from './rules.js';
import { type SemanticWarning, checkSemantics } from './semantic/index.js';
import type { SuppressionIndex } from './suppress.js';
import { detectDiagramType } from './type-detect.js';

export type { SemanticWarning };

/**
 * A syntax error from diagram validation, with an optional location relative to
 * the diagram body.
 *
 * @public
 */
export interface ValidationError {
  /**
   * Human-readable error message.
   *
   * For a parser failure this is the *translated* text from `explainParseError`
   * — it names the defect and cites no line at all, because the position is
   * already carried structurally in {@link ValidationError.line}. So nothing in
   * here needs body→file mapping; a caller printing it beside a file position
   * may use it verbatim. {@link ValidationError.raw} is what carries mermaid's
   * own citations, and is what any such mapping should act on.
   */
  message: string;
  /**
   * mermaid's original message, verbatim except that every line number it cites
   * has been mapped into body coordinates, matching {@link ValidationError.line}.
   *
   * Present only for parser failures — structural defects never reach a parser.
   * `blockToDiagnostics` maps these citations on to file coordinates when it
   * builds a `Diagnostic`; code calling `validateBlock` directly and surfacing
   * this beside a file position should do the same.
   */
  raw?: string;
  /**
   * The one corrected source line the explanation is confident about, when it
   * is confident about one — the author's own line, rewritten.
   *
   * Quoted text, not prose: it holds whatever the author wrote, so it must
   * never be run through `mapParserMessageLines`. A line reading `Parse error
   * on line 2->>Bob: hi` is a sequence message, not a citation, and rewriting
   * the number in it would corrupt the user's own source.
   */
  suggestion?: string;
  /** True when `--fix` writes exactly {@link ValidationError.suggestion}. */
  fixable?: boolean;
  /** 1-indexed line within the diagram body, when known. */
  line?: number;
  /** 1-indexed column within the diagram body, when known. */
  col?: number;
  /**
   * True when the error is a defect in the *document* rather than the diagram
   * — an unclosed fence or an empty block — so no diagram was ever parsed.
   *
   * Suppression directives deliberately do not apply to these. An unclosed
   * fence has no parseable body (its `body` is the `__UNCLOSED_FENCE__`
   * sentinel), so no in-diagram `%%` directive can reach it and a
   * `-disable-file mermaid` would be the only lever — a blunt one that would
   * hide a broken fence indefinitely. Suppressing "mermaid rejected this
   * diagram" should not also suppress "your Markdown never closed".
   */
  structural?: boolean;
}

/**
 * Outcome of {@link validateBlock}: either valid (with any semantic warnings)
 * or invalid (with the syntax error and any warnings collected so far).
 *
 * @public
 */
export type ValidationResult =
  | { ok: true; warnings: SemanticWarning[] }
  | { ok: false; error: ValidationError; warnings: SemanticWarning[] };

// Mermaid v11 calls DOMPurify.sanitize during parse for some diagram types.
// DOMPurify requires a DOM window at module-evaluation time, so we bootstrap
// jsdom lazily before the first mermaid import via a dynamic import chain.
let _mermaidPromise: Promise<unknown> | null = null;

async function loadMermaid(): Promise<unknown> {
  if (!globalThis.window) {
    const { JSDOM } = await import('jsdom');
    const { window } = new JSDOM('');
    Object.defineProperty(globalThis, 'window', {
      value: window,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'document', {
      value: window.document,
      writable: true,
      configurable: true,
    });
    // sequenceDiagram `box` parser references bare `Option` (HTMLOptionElement),
    // which jsdom attaches to window but not globalThis.
    Object.defineProperty(globalThis, 'Option', {
      value: (window as unknown as Window & typeof globalThis).Option,
      writable: true,
      configurable: true,
    });
  }
  const { default: mermaid } = await import('mermaid');
  mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
  return mermaid;
}

function getMermaid(): Promise<unknown> {
  if (!_mermaidPromise) _mermaidPromise = loadMermaid();
  return _mermaidPromise;
}

/**
 * The line number mermaid cites in an error, always body-relative — the body is
 * all mermaid was handed.
 *
 * mermaid ships two parser families that word this identically but *lay it out*
 * differently, which is why the two need different anchoring below.
 */
const CITATION = String.raw`(?:Parse error|Lexical error|Lexer error) on line `;

/**
 * Langium prefixes its whole message with this, and is the only family that
 * does — so it doubles as the discriminator between the two layouts.
 */
const LANGIUM_PREFIX = 'Parsing failed:';

/**
 * jison puts one citation at the start of the message and echoes a snippet of
 * the user's diagram on the *next* line, so a citation is only ever real at a
 * line start. That anchor is load-bearing: a diagram may legitimately contain
 * the text "Parse error on line 9", and an unanchored pattern would rewrite the
 * user's own source back at them.
 *
 * The leading class excludes newlines deliberately. A plain `\s*` would, under
 * `m`, let every newline start a run that re-spans all the whitespace after it
 * — quadratic on a message carrying thousands of blank lines, the same
 * `js/polynomial-redos` shape the guards in `fix.ts` and `suppress.ts` avoid.
 * Excluding `\n` costs no matches, since any match whose leading whitespace
 * crossed a newline is found again at the later line-start anchor.
 */
const JISON_SOURCE = String.raw`^([^\S\n]*${CITATION})(\d+)`;

/**
 * Langium joins its lexer-error and parser-error groups with a space, all on
 * one line, so only the first of several citations starts a line — anchoring
 * here would map one number and leave the rest body-relative, putting two
 * coordinate systems in one message.
 *
 * Matching anywhere is safe because Langium always follows the line with a
 * column, and the lookahead requires it: the echoed token would have to spell
 * out a whole `on line N, column M` to be mistaken for a citation. The
 * lookahead is not consumed, so the column survives the rewrite untouched.
 */
const LANGIUM_SOURCE = String.raw`(${CITATION})(\d+)(?=, column )`;

/** Both families, in read-one and rewrite-all forms. Group 1 = head, 2 = digits. */
const JISON_RE = new RegExp(JISON_SOURCE, 'm');
const JISON_RE_ALL = new RegExp(JISON_SOURCE, 'gm');
const LANGIUM_RE = new RegExp(LANGIUM_SOURCE);
const LANGIUM_RE_ALL = new RegExp(LANGIUM_SOURCE, 'g');

/** Langium follows the line with a column; jison stops at the line. */
const PARSER_COL_RE = /^, column (\d+)/;

/** Pick the pattern matching how this message lays its citations out. */
function citationRe(message: string, all: boolean): RegExp {
  if (message.startsWith(LANGIUM_PREFIX))
    return all ? LANGIUM_RE_ALL : LANGIUM_RE;
  return all ? JISON_RE_ALL : JISON_RE;
}

/**
 * An unrecognized diagram type makes mermaid quote the entire body back and
 * cite no line of its own. Nothing in such a message is a citation, so neither
 * reading nor rewriting may touch it — the numbers there are the user's text.
 */
const ECHOES_BODY = 'No diagram type detected';

/** A body-relative position, as far as any one signal could determine it. */
interface CitedPosition {
  line: number;
  col?: number;
}

/** Narrow to a usable 1-indexed coordinate, rejecting `null`/`undefined`/`NaN`. */
function coord(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value)
    ? value
    : undefined;
}

/**
 * The position mermaid's Langium-based parsers attach to the error object.
 *
 * pie, packet-beta, gitGraph, architecture-beta, treemap-beta, radar-beta and
 * eventmodeling parse via Langium and throw without jison's `hash`, but they
 * carry a `result`
 * holding the very errors mermaid formatted its message from — so the position
 * is available as data rather than as prose. Lexer errors carry `line`/`column`
 * directly; parser errors carry the offending token.
 *
 * When input runs out mid-construct the offending token is Chevrotain's
 * end-of-input sentinel, whose `startLine`/`startColumn` are `NaN` — which is
 * what makes mermaid print a literal `on line ?, column ?` with no number for
 * the prose fallback to read either. The error still names the last token it
 * *did* consume, and that one is positioned, so an unterminated construct is
 * blamed on the last real line rather than on the block opener. This mirrors
 * what the jison branch already does for `subgraph`/`loop` with no `end`.
 * radar-beta is the only grammar observed to reach the sentinel — its siblings
 * stop at the trailing newline instead — but nothing here is radar-specific.
 */
function structuredPosition(
  err: Record<string, unknown>,
): CitedPosition | undefined {
  const result = err.result as Record<string, unknown> | undefined;
  if (!result) return undefined;

  const lexer = (
    result.lexerErrors as { line?: unknown; column?: unknown }[]
  )?.[0];
  const lexLine = coord(lexer?.line);
  if (lexLine !== undefined)
    return { line: lexLine, col: coord(lexer?.column) };

  const parserError = (
    result.parserErrors as {
      token?: Record<string, unknown>;
      previousToken?: Record<string, unknown>;
    }[]
  )?.[0];
  for (const token of [parserError?.token, parserError?.previousToken]) {
    const parseLine = coord(token?.startLine);
    if (parseLine !== undefined)
      return { line: parseLine, col: coord(token?.startColumn) };
  }

  return undefined;
}

/**
 * The body-relative position mermaid names in its own error prose, when it
 * names one. The last resort, for grammars that surface a position in neither
 * `hash` nor `result` — jison's lexical errors, which give a `hash` with no
 * `loc`.
 */
function citedPosition(message: string): CitedPosition | undefined {
  if (message.startsWith(ECHOES_BODY)) return undefined;
  const m = citationRe(message, false).exec(message);
  if (!m) return undefined;
  const col = PARSER_COL_RE.exec(message.slice(m.index + m[0].length));
  return { line: Number(m[2]), col: col ? Number(col[1]) : undefined };
}

/**
 * Rewrite every line number mermaid cites in its own prose, mapping each
 * through `map`.
 *
 * The numbers are body-relative but are read beside a file-absolute position,
 * so inside a Markdown fence they point at unrelated prose. Rule messages fix
 * this at the interpolation site via `RuleContext.fileLine`; parser output has
 * no such site, so the finished string is mapped instead.
 *
 * @internal
 */
export function mapParserMessageLines(
  message: string,
  map: (bodyLine: number) => number,
): string {
  if (message.startsWith(ECHOES_BODY)) return message;
  return message.replace(
    citationRe(message, true),
    (_full, head: string, n: string) => `${head}${map(Number(n))}`,
  );
}

/**
 * The position jison attaches to the offending token, when it attaches one.
 *
 * `loc` almost always names a token that sits on a single line, so `first_line`
 * and `last_line` agree and either end would do. They diverge when the token
 * runs across a newline, and the two ends then mean different things:
 *
 * - With a concrete token in `hash.text` — a stray `@` in `erDiagram`, a `:` in
 *   `timeline` — `first_line` is where the *whitespace* run leading up to that
 *   token began, back on the last line of valid content, and `last_line` is
 *   where the character itself sits. `last_line` is the defect, and is also the
 *   line mermaid's own message formatter cites, so taking it keeps the position
 *   and the prose from contradicting each other.
 * - With `hash.text` empty, no token was ever matched: the lexer ran off the
 *   end of an unterminated construct — `A[Start` with no `]` — and swallowed
 *   every line below it. `first_line` is where that construct opened, which is
 *   the defect; `last_line` is merely where scanning gave up.
 *
 * Surveyed across the jison grammars mermaid ships, that split held for every
 * diverging case found: er, timeline and journey stray tokens want `last_line`;
 * flowchart's unterminated `[`, `(`, `{` and `"` want `first_line`. So this
 * reads `hash.text` rather than preferring one end outright — the two ends are
 * not ranked, they answer different questions.
 *
 * jison counts columns from 0; every other signal here is 1-indexed. The column
 * is dropped when `last_line` wins, because `first_column` measures the line
 * the token *started* on rather than the one being blamed — `refineColumn`
 * locates the token on the blamed line instead.
 */
function jisonPosition(
  loc: Record<string, unknown> | undefined,
  hash: Record<string, unknown> | undefined,
): CitedPosition | undefined {
  const first = coord(loc?.first_line);
  if (first === undefined) return undefined;

  const last = coord(loc?.last_line);
  const token = typeof hash?.text === 'string' ? hash.text : '';
  if (last !== undefined && last !== first && token.trim().length > 0)
    return { line: last };

  const col = coord(loc?.first_column);
  return { line: first, col: col === undefined ? undefined : col + 1 };
}

/**
 * How long a body may be before bisection declines to look.
 *
 * Bisection costs `log2(lines)` extra parses, each over a prefix of the body,
 * so the work grows as `lines * log2(lines)` — a thousand-line diagram probes
 * ten times and settles in well under a second. Past that the guess stops being
 * worth the wait, and a diagram that large has bigger problems than a caret.
 */
const MAX_BISECT_LINES = 1000;

/** The message mermaid rejects `body` with, or `undefined` if it accepts it. */
async function parseMessage(body: string): Promise<string | undefined> {
  try {
    const mermaid = await getMermaid();
    await (
      mermaid as { parse(text: string, opts: object): Promise<unknown> }
    ).parse(body, { suppressErrors: false });
    return undefined;
  } catch (err: unknown) {
    const e = err as Record<string, unknown>;
    return typeof e?.message === 'string' ? e.message : String(err);
  }
}

/**
 * The body line an error first appears on, found by re-parsing prefixes of the
 * body.
 *
 * The last resort for errors that are not parse errors at all. A diagram module
 * runs its own checks on what it built *after* parsing succeeds — mindmap's
 * "only one root", gitGraph's "branch which is not yet created", packet-beta's
 * "not contiguous", architecture-beta's missing parent — and throws a plain
 * `Error` carrying no `hash`, no `result` and no cited line. Nothing in the
 * message names a position because the code raising it never had one, so
 * `structuredPosition` and `citedPosition` both come back empty and the
 * diagnostic collapses onto the block opener.
 *
 * The body still knows, though: the shortest prefix that reproduces the *same*
 * message is the one whose last line introduced the offending construct. That
 * makes this a measurement rather than a guess — and it degrades safely, since
 * a prefix failing some other way simply does not match. Requiring an exact
 * message match is what keeps it honest, and the full body always matches (it
 * is the parse we just made), so the search always terminates on a real answer.
 *
 * Prefixes are cut from the body itself, so the line returned is body-relative
 * already and must not be mapped through `parsedLineToBodyLine` a second time.
 *
 * The one message that must never be bisected is the echoed-body one: it quotes
 * the diagram back, so no prefix can ever match it except the whole body, and
 * the search would blame the last line of a diagram whose *type* was the defect.
 */
async function bisectedLine(
  body: string,
  message: string,
): Promise<number | undefined> {
  if (message.startsWith(ECHOES_BODY)) return undefined;
  const lines = body.split('\n');
  if (lines.length > MAX_BISECT_LINES) return undefined;

  // Lower bound over "this prefix already fails the same way". `hi` only ever
  // moves to a prefix that matched, and starts on the body that did.
  let lo = 1;
  let hi = lines.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((await parseMessage(lines.slice(0, mid).join('\n'))) === message)
      hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * Sharpen the reported column against the line it lands on.
 *
 * jison sets `first_column` from where the *previous* token ended, so it points
 * at the whitespace before the defect — or, when tokens run together, at the
 * token before it. It also sometimes names a column past the end of the line
 * entirely. `hash.text` carries the offending token itself, so searching for it
 * from the reported column lands on the real thing; only jison sets it, which
 * is why Langium's already-exact columns pass through untouched.
 *
 * Falls back to the first non-blank column rather than a column that does not
 * exist on the line — a caret on the first real character beats one past the
 * end, or none at all.
 */
function refineColumn(
  body: string,
  bodyLine: number | undefined,
  reported: number | undefined,
  jisonFirstColumn: number | undefined,
  err: Record<string, unknown>,
): number | undefined {
  if (bodyLine === undefined) return reported;
  const text = body.split('\n')[bodyLine - 1];
  if (text === undefined) return reported;

  const token = err.hash as Record<string, unknown> | undefined;
  const raw = typeof token?.text === 'string' ? token.text : '';
  if (raw.trim().length > 0) {
    const at = text.indexOf(raw, jisonFirstColumn ?? 0);
    if (at >= 0) return at + 1;
  }

  if (reported !== undefined && reported <= text.length) return reported;
  const firstNonBlank = text.search(/\S/);
  return firstNonBlank >= 0 ? firstNonBlank + 1 : reported;
}

async function runMermaidValidation(
  body: string,
): Promise<{ ok: true } | { ok: false; error: ValidationError }> {
  try {
    const mermaid = await getMermaid();
    await (
      mermaid as { parse(text: string, opts: object): Promise<unknown> }
    ).parse(body, { suppressErrors: false });
    return { ok: true as const };
  } catch (err: unknown) {
    const e = err as Record<string, unknown>;
    const raw = typeof e?.message === 'string' ? e.message : String(err);
    const hash = e?.hash as Record<string, unknown> | undefined;
    const loc = hash?.loc as Record<string, unknown> | undefined;

    // Three signals, in descending order of how directly each names the defect.
    //
    // `loc` is jison's offending token, which is what a diagnostic position
    // should mean, so it wins — see `jisonPosition` for which end of a token
    // that spans a newline answers that. `result` is the same thing for Langium
    // grammars, as data rather than prose. The cited number is read from
    // wording rather than structure, for grammars that publish neither — and on
    // an unclosed delimiter it names the line the lexer gave up on rather than
    // the one that opened it. When all three come back empty the error is not a
    // parse error at all, and `bisectedLine` below re-derives the position from
    // the body.
    const jison = jisonPosition(loc, hash);
    const found: CitedPosition | undefined =
      jison ?? structuredPosition(e) ?? citedPosition(raw);

    // Every number above counts lines in mermaid's *preprocessed* copy, not the
    // body — see `parsedLineToBodyLine`. Mapping here keeps `ValidationError`
    // wholly body-relative, so the adapters' body→file step stays the only
    // other hop. It also lands an unterminated construct (`subgraph`/`loop`
    // with no `end`, which fails on the EOF token one line past the end) back
    // on the last real line, where the missing terminator belongs.
    const toBody = (n: number) => parsedLineToBodyLine(body, n);
    const line =
      found === undefined ? await bisectedLine(body, raw) : toBody(found.line);

    // `raw` inherits what `message` used to do: it is the only field left
    // carrying mermaid's citations, so it is the only one mapped. Mapped once,
    // here, and handed to both consumers — the explain layer echoes this string
    // verbatim for the `module` family, so feeding it the unmapped copy would
    // put a parsed-copy line number inside an otherwise body-relative message.
    const mapped = mapParserMessageLines(raw, toBody);

    // Translated last, because the rules re-read the source line mermaid blamed
    // and `line` is only final here — after the signal chain, the body mapping
    // and any bisection have all had their say.
    const explanation = explainParseError({
      parsed: parseRawError(mapped),
      raw: mapped,
      type: detectDiagramType(body),
      body,
      line,
    });

    return {
      ok: false as const,
      error: {
        message: explanation.message,
        raw: mapped,
        // Deliberately unmapped — see `ValidationError.suggestion`.
        suggestion: explanation.suggestion,
        fixable: explanation.fixable,
        line,
        col: refineColumn(
          body,
          line,
          found?.col,
          // Only ever the column of the line being blamed: `jisonPosition`
          // withholds it when it takes the far end of a token that spans a
          // newline, so the token search below starts at the head of that line
          // rather than at an offset measured against a different one.
          jison?.col === undefined ? undefined : jison.col - 1,
          e,
        ),
      },
    };
  }
}

/**
 * Validate raw diagram source with the bundled mermaid.js parser, the
 * authoritative engine for error location and final verdict. Boots a jsdom
 * window lazily on first call. Returns a syntax error without semantic
 * warnings; use {@link validateBlock} for the full pipeline.
 *
 * @param body - Raw Mermaid diagram source.
 * @returns `{ ok: true }` if mermaid.js parses it, else `{ ok: false, error }`.
 * @public
 */
export async function validateWithMermaidJS(
  body: string,
): Promise<{ ok: true } | { ok: false; error: ValidationError }> {
  return runMermaidValidation(body);
}

/**
 * Diagram types whose `MERMAN_OK` verdict is not trustworthy, so the fast path
 * must not act on it.
 *
 * merman reports these as valid without truly parsing the body: `eventmodeling`
 * accepts anything at all, and `kanban` accepts some malformed bodies (it does
 * catch others, e.g. an unterminated `@{` metadata block). Taking the fast path
 * on that verdict skips mermaid.js entirely, so a broken diagram yields *zero*
 * diagnostics rather than a late one — a correctness bug, not a latency one.
 * See #153.
 *
 * A merman false *negative* needs no such list: rejecting a valid diagram only
 * costs the fallback, which then overrules it. Only false positives escape.
 *
 * This list cannot cover a type nobody has noticed yet, so it is a floor rather
 * than a guarantee. The invalid parity fixtures are what turn the next such
 * regression into a CI failure instead of silence — see `parity.test.ts`.
 */
const MERMAN_UNTRUSTED_TYPES = new Set(['eventmodeling', 'kanban']);

/**
 * Decide whether merman's `valid` verdict is strong enough to skip mermaid.js.
 *
 * Only false *positives* matter here — a merman rejection already falls through
 * to mermaid.js, which overrules it. Every check below is therefore a known way
 * merman claims valid for something mermaid cannot parse. When in doubt, return
 * false: the cost is one mermaid.js call, and the cost of a wrong `true` is a
 * broken diagram reported as clean.
 *
 * @param body - Raw diagram source.
 * @returns `true` when the fast path may accept on merman's word alone.
 */
function mermanVerdictIsTrustworthy(body: string): boolean {
  // Read the type off the body rather than the caller's `block.type`: hand-built
  // blocks from the remark and textlint adapters don't always populate it, and a
  // guard that fails open on a missing field is the bug it exists to prevent.
  const type = detectDiagramType(body);

  if (MERMAN_UNTRUSTED_TYPES.has(type)) return false;

  if (type === 'flowchart' || type === 'graph') {
    // Omitting the direction entirely is valid, so only a present-and-unknown
    // token defects. Anything past the direction is the grammar's problem.
    const [, direction] = locateHeader(body.split('\n')).text.split(/\s+/);
    if (direction !== undefined && !FLOWCHART_DIRECTIONS.has(direction)) {
      return false;
    }
  }

  return true;
}

/**
 * Validate an extracted {@link Block} end to end: structural checks (unclosed /
 * empty fence), semantic warnings, then the fast Rust (`merman`) parser with a
 * mermaid.js fallback for anything merman rejects. mermaid.js is treated as
 * authoritative on the final verdict.
 *
 * Bodies that fail `mermanVerdictIsTrustworthy` skip the fast path and always
 * consult mermaid.js, because merman claims to accept input it never really
 * parsed.
 *
 * @param block - The block to validate.
 * @param rules - Resolved per-rule severities for the semantic pass. Defaults
 *   to {@link RULE_DEFAULTS}.
 * @param index - Suppression index to consult for semantic findings. Forwarded
 *   to {@link checkSemantics}.
 * @returns A {@link ValidationResult} carrying the verdict and any warnings.
 * @public
 */
export async function validateBlock(
  block: Block,
  rules: ResolvedRules = RULE_DEFAULTS,
  index?: SuppressionIndex,
): Promise<ValidationResult> {
  const { body } = block;

  if (body === '__UNCLOSED_FENCE__') {
    return {
      ok: false,
      error: {
        message: 'unclosed ```mermaid fence (no closing ``` found)',
        structural: true,
      },
      warnings: [],
    };
  }
  if (!body.trim()) {
    return {
      ok: false,
      error: { message: 'empty mermaid block', structural: true },
      warnings: [],
    };
  }

  const warnings = checkSemantics(block, rules, index);

  const mermanResult = await validateWithMerman(body);

  if (mermanResult.valid && mermanVerdictIsTrustworthy(body)) {
    // Fast path: merman confirmed valid — skip mermaid.js entirely
    return { ok: true, warnings };
  }

  // Any non-valid result (parse error, unsupported type, panic) —
  // fall back to mermaid.js which is authoritative for error location and final verdict.
  // If mermaid.js accepts it, trust mermaid.js (merman may be stricter on edge cases).
  const mermaidResult = await runMermaidValidation(body);
  if (!mermaidResult.ok) {
    return { ok: false, error: mermaidResult.error, warnings };
  }
  return { ok: true, warnings };
}
