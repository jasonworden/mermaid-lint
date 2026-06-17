import { readFileSync } from 'node:fs';
import { describe, expect, test } from '@jest/globals';
import {
  type Block,
  type DiscoverOptions,
  discoverFiles,
  extractMermaidBlocks,
  validateBlock,
} from '@mermaid-lint/core';

export function defineMermaidTests(opts: DiscoverOptions = {}): void {
  const files = discoverFiles(opts);
  const blocks: Block[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    blocks.push(...extractMermaidBlocks(file, text));
  }

  describe('Mermaid diagrams', () => {
    test('finds at least one diagram', () => {
      expect(blocks.length).toBeGreaterThan(0);
    });

    test.each(blocks)('$path:$line is valid', async (block) => {
      const result = await validateBlock(block);
      if (!result.ok)
        throw new Error(`${block.path}:${block.line}: ${result.error.message}`);
      expect(result.ok).toBe(true);
    });
  });
}
