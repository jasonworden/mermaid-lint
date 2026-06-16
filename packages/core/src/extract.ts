import { detectDiagramType } from './type-detect.js';

export interface Block {
  path: string;
  line: number;
  col: number;
  /** For indented fences, body lines retain the source indentation prefix. */
  body: string;
  type: string;
}

// Captures leading space/tab indent and optional info-string after `mermaid`
const FENCE_RE = /^([ \t]*)```mermaid([ \t][^\n]*)?\s*$/;

function makeCloseRe(indent: string): RegExp {
  const escaped = indent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}\`\`\`\\s*$`);
}

export function extractMermaidBlocks(path: string, text: string): Block[] {
  const normalized = text.replace(/\r\n/g, '\n');

  if (path.endsWith('.mmd')) {
    const body = normalized.replace(/\n+$/, '');
    return [{ path, line: 1, col: 1, body, type: detectDiagramType(body) }];
  }

  const lines = normalized.split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const m = FENCE_RE.exec(lines[i]);
    if (!m) {
      i++;
      continue;
    }
    const indent = m[1];
    const openerLine = i + 1;
    const col = indent.length + 1;
    const closeRe = makeCloseRe(indent);
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
    blocks.push({ path, line: openerLine, col, body, type: detectDiagramType(body) });
    i++;
  }
  return blocks;
}
