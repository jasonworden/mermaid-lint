import type { LintResults } from 'markdownlint';
import { lint } from 'markdownlint/promise';
import { describe, expect, it } from 'vitest';
import mermaidRule from '../index.js';

function lintMd(
  content: string,
  ruleConfig: unknown = true,
): Promise<LintResults> {
  return lint({
    strings: { 'test.md': content },
    customRules: [mermaidRule],
    config: { default: false, ML001: ruleConfig },
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

  it('reports an unclosed fence at the opener line (not past EOF)', async () => {
    // Opener on line 1, no closing fence. The structural error carries no
    // body line, so it must be reported at the opener (line 1) and never
    // point past the last document line.
    const md = '```mermaid\nflowchart LR\n  A --> B\n';
    const result = await lintMd(md);
    const errors = result['test.md'];
    expect(errors).toHaveLength(1);
    expect(errors[0].lineNumber).toBe(1);
  });

  it('reports an empty mermaid block at the opener line', async () => {
    const md = '```mermaid\n```\n';
    const result = await lintMd(md);
    const errors = result['test.md'];
    expect(errors).toHaveLength(1);
    expect(errors[0].lineNumber).toBe(1);
  });

  it('reports an error inside a tilde fence', async () => {
    const md = '~~~mermaid\nflowchart LR\n  A -->|broken label B\n~~~\n';
    const result = await lintMd(md);
    expect(result['test.md'].length).toBeGreaterThan(0);
  });

  it('ignores tilde fences when config restricts to backtick', async () => {
    const md = '~~~mermaid\nflowchart LR\n  A -->|broken label B\n~~~\n';
    const result = await lintMd(md, { fences: ['backtick'] });
    expect(result['test.md']).toHaveLength(0);
  });

  it('still flags backtick fences when config restricts to backtick', async () => {
    const md = '```mermaid\nflowchart LR\n  A -->|broken label B\n```\n';
    const result = await lintMd(md, { fences: ['backtick'] });
    expect(result['test.md'].length).toBeGreaterThan(0);
  });

  it('rule has correct names, tags, and description', () => {
    expect(mermaidRule.names).toContain('ML001');
    expect(mermaidRule.names).toContain('mermaid');
    expect(mermaidRule.tags).toEqual(['mermaid-diagram', 'code']);
    expect(typeof mermaidRule.description).toBe('string');
  });

  // Regression guard: markdownlint-cli2 must run the async rule through its
  // OWN bundled markdownlint. Versions < 0.17 bundle markdownlint < 0.37,
  // which predates async custom rules and silently skips this rule (zero
  // errors). This test exercises that real path end-to-end.
  it('runs through markdownlint-cli2 and flags invalid blocks', async () => {
    const { main } = await import('markdownlint-cli2');
    let results: Array<{ fileName: string; lineNumber: number }> = [];
    const exitCode = await main({
      directory: process.cwd(),
      argv: [],
      optionsOverride: {
        config: { default: false, ML001: true },
        customRules: [mermaidRule],
        outputFormatters: [
          [
            (options: { results: typeof results }) => {
              results = options.results;
            },
          ],
        ],
      },
      nonFileContents: {
        'bad.md': '```mermaid\nflowchart LR\n  A -->|broken label B\n```\n',
        'good.md': '```mermaid\nflowchart LR\n  A --> B\n```\n',
      },
      logMessage: () => {},
      logError: () => {},
    });
    expect(exitCode).toBeTruthy();
    expect(results).toHaveLength(1);
    expect(results[0].fileName).toBe('bad.md');
    expect(results[0].lineNumber).toBe(3);
  });
});
