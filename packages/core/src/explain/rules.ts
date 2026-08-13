import { FLOWCHART_DIRECTIONS } from '../directions.js';
import { SEQ_MISSING_COLON_RE } from '../fix.js';
import { locateFrontmatter, locateHeader } from '../header.js';
import { KNOWN_DIAGRAM_TYPES, nearestDiagramType } from './diagram-types.js';
import type { ParsedParserError } from './parse-raw.js';

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

/** Complete quoted segments, split out so brackets inside them don't count. */
const QUOTED_SEGMENT_RE = /(["'][^"']*["'])/;

/**
 * The line with every *complete* quoted segment replaced by spaces, so
 * delimiter scans see label text as inert while every index still lines up
 * with the original. An unterminated quote leaves the line untouched, which is
 * what makes the shape rules decline on it rather than blame a bracket.
 */
function blankQuoted(line: string): string {
  return line
    .split(QUOTED_SEGMENT_RE)
    .map((part, i) => (i % 2 === 1 ? ' '.repeat(part.length) : part))
    .join('');
}

/** The body's header line verbatim, indentation kept, or `undefined`. */
function headerLine(body: string): string | undefined {
  const lines = body.split('\n');
  const { line, text } = locateHeader(lines);
  return text.length === 0 ? undefined : lines[line - 1];
}

function headerWords(body: string): string[] | undefined {
  const header = headerLine(body);
  return header === undefined ? undefined : header.trim().split(/\s+/);
}

/** Replace the nth whitespace-delimited word of `line`, keeping its spacing. */
function replaceWord(line: string, index: number, replacement: string): string {
  const pattern = index === 0 ? /^(\s*)(\S+)/ : /^(\s*\S+\s+)(\S+)/;
  return line.replace(pattern, (_match, head: string) => head + replacement);
}

/**
 * Flowchart link openers, used to find where a node's label has to end.
 * Deliberately spelled `-{1,2}>` rather than with a literal two-dash arrow: a
 * CodeQL rule fails CI on the literal form.
 */
const LINK_START_RE = /(?:-{1,2}|={1,2})(?:>|[ox])|-\.-{0,2}>/;

// ---------------------------------------------------------------------------
// Node-shape delimiters
// ---------------------------------------------------------------------------

const CLOSER_FOR = new Map([
  ['[', ']'],
  ['(', ')'],
  ['{', '}'],
]);
const CLOSERS = new Set(CLOSER_FOR.values());

interface ShapeDefect {
  kind: 'unclosed' | 'mismatched';
  opener: string;
  openerIndex: number;
  /** Present only for `'mismatched'`. */
  closer: string;
  closerIndex: number;
}

/**
 * The first unbalanced node-shape delimiter on a line, or `undefined` when
 * every opener pairs with its own closer.
 *
 * Shape *multiplicity* is deliberately ignored — `[[`, `[(` and `[` all count
 * as one `[`, and mermaid's expected-token list already told us a closer was
 * wanted. A surplus closer with nothing open is not treated as a defect: on
 * `A[Start]] --> B` the pair really does agree and the extra `]` is the
 * surplus, so both shape rules stand down rather than name delimiters that
 * match.
 */
function scanShapes(line: string): ShapeDefect | undefined {
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
      };
  }

  const unclosed = stack.pop();
  if (unclosed === undefined) return undefined;
  return {
    kind: 'unclosed',
    opener: unclosed.char,
    openerIndex: unclosed.index,
    closer: '',
    closerIndex: -1,
  };
}

/**
 * The line with the missing closer inserted — before the first link if one
 * follows the opener, so `A[Start --> B` becomes `A[Start] --> B` rather than
 * a single node labelled "Start --> B". Returns `undefined` when there is no
 * label text to close around, since `C[]` is no more valid than `C[`.
 */
function withCloserInserted(
  line: string,
  defect: ShapeDefect,
): string | undefined {
  const closer = CLOSER_FOR.get(defect.opener);
  if (closer === undefined) return undefined;

  const after = line.slice(defect.openerIndex + 1);
  const link = LINK_START_RE.exec(after);
  const cut = link === null ? line.length : defect.openerIndex + 1 + link.index;
  const head = line.slice(0, cut).trimEnd();
  if (head.length <= defect.openerIndex + 1) return undefined;

  const tail = line.slice(cut);
  return tail.length === 0 ? `${head}${closer}` : `${head}${closer} ${tail}`;
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
 * the two-dash form). Spelled and replaced exactly as `normalizeFlowchartArrows`
 * in `fix.ts` does, so the suggestion is what `--fix` would write.
 *
 * The `/g` copy is a separate literal rather than a shared one: `test` on a
 * global regex advances `lastIndex`, so one object used for both the gate and
 * the rewrite would skip matches on every other call.
 */
const SINGLE_DASH_ARROW_RE = /(?<![=\-.])-{1}>(?![>-])/;
const SINGLE_DASH_ARROW_GLOBAL_RE = /(?<![=\-.])-{1}>(?![>-])/g;
const TWO_DASH_ARROW = '-->';

const NOTE_PREFIX_RE = /^\s*Note\s+(over|left of|right of)\s+/i;
const NOTE_OVER_RE =
  /^(\s*Note\s+over\s+)([^\s,]+(?:\s*,\s*[^\s,]+)*)\s+(\S.*)$/i;
const NOTE_SIDE_RE = /^(\s*Note\s+(?:left|right) of\s+)(\S+)\s+(\S.*)$/i;

/** An arrow whose target is a bare `end` and nothing else. */
const ARROW_TO_BARE_END_RE =
  /(?:(?:-{1,2}|={1,2})(?:>|[ox])|-\.-{0,2}>)\s*end\s*$/;
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

/** Block keywords mermaid closes with `end`, across flowchart and sequence. */
const BLOCK_OPEN_RE = /^(loop|alt|opt|par|critical|rect|subgraph)\b/;
const BLOCK_END_RE = /^end\b/;

/**
 * The innermost block keyword left open at the end of the body, or
 * `undefined`. Keywords are only counted at the start of a line, so `subgraph`
 * inside a node label never opens a block; frontmatter and `%%` comments are
 * skipped for the same reason.
 */
function unclosedBlock(body: string): string | undefined {
  const lines = body.split('\n');
  const frontmatter = locateFrontmatter(lines);
  const stack: string[] = [];

  for (let i = frontmatter ? frontmatter.end + 1 : 0; i < lines.length; i++) {
    const line = lines[i].trimStart();
    if (line.startsWith('%%')) continue;
    const open = BLOCK_OPEN_RE.exec(line);
    if (open) {
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
      const header = headerLine(input.body);
      const word = headerWords(input.body)?.[0];
      if (header === undefined || word === undefined) return undefined;
      // mermaid says the same thing when a real type is not registered in the
      // running config. Calling a correctly spelled keyword unknown would lie.
      if (KNOWN_DIAGRAM_TYPES.includes(word)) return undefined;

      const nearest = nearestDiagramType(word);
      if (nearest === undefined)
        return { message: `unknown diagram type \`${word}\`` };
      return {
        message: `unknown diagram type \`${word}\`; did you mean \`${nearest}\`?`,
        suggestion: replaceWord(header, 0, nearest),
      };
    },
  },

  {
    id: 'flowchart-bad-direction',
    matches: (input) =>
      input.parsed.family === 'jison-lexical' && isFlowchart(input),
    confirm(_sourceLine, input) {
      const header = headerLine(input.body);
      const direction = headerWords(input.body)?.[1];
      if (header === undefined || direction === undefined) return undefined;
      if (FLOWCHART_DIRECTIONS.has(direction)) return undefined;

      const message = `\`${direction}\` is not a valid flowchart direction`;
      const nearest = nearestDirection(direction);
      if (nearest === undefined) return { message };
      return {
        message: `${message}; did you mean \`${nearest}\`?`,
        suggestion: replaceWord(header, 1, nearest),
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
      if (!SINGLE_DASH_ARROW_RE.test(blankQuoted(sourceLine))) return undefined;
      return {
        message:
          '`->` is not a flowchart arrow — flowchart arrows need two dashes',
        suggestion: sourceLine
          .split(QUOTED_SEGMENT_RE)
          .map((part, i) =>
            i % 2 === 1
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
      const closer = CLOSER_FOR.get(defect.opener);
      if (closer === undefined) return undefined;
      return {
        message: `node label opened with \`${defect.opener}\` is closed with \`${defect.closer}\``,
        suggestion:
          sourceLine.slice(0, defect.closerIndex) +
          closer +
          sourceLine.slice(defect.closerIndex + 1),
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
      const keyword = unclosedBlock(input.body);
      if (keyword === undefined) return undefined;
      return {
        message: `\`${keyword}\` block was never closed with \`end\``,
      };
    },
  },
];
