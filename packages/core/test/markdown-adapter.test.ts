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

  it('surfaces semantic warnings as warning diagnostics', async () => {
    // Same node id with conflicting labels → duplicate-ids warning.
    const md =
      '```mermaid\nflowchart LR\n  A[Start] --> B\n  A[Begin] --> C\n```\n';
    const warnings = (await lintMarkdown('test.md', md)).filter(
      (d) => d.severity === 'warning',
    );
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].ruleId).toBeTruthy();
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
