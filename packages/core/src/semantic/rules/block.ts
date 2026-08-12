import type { Rule } from '../types.js';

const BLOCK_DECL_RE = /^\s*[A-Za-z_][\w-]*(?:\s*\[[^\]]*])?(?::\d+)?\s*$/;

export const blockNoBlocks: Rule = {
  id: 'block-no-blocks',
  appliesTo: (block) => block.type === 'block-beta',
  evaluate: ({ lines, headerLine }) => {
    if (
      lines.some((line) => {
        const trimmed = line.trim();
        return trimmed !== 'block-beta' && BLOCK_DECL_RE.test(trimmed);
      })
    ) {
      return [];
    }
    return [
      {
        message:
          'block-beta has no blocks and renders empty; add at least one block declaration.',
        line: headerLine,
      },
    ];
  },
};
