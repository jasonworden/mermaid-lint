import type { Block } from './extract.js';
import { validateWithMerman } from './merman.js';
import { RULE_DEFAULTS, type ResolvedRules } from './rules.js';
import { type SemanticWarning, checkSemantics } from './semantic.js';
import type { SuppressionIndex } from './suppress.js';

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
   * Any line number mermaid quotes inside this text is body-relative, matching
   * {@link ValidationError.line}. `blockToDiagnostics` maps both when it builds
   * a `Diagnostic`; code calling `validateBlock` directly and printing this
   * beside a file position should do the same.
   */
  message: string;
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
 * directly; parser errors carry the offending token. radar-beta reports a token
 * with no start line (hence its literal `on line ?`), which `coord` rejects.
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

  const token = (
    result.parserErrors as { token?: Record<string, unknown> }[]
  )?.[0]?.token;
  const parseLine = coord(token?.startLine);
  if (parseLine !== undefined)
    return { line: parseLine, col: coord(token?.startColumn) };

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
    const message = typeof e?.message === 'string' ? e.message : String(err);
    const hash = e?.hash as Record<string, unknown> | undefined;
    const loc = hash?.loc as Record<string, unknown> | undefined;

    // Four signals, in descending order of how directly each names the defect.
    //
    // `loc` is jison's offending token, which is what a diagnostic position
    // should mean, so it wins. `result` is the same thing for Langium grammars,
    // as data rather than prose. The cited number is the fallback for grammars
    // that publish neither, and is read from wording rather than structure —
    // last resort by design, and on an unclosed delimiter it names the line the
    // lexer gave up on rather than the one that opened it. `hash.line` sits
    // below all of them because for most jison grammars it is a 0-indexed
    // cursor one line above the defect; it is kept only for the few grammars
    // that set nothing else.
    const jisonLine = coord(loc?.first_line);
    const jisonCol = coord(loc?.first_column);
    const found: CitedPosition | undefined =
      jisonLine === undefined
        ? (structuredPosition(e) ?? citedPosition(message))
        : // jison counts columns from 0; every other signal is 1-indexed.
          {
            line: jisonLine,
            col: jisonCol === undefined ? undefined : jisonCol + 1,
          };

    // An unterminated construct (`subgraph`/`loop`/`alt` with no `end`) fails
    // on the EOF token, and every signal that names it points one line past the
    // body: at the closing fence in Markdown, or at nothing at all in a `.mmd`.
    // A diagnostic has to land inside the diagram it describes, and the last
    // body line is where the missing terminator belongs.
    const lastLine = body.split('\n').length;
    const line = found?.line ?? coord(hash?.line);

    return {
      ok: false as const,
      error: {
        message,
        line: line === undefined ? undefined : Math.min(line, lastLine),
        col: found?.col,
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
 * Validate an extracted {@link Block} end to end: structural checks (unclosed /
 * empty fence), semantic warnings, then the fast Rust (`merman`) parser with a
 * mermaid.js fallback for anything merman rejects. mermaid.js is treated as
 * authoritative on the final verdict.
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

  if (mermanResult.valid) {
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
