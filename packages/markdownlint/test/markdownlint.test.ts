import type { LintResults } from 'markdownlint';
import { lint } from 'markdownlint/promise';
import { describe, expect, it } from 'vitest';
import mermaidRule from '../index.js';

function lintMd(content: string): Promise<LintResults> {
  return lint({
    strings: { 'test.md': content },
    customRules: [mermaidRule],
    config: { default: false, ML001: true },
  });
}

describe('@mermaid-lint/markdownlint', () => {
  it('passes on a valid mermaid block', async () => {
    const md = '```mermaid\nflowchart LR\n  A --> B\n```\n';
    const result = await lintMd(md);
    expect(result['test.md']).toHaveLength(0);
  });

  it('reports an error on an invalid mermaid block', async () => {
    const md = '```mermaid\nflowchart LR\n  A -->|broken label B\n```\n';
    const result = await lintMd(md);
    expect(result['test.md'].length).toBeGreaterThan(0);
  });

  it('does not report errors on non-mermaid code blocks', async () => {
    const md = '```js\nconsole.log("hello")\n```\n';
    const result = await lintMd(md);
    expect(result['test.md']).toHaveLength(0);
  });

  it('passes on markdown with no code blocks', async () => {
    const md = '# Hello\n\nSome text.\n';
    const result = await lintMd(md);
    expect(result['test.md']).toHaveLength(0);
  });

  it('reports error at the correct absolute line number', async () => {
    // Fence opens at line 3 (1-indexed). Body error is on line 2 of body.
    // absLine = fenceStart(3) + error.line(2) = 5
    const md =
      'Line one\n\n```mermaid\nflowchart LR\n  A -->|broken label B\n```\n';
    const result = await lintMd(md);
    expect(result['test.md'].length).toBeGreaterThan(0);
    const err = result['test.md'][0];
    // fence opens at line 3; body starts line 4; error is on body line 2
    // absLine = 3 + 2 = 5
    expect(err.lineNumber).toBe(5);
  });

  it('handles multiple mermaid blocks, reports only the invalid one', async () => {
    const md = [
      '```mermaid',
      'flowchart LR',
      '  A --> B',
      '```',
      '',
      '```mermaid',
      'flowchart LR',
      '  C -->|broken label D',
      '```',
      '',
    ].join('\n');
    const result = await lintMd(md);
    expect(result['test.md']).toHaveLength(1);
  });

  it('rule has correct names and description', () => {
    expect(mermaidRule.names).toContain('ML001');
    expect(mermaidRule.names).toContain('mermaid');
    expect(typeof mermaidRule.description).toBe('string');
  });
});
