import {
  type Block,
  type RulesConfig,
  blockToDiagnostics,
  detectDiagramType,
  fixBlockBody,
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

/**
 * remark **fix** transformer for Mermaid blocks.
 *
 * Unlike {@link remarkLintMermaid} (which only reports), this is a plain
 * unified transformer that mutates the tree: it rewrites the body of every
 * `mermaid` code block in place via core's {@link fixBlockBody} — normalizing
 * flowchart/graph arrows (`->` → `-->`) and inserting missing sequence-message
 * colons, the same mechanical set `mermaid-lint --fix` applies.
 *
 * remark has no lint-fixer API, so a "fix" can only take effect when remark
 * serializes the tree — i.e. when run with `remark --output` (or any pipeline
 * ending in `.stringify`). In pure-lint mode it is inert. Because `--output`
 * already round-trips the whole document through `remark-stringify`, this
 * introduces no new reformatting: it only changes the Mermaid fence bodies
 * within a serialization that was already going to happen.
 *
 * Compose it alongside the lint rule to both report and fix:
 * `remark().use(remarkLintMermaid).use(remarkMermaidFix)`.
 *
 * The fix is mechanical-only and takes no options; it never alters diagram
 * meaning (semantic findings are left untouched) and is a no-op on valid or
 * non-mermaid blocks.
 */
export function remarkMermaidFix() {
  return (tree: Root): void => {
    visit(tree, 'code', (node: Code) => {
      if (node.lang !== 'mermaid') return;
      node.value = fixBlockBody(node.value);
    });
  };
}
