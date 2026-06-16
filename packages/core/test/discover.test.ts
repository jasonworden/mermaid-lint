import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverFiles } from '../src/discover.js';

describe('discoverFiles', () => {
  it('returns explicit paths that exist', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    const file = join(tmp, 'test.md');
    writeFileSync(file, '# test');
    expect(discoverFiles({ paths: [file] })).toContain(file);
  });

  it('filters out non-existent explicit paths', () => {
    expect(discoverFiles({ paths: ['/non/existent/file.md'] })).toHaveLength(0);
  });

  it('discovers all .md files with all:true', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(join(tmp, 'a.md'), '# a');
    writeFileSync(join(tmp, 'b.md'), '# b');
    writeFileSync(join(tmp, 'c.txt'), 'not md');
    const result = discoverFiles({ root: tmp, all: true });
    expect(result).toHaveLength(2);
    expect(result.every((p) => p.endsWith('.md'))).toBe(true);
  });

  it('skips node_modules with all:true', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(join(tmp, 'real.md'), '# real');
    const nm = join(tmp, 'node_modules');
    mkdirSync(nm);
    writeFileSync(join(nm, 'ignored.md'), '# ignored');
    const result = discoverFiles({ root: tmp, all: true });
    expect(result.some((p) => p.includes('node_modules'))).toBe(false);
  });

  it('returns empty array when git ls-files fails (not a git repo)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    const result = discoverFiles({ root: tmp });
    expect(result).toEqual([]);
  });

  it('discovers .mmd files with all:true', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(join(tmp, 'diagram.mmd'), 'flowchart LR\n  A-->B');
    writeFileSync(join(tmp, 'doc.md'), '# doc');
    const result = discoverFiles({ root: tmp, all: true });
    expect(result.some((p) => p.endsWith('.mmd'))).toBe(true);
  });

  it('discovers .mdx files with all:true', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(join(tmp, 'page.mdx'), '# page');
    const result = discoverFiles({ root: tmp, all: true });
    expect(result.some((p) => p.endsWith('.mdx'))).toBe(true);
  });

  it('discovers .markdown files with all:true', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(join(tmp, 'doc.markdown'), '# doc');
    const result = discoverFiles({ root: tmp, all: true });
    expect(result.some((p) => p.endsWith('.markdown'))).toBe(true);
  });

  it('accepts .mmd explicit paths', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    const file = join(tmp, 'diagram.mmd');
    writeFileSync(file, 'flowchart LR\n  A-->B');
    expect(discoverFiles({ paths: [file] })).toContain(file);
  });
});
