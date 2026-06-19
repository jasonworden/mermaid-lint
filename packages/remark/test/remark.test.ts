import { remark } from 'remark';
import remarkLint from 'remark-lint';
import { describe, expect, it } from 'vitest';
import remarkLintMermaid from '../index.js';

async function lint(markdown: string): Promise<string[]> {
  const file = await remark()
    .use(remarkLint)
    .use(remarkLintMermaid)
    .process(markdown);
  return file.messages.map((m) => m.reason);
}

async function lintFile(markdown: string) {
  return remark().use(remarkLint).use(remarkLintMermaid).process(markdown);
}

describe('@mermaid-lint/remark', () => {
  it('passes on a valid mermaid block', async () => {
    const md = '```mermaid\nflowchart LR\n  A --> B\n```\n';
    expect(await lint(md)).toEqual([]);
  });

  it('reports an error on an invalid mermaid block', async () => {
    const md = '```mermaid\nflowchart LR\n  A -->|broken label B\n```\n';
    const msgs = await lint(md);
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('does not report errors on non-mermaid code blocks', async () => {
    const md = '```js\nconsole.log("hello")\n```\n';
    expect(await lint(md)).toEqual([]);
  });

  it('passes on markdown with no code blocks', async () => {
    const md = '# Hello\n\nSome text.\n';
    expect(await lint(md)).toEqual([]);
  });

  it('reports error line number relative to document (not fence body)', async () => {
    // Fence opens at line 3 (1-indexed). Error is in the body.
    // Absolute line = fenceStartLine + error.line
    const md =
      'Line one\n\n```mermaid\nflowchart LR\n  A -->|broken label B\n```\n';
    const file = await lintFile(md);
    expect(file.messages.length).toBeGreaterThan(0);
    const msg = file.messages[0];
    // The fence opens on line 3. Body starts on line 4. Error is in body.
    // Absolute line should be >= 3.
    expect(msg.line).toBeGreaterThanOrEqual(3);
  });

  it('strict mode: reports semantic warnings as errors', async () => {
    // duplicate-ids warning: same node ID used with different labels
    const md =
      '```mermaid\nflowchart LR\n  A[Start] --> B\n  A[Begin] --> C\n```\n';
    const fileDefault = await remark()
      .use(remarkLint)
      .use(remarkLintMermaid)
      .process(md);
    expect(fileDefault.messages).toHaveLength(0); // strict=false by default

    const fileStrict = await remark()
      .use(remarkLint)
      .use(remarkLintMermaid, { strict: true })
      .process(md);
    expect(fileStrict.messages.length).toBeGreaterThan(0);
  });

  it('handles multiple mermaid blocks in one document', async () => {
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
    const msgs = await lint(md);
    expect(msgs.length).toBe(1); // only the second block is invalid
  });
});
