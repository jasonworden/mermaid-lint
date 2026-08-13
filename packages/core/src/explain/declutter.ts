import { locateHeader } from '../header.js';
import type { ExplainInput, Explanation } from './rules.js';
import { humanizeToken, summarizeExpected } from './tokens.js';

/** No signature survived: the position is all we honestly have. */
const NOTHING_KNOWN = 'unexpected input';

/**
 * mermaid's own verdict on a `jison-lexical` failure, minus the citation.
 * The family is *defined* by the `Lexical error on line N. Unrecognized text.`
 * shape, so this is mermaid's claim restated, not a new one.
 */
const LEXICAL = 'unrecognized text';

/** mermaid's `no-diagram-type` verdict, minus the echoed body. */
const NO_TYPE = 'no diagram type detected';

/**
 * The diagram-type keyword the author actually wrote, or `undefined`.
 *
 * Deliberately *not* described as unknown. Tier 1's `unknown-diagram-type`
 * rule declines on a keyword that really is a diagram type — mermaid emits
 * this same message when a genuine type is not registered in the running
 * config — so anything reaching Tier 2 has either no header at all or a
 * header Tier 1 refused to call a typo. Repeating "unknown diagram type
 * `gantt`" here would state the falsehood Tier 1 stepped around.
 */
function headerKeyword(body: string): string | undefined {
  const { text } = locateHeader(body.split('\n'));
  const word = text.split(/\s+/)[0];
  return word.length === 0 ? undefined : word;
}

/**
 * A sentence built from the token signature alone.
 *
 * Both clauses are optional and mermaid omits either in practice: a Langium
 * lexer error carries neither, and a Langium sequence error can carry one
 * without the other.
 */
function fromSignature(expected: string[], got: string | undefined): string {
  const wanted = summarizeExpected(expected);
  if (wanted.length === 0)
    return got === undefined
      ? NOTHING_KNOWN
      : `unexpected ${humanizeToken(got)}`;
  if (got === undefined) return `expected ${wanted}`;
  return `expected ${wanted}, found ${humanizeToken(got)}`;
}

/**
 * Tier 2: mechanical cleanup of mermaid's own prose, for every failure Tier 1
 * declined.
 *
 * This layer diagnoses nothing. Tier 1 is where a defect gets named, and it
 * only names one it could confirm against the source; if it declined, the
 * defect is unknown, and asserting one here would reintroduce exactly the
 * confident falsehood the two-gate design exists to prevent. So it never
 * returns a suggestion either — a suggestion is a claim about what the author
 * meant, and this layer has confirmed nothing.
 *
 * Two things are dropped from every token-carrying family:
 *
 * - **The caret snippet.** jison echoes a window of the *preprocessed* source
 *   and underlines it, and the underline routinely lands on the wrong column.
 * - **The `Parse error on line N:` header.** The line is already carried
 *   structurally in `ValidationError.line`, and mermaid's original text stays
 *   reachable in `raw`. Repeating it in prose puts a second coordinate system
 *   in the message — one that is wrong inside a fenced Markdown file, where
 *   only the structured position gets mapped body→file.
 *
 * Neither is reconstructed from `raw`: what is left is rebuilt from the
 * normalized token signature alone.
 *
 * @internal
 */
export function declutter(input: ExplainInput): Explanation {
  const { family, expected, got } = input.parsed;

  // Verbatim, byte for byte. mindmap's "There can be only one root..." and
  // gitGraph's "Trying to checkout branch which is not yet created..." are
  // written for humans already; every transformation available here would
  // make them worse. That includes trimming and re-casing.
  if (family === 'module') return { message: input.raw };

  if (family === 'no-diagram-type') {
    const keyword = headerKeyword(input.body);
    return {
      message:
        keyword === undefined ? NO_TYPE : `${NO_TYPE} for \`${keyword}\``,
    };
  }

  if (family === 'jison-lexical') return { message: LEXICAL };

  return { message: fromSignature(expected, got) };
}
