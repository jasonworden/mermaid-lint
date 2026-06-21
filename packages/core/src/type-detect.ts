const MERMAID_COMMENT_RE = /^%%/;

/**
 * Detect a Mermaid diagram's type from its source by reading the first
 * non-blank, non-comment line's leading keyword (e.g. `flowchart`,
 * `sequenceDiagram`). Returns `'unknown'` for empty or unrecognizable input.
 *
 * @param body - Raw diagram source.
 * @returns The diagram-type keyword, or `'unknown'`.
 * @public
 */
export function detectDiagramType(body: string): string {
  if (!body || body === '__UNCLOSED_FENCE__') return 'unknown';
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || MERMAID_COMMENT_RE.test(trimmed)) continue;
    return trimmed.split(/\s+/)[0] ?? 'unknown';
  }
  return 'unknown';
}
