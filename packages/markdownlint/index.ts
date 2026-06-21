import { lintMarkdown } from '@mermaid-lint/core';
import type { RuleOnError, RuleParams } from 'markdownlint';

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
    // Delegate extraction, validation, and absolute line mapping to core's
    // shared Markdown adapter so this rule stays in lockstep with every other
    // integration. markdownlint surfaces syntax errors only (no warnings).
    const diagnostics = await lintMarkdown(params.name, lines.join('\n'));

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
