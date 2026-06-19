import { extractMermaidBlocks, validateBlock } from '@mermaid-lint/core';

export type Severity = 'error' | 'warning';

/** All positions 0-indexed (VS Code Range convention). */
export interface MermaidDiagnostic {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  message: string;
  severity: Severity;
}

export interface ComputeOptions {
  /** Run semantic checks (default true). When false, semantic warnings are dropped. */
  semantic?: boolean;
  /** Treat semantic warnings as errors (default false). */
  strict?: boolean;
}

function makeDiag(
  lines: string[],
  docLine1: number,
  col1: number | undefined,
  message: string,
  severity: Severity,
): MermaidDiagnostic {
  const line0 = Math.min(Math.max(docLine1, 1), lines.length) - 1;
  const lineText = lines[line0] ?? '';
  let startCol = col1 && col1 >= 1 ? col1 - 1 : 0;
  if (startCol > lineText.length) startCol = lineText.length;
  let endCol = lineText.length;
  if (endCol <= startCol) {
    // Empty/whole-line target — underline from start of line for visibility.
    startCol = 0;
    endCol = Math.max(lineText.length, 1);
  }
  return {
    startLine: line0,
    startCol,
    endLine: line0,
    endCol,
    message,
    severity,
  };
}

export async function computeMermaidDiagnostics(
  path: string,
  text: string,
  options: ComputeOptions = {},
): Promise<MermaidDiagnostic[]> {
  const { semantic = true, strict = false } = options;
  const isMmd = path.endsWith('.mmd');
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks = extractMermaidBlocks(path, text);
  const out: MermaidDiagnostic[] = [];

  await Promise.all(
    blocks.map(async (block) => {
      const result = await validateBlock(block);
      const bodyStart = isMmd ? block.line : block.line + 1;
      const toDocLine = (bodyLine: number | undefined): number =>
        bodyLine === undefined ? block.line : bodyStart + bodyLine - 1;

      if (!result.ok) {
        out.push(
          makeDiag(
            lines,
            toDocLine(result.error.line),
            result.error.col,
            result.error.message,
            'error',
          ),
        );
      }
      if (semantic) {
        for (const w of result.warnings) {
          out.push(
            makeDiag(
              lines,
              toDocLine(w.line),
              undefined,
              w.message,
              strict ? 'error' : 'warning',
            ),
          );
        }
      }
    }),
  );

  out.sort((a, b) => a.startLine - b.startLine || a.startCol - b.startCol);
  return out;
}
