const MERMAID_COMMENT_RE = /^%%/;

export function detectDiagramType(body: string): string {
  if (!body || body === '__UNCLOSED_FENCE__') return 'unknown';
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || MERMAID_COMMENT_RE.test(trimmed)) continue;
    return trimmed.split(/\s+/)[0] ?? 'unknown';
  }
  return 'unknown';
}
