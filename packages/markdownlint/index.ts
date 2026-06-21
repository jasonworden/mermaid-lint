import {
  type FenceMarker,
  isFenceMarker,
  lintMarkdown,
} from '@mermaid-lint/core';
import type { RuleOnError, RuleParams } from 'markdownlint';

/**
 * Read an optional `fences` array from this rule's markdownlint config, e.g.
 * `{ "ML001": { "fences": ["backtick"] } }`. Invalid values fall back to the
 * CommonMark default (both backtick and tilde) so a typo never silently
 * disables linting.
 */
function readFences(config: unknown): FenceMarker[] | undefined {
  if (typeof config !== 'object' || config === null) return undefined;
  const { fences } = config as { fences?: unknown };
  if (!Array.isArray(fences) || !fences.every(isFenceMarker)) return undefined;
  return fences;
}

const mermaidRule = {
  names: ['ML001', 'mermaid'],
  description: 'Mermaid diagram syntax validation',
  // 'mermaid-diagram' (not 'mermaid'): markdownlint forbids a tag that
  // duplicates one of the rule's own names ('mermaid' is an alias above).
  tags: ['mermaid-diagram', 'code'],
  // The rule line-scans params.lines and needs no markdown parser; declaring
  // 'none' avoids markdownlint's markdownItFactory requirement and skips
  // parsing entirely for this rule.
  parser: 'none',
  asynchronous: true,
  function: async (params: RuleParams, onError: RuleOnError): Promise<void> => {
    const { lines } = params;
    const fences = readFences(params.config);
    // Delegate extraction, validation, and absolute line mapping to core's
    // shared Markdown adapter so this rule stays in lockstep with every other
    // integration. markdownlint surfaces syntax errors only (no warnings).
    const diagnostics = await lintMarkdown(
      params.name,
      lines.join('\n'),
      fences ? { fences } : {},
    );

    for (const d of diagnostics) {
      if (d.severity !== 'error') continue;
      const errorLine = lines[d.line - 1] ?? '';
      const rangeLength = errorLine.length - d.column + 1;
      onError({
        lineNumber: d.line,
        detail: d.message,
        ...(rangeLength > 0 ? { range: [d.column, rangeLength] } : {}),
      });
    }
  },
};

export default mermaidRule;
