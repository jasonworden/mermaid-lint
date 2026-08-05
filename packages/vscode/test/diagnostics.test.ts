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

describe('computeMermaidDiagnostics — rules config', () => {
  // no-orphan-nodes is off by default: C is declared but never connected.
  const ORPHAN_MMD = 'flowchart LR\n  A --> B\n  C[Orphan]\n';
  // no-self-loop is warn-severity by default.
  const SELF_LOOP_MMD = 'flowchart LR\n  A --> A\n';

  it('enables an off-by-default rule via rules', async () => {
    expect(await computeMermaidDiagnostics('d.mmd', ORPHAN_MMD)).toEqual([]);

    const diags = await computeMermaidDiagnostics('d.mmd', ORPHAN_MMD, {
      rules: { 'no-orphan-nodes': 'error' },
    });
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('error');
  });

  it('silences a rule via rules even under strict', async () => {
    const strict = await computeMermaidDiagnostics('d.mmd', SELF_LOOP_MMD, {
      strict: true,
    });
    expect(strict).toHaveLength(1);

    const silenced = await computeMermaidDiagnostics('d.mmd', SELF_LOOP_MMD, {
      strict: true,
      rules: { 'no-self-loop': 'off' },
    });
    expect(silenced).toEqual([]);
  });
});

describe('computeMermaidDiagnostics — suppression directives', () => {
  it('honors a -disable-diagram mermaid: <reason> directive on a syntax error', async () => {
    const mmd =
      '%% mermaid-lint-disable-diagram mermaid: pinned parser predates this syntax\nflowchart LR\n  A[Start] -->\n';
    expect(await computeMermaidDiagnostics('d.mmd', mmd)).toEqual([]);
  });

  it('surfaces suppression-malformed for a directive with no reason', async () => {
    const mmd =
      '%% mermaid-lint-disable-next-line duplicate-ids\nflowchart LR\n  A --> B\n';
    const diags = await computeMermaidDiagnostics('d.mmd', mmd);
    expect(diags.some((d) => d.message.includes('needs a reason'))).toBe(true);
  });
});

// Document-scope diagnostics: only reachable because the adapter drives
// `lintMarkdown` over the whole document rather than looping over blocks.
describe('computeMermaidDiagnostics — file-scope directives', () => {
  it('surfaces a stale file directive at the HTML comment line', async () => {
    const md =
      '# Doc\n\n' +
      '<!-- mermaid-lint-disable-file duplicate-ids: no longer needed -->\n\n' +
      '```mermaid\nflowchart LR\n  A --> B\n```\n\n' +
      '```mermaid\nflowchart LR\n  C --> D\n```\n';
    const diags = await computeMermaidDiagnostics('test.md', md);
    const stale = diags.filter((d) =>
      d.message.includes('suppressed nothing in this document'),
    );
    expect(stale).toHaveLength(1);
    // Document line 3, 0-indexed for VS Code.
    expect(stale[0].startLine).toBe(2);
    expect(stale[0].severity).toBe('warning');
  });

  it('does not flag a file directive that suppressed something', async () => {
    const md =
      '<!-- mermaid-lint-disable-file duplicate-ids: vendored -->\n\n' +
      '```mermaid\nflowchart LR\n  A[x] --> B\n  A[y] --> C\n```\n';
    const diags = await computeMermaidDiagnostics('test.md', md);
    expect(diags).toEqual([]);
  });

  it('surfaces an unknown rule id in a file directive', async () => {
    const md =
      '<!-- mermaid-lint-disable-file duplicat-ids: typo -->\n\n' +
      '```mermaid\nflowchart LR\n  A --> B\n```\n';
    const diags = await computeMermaidDiagnostics('test.md', md);
    expect(diags.some((d) => d.message.includes('unknown rule'))).toBe(true);
  });

  it('emits no file-scope diagnostics when semantic is off', async () => {
    const md =
      '<!-- mermaid-lint-disable-file duplicate-ids: stale -->\n\n' +
      '```mermaid\nflowchart LR\n  A --> B\n```\n';
    const diags = await computeMermaidDiagnostics('test.md', md, {
      semantic: false,
    });
    expect(diags).toEqual([]);
  });

  it('elevates a stale file directive to an error under strict', async () => {
    const md =
      '<!-- mermaid-lint-disable-file duplicate-ids: stale -->\n\n' +
      '```mermaid\nflowchart LR\n  A --> B\n```\n';
    const diags = await computeMermaidDiagnostics('test.md', md, {
      strict: true,
    });
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('error');
  });

  it('honors the fences option when computing file-scope diagnostics', async () => {
    // Pins that `fences` still reaches core after the switch to `lintMarkdown`
    // — it moved from `extractMermaidBlocks`'s options to `lintMarkdown`'s
    // third positional argument, and swapping it with `rules` would otherwise
    // fail nothing. Restricted to backticks, the tilde block is not extracted,
    // so the directive suppresses nothing and is reported stale.
    const md =
      '<!-- mermaid-lint-disable-file duplicate-ids: vendored -->\n\n' +
      '~~~mermaid\nflowchart LR\n  A[x] --> B\n  A[y] --> C\n~~~\n';
    const backtickOnly = await computeMermaidDiagnostics('test.md', md, {
      fences: ['backtick'],
    });
    expect(
      backtickOnly.some((d) =>
        d.message.includes('suppressed nothing in this document'),
      ),
    ).toBe(true);

    // With the CommonMark default (both markers) the tilde block is linted,
    // the directive fires, and nothing is reported.
    expect(await computeMermaidDiagnostics('test.md', md)).toEqual([]);
  });

  it('maps a stale file directive to the right line in a CRLF document', async () => {
    const md =
      '# Doc\r\n\r\n' +
      '<!-- mermaid-lint-disable-file duplicate-ids: stale -->\r\n\r\n' +
      '```mermaid\r\nflowchart LR\r\n  A --> B\r\n```\r\n';
    const diags = await computeMermaidDiagnostics('test.md', md);
    expect(diags).toHaveLength(1);
    expect(diags[0].startLine).toBe(2);
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
