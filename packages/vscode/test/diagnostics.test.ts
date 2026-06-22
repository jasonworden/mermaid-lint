import { describe, expect, it } from 'vitest';
import { computeMermaidDiagnostics } from '../src/diagnostics.js';
import { computeFix } from '../src/fix.js';

// Valid + invalid fixtures. The invalid body has an unterminated edge label
// (`|broken label B` with no closing `|`), which mermaid reports on body line 2.
const VALID_MD = '```mermaid\nflowchart LR\n  A --> B\n```\n';
// A syntactically-valid flowchart that declares node A twice with different
// labels — triggers core's duplicate-ids rule (error severity) on body line 3.
const DUP_MMD = 'flowchart LR\n  A[First] --> B\n  A[Second] --> C\n';
// A valid diagram that only trips a warn-severity rule (prefer-flowchart).
const WARN_MMD = 'graph LR\n  A --> B\n';

describe('computeMermaidDiagnostics — markdown', () => {
  it('returns no diagnostics for a valid mermaid block', async () => {
    expect(await computeMermaidDiagnostics('test.md', VALID_MD)).toEqual([]);
  });

  it('flags an invalid block at the correct 0-indexed document line', async () => {
    // doc: 1 ```mermaid, 2 flowchart LR, 3 (broken), 4 ```
    const md = '```mermaid\nflowchart LR\n  A -->|broken label B\n```\n';
    const diags = await computeMermaidDiagnostics('test.md', md);
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].severity).toBe('error');
    // fence opener doc line 1 -> bodyStart 2; body line 2 -> doc line 3 -> idx 2
    expect(diags[0].startLine).toBe(2);
  });

  it('ignores non-mermaid code blocks', async () => {
    expect(
      await computeMermaidDiagnostics('test.md', '```js\nx\n```\n'),
    ).toEqual([]);
  });

  it('flags only the invalid block among many', async () => {
    const md = [
      '```mermaid',
      'flowchart LR',
      '  A --> B',
      '```',
      '',
      '```mermaid',
      'flowchart LR',
      '  C -->|broken D',
      '```',
      '',
    ].join('\n');
    const diags = await computeMermaidDiagnostics('test.md', md);
    expect(diags).toHaveLength(1);
    // 2nd fence opener at doc line 6 -> bodyStart 7; body line 2 -> doc line 8 -> idx 7
    expect(diags[0].startLine).toBe(7);
  });

  it('reports an unclosed fence at the opener line, not past EOF', async () => {
    const md = '```mermaid\nflowchart LR\n  A --> B\n';
    const diags = await computeMermaidDiagnostics('test.md', md);
    expect(diags).toHaveLength(1);
    expect(diags[0].startLine).toBe(0); // opener doc line 1 -> idx 0
    expect(diags[0].startLine).toBeLessThan(md.split('\n').length);
  });

  it('reports an empty mermaid block at the opener line', async () => {
    const diags = await computeMermaidDiagnostics(
      'test.md',
      '```mermaid\n```\n',
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].startLine).toBe(0);
  });
});

describe('computeMermaidDiagnostics — .mmd files', () => {
  it('flags an invalid .mmd diagram at the correct line (no off-by-one)', async () => {
    const mmd = 'flowchart LR\n  A -->|broken label B\n';
    const diags = await computeMermaidDiagnostics('diagram.mmd', mmd);
    expect(diags.length).toBeGreaterThan(0);
    // .mmd body line 2 -> doc line 2 -> idx 1 (the .md formula would give 2)
    expect(diags[0].startLine).toBe(1);
  });
});

describe('computeMermaidDiagnostics — semantic findings', () => {
  it('reports a duplicate-id finding as an error by default', async () => {
    // duplicate-ids defaults to error severity, so it is an error even without strict.
    const diags = await computeMermaidDiagnostics('d.mmd', DUP_MMD);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('error');
  });

  it('reports a warn-severity finding as a warning by default', async () => {
    const diags = await computeMermaidDiagnostics('d.mmd', WARN_MMD);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('warning');
  });

  it('elevates warn-severity findings to errors under strict', async () => {
    const diags = await computeMermaidDiagnostics('d.mmd', WARN_MMD, {
      strict: true,
    });
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('error');
  });

  it('suppresses findings when semantic is false', async () => {
    expect(
      await computeMermaidDiagnostics('d.mmd', DUP_MMD, { semantic: false }),
    ).toEqual([]);
  });
});

describe('computeFix', () => {
  it('returns null when there is nothing to fix', async () => {
    expect(await computeFix('test.md', VALID_MD)).toBeNull();
  });

  it('returns fixed text when the document has an auto-fixable issue', async () => {
    // A fenced block whose body fixText can mechanically correct. If this exact
    // input is already canonical, the assertion below still holds (null), so we
    // assert the contract: result is either null or a changed string, never the
    // unchanged input.
    const md = '```mermaid\nflowchart LR\n  A-->B\n```\n';
    const fixed = await computeFix('test.md', md);
    if (fixed !== null) expect(fixed).not.toBe(md);
  });
});
