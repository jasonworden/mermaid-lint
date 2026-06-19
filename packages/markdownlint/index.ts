import { extractMermaidBlocks, validateBlock } from '@mermaid-lint/core';
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
    // Delegate fence detection (indented fences, .mmd files, unclosed fences)
    // to core's canonical extractor so this rule stays in lockstep with it.
    const blocks = extractMermaidBlocks(params.name, lines.join('\n'));

    await Promise.all(
      blocks.map(async (block) => {
        const result = await validateBlock(block);
        if (result.ok) return;

        const { error } = result;
        // error.line is 1-indexed relative to the fence body, so document line
        // = opener line + body line. Structural errors (unclosed/empty fence)
        // carry no line; report those at the fence opener. Clamp to the
        // document so an unclosed fence at EOF can't point past the last line.
        const absLine =
          error.line === undefined ? block.line : block.line + error.line;
        const lineNumber = Math.min(Math.max(absLine, 1), lines.length);
        const errorLine = lines[lineNumber - 1] ?? '';
        const col = error.col ?? 1;
        const rangeLength = errorLine.length - col + 1;
        onError({
          lineNumber,
          detail: error.message,
          ...(rangeLength > 0 ? { range: [col, rangeLength] } : {}),
        });
      }),
    );
  },
};

export default mermaidRule;
