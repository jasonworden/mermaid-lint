const MERMAID_COMMENT_RE = /^%%/;

/**
 * Locate a leading YAML frontmatter block and return its 0-indexed line span,
 * both `---` delimiters included. Returns `null` when the body has none.
 *
 * Mermaid only honors frontmatter at the very start of a body (its
 * `frontMatterRegex` is `/^-{3}\s*[\n\r](.*?)[\n\r]-{3}\s*[\n\r]+/s`), so a
 * block only counts when it opens the body and is terminated by another line of
 * exactly three dashes. An unterminated block is not frontmatter to Mermaid
 * either, and is reported as absent here so its `---` stays the header.
 *
 * Delimiters are matched after trimming rather than anchored at column 0 as
 * Mermaid's regex is. Indented fences keep their source indentation (see
 * `Block.body` in `extract.ts`), so a column-strict match would miss
 * frontmatter in a list-nested fence while still finding the keyword on the
 * following line. This assumes the block is uniformly indented; a block
 * whose delimiters disagree on indentation is not frontmatter to Mermaid at
 * all, and is treated as frontmatter here — harmlessly, since Mermaid will
 * not render such a diagram regardless.
 *
 * Two things need the span rather than just the header line: `locateHeader`,
 * which resumes its scan past it, and `fix.ts`, whose whole-body rewrites must
 * leave the user's YAML byte-identical.
 */
export function locateFrontmatter(
  lines: string[],
): { start: number; end: number } | null {
  if (lines[0]?.trim() !== '---') return null;
  const close = lines.findIndex((l, idx) => idx > 0 && l.trim() === '---');
  if (close === -1) return null;
  return { start: 0, end: close };
}

/**
 * Locate the diagram's header — the first non-blank, non-comment,
 * non-frontmatter line — and return both its 1-indexed body line and its
 * trimmed text. Returns `{ line: 1, text: '' }` when there is no header.
 *
 * A leading frontmatter block is skipped; see {@link locateFrontmatter} for
 * exactly which blocks qualify.
 *
 * Two callers need this: `detectDiagramType`, which reads the header's leading
 * keyword, and the semantic rules, which anchor findings to `line` so a
 * suppression comment above the header does not shift a rule's reported
 * location.
 */
export function locateHeader(lines: string[]): { line: number; text: string } {
  const frontmatter = locateFrontmatter(lines);
  let i = frontmatter ? frontmatter.end + 1 : 0;
  for (; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.length === 0 || MERMAID_COMMENT_RE.test(trimmed)) continue;
    return { line: i + 1, text: trimmed };
  }
  return { line: 1, text: '' };
}
