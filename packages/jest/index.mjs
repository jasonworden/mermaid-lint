import { readFileSync } from 'node:fs';
import { describe, expect, test } from '@jest/globals';
import {
  discoverFiles,
  extractMermaidBlocks,
  validateBlock,
} from '@mermaid-lint/core';

export function defineMermaidTests(opts = {}) {
  const files = discoverFiles(opts);
  const blocks = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    blocks.push(...extractMermaidBlocks(file, text));
  }

  describe('Mermaid diagrams', () => {
    test('finds at least one diagram', () => {
      expect(blocks.length).toBeGreaterThan(0);
    });

    test.each(blocks)('$path:$line is valid', async ({ path, line, body }) => {
      const result = await validateBlock(body);
      if (!result.ok)
        throw new Error(`${path}:${line}: ${result.error.message}`);
      expect(result.ok).toBe(true);
    });
  });
}
