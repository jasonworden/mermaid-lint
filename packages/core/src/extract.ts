import {
  ALL_FENCE_MARKERS,
  type FenceMarker,
  makeFenceCloseRe,
  makeFenceOpenRe,
} from './fences.js';
import { detectDiagramType } from './type-detect.js';

/**
 * A single Mermaid diagram extracted from a source document, with the location
 * of its opening fence and the raw diagram body.
 *
 * @public
 */
export interface Block {
  /** Source file path the block came from. */
  path: string;
  /** 1-indexed line of the opening fence (or line 1 for whole-file `.mmd`). */
  line: number;
  /** 1-indexed column of the opening fence. */
  col: number;
  /**
   * Raw diagram source. For indented fences, body lines retain the source
   * indentation prefix. The sentinel `'__UNCLOSED_FENCE__'` marks a fence with
   * no closing marker.
   */
  body: string;
  /** Detected diagram type (e.g. `'flowchart'`, `'sequenceDiagram'`, `'unknown'`). */
  type: string;
}

/**
 * Options controlling how {@link extractMermaidBlocks} scans a document.
 *
 * @public
 */
export interface ExtractOptions {
  /**
   * Which code-fence markers to recognize. Defaults to both `'backtick'`
   * (```` ```mermaid ````) and `'tilde'` (`~~~mermaid`), matching CommonMark.
   * Restrict to e.g. `['backtick']` to ignore tilde fences.
   */
  fences?: readonly FenceMarker[];
}

/**
 * Extract every Mermaid diagram from a Markdown document, or treat the whole
 * file as one diagram when `path` ends in `.mmd`. CRLF line endings are
 * normalized before scanning.
 *
 * @param path - Source path; a `.mmd` extension switches to whole-file mode.
 * @param text - File contents to scan.
 * @param options - Fence markers to recognize (see {@link ExtractOptions}).
 * @returns One {@link Block} per Mermaid block found, in document order.
 * @public
 */
export function extractMermaidBlocks(
  path: string,
  text: string,
  options: ExtractOptions = {},
): Block[] {
  const normalized = text.replace(/\r\n/g, '\n');

  if (path.endsWith('.mmd')) {
    const body = normalized.replace(/\n+$/, '');
    return [{ path, line: 1, col: 1, body, type: detectDiagramType(body) }];
  }

  const openRe = makeFenceOpenRe(options.fences ?? ALL_FENCE_MARKERS);
  if (!openRe) return [];

  const lines = normalized.split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const m = openRe.exec(lines[i]);
    if (!m) {
      i++;
      continue;
    }
    const indent = m[1];
    const marker = m[2];
    const openerLine = i + 1;
    const col = indent.length + 1;
    const closeRe = makeFenceCloseRe(indent, marker);
    const bodyLines: string[] = [];
    i++;
    let closed = false;
    while (i < lines.length) {
      if (closeRe.test(lines[i])) {
        closed = true;
        break;
      }
      bodyLines.push(lines[i]);
      i++;
    }
    const body = closed ? bodyLines.join('\n') : '__UNCLOSED_FENCE__';
    blocks.push({
      path,
      line: openerLine,
      col,
      body,
      type: detectDiagramType(body),
    });
    i++;
  }
  return blocks;
}
