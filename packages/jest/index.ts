import { describe, expect, test } from '@jest/globals';
import {
  type LintFilesOptions,
  blockToDiagnostics,
  collectMermaidBlocks,
  resolveRules,
  selectFailures,
} from '@mermaid-lint/core';

export type { MermaidBlockResult } from '@mermaid-lint/core';
export { lintMermaidFiles } from '@mermaid-lint/core';

/** Options for {@link defineMermaidTests}: discovery, per-rule severities, strict. */
export interface MermaidTestOptions extends LintFilesOptions {
  /** Also fail on `warning`-severity semantic findings, not just errors. */
  strict?: boolean;
}

/**
 * Register one Jest test per Mermaid block found under `opts`, failing any block
 * whose diagnostics include a syntax error or (under `strict`) a semantic
 * warning. Blocks are collected synchronously so tests register during Jest's
 * collection phase; validation runs asynchronously inside each test.
 */
export function defineMermaidTests(opts: MermaidTestOptions = {}): void {
  const { strict = false, rules, ...discoverOpts } = opts;
  const resolved = resolveRules({ rules });
  const blocks = collectMermaidBlocks(discoverOpts);

  describe('Mermaid diagrams', () => {
    test('finds at least one diagram', () => {
      expect(blocks.length).toBeGreaterThan(0);
    });

    test.each(blocks)('$path:$line is valid', async (block) => {
      const diagnostics = await blockToDiagnostics(block, resolved);
      const failures = selectFailures(diagnostics, strict);
      if (failures.length > 0) {
        const detail = failures.map((d) => d.message).join('; ');
        throw new Error(`${block.path}:${block.line}: ${detail}`);
      }
    });
  });
}
