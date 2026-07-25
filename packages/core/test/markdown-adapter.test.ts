import { describe, expect, it } from 'vitest';
import { blockToDiagnostics, lintMarkdown } from '../index.js';

describe('lintMarkdown', () => {
  it('returns no diagnostics for a valid mermaid block', async () => {
    const md = '```mermaid\nflowchart LR\n  A --> B\n```\n';
    expect(await lintMarkdown('test.md', md)).toEqual([]);
  });

  it('returns an error diagnostic for an invalid mermaid block', async () => {
    const md = '```mermaid\nflowchart LR\n  A -->|broken label B\n```\n';
    const diags = await lintMarkdown('test.md', md);
    const errors = diags.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].ruleId).toBe('mermaid');
  });

  it('maps a body error to its absolute document line', async () => {
    // Fence opens at line 3; body error is on body line 2 → 3 + 2 = 5.
    const md =
      'Line one\n\n```mermaid\nflowchart LR\n  A -->|broken label B\n```\n';
    const errors = (await lintMarkdown('test.md', md)).filter(
      (d) => d.severity === 'error',
    );
    expect(errors[0].line).toBe(5);
  });

  it('reports an unclosed fence at the opener line, not past EOF', async () => {
    const md = '```mermaid\nflowchart LR\n  A --> B\n';
    const errors = (await lintMarkdown('test.md', md)).filter(
      (d) => d.severity === 'error',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(1);
  });

  it('reports an empty mermaid block at the opener line', async () => {
    const md = '```mermaid\n```\n';
    const errors = (await lintMarkdown('test.md', md)).filter(
      (d) => d.severity === 'error',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(1);
  });

  it('ignores non-mermaid code blocks', async () => {
    const md = '```js\nconsole.log("hello")\n```\n';
    expect(await lintMarkdown('test.md', md)).toEqual([]);
  });

  it('flags only the invalid block among several', async () => {
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
    const errors = (await lintMarkdown('test.md', md)).filter(
      (d) => d.severity === 'error',
    );
    expect(errors).toHaveLength(1);
  });

  it('surfaces warn-severity findings as warning diagnostics', async () => {
    // Legacy `graph` keyword → prefer-flowchart, a warn-severity rule.
    const md = '```mermaid\ngraph LR\n  A --> B\n```\n';
    const warnings = (await lintMarkdown('test.md', md)).filter(
      (d) => d.severity === 'warning',
    );
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].ruleId).toBe('prefer-flowchart');
  });

  it('surfaces error-severity findings as error diagnostics', async () => {
    // Conflicting duplicate ids → duplicate-ids, an error-severity rule.
    const md =
      '```mermaid\nflowchart LR\n  A[Start] --> B\n  A[Begin] --> C\n```\n';
    const errors = (await lintMarkdown('test.md', md)).filter(
      (d) => d.severity === 'error' && d.ruleId === 'duplicate-ids',
    );
    expect(errors).toHaveLength(1);
  });
});

describe('blockToDiagnostics', () => {
  it('validates a single block built from explicit coordinates', async () => {
    const block = {
      path: 'doc.md',
      line: 10,
      col: 1,
      body: 'flowchart LR\n  A -->|broken label B',
      type: 'flowchart',
    };
    const errors = (await blockToDiagnostics(block)).filter(
      (d) => d.severity === 'error',
    );
    expect(errors).toHaveLength(1);
    // Body error on line 2 → opener(10) + 2 = 12.
    expect(errors[0].line).toBe(12);
  });
});

describe('suppression', () => {
  const md = (body: string) => `# Doc\n\n\`\`\`mermaid\n${body}\n\`\`\`\n`;

  it('suppresses a semantic finding with -disable-next-line', async () => {
    const withoutDirective = await lintMarkdown(
      'a.md',
      md('flowchart LR\n  A[x] --> B\n  A[y] --> C'),
    );
    expect(withoutDirective.some((d) => d.ruleId === 'duplicate-ids')).toBe(
      true,
    );

    const withDirective = await lintMarkdown(
      'a.md',
      md(
        'flowchart LR\n  A[x] --> B\n%% mermaid-lint-disable-next-line duplicate-ids: upstream\n  A[y] --> C',
      ),
    );
    expect(withDirective.some((d) => d.ruleId === 'duplicate-ids')).toBe(false);
  });

  it('suppresses every rule in the diagram with -disable-diagram all', async () => {
    const diags = await lintMarkdown(
      'a.md',
      md(
        '%% mermaid-lint-disable-diagram all: vendored\ngraph LR\n  A[x] --> B\n  A[y] --> C',
      ),
    );
    expect(diags.filter((d) => d.severity === 'warning')).toEqual([]);
  });

  it('does not suppress syntax errors via `all`', async () => {
    const diags = await lintMarkdown(
      'a.md',
      md(
        '%% mermaid-lint-disable-diagram all: vendored\nflowchart LR\n  A -->',
      ),
    );
    expect(diags.some((d) => d.ruleId === 'mermaid')).toBe(true);
  });

  it('suppresses a syntax error when `mermaid` is named at diagram scope', async () => {
    const diags = await lintMarkdown(
      'a.md',
      md(
        '%% mermaid-lint-disable-diagram mermaid: parser lags\nflowchart LR\n  A -->',
      ),
    );
    expect(diags.some((d) => d.ruleId === 'mermaid')).toBe(false);
  });

  it('applies a document-level directive to every block', async () => {
    const text =
      '<!-- mermaid-lint-disable-file duplicate-ids: vendored docs -->\n\n' +
      '```mermaid\nflowchart LR\n  A[x] --> B\n  A[y] --> C\n```\n';
    const diags = await lintMarkdown('a.md', text);
    expect(diags.some((d) => d.ruleId === 'duplicate-ids')).toBe(false);
  });

  it('reports an unknown rule id in a directive', async () => {
    const diags = await lintMarkdown(
      'a.md',
      md(
        '%% mermaid-lint-disable-diagram duplicat-ids: typo\nflowchart LR\n  A --> B',
      ),
    );
    expect(diags.some((d) => d.ruleId === 'suppression-unknown-rule')).toBe(
      true,
    );
  });

  it('reports a directive with no reason as malformed', async () => {
    const diags = await lintMarkdown(
      'a.md',
      md(
        '%% mermaid-lint-disable-diagram duplicate-ids\nflowchart LR\n  A --> B',
      ),
    );
    expect(diags.some((d) => d.ruleId === 'suppression-malformed')).toBe(true);
  });

  it('reports a directive that suppressed nothing', async () => {
    const diags = await lintMarkdown(
      'a.md',
      md(
        '%% mermaid-lint-disable-diagram no-self-loop: stale\nflowchart LR\n  A --> B',
      ),
    );
    expect(diags.some((d) => d.ruleId === 'suppression-unused')).toBe(true);
  });

  it('reports directive diagnostics at the directive line', async () => {
    const diags = await lintMarkdown(
      'a.md',
      md(
        'flowchart LR\n%% mermaid-lint-disable-diagram duplicat-ids: typo\n  A --> B',
      ),
    );
    const finding = diags.find((d) => d.ruleId === 'suppression-unknown-rule');
    // Fence opener is line 3, so body line 2 is document line 5.
    expect(finding?.line).toBe(5);
  });
});
