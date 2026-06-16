import { readFileSync } from 'node:fs';
import {
  type Block,
  type DiscoverOptions,
  discoverFiles,
  extractMermaidBlocks,
  validateBlock,
} from '@mermaid-lint/core';
import { describe, expect, it } from 'vitest';

export function defineMermaidTests(opts: DiscoverOptions = {}): void {
  const files = discoverFiles(opts);
  const blocks: Block[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    blocks.push(...extractMermaidBlocks(file, text));
  }

  describe('Mermaid diagrams', () => {
    it('finds at least one diagram', () => {
      expect(blocks.length, 'no mermaid blocks found').toBeGreaterThan(0);
    });

    it.each(blocks)('$path:$line is valid', async ({ path, line, body }) => {
      const result = await validateBlock(body);
      expect(
        result.ok,
        `${path}:${line}: ${result.ok ? '' : result.error.message}`,
      ).toBe(true);
    });
  });
}
