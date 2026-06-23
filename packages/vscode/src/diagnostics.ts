import type { RulesConfig } from '@mermaid-lint/core';
import { loadCore } from './core.js';

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
  /**
   * Which code-fence markers to recognize. Defaults to both backtick and tilde
   * (CommonMark); restrict to e.g. `['backtick']` to ignore `~~~mermaid`.
   */
  fences?: ('backtick' | 'tilde')[];
  /**
   * Per-rule severity overrides (`'off'` | `'warn'` | `'error'`), layered over
   * the built-in defaults — the `rules` key from the project's mermaid-lint
   * config. Lets the editor enable off-by-default rules (e.g. `no-orphan-nodes`)
   * and tune severities, matching the CLI. Ignored when `semantic` is false.
   */
  rules?: RulesConfig;
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
  const { semantic = true, strict = false, fences, rules } = options;
  const { extractMermaidBlocks, validateBlock, resolveRules } =
    await loadCore();
  const isMmd = path.endsWith('.mmd');
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks = extractMermaidBlocks(path, text, fences ? { fences } : {});
  // Layer the config's `rules` over the built-in defaults. `semantic: false`
  // resolves every rule to `off`, so the validator emits no warnings.
  const resolved = resolveRules({ rules, semantic });
  const out: MermaidDiagnostic[] = [];

  await Promise.all(
    blocks.map(async (block) => {
      const result = await validateBlock(block, resolved);
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
          // A rule resolved to `error` is always an error; `strict` elevates
          // the remaining `warn`-severity findings to errors too.
          const severity: Severity =
            w.severity === 'error' || strict ? 'error' : 'warning';
          out.push(
            makeDiag(lines, toDocLine(w.line), undefined, w.message, severity),
          );
        }
      }
    }),
  );

  out.sort((a, b) => a.startLine - b.startLine || a.startCol - b.startCol);
  return out;
}
