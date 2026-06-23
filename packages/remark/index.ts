import {
  type Block,
  type RulesConfig,
  blockToDiagnostics,
  detectDiagramType,
  resolveRules,
} from '@mermaid-lint/core';
import type { Code, Root } from 'mdast';
import { lintRule } from 'unified-lint-rule';
import { visit } from 'unist-util-visit';

export interface Options {
  /** Report semantic warnings (duplicate ids, etc.) in addition to errors. */
  strict?: boolean;
  /**
   * Per-rule severity overrides (`'off'` | `'warn'` | `'error'`), layered over
   * the built-in defaults — e.g. `{ 'no-orphan-nodes': 'error' }` to enable an
   * off-by-default rule, or `{ 'no-self-loop': 'off' }` to silence one. Same
   * shape as the CLI's `rules` config key.
   */
  rules?: RulesConfig;
}

const remarkLintMermaid = lintRule<Root, Options>(
  {
    origin: 'remark-lint:mermaid',
    url: 'https://github.com/jasonworden/mermaid-lint',
  },
  async (tree: Root, file, options: Options = {}) => {
    const { strict = false, rules } = options;
    const resolved = resolveRules({ rules });
    const tasks: Promise<void>[] = [];

    visit(tree, 'code', (node: Code) => {
      if (node.lang !== 'mermaid' || !node.position) return;
      // Build a block from the mdast node and hand it to core's shared adapter,
      // which validates and returns diagnostics with absolute document
      // coordinates. node.position.start.line is the ```mermaid fence line.
      const block: Block = {
        path: file.path ?? '<stdin>',
        line: node.position.start.line,
        col: node.position.start.column,
        body: node.value,
        type: detectDiagramType(node.value),
      };
      tasks.push(
        blockToDiagnostics(block, resolved).then((diagnostics) => {
          for (const d of diagnostics) {
            // Syntax errors always report; semantic warnings only in strict mode.
            if (d.severity === 'error' || strict) {
              file.message(
                d.message,
                { line: d.line, column: d.column },
                'remark-lint:mermaid',
              );
            }
          }
        }),
      );
    });

    await Promise.all(tasks);
  },
);

export default remarkLintMermaid;
