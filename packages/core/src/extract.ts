export interface Block {
  path: string;
  line: number;
  col: number;
  body: string;
}

const FENCE_RE = /^(\s*)```mermaid(\s.*)?$/;
const CLOSE_RE = /^\s*```\s*$/;

export function extractMermaidBlocks(path: string, text: string): Block[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const m = FENCE_RE.exec(lines[i]);
    if (!m) {
      i++;
      continue;
    }
    const openerLine = i + 1;
    const col = m[1].length + 1;
    const bodyLines: string[] = [];
    i++;
    let closed = false;
    while (i < lines.length) {
      if (CLOSE_RE.test(lines[i])) {
        closed = true;
        break;
      }
      bodyLines.push(lines[i]);
      i++;
    }
    if (!closed) {
      blocks.push({ path, line: openerLine, col, body: '__UNCLOSED_FENCE__' });
    } else {
      blocks.push({ path, line: openerLine, col, body: bodyLines.join('\n') });
    }
    i++;
  }
  return blocks;
}
