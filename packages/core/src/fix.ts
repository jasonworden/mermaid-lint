const CLOSE_RE_CACHE = new Map<string, RegExp>();

function getCloseRe(indent: string): RegExp {
  let re = CLOSE_RE_CACHE.get(indent);
  if (!re) {
    const escaped = indent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(`^${escaped}\`\`\`\\s*$`, 'm');
    CLOSE_RE_CACHE.set(indent, re);
  }
  return re;
}

type DiagramType = 'flowchart' | 'graph' | 'sequenceDiagram' | 'other';

function detectBlockType(body: string): DiagramType {
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('%%')) continue;
    const keyword = trimmed.split(/\s+/)[0] ?? '';
    if (keyword === 'flowchart') return 'flowchart';
    if (keyword === 'graph') return 'graph';
    if (keyword === 'sequenceDiagram') return 'sequenceDiagram';
    return 'other';
  }
  return 'other';
}

function normalizeFlowchartArrows(body: string): string {
  return body
    .split('\n')
    .map((line) => {
      if (line.trimStart().startsWith('%%')) return line;
      // Split on quoted segments; only replace in unquoted parts
      const parts = line.split(/(["'][^"']*["'])/);
      return parts
        .map((part, i) => {
          if (i % 2 === 1) return part; // quoted — leave alone
          return part.replace(/(?<![=\-.])->(?![>-])/g, '-->');
        })
        .join('');
    })
    .join('\n');
}

// Matches sequence message lines missing a colon:
// indent, from-participant, arrow, to-participant (no spaces), space, message
// Participant names after the arrow have no spaces to avoid
// greedy matching bleeding into the message text.
const SEQ_MISSING_COLON_RE =
  /^(\s*)([\w][\w ]*)((?:-->>|-->|->>|->|-x|--x)\s*(?:[+-]?\s*)?)(\w+)\s+([^:\s].*)$/;

function fixSequenceColons(body: string): string {
  return body
    .split('\n')
    .map((line) => {
      if (line.trimStart().startsWith('%%')) return line;
      const m = SEQ_MISSING_COLON_RE.exec(line);
      if (!m) return line;
      // m[1]=indent, m[2]=from, m[3]=arrow, m[4]=to, m[5]=message
      return `${m[1]}${m[2]}${m[3]}${m[4]}: ${m[5]}`;
    })
    .join('\n');
}

function fixBody(body: string, type: DiagramType): string {
  if (type === 'flowchart' || type === 'graph') {
    return normalizeFlowchartArrows(body);
  }
  if (type === 'sequenceDiagram') {
    return fixSequenceColons(body);
  }
  return body;
}

function fixMarkdown(src: string): string {
  const lines = src.split('\n');
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const m = /^([ \t]*)```mermaid([ \t][^\n]*)?\s*$/.exec(lines[i]);
    if (!m) {
      result.push(lines[i]);
      i++;
      continue;
    }

    const indent = m[1];
    const opener = lines[i];
    result.push(opener);
    i++;

    const bodyLines: string[] = [];
    const closeRe = getCloseRe(indent);
    let closed = false;

    while (i < lines.length) {
      if (closeRe.test(lines[i])) {
        closed = true;
        break;
      }
      bodyLines.push(lines[i]);
      i++;
    }

    const body = bodyLines.join('\n');
    const type = detectBlockType(body);
    const fixedBody = fixBody(body, type);
    const fixedLines = fixedBody.split('\n');

    if (closed) {
      result.push(...fixedLines);
      result.push(lines[i]); // the closing ```
      i++;
    } else {
      // Unclosed fence — insert closing before any trailing ''
      // (trailing '' represents the newline at end of source)
      const trailingEmpty =
        fixedLines.length > 0 && fixedLines[fixedLines.length - 1] === ''
          ? fixedLines.pop()
          : undefined;
      result.push(...fixedLines);
      result.push(`${indent}\`\`\``);
      if (trailingEmpty !== undefined) {
        result.push(trailingEmpty);
      }
    }
  }

  return result.join('\n');
}

function fixMmd(src: string): string {
  const type = detectBlockType(src);
  return fixBody(src, type);
}

function applyOnce(src: string, isMmd: boolean): string {
  return isMmd ? fixMmd(src) : fixMarkdown(src);
}

export interface FixOptions {
  path?: string;
}

export function fixText(src: string, opts?: FixOptions): string {
  const isMmd = opts?.path?.endsWith('.mmd') ?? false;
  const MAX_PASSES = 10;
  let current = src;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const next = applyOnce(current, isMmd);
    if (next === current) break;
    current = next;
  }
  return current;
}
