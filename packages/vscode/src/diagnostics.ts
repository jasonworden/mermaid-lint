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
  const { lintMarkdown, resolveRules, SYNTAX_RULE_ID } = await loadCore();
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  // Layer the config's `rules` over the built-in defaults. `semantic: false`
  // resolves every rule (including the suppression meta-rules) to `off`, so
  // the adapter emits no warnings.
  const resolved = resolveRules({ rules, semantic });

  // `lintMarkdown`, not a per-block `blockToDiagnostics` loop: it runs the same
  // extract → validate → report path (returning document-absolute coordinates,
  // suppression directives honored) but adds the document-scope diagnostics no
  // single block can produce — a `<!-- mermaid-lint-disable-file -->` that is
  // malformed, names an unknown rule, or suppressed nothing anywhere in the
  // file. Those need every block's suppression state at once, so a per-block
  // caller can't surface them at all.
  const diagnostics = await lintMarkdown(
    path,
    text,
    fences ? { fences } : {},
    resolved,
  );

  const out = diagnostics.map((d) => {
    // A syntax error is always an error; for everything else, a rule resolved
    // to `error` is always an error, and `strict` elevates the remaining
    // `warning`-severity findings to errors too.
    const severity: Severity =
      d.ruleId === SYNTAX_RULE_ID || d.severity === 'error' || strict
        ? 'error'
        : 'warning';
    return makeDiag(lines, d.line, d.column, d.message, severity);
  });

  out.sort((a, b) => a.startLine - b.startLine || a.startCol - b.startCol);
  return out;
}
