import { detectDiagramType, validateBlock } from '@mermaid-lint/core';
import type { RuleOnError, RuleParams } from 'markdownlint';

const mermaidRule = {
  names: ['ML001', 'mermaid'],
  description: 'Mermaid diagram syntax validation',
  tags: ['mermaid-diagram', 'code'],
  asynchronous: true,
  function: async (params: RuleParams, onError: RuleOnError): Promise<void> => {
    const lines: readonly string[] = params.lines;
    let inFence = false;
    let fenceStart = -1;
    const bodyLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!inFence && /^[ \t]*```mermaid(\s.*)?$/.test(line)) {
        inFence = true;
        fenceStart = i + 1; // 1-indexed line number of the fence opener
        bodyLines.length = 0;
        continue;
      }
      if (inFence && /^[ \t]*```\s*$/.test(line)) {
        inFence = false;
        const body = bodyLines.join('\n');
        const block = {
          path: params.name,
          line: fenceStart,
          col: 1,
          body,
          type: detectDiagramType(body),
        };
        const result = await validateBlock(block);
        if (!result.ok) {
          const { error } = result;
          const absLine = fenceStart + (error.line ?? 1);
          const errorLine = lines[absLine - 1] ?? '';
          const col = error.col ?? 1;
          const rangeLength = errorLine.length - col + 1;
          onError({
            lineNumber: absLine,
            detail: error.message,
            ...(rangeLength > 0 ? { range: [col, rangeLength] } : {}),
          });
        }
        continue;
      }
      if (inFence) bodyLines.push(line);
    }
  },
};

export default mermaidRule;
