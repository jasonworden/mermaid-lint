import { extractMermaidBlocks, validateBlock } from '@mermaid-lint/core';
import type { RuleOnError, RuleParams } from 'markdownlint';

const mermaidRule = {
  names: ['ML001', 'mermaid'],
  description: 'Mermaid diagram syntax validation',
  tags: ['mermaid-diagram', 'code'],
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
        // error.line/col are 1-indexed relative to the fence body; block.line
        // is the document line of the fence opener.
        const absLine = block.line + (error.line ?? 1);
        const errorLine = lines[absLine - 1] ?? '';
        const col = error.col ?? 1;
        const rangeLength = errorLine.length - col + 1;
        onError({
          lineNumber: absLine,
          detail: error.message,
          ...(rangeLength > 0 ? { range: [col, rangeLength] } : {}),
        });
      }),
    );
  },
};

export default mermaidRule;
