import { locateHeader } from './header.js';

/**
 * Detect a Mermaid diagram's type from its source by reading the leading
 * keyword of its header line (e.g. `flowchart`, `sequenceDiagram`). Blank
 * lines, `%%` comments, and a leading YAML frontmatter block are skipped —
 * see {@link locateHeader}. Returns `'unknown'` for empty or unrecognizable
 * input.
 *
 * One non-keyword value is deliberate and depended upon: `'---'`. The
 * frontmatter skip only fires for a block that *opens* the body, so a body
 * whose frontmatter is preceded by anything — or whose frontmatter is never
 * closed — leaves `---` as the header and returns it verbatim. That makes
 * `'---'` mean exactly "frontmatter present but misplaced or unterminated",
 * which is what the `frontmatter-must-be-first` rule gates on. Widening the
 * skip to scan past a misplaced block would disable that rule, so this is a
 * contract, not an accident — `type-detect.test.ts` pins it.
 *
 * @param body - Raw diagram source.
 * @returns The diagram-type keyword, `'---'` for misplaced or unterminated
 *   frontmatter, or `'unknown'`.
 * @public
 */
export function detectDiagramType(body: string): string {
  if (!body || body === '__UNCLOSED_FENCE__') return 'unknown';
  const { text } = locateHeader(body.split('\n'));
  if (text.length === 0) return 'unknown';
  return text.split(/\s+/)[0] ?? 'unknown';
}
