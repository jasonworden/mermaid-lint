import { TextlintKernel } from '@textlint/kernel';
import markdownPlugin from '@textlint/textlint-plugin-markdown';
import { describe, expect, it } from 'vitest';
import rule from '../index.js';

const kernel = new TextlintKernel();

function lint(text: string, options: Record<string, unknown> = {}) {
  return kernel.lintText(text, {
    ext: '.md',
    plugins: [{ pluginId: 'markdown', plugin: markdownPlugin }],
    rules: [{ ruleId: 'mermaid', rule, options }],
  });
}

describe('@mermaid-lint/textlint', () => {
  it('passes on a valid mermaid block', async () => {
    const md = '```mermaid\nflowchart LR\n  A --> B\n```\n';
    const { messages } = await lint(md);
    expect(messages).toHaveLength(0);
  });

  it('reports an error on an invalid mermaid block', async () => {
    const md = '```mermaid\nflowchart LR\n  A -->|broken label B\n```\n';
    const { messages } = await lint(md);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0].ruleId).toBe('mermaid');
  });

  it('does not report on non-mermaid code blocks', async () => {
    const md = '```js\nconsole.log("hello")\n```\n';
    const { messages } = await lint(md);
    expect(messages).toHaveLength(0);
  });

  it('passes on markdown with no code blocks', async () => {
    const md = '# Hello\n\nSome text.\n';
    const { messages } = await lint(md);
    expect(messages).toHaveLength(0);
  });

  it('reports the error at the correct absolute document line', async () => {
    // Fence opens at line 3; body error is on body line 2 → 3 + 2 = 5.
    const md =
      'Line one\n\n```mermaid\nflowchart LR\n  A -->|broken label B\n```\n';
    const { messages } = await lint(md);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0].line).toBe(5);
  });

  it('reports warn-severity findings only in strict mode', async () => {
    // prefer-flowchart is a warn-severity rule: hidden by default, shown in strict.
    const md = '```mermaid\ngraph LR\n  A --> B\n```\n';
    const lenient = await lint(md);
    expect(lenient.messages).toHaveLength(0);

    const strict = await lint(md, { strict: true });
    expect(strict.messages.length).toBeGreaterThan(0);
  });

  it('rules: enables an off-by-default rule', async () => {
    // no-orphan-nodes is `off` by default: C is declared but never connected.
    const md = '```mermaid\nflowchart LR\n  A --> B\n  C[Orphan]\n```\n';
    const lenient = await lint(md);
    expect(lenient.messages).toHaveLength(0); // off by default

    const enabled = await lint(md, { rules: { 'no-orphan-nodes': 'error' } });
    expect(enabled.messages.length).toBeGreaterThan(0);
  });

  it('rules: silences a rule even under strict', async () => {
    // no-self-loop is warn-severity; strict surfaces it, but `off` overrides.
    const md = '```mermaid\nflowchart LR\n  A --> A\n```\n';
    const strict = await lint(md, { strict: true });
    expect(strict.messages.length).toBeGreaterThan(0);

    const silenced = await lint(md, {
      strict: true,
      rules: { 'no-self-loop': 'off' },
    });
    expect(silenced.messages).toHaveLength(0);
  });
});
