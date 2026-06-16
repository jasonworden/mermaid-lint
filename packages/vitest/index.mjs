import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { discoverFiles, extractMermaidBlocks, validateBlock } from '@mermaid-lint/core';

export function defineMermaidTests(opts = {}) {
  const files = discoverFiles(opts);
  const blocks = [];
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
      expect(result.ok, `${path}:${line}: ${result.ok ? '' : result.error.message}`).toBe(true);
    });
  });
}
