/**
 * Human phrases for mermaid's jison/langium grammar token names.
 *
 * Values that start with a backtick are treated as literal punctuation or
 * keywords (rendered verbatim, e.g. `` `]` ``); anything else is treated as
 * a named, more abstract phrase (e.g. `a node name`). That distinction
 * drives the truncation ranking in {@link summarizeExpected}: concrete
 * literals are more actionable for a diagram author than abstract classes,
 * so they survive truncation first.
 *
 * Tokens not listed here are never guessed at — {@link humanizeToken} falls
 * back to the raw token name, backticked, so we never invent meaning for a
 * token we don't recognize.
 */
const TOKEN_PHRASES: Record<string, string> = {
  // Mermaid's collapsed-newline artifact and real newline/EOF tokens.
  '1': 'the end of the line',
  NEWLINE: 'the end of the line',
  NL: 'the end of the line',
  EOF: 'the end of the diagram',
  EOF_IN_STRUCT: 'an unclosed block',

  // Free-form text categories.
  TXT: 'message text',
  TEXT: 'text',
  UNICODE_TEXT: 'text',
  STR: 'a quoted string',
  SPACE: 'a space',
  NODE_STRING: 'a node name',
  IDENTIFIER: 'an identifier',
  ACTOR: 'a participant name',
  GENERICTYPE: 'a generic type',
  MEMBER: 'a class member',
  LABEL: 'a label',
  NUM: 'a number',
  LINK: 'an arrow',
  START_LINK: 'an arrow',
  LINK_ID: 'a link ID',
  INVALID: 'an unexpected character',

  // Punctuation and shape delimiters: rendered as literal backticked text.
  SQE: '`]`',
  SQS: '`[`',
  PE: '`)`',
  PS: '`(`',
  PIPE: '`|`',
  STADIUMEND: '`])`',
  SUBROUTINEEND: '`]]`',
  CYLINDEREND: '`)]`',
  DIAMOND_STOP: '`}`',
  DOUBLECIRCLEEND: '`)))`',
  TAGSTART: '`<`',
  TAGEND: '`>`',
  TRAPEND: '`\\]`',
  INVTRAPEND: '`/]`',
  STRUCT_START: '`{`',
  STRUCT_STOP: '`}`',
  COMMA: '`,`',
  COLON: '`:`',
  SEMI: '`;`',
  AMP: '`&`',
  MINUS: '`-`',
  MULT: '`*`',
  PLUS: '`+`',
  BRKT: '`#`',
  DOWN: '`v`',

  // Literal grammar keywords.
  DEFAULT: '`default`',
  end: '`end`',
  loop: '`loop`',
  alt: '`alt`',
  subgraph: '`subgraph`',
  note: '`note`',
  participant: '`participant`',
};

/** Truncation priority: concrete literals first, then named phrases, then unmapped fallbacks. */
type Rank = 0 | 1 | 2;

interface Classified {
  phrase: string;
  rank: Rank;
}

function classify(token: string): Classified {
  const mapped = TOKEN_PHRASES[token];
  if (mapped !== undefined)
    return { phrase: mapped, rank: mapped.startsWith('`') ? 0 : 1 };
  // Unmapped: pass the raw token through as a literal rather than inventing meaning.
  return { phrase: `\`${token}\``, rank: 2 };
}

/** A human phrase for one grammar token name. */
export function humanizeToken(token: string): string {
  return classify(token).phrase;
}

function joinPhrases(shown: string[], remainder: number): string {
  if (remainder > 0) return `${shown.join(', ')}, or ${remainder} more`;
  if (shown.length === 0) return '';
  if (shown.length === 1) return shown[0];
  if (shown.length === 2) return `${shown[0]} or ${shown[1]}`;
  return `${shown.slice(0, -1).join(', ')}, or ${shown[shown.length - 1]}`;
}

/** A humanized, deduped, capped list: "`]`, a node name, or 24 more". */
export function summarizeExpected(expected: string[], max = 5): string {
  const seen = new Map<string, Rank>();
  for (const token of expected) {
    const { phrase, rank } = classify(token);
    if (!seen.has(phrase)) seen.set(phrase, rank);
  }
  if (seen.size === 0) return '';

  const sorted = [...seen.entries()]
    .map(([phrase, rank], index) => ({ phrase, rank, index }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.phrase);

  const shown = sorted.slice(0, max);
  const remainder = sorted.length - shown.length;
  return joinPhrases(shown, remainder);
}
