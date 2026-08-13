export type ErrorFamily =
  | 'jison-parse'
  | 'jison-lexical'
  | 'langium'
  | 'no-diagram-type'
  | 'module';

export interface ParsedParserError {
  family: ErrorFamily;
  /** Token names mermaid listed as acceptable. Empty when none are carried. */
  expected: string[];
  /** The token mermaid found instead. Undefined when none is carried. */
  got?: string;
}

/** Every quoted token in a jison expected-list, e.g. `'SQE'`, `'-)'`, `','`. */
const QUOTED_RE = /'([^']*)'/g;

/** jison's trailer. Anchored to a line start; the list may contain commas. */
const JISON_EXPECT_RE = /^Expecting (.+), got (.+)$/m;

const JISON_LEXICAL_RE = /^(?:Lexical|Lexer) error on line \d+\./m;

const LANGIUM_PREFIX = 'Parsing failed:';
const ECHOES_BODY = 'No diagram type detected';

/** Langium's single-token form. */
const LANGIUM_ONE_RE = /Expecting token of type '([^']*)' but found `([^`]*)`/;
/** Langium's sequence form: bracketed token lists, then a `but found` clause. */
const LANGIUM_SEQ_RE = /\[([^\]]*)\]/g;
const LANGIUM_FOUND_RE = /but found: '([^']*)'/;

function quotedTokens(text: string): string[] {
  return [...text.matchAll(QUOTED_RE)].map((m) => m[1]);
}

function unquote(text: string): string {
  const m = /^'(.*)'$/.exec(text.trim());
  return m ? m[1] : text.trim();
}

export function parseRawError(raw: string): ParsedParserError {
  if (raw.startsWith(ECHOES_BODY))
    return { family: 'no-diagram-type', expected: [], got: undefined };

  if (raw.startsWith(LANGIUM_PREFIX)) {
    const one = LANGIUM_ONE_RE.exec(raw);
    if (one) return { family: 'langium', expected: [one[1]], got: one[2] };
    const seq = [...raw.matchAll(LANGIUM_SEQ_RE)].flatMap((m) =>
      m[1].split(',').map((t) => t.trim()),
    );
    const found = LANGIUM_FOUND_RE.exec(raw);
    return {
      family: 'langium',
      expected: [...new Set(seq)].filter(Boolean),
      got: found?.[1],
    };
  }

  const jison = JISON_EXPECT_RE.exec(raw);
  if (jison)
    return {
      family: 'jison-parse',
      expected: quotedTokens(jison[1]),
      got: unquote(jison[2]),
    };

  if (JISON_LEXICAL_RE.test(raw))
    return { family: 'jison-lexical', expected: [], got: undefined };

  return { family: 'module', expected: [], got: undefined };
}
