const MERMAID_COMMENT_RE = /^%%/;

/**
 * Locate the diagram's header — the first non-blank, non-comment,
 * non-frontmatter line — and return both its 1-indexed body line and its
 * trimmed text. Returns `{ line: 1, text: '' }` when there is no header.
 *
 * Mermaid only honors frontmatter at the very start of a body (its
 * `frontMatterRegex` is `/^-{3}\s*[\n\r](.*?)[\n\r]-{3}\s*[\n\r]+/s`), so the
 * skip only applies to a leading, terminated block of exactly three dashes.
 * An unterminated block is not frontmatter to Mermaid either, and is left
 * alone here so the type stays `'---'`.
 *
 * Delimiters are matched after trimming rather than anchored at column 0 as
 * Mermaid's regex is. Indented fences keep their source indentation (see
 * `Block.body` in `extract.ts`), so a column-strict match would miss
 * frontmatter in a list-nested fence while still finding the keyword on the
 * following line.
 *
 * Two callers need this: `detectDiagramType`, which reads the header's leading
 * keyword, and the semantic rules, which anchor findings to `line` so a
 * suppression comment above the header does not shift a rule's reported
 * location.
 */
export function locateHeader(lines: string[]): { line: number; text: string } {
  let i = 0;
  // A frontmatter block is only frontmatter when it opens the body.
  if (lines[0]?.trim() === '---') {
    const close = lines.findIndex((l, idx) => idx > 0 && l.trim() === '---');
    if (close > 0) i = close + 1;
  }
  for (; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.length === 0 || MERMAID_COMMENT_RE.test(trimmed)) continue;
    return { line: i + 1, text: trimmed };
  }
  return { line: 1, text: '' };
}
