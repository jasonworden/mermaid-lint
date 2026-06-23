import { remark } from 'remark';
import remarkLint from 'remark-lint';
import { describe, expect, it } from 'vitest';
import remarkLintMermaid, { remarkMermaidFix } from '../index.js';

async function lint(markdown: string): Promise<string[]> {
  const file = await remark()
    .use(remarkLint)
    .use(remarkLintMermaid)
    .process(markdown);
  return file.messages.map((m) => m.reason);
}

/**
 * Run the fix transformer and return the serialized document. The fix is only
 * observable on stringify (mirrors `remark --output`), so we round-trip.
 */
async function fix(markdown: string): Promise<string> {
  const file = await remark().use(remarkMermaidFix).process(markdown);
  return String(file);
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
    // The fence opens on line 3. Error is on line 2 of body (5 absolute).
    // Absolute line = fenceStartLine (3) + errorBodyLine (2) = 5
    expect(msg.line).toBe(5);
  });

  it('strict mode: reports warn-severity findings as errors', async () => {
    // prefer-flowchart is a warn-severity rule: hidden by default, shown in strict.
    const md = '```mermaid\ngraph LR\n  A --> B\n```\n';
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

  it('rules: enables an off-by-default rule', async () => {
    // no-orphan-nodes is `off` by default: C is declared but never connected.
    const md = '```mermaid\nflowchart LR\n  A --> B\n  C[Orphan]\n```\n';

    const fileDefault = await remark()
      .use(remarkLint)
      .use(remarkLintMermaid)
      .process(md);
    expect(fileDefault.messages).toHaveLength(0); // off by default

    const fileEnabled = await remark()
      .use(remarkLint)
      .use(remarkLintMermaid, { rules: { 'no-orphan-nodes': 'error' } })
      .process(md);
    expect(fileEnabled.messages.length).toBeGreaterThan(0);
  });

  it('rules: silences a rule even under strict', async () => {
    // no-self-loop is warn-severity; strict would surface it, but an explicit
    // `off` override wins.
    const md = '```mermaid\nflowchart LR\n  A --> A\n```\n';

    const strict = await remark()
      .use(remarkLint)
      .use(remarkLintMermaid, { strict: true })
      .process(md);
    expect(strict.messages.length).toBeGreaterThan(0);

    const silenced = await remark()
      .use(remarkLint)
      .use(remarkLintMermaid, {
        strict: true,
        rules: { 'no-self-loop': 'off' },
      })
      .process(md);
    expect(silenced.messages).toHaveLength(0);
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

describe('@mermaid-lint/remark — autofix (remarkMermaidFix)', () => {
  it('normalizes -> to --> in a flowchart block', async () => {
    const out = await fix('```mermaid\nflowchart LR\n  A -> B\n```\n');
    expect(out).toContain('A --> B');
    expect(out).not.toContain('A -> B');
  });

  it('normalizes -> to --> in a graph block', async () => {
    const out = await fix('```mermaid\ngraph LR\n  A -> B\n```\n');
    expect(out).toContain('A --> B');
  });

  it('inserts a missing sequence-message colon', async () => {
    const out = await fix(
      '```mermaid\nsequenceDiagram\n  Alice->>Bob hi\n```\n',
    );
    expect(out).toContain('Alice->>Bob: hi');
  });

  it('fixes multiple arrows in one block', async () => {
    const out = await fix(
      '```mermaid\nflowchart LR\n  A -> B\n  B -> C\n```\n',
    );
    expect(out).toContain('A --> B');
    expect(out).toContain('B --> C');
    expect(out).not.toContain('A -> B'); // single-arrow form gone
    expect(out).not.toContain('B -> C');
  });

  it('leaves a valid mermaid block unchanged', async () => {
    const out = await fix('```mermaid\nflowchart LR\n  A --> B\n```\n');
    expect(out).toContain('A --> B');
    expect(out).not.toContain('--->'); // no double-application
  });

  it('does not touch non-mermaid code blocks', async () => {
    const out = await fix('```js\nconst x = a -> b\n```\n');
    expect(out).toContain('a -> b'); // untouched
  });

  it('does not mechanically fix an unfixable / semantic-only issue', async () => {
    // A broken label has no mechanical fix; the body should round-trip as-is.
    const out = await fix(
      '```mermaid\nflowchart LR\n  A -->|broken label B\n```\n',
    );
    expect(out).toContain('A -->|broken label B');
  });

  it('is idempotent — running twice equals running once', async () => {
    const md = '```mermaid\nflowchart LR\n  A -> B\n```\n';
    const once = await fix(md);
    const twice = await fix(once);
    expect(twice).toBe(once);
  });

  it('preserves surrounding markdown structure', async () => {
    const md = [
      '# Title',
      '',
      'Some prose.',
      '',
      '```mermaid',
      'flowchart LR',
      '  A -> B',
      '```',
      '',
      '- list item',
      '',
    ].join('\n');
    const out = await fix(md);
    expect(out).toContain('# Title');
    expect(out).toContain('Some prose.');
    // remark-stringify normalizes bullet markers (`-` → `*`) under --output;
    // that reflow is inherent to remark, so assert content survives, not syntax.
    expect(out).toContain('list item');
    expect(out).toContain('A --> B');
  });

  it('fixes a mermaid fence nested in a list item', async () => {
    const md = [
      '- step one',
      '',
      '  ```mermaid',
      '  flowchart LR',
      '    A -> B',
      '  ```',
      '',
    ].join('\n');
    const out = await fix(md);
    expect(out).toContain('A --> B');
  });

  it('reporting and fixing compose in one pipeline', async () => {
    const md = '```mermaid\nflowchart LR\n  A -> B\n```\n';
    const file = await remark()
      .use(remarkLint)
      .use(remarkLintMermaid)
      .use(remarkMermaidFix)
      .process(md);
    expect(String(file)).toContain('A --> B');
  });

  it('leaves a diagram of an unhandled type untouched', async () => {
    // Arrow/colon fixes only apply to flowchart/graph/sequence; an `->` inside
    // another diagram type must round-trip unchanged.
    const out = await fix('```mermaid\npie title T\n  "A" -> 1\n```\n');
    expect(out).toContain('"A" -> 1');
    expect(out).not.toContain('-->');
  });
});
