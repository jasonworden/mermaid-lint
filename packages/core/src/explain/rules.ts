import { FLOWCHART_DIRECTIONS } from '../directions.js';
import { SEQ_MISSING_COLON_RE } from '../fix.js';
import { locateFrontmatter, locateHeader } from '../header.js';
import { KNOWN_DIAGRAM_TYPES, nearestDiagramType } from './diagram-types.js';
import type { ParsedParserError } from './parse-raw.js';
import {
  LINK_START_RE,
  blankQuoted,
  scanShapes,
  withCloserCorrected,
  withCloserInserted,
} from './shapes.js';

/**
 * Everything a rule may look at: mermaid's normalized signature, its original
 * text, and the diagram source the signature came from.
 *
 * @internal
 */
export interface ExplainInput {
  parsed: ParsedParserError;
  raw: string;
  /** `detectDiagramType(body)`. */
  type: string;
  body: string;
  /** 1-indexed body line, when the signal chain resolved one. */
  line?: number;
}

/** A rule's verdict on one parse failure. @internal */
export interface Explanation {
  message: string;
  suggestion?: string;
  fixable?: boolean;
}

/**
 * One Tier 1 translation, gated twice.
 *
 * `matches` reads only the token signature, which is cheap but ambiguous:
 * several distinct authoring mistakes collapse onto the same expected/got pair.
 * `confirm` then re-reads the offending source and returns `undefined` to
 * decline — a rule that fires on a diagram it misread states a confident
 * falsehood, which is worse than the jargon it replaced. Declining costs
 * nothing: Tier 2 still declutters mermaid's own wording.
 *
 * `confirm` is also where suggestions come from, so they quote the author's
 * real node and participant names instead of a template.
 *
 * @internal
 */
export interface ExplainRule {
  id: string;
  matches(input: ExplainInput): boolean;
  /** Re-read the source and either explain or decline. */
  confirm(sourceLine: string, input: ExplainInput): Explanation | undefined;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** The body's header: its 1-indexed line, trimmed text, and verbatim source. */
function headerOf(
  body: string,
): { line: number; text: string; raw: string } | undefined {
  const lines = body.split('\n');
  const { line, text } = locateHeader(lines);
  return text.length === 0 ? undefined : { line, text, raw: lines[line - 1] };
}

/** Replace the nth whitespace-delimited word of `line`, keeping its spacing. */
function replaceWord(line: string, index: number, replacement: string): string {
  const pattern = index === 0 ? /^(\s*)(\S+)/ : /^(\s*\S+\s+)(\S+)/;
  return line.replace(pattern, (_match, head: string) => head + replacement);
}

/** Every token mermaid names when it wanted a node-shape closer. */
const SHAPE_CLOSER_TOKENS = [
  'SQE',
  'PE',
  'STADIUMEND',
  'SUBROUTINEEND',
  'CYLINDEREND',
  'DIAMOND_STOP',
  'DOUBLECIRCLEEND',
];

function expectsShapeCloser(input: ExplainInput): boolean {
  return SHAPE_CLOSER_TOKENS.some((token) =>
    input.parsed.expected.includes(token),
  );
}

function expectsLink(input: ExplainInput): boolean {
  const { expected } = input.parsed;
  return expected.includes('LINK') || expected.includes('START_LINK');
}

function isFlowchart(input: ExplainInput): boolean {
  return input.type === 'flowchart' || input.type === 'graph';
}

// ---------------------------------------------------------------------------
// Rule-local patterns
// ---------------------------------------------------------------------------

/**
 * A one-dash arrow that is not part of a longer link (`==>`, `-.->`, `->>`, or
 * the two-dash form), plus the quote split and replacement that go with it.
 *
 * All three mirror `normalizeFlowchartArrows` in `fix.ts` character for
 * character, so this rule's suggestion is exactly what `--fix` will write. That
 * includes the `["']` split, which differs from {@link blankQuoted}'s
 * `"`-only rule: `fix.ts` treats an apostrophe as a quote, so it declines to
 * rewrite `A[don't] -> B[won't]`. Narrowing it here alone would make this rule
 * promise a `fixable` correction `--fix` then refuses to perform, which is the
 * one thing sharing `SEQ_MISSING_COLON_RE` exists to prevent. The fix belongs
 * in `fix.ts`, for both at once.
 *
 * The `/g` copy is derived rather than shared: `test` on a global regex
 * advances `lastIndex`, so one object used for both the gate and the rewrite
 * would skip every other match.
 */
const SINGLE_DASH_ARROW_RE = /(?<![=\-.])-{1}>(?![>-])/;
const SINGLE_DASH_ARROW_GLOBAL_RE = new RegExp(
  SINGLE_DASH_ARROW_RE.source,
  'g',
);
const FIX_QUOTED_SEGMENT_RE = /(["'][^"']*["'])/;
const TWO_DASH_ARROW = '-->';

const NOTE_PREFIX_RE = /^\s*Note\s+(over|left of|right of)\s+/i;
const NOTE_OVER_RE =
  /^(\s*Note\s+over\s+)([^\s,]+(?:\s*,\s*[^\s,]+)*)\s+(\S.*)$/i;
const NOTE_SIDE_RE = /^(\s*Note\s+(?:left|right) of\s+)(\S+)\s+(\S.*)$/i;

/**
 * An arrow whose target is a bare `end` and nothing else. Built from
 * {@link LINK_START_RE} rather than re-spelled, so there is one definition of
 * what a link looks like and no second place to re-remember the `-{1,2}>` form.
 */
const ARROW_TO_BARE_END_RE = new RegExp(
  `(?:${LINK_START_RE.source})\\s*end\\s*$`,
);
const TRAILING_END_RE = /end(\s*)$/;

/**
 * Two bare words where a node id belongs, followed by a link. Kept to the
 * two-word shape on purpose: with three or more, which words form the id and
 * which the label is a guess.
 */
const SPACE_IN_ID_RE = /^(\s*)(\w+)\s+(\w+)(\s+-{1,2}>)/;

/**
 * A `[...]` label holding an unquoted `(`. The text before the paren excludes
 * `(` so the two runs can never match the same characters — adjacent unbounded
 * quantifiers over overlapping classes are what `js/polynomial-redos` flags.
 */
const UNQUOTED_PAREN_LABEL_RE = /\[([^"'[\]()]*\([^"'[\]]*)\]/;

/**
 * Block keywords mermaid closes with `end`, partitioned by diagram type.
 *
 * The partition is the whole point. `loop`, `alt`, `opt`, `par`, `critical`,
 * `rect` and `break` are sequence-diagram keywords and every one of them is a
 * legal flowchart *node id* — `flowchart LR / loop --> retry` opens no block at
 * all. One combined set invented a block from that node and told the author it
 * was never closed.
 */
const BLOCK_OPEN_RE_FOR = new Map([
  ['flowchart', /^(subgraph)\b/],
  ['graph', /^(subgraph)\b/],
  ['sequenceDiagram', /^(loop|alt|opt|par_over|par|critical|rect|break)\b/],
]);
const BLOCK_END_RE = /^end\b/;

/**
 * The innermost block keyword left open at the end of the body, or `undefined`
 * — including when the diagram type has no `end`-closed blocks we model, since
 * inventing one is worse than declining.
 *
 * A keyword only opens a block at the start of a line *and* with no link on
 * that line: `subgraph` inside a node label is label text, and `loop --> retry`
 * is a node statement. Frontmatter and `%%` comments are skipped entirely.
 */
function unclosedBlock(body: string, type: string): string | undefined {
  const openRe = BLOCK_OPEN_RE_FOR.get(type);
  if (openRe === undefined) return undefined;

  const lines = body.split('\n');
  const frontmatter = locateFrontmatter(lines);
  const stack: string[] = [];

  for (let i = frontmatter ? frontmatter.end + 1 : 0; i < lines.length; i++) {
    const line = blankQuoted(lines[i]).trimStart();
    if (line.startsWith('%%')) continue;
    const open = openRe.exec(line);
    if (open && !LINK_START_RE.test(line)) {
      stack.push(open[1]);
      continue;
    }
    if (BLOCK_END_RE.test(line)) stack.pop();
  }

  return stack.pop();
}

/**
 * The direction the author meant, when that is knowable without guessing.
 *
 * Only a case-insensitive exact match counts. Edit distance is worthless on
 * two-letter tokens — `TR` sits one edit from `TB`, `TD` and `LR` at once — so
 * anything else gets the message without a correction.
 */
function nearestDirection(word: string): string | undefined {
  const lower = word.toLowerCase();
  for (const direction of FLOWCHART_DIRECTIONS)
    if (direction.toLowerCase() === lower) return direction;
  return undefined;
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

/**
 * Tier 1 translations, in priority order: the first rule that both matches and
 * confirms wins.
 *
 * Order is load-bearing twice. `sequence-note-missing-colon` precedes
 * `sequence-missing-colon` because both key on the same signature and the Note
 * form is narrower. `flowchart-mismatched-shape` precedes
 * `flowchart-unclosed-shape` because a line closed by the wrong delimiter also
 * reads as unclosed once the mismatch is ignored.
 *
 * No message here may name a line number. The diagnostic carries exactly one
 * position and there is no mechanism to map a second one, which inside a fenced
 * Markdown file would print a line that does not exist.
 *
 * @internal
 */
export const EXPLAIN_RULES: readonly ExplainRule[] = [
  {
    id: 'unknown-diagram-type',
    matches: (input) => input.parsed.family === 'no-diagram-type',
    confirm(_sourceLine, input) {
      const header = headerOf(input.body);
      if (header === undefined) return undefined;
      const word = header.text.split(/\s+/)[0];
      // mermaid says the same thing when a real type is not registered in the
      // running config. Calling a correctly spelled keyword unknown would lie.
      if (KNOWN_DIAGRAM_TYPES.includes(word)) return undefined;

      const nearest = nearestDiagramType(word);
      if (nearest === undefined)
        return { message: `unknown diagram type \`${word}\`` };
      return {
        message: `unknown diagram type \`${word}\`; did you mean \`${nearest}\`?`,
        suggestion: replaceWord(header.raw, 0, nearest),
      };
    },
  },

  {
    id: 'flowchart-bad-direction',
    matches: (input) =>
      input.parsed.family === 'jison-lexical' && isFlowchart(input),
    confirm(_sourceLine, input) {
      const header = headerOf(input.body);
      if (header === undefined) return undefined;
      // mermaid rejects a bad direction on the header line itself, wherever
      // that line falls — comments, blank lines and frontmatter shift its
      // reported line and `locateHeader` in lockstep (pinned in the tests).
      // Any other blamed line means the lexer tripped further down and the
      // header is a bystander.
      //
      // Belt and braces: cutting the direction at `;` below already declines
      // every such case we can construct, because a header whose direction
      // token is not a real direction is one mermaid rejects *at the header*.
      // This guard is kept because that is a claim about mermaid's behaviour
      // rather than about our own code — `FLOWCHART_DIRECTIONS` is a fail-safe
      // routing hint in `validate.ts` ("when in doubt, call mermaid"), not
      // evidence that a header is invalid, and inverting it into an assertion
      // of invalidity is what made this rule libel `graph TD;` in the first
      // place.
      if (input.line !== header.line) return undefined;

      const word = header.text.split(/\s+/)[1];
      if (word === undefined) return undefined;
      // `;` ends the statement, so the direction is whatever precedes the
      // first one — not the whole whitespace-delimited token. `graph TD;` is
      // the README spelling, and `graph TD;A-->B` puts an entire statement on
      // the header line; both are valid, and both name the direction `TD`.
      const direction = word.split(';')[0];
      if (direction.length === 0 || FLOWCHART_DIRECTIONS.has(direction))
        return undefined;

      const message = `\`${direction}\` is not a valid flowchart direction`;
      const nearest = nearestDirection(direction);
      if (nearest === undefined) return { message };
      return {
        message: `${message}; did you mean \`${nearest}\`?`,
        // Keep whatever punctuation followed the direction word.
        suggestion: replaceWord(
          header.raw,
          1,
          nearest + word.slice(direction.length),
        ),
      };
    },
  },

  {
    id: 'sequence-note-missing-colon',
    matches: (input) =>
      input.type === 'sequenceDiagram' &&
      input.parsed.expected.includes('TXT') &&
      input.parsed.got === 'NEWLINE',
    confirm(sourceLine) {
      if (!NOTE_PREFIX_RE.test(sourceLine)) return undefined;
      // A colon after the placement means the note already has its separator;
      // whatever mermaid tripped on, it was not a missing one.
      if (sourceLine.replace(NOTE_PREFIX_RE, '').includes(':'))
        return undefined;

      const message = '`Note` is missing a colon before its text';
      const parts =
        NOTE_OVER_RE.exec(sourceLine) ?? NOTE_SIDE_RE.exec(sourceLine);
      if (parts === null) return { message };
      return { message, suggestion: `${parts[1]}${parts[2]}: ${parts[3]}` };
    },
  },

  {
    id: 'sequence-missing-colon',
    matches: (input) =>
      input.type === 'sequenceDiagram' &&
      input.parsed.expected.includes('TXT') &&
      input.parsed.got === 'NEWLINE',
    confirm(sourceLine) {
      const parts = SEQ_MISSING_COLON_RE.exec(sourceLine);
      if (parts === null) return undefined;
      return {
        message: 'sequence message is missing a colon',
        // Same captures `fixSequenceColons` rebuilds from, so the suggestion is
        // byte-for-byte what `--fix` will write.
        suggestion: `${parts[1]}${parts[2]}${parts[3]}${parts[4]}: ${parts[5]}`,
        fixable: true,
      };
    },
  },

  {
    id: 'flowchart-single-dash-arrow',
    matches: (input) => expectsLink(input) && input.parsed.got === 'MINUS',
    confirm(sourceLine) {
      // One split feeds both the gate and the rewrite, so this rule can never
      // claim an arrow it would then decline to rewrite — or vice versa.
      const parts = sourceLine.split(FIX_QUOTED_SEGMENT_RE);
      const isQuoted = (i: number) => i % 2 === 1;
      if (
        !parts.some(
          (part, i) => !isQuoted(i) && SINGLE_DASH_ARROW_RE.test(part),
        )
      )
        return undefined;
      return {
        message:
          '`->` is not a flowchart arrow — flowchart arrows need two dashes',
        suggestion: parts
          .map((part, i) =>
            isQuoted(i)
              ? part
              : part.replace(SINGLE_DASH_ARROW_GLOBAL_RE, TWO_DASH_ARROW),
          )
          .join(''),
        fixable: true,
      };
    },
  },

  {
    id: 'flowchart-space-in-id',
    matches: (input) =>
      expectsLink(input) && input.parsed.got === 'NODE_STRING',
    confirm(sourceLine) {
      const parts = SPACE_IN_ID_RE.exec(sourceLine);
      if (parts === null) return undefined;
      const [full, indent, first, second, arrow] = parts;
      return {
        message: `node id \`${first} ${second}\` contains a space — put the text in a label instead`,
        suggestion: `${indent}${first}${second}[${first} ${second}]${arrow}${sourceLine.slice(full.length)}`,
      };
    },
  },

  {
    id: 'flowchart-mismatched-shape',
    matches: (input) =>
      expectsShapeCloser(input) &&
      input.parsed.got !== undefined &&
      SHAPE_CLOSER_TOKENS.includes(input.parsed.got),
    confirm(sourceLine) {
      const defect = scanShapes(sourceLine);
      if (defect?.kind !== 'mismatched') return undefined;
      return {
        message: `node label opened with \`${defect.opener}\` is closed with \`${defect.closer}\``,
        suggestion: withCloserCorrected(sourceLine, defect),
      };
    },
  },

  {
    id: 'flowchart-unclosed-shape',
    matches: expectsShapeCloser,
    confirm(sourceLine) {
      const defect = scanShapes(sourceLine);
      if (defect?.kind !== 'unclosed') return undefined;
      return {
        message: `node label opened with \`${defect.opener}\` was never closed`,
        suggestion: withCloserInserted(sourceLine, defect),
      };
    },
  },

  {
    id: 'flowchart-unquoted-paren',
    matches: (input) => expectsShapeCloser(input) && input.parsed.got === 'PS',
    confirm(sourceLine) {
      const label = UNQUOTED_PAREN_LABEL_RE.exec(sourceLine);
      if (label === null) return undefined;
      const before = sourceLine.slice(0, label.index);
      const after = sourceLine.slice(label.index + label[0].length);
      return {
        message: '`(` inside a label needs quoting',
        suggestion: `${before}["${label[1]}"]${after}`,
      };
    },
  },

  {
    id: 'flowchart-reserved-end',
    matches: (input) => input.parsed.got === 'end',
    confirm(sourceLine) {
      if (!ARROW_TO_BARE_END_RE.test(sourceLine)) return undefined;
      return {
        message: '`end` is a reserved word and cannot be used as a node id',
        suggestion: sourceLine.replace(TRAILING_END_RE, 'End$1'),
      };
    },
  },

  {
    id: 'block-missing-end',
    matches: (input) => input.parsed.expected.includes('end'),
    confirm(_sourceLine, input) {
      const keyword = unclosedBlock(input.body, input.type);
      if (keyword === undefined) return undefined;
      return {
        message: `\`${keyword}\` block was never closed with \`end\``,
      };
    },
  },
];
