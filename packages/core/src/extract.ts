import {
  ALL_FENCE_MARKERS,
  type FenceMarker,
  makeFenceCloseRe,
  makeFenceOpenRe,
} from './fences.js';
import { detectDiagramType } from './type-detect.js';

export interface Block {
  path: string;
  line: number;
  col: number;
  /** For indented fences, body lines retain the source indentation prefix. */
  body: string;
  type: string;
}

export interface ExtractOptions {
  /**
   * Which code-fence markers to recognize. Defaults to both `'backtick'`
   * (```` ```mermaid ````) and `'tilde'` (`~~~mermaid`), matching CommonMark.
   * Restrict to e.g. `['backtick']` to ignore tilde fences.
   */
  fences?: readonly FenceMarker[];
}

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
