import {
  ALL_FENCE_MARKERS,
  type FenceMarker,
  makeFenceCloseRe,
  makeFenceOpenRe,
} from './fences.js';

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
//
// The activation-marker group is `(?:[+-]\s*)?`, not `(?:[+-]?\s*)?`: the `+`/`-`
// is required inside it so the group can never match bare whitespace already
// consumed by the preceding `\s*`. Allowing both to match the same space run made
// the target `\w+` fail with quadratic backtracking on arrows followed by long
// space runs (js/polynomial-redos).
const SEQ_MISSING_COLON_RE =
  /^(\s*)([\w][\w ]*)((?:-->>|-->|->>|->|-x|--x)\s*(?:[+-]\s*)?)(\w+)\s+([^:\s].*)$/;

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

function fixMarkdown(src: string, fences: readonly FenceMarker[]): string {
  const openRe = makeFenceOpenRe(fences);
  const lines = src.split('\n');
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const m = openRe?.exec(lines[i]);
    if (!m) {
      result.push(lines[i]);
      i++;
      continue;
    }

    const indent = m[1];
    const marker = m[2];
    const opener = lines[i];
    result.push(opener);
    i++;

    const bodyLines: string[] = [];
    const closeRe = makeFenceCloseRe(indent, marker);
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
      result.push(`${indent}${marker}`);
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

/**
 * Apply the mechanical in-diagram fixes to a single Mermaid diagram body and
 * return the corrected body. This is the per-block primitive behind {@link
 * fixText}, exposed for host integrations (markdownlint, …) that already hold a
 * diagram body extracted from their own AST and need to feed a corrected body
 * back into the host's autofix machinery.
 *
 * It applies only the body-local rewrites — normalizing flowchart arrows (`->`
 * to `-->`) and inserting missing sequence-message colons — re-running until the
 * output stabilizes (max 10 passes). Unlike {@link fixText} it does no
 * fence-level work (closing unclosed fences is a document-structure concern, not
 * a diagram-body one), so it never changes the number of lines: the returned
 * body has exactly as many lines as the input, which lets callers map each
 * changed line back to a host edit one-to-one.
 *
 * @param body - Raw diagram source (no surrounding fences).
 * @returns The fixed body, unchanged if nothing matched.
 * @public
 */
export function fixBlockBody(body: string): string {
  const MAX_PASSES = 10;
  let current = body;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const next = fixMmd(current);
    if (next === current) break;
    current = next;
  }
  return current;
}

function applyOnce(
  src: string,
  isMmd: boolean,
  fences: readonly FenceMarker[],
): string {
  return isMmd ? fixMmd(src) : fixMarkdown(src, fences);
}

/**
 * Options for {@link fixText}.
 *
 * @public
 */
export interface FixOptions {
  /** Source path; a `.mmd` extension fixes the whole file as one diagram. */
  path?: string;
  /**
   * Which code-fence markers to recognize, matching `extractMermaidBlocks`.
   * Defaults to both `'backtick'` and `'tilde'` (CommonMark).
   */
  fences?: readonly FenceMarker[];
}

/**
 * Auto-fix common Mermaid mistakes in a document, returning the corrected text.
 * Applies safe rewrites inside Mermaid blocks only — normalizing flowchart
 * arrows (`->` to `-->`), inserting missing sequence-message colons, and closing
 * unclosed fences — re-running until the output stabilizes (max 10 passes).
 *
 * @param src - Original document contents.
 * @param opts - Path and fence options (see {@link FixOptions}).
 * @returns The fixed text, unchanged if nothing matched.
 * @public
 */
export function fixText(src: string, opts?: FixOptions): string {
  const isMmd = opts?.path?.endsWith('.mmd') ?? false;
  const fences = opts?.fences ?? ALL_FENCE_MARKERS;
  const MAX_PASSES = 10;
  let current = src;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const next = applyOnce(current, isMmd, fences);
    if (next === current) break;
    current = next;
  }
  return current;
}
