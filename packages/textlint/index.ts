import {
  type Block,
  type RulesConfig,
  blockToDiagnostics,
  detectDiagramType,
  fixBlockBody,
  resolveRules,
} from '@mermaid-lint/core';
import type {
  TextlintFixableRuleModule,
  TextlintRuleReporter,
} from '@textlint/types';

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

/**
 * textlint rule that validates Mermaid code blocks. Unlike ESLint, textlint
 * awaits a Promise returned from a node handler, so the rule can run core's
 * fully async validator (merman + mermaid.js) — see issue #39 for the ESLint
 * limitation. Validation, semantic checks, and line mapping all come from the
 * shared `@mermaid-lint/core` Markdown adapter.
 *
 * The rule is also a textlint **fixer**: `textlint --fix` applies the same
 * mechanical, meaning-preserving corrections as the CLI's `--fix` (normalizing
 * `->` arrows, inserting missing sequence-message colons) via core's shared
 * `fixBlockBody`. Semantic findings are never auto-changed.
 */
const reporter: TextlintRuleReporter<Options> = (context, options = {}) => {
  const { Syntax, RuleError, report, fixer, getSource, locator, getFilePath } =
    context;
  const strict = options?.strict ?? false;
  const resolved = resolveRules({ rules: options?.rules });

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
      return blockToDiagnostics(block, resolved).then((diagnostics) => {
        const nodeSource = getSource(node);
        const sourceLines = nodeSource.split('\n');

        // Build the mechanical autofix once per block. fixBlockBody is
        // line-count preserving, so swapping the corrected body back into the
        // node's source (the body is a unique literal substring of it) yields a
        // whole-node replacement that touches only diagram content — never the
        // fences or surrounding Markdown. The function replacer avoids `$`
        // being interpreted as a replacement pattern. If the body isn't a
        // literal substring (e.g. an oddly-indented fence), the swap is a no-op
        // and no fix is offered.
        const fixedBody = fixBlockBody(body);
        const newSource =
          fixedBody === body
            ? nodeSource
            : nodeSource.replace(body, () => fixedBody);
        const fixCommand =
          newSource === nodeSource
            ? undefined
            : fixer.replaceText(node, newSource);
        let fixAttached = false;

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

          // Attach the autofix to the first syntax error (the only severity
          // that mechanical fixes target); semantic findings carry no fix.
          const attachFix =
            fixCommand && !fixAttached && d.severity === 'error';
          if (attachFix) fixAttached = true;
          report(
            node,
            new RuleError(d.message, {
              padding: locator.at(index),
              ...(attachFix ? { fix: fixCommand } : {}),
            }),
          );
        }

        // A fixable block whose validator surfaced no carryable error (rare):
        // report a dedicated fixable finding so `--fix` still corrects it.
        if (fixCommand && !fixAttached) {
          report(
            node,
            new RuleError(
              'Mermaid: auto-fixable syntax issue (run with --fix)',
              { padding: locator.at(0), fix: fixCommand },
            ),
          );
        }
      });
    },
  };
};

// A fixable textlint rule exports `{ linter, fixer }` (same reporter for both);
// `textlint --fix` runs the `fixer` entry and applies the `fix` descriptors.
export default {
  linter: reporter,
  fixer: reporter,
} satisfies TextlintFixableRuleModule<Options>;
