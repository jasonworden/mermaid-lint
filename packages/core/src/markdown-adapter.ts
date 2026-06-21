import {
  type Block,
  type ExtractOptions,
  extractMermaidBlocks,
} from './extract.js';
import { validateBlock } from './validate.js';

/**
 * Diagnostic severity: a syntax `error` or a semantic `warning`.
 *
 * @public
 */
export type Severity = 'error' | 'warning';

/**
 * A normalized diagnostic with absolute (document-relative) coordinates.
 *
 * This is the single shape every Markdown integration (markdownlint, remark,
 * textlint, …) consumes, so they all share one extract → validate → report
 * path instead of each re-deriving line mapping and error shaping.
 *
 * @public
 */
export interface Diagnostic {
  /** 1-indexed line in the source document. */
  line: number;
  /** 1-indexed column in the source document. */
  column: number;
  /** Human-readable message (no rule-id prefix; see `ruleId`). */
  message: string;
  /** Stable id: `'mermaid'` for syntax errors, else the semantic rule name. */
  ruleId: string;
  severity: Severity;
}

/**
 * Map a body-relative line to its absolute document line.
 *
 * - A structural error (unclosed/empty fence) carries no line; report it at the
 *   block's opener line (`block.line`).
 * - For a fenced block, the body starts one line after the opener, so the
 *   opener line itself is the offset added to the 1-indexed body line.
 * - For a whole-file `.mmd` block, the body starts at line 1, so the offset is
 *   `block.line - 1` (i.e. 0 when `block.line` is 1).
 *
 * @internal
 */
function toAbsLine(block: Block, relLine: number | undefined): number {
  if (relLine === undefined) return block.line;
  const bodyOffset = block.path.endsWith('.mmd') ? block.line - 1 : block.line;
  return bodyOffset + relLine;
}

/**
 * Validate a single extracted block and return its diagnostics with absolute
 * coordinates. Both syntax errors (severity `error`) and semantic warnings
 * (severity `warning`) are returned; consumers filter by severity as needed
 * (e.g. markdownlint surfaces only errors; remark/textlint add warnings in
 * strict mode).
 *
 * @param block - The block to validate.
 * @returns Diagnostics with document-absolute line/column coordinates.
 * @public
 */
export async function blockToDiagnostics(block: Block): Promise<Diagnostic[]> {
  const result = await validateBlock(block);
  const diagnostics: Diagnostic[] = [];

  if (!result.ok) {
    diagnostics.push({
      line: toAbsLine(block, result.error.line),
      column: result.error.col ?? 1,
      message: result.error.message,
      ruleId: 'mermaid',
      severity: 'error',
    });
  }

  for (const w of result.warnings) {
    diagnostics.push({
      line: toAbsLine(block, w.line),
      column: block.col,
      message: w.message,
      ruleId: w.rule,
      severity: 'warning',
    });
  }

  return diagnostics;
}

/**
 * Extract every Mermaid block from a Markdown (or `.mmd`) document and return
 * all diagnostics with absolute coordinates. Lines are clamped to the document
 * so a structural error at EOF can't point past the last line. This is the main
 * entry point for Markdown tool integrations.
 *
 * @param path - Source path (a `.mmd` extension switches to whole-file mode).
 * @param text - Document contents.
 * @param options - Fence markers to recognize (see {@link ExtractOptions}).
 * @returns Every diagnostic across all blocks, with absolute coordinates.
 * @public
 */
export async function lintMarkdown(
  path: string,
  text: string,
  options: ExtractOptions = {},
): Promise<Diagnostic[]> {
  const blocks = extractMermaidBlocks(path, text, options);
  const perBlock = await Promise.all(blocks.map(blockToDiagnostics));
  const lineCount = text.replace(/\r\n/g, '\n').split('\n').length;
  const diagnostics = perBlock.flat();
  for (const d of diagnostics) {
    d.line = Math.min(Math.max(d.line, 1), lineCount);
  }
  return diagnostics;
}
