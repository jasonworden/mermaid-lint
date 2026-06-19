import { detectDiagramType, validateBlock } from '@mermaid-lint/core';
import type { Code, Root } from 'mdast';
import { lintRule } from 'unified-lint-rule';
import { visit } from 'unist-util-visit';

export interface Options {
  strict?: boolean;
}

const remarkLintMermaid = lintRule<Root, Options>(
  {
    origin: 'remark-lint:mermaid',
    url: 'https://github.com/jasonworden/mermaid-lint',
  },
  async (tree: Root, file, options: Options = {}) => {
    const { strict = false } = options;
    const tasks: Promise<void>[] = [];

    visit(tree, 'code', (node: Code) => {
      if (node.lang !== 'mermaid' || !node.position) return;
      tasks.push(
        (async () => {
          const block = {
            path: file.path ?? '<stdin>',
            line: node.position?.start.line ?? 1,
            col: node.position?.start.column ?? 1,
            body: node.value,
            type: detectDiagramType(node.value),
          };
          const result = await validateBlock(block);
          if (!result.ok) {
            const { error } = result;
            // error.line is 1-indexed relative to the fence body.
            // node.position.start.line is the ```mermaid fence line.
            // The body starts one line after the fence, so absolute line =
            // fenceLine + (error.line ?? 1).
            const fenceLine = node.position?.start.line ?? 1;
            const point = {
              line: fenceLine + (error.line ?? 1),
              column: error.col ?? 1,
            };
            file.message(error.message, point, 'remark-lint:mermaid');
          }
          if (strict) {
            for (const w of result.warnings) {
              file.message(
                w.message,
                node.position?.start,
                'remark-lint:mermaid',
              );
            }
          }
        })(),
      );
    });

    await Promise.all(tasks);
  },
);

export default remarkLintMermaid;
