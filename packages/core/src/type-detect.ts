import { locateHeader } from './header.js';

/**
 * Detect a Mermaid diagram's type from its source by reading the leading
 * keyword of its header line (e.g. `flowchart`, `sequenceDiagram`). Blank
 * lines, `%%` comments, and a leading YAML frontmatter block are skipped —
 * see {@link locateHeader}. Returns `'unknown'` for empty or unrecognizable
 * input.
 *
 * @param body - Raw diagram source.
 * @returns The diagram-type keyword, or `'unknown'`.
 * @public
 */
export function detectDiagramType(body: string): string {
  if (!body || body === '__UNCLOSED_FENCE__') return 'unknown';
  const { text } = locateHeader(body.split('\n'));
  if (text.length === 0) return 'unknown';
  return text.split(/\s+/)[0] ?? 'unknown';
}
