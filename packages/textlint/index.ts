import {
  type Block,
  blockToDiagnostics,
  detectDiagramType,
} from '@mermaid-lint/core';
import type { TextlintRuleModule } from '@textlint/types';

export interface Options {
  /** Report semantic warnings (duplicate ids, etc.) in addition to errors. */
  strict?: boolean;
}

/**
 * textlint rule that validates Mermaid code blocks. Unlike ESLint, textlint
 * awaits a Promise returned from a node handler, so the rule can run core's
 * fully async validator (merman + mermaid.js) — see issue #39 for the ESLint
 * limitation. Validation, semantic checks, and line mapping all come from the
 * shared `@mermaid-lint/core` Markdown adapter.
 */
const rule: TextlintRuleModule<Options> = (context, options = {}) => {
  const { Syntax, RuleError, report, getSource, locator, getFilePath } =
    context;
  const strict = options?.strict ?? false;

  return {
    [Syntax.CodeBlock](node) {
      // textlint's markdown AST exposes lang/value on code blocks, mirroring
      // mdast. Only Mermaid fences are our concern.
      const lang = (node as { lang?: string | null }).lang;
      if (lang !== 'mermaid') return;
      const body = (node as { value: string }).value;

      const block: Block = {
        path: getFilePath() ?? '<text>',
        line: node.loc.start.line,
        col: node.loc.start.column,
        body,
        type: detectDiagramType(body),
      };

      // Returning the Promise makes textlint wait for async validation.
      return blockToDiagnostics(block).then((diagnostics) => {
        const nodeSource = getSource(node);
        const sourceLines = nodeSource.split('\n');

        for (const d of diagnostics) {
          if (d.severity !== 'error' && !strict) continue;

          // Diagnostics carry absolute document lines; convert to a character
          // index relative to this node's source (line 0 is the ```mermaid
          // fence) so textlint's locator can place the report precisely.
          const relLine = d.line - node.loc.start.line;
          let index = 0;
          for (let i = 0; i < relLine && i < sourceLines.length; i++) {
            index += sourceLines[i].length + 1;
          }
          index += Math.max(d.column - 1, 0);

          report(
            node,
            new RuleError(d.message, { padding: locator.at(index) }),
          );
        }
      });
    },
  };
};

export default rule;
