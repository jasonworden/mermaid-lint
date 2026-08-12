import { describe, expect, it } from 'vitest';
import { extractMermaidBlocks } from '../../src/extract.js';
import { RULE_DEFAULTS } from '../../src/rules.js';
import type { ResolvedRules } from '../../src/rules.js';
import { block } from './helpers.js';
import { only } from './helpers.js';

describe('prefer-flowchart rule', () => {
  it('flags the legacy `graph` keyword (warn)', () => {
    const b = block('graph LR\n  A --> B', 'graph');
    const warnings = only(b, 'prefer-flowchart');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].line).toBe(1);
    expect(warnings[0].message).toContain('flowchart');
  });

  it('does not flag `flowchart`', () => {
    const b = block('flowchart LR\n  A --> B', 'flowchart');
    expect(only(b, 'prefer-flowchart')).toEqual([]);
  });

  it('is suppressed by %% mermaid-lint-disable-diagram prefer-flowchart', () => {
    const b = block(
      'graph LR\n  %% mermaid-lint-disable-diagram prefer-flowchart: legacy suppression test\n  A --> B',
      'graph',
    );
    expect(only(b, 'prefer-flowchart')).toEqual([]);
  });

  it('returns [] when configured off', () => {
    const b = block('graph LR\n  A --> B', 'graph');
    const rules: ResolvedRules = {
      ...RULE_DEFAULTS,
      'prefer-flowchart': 'off',
    };
    expect(only(b, 'prefer-flowchart', rules)).toEqual([]);
  });
});

describe('require-direction rule', () => {
  it('flags a flowchart with no direction (warn)', () => {
    const b = block('flowchart\n  A --> B', 'flowchart');
    const warnings = only(b, 'require-direction');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('TD');
  });

  it('does not flag a flowchart with an explicit direction', () => {
    for (const dir of ['TB', 'TD', 'BT', 'RL', 'LR']) {
      const b = block(`flowchart ${dir}\n  A --> B`, 'flowchart');
      expect(only(b, 'require-direction')).toEqual([]);
    }
  });

  it('flags a directionless graph too', () => {
    const b = block('graph\n  A --> B', 'graph');
    expect(only(b, 'require-direction')).toHaveLength(1);
  });

  it('ignores leading comment lines when finding the keyword', () => {
    const b = block('%% a title\nflowchart LR\n  A --> B', 'flowchart');
    expect(only(b, 'require-direction')).toEqual([]);
  });

  it('is suppressed by %% mermaid-lint-disable-diagram require-direction', () => {
    const b = block(
      'flowchart\n  %% mermaid-lint-disable-diagram require-direction: legacy suppression test\n  A --> B',
      'flowchart',
    );
    expect(only(b, 'require-direction')).toEqual([]);
  });
});

describe('no-experimental rule', () => {
  it('flags a *-beta diagram type (warn)', () => {
    const b = block('xychart-beta\n  title "x"', 'xychart-beta');
    const warnings = only(b, 'no-experimental');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('xychart-beta');
  });

  it('does not flag a stable diagram type', () => {
    const b = block('flowchart LR\n  A --> B', 'flowchart');
    expect(only(b, 'no-experimental')).toEqual([]);
  });

  it('is suppressed by %% mermaid-lint-disable-diagram no-experimental', () => {
    const b = block(
      'sankey-beta\n%% mermaid-lint-disable-diagram no-experimental: legacy suppression test\nA,B,1',
      'sankey-beta',
    );
    expect(only(b, 'no-experimental')).toEqual([]);
  });

  it('returns [] when configured off', () => {
    const b = block('packet-beta\n  0-7: "x"', 'packet-beta');
    const rules: ResolvedRules = {
      ...RULE_DEFAULTS,
      'no-experimental': 'off',
    };
    expect(only(b, 'no-experimental', rules)).toEqual([]);
  });
});

describe('frontmatter-must-be-first rule', () => {
  function fenced(...body: string[]): Block {
    const [b] = extractMermaidBlocks(
      'test.md',
      ['```mermaid', ...body, '```'].join('\n'),
    );
    return b;
  }

  it('returns [] when frontmatter opens the diagram', () => {
    const b = fenced('---', 'title: T', '---', 'flowchart LR', '  A --> B');
    expect(b.type).toBe('flowchart');
    expect(only(b, 'frontmatter-must-be-first')).toEqual([]);
  });

  it('returns [] when the diagram has no frontmatter at all', () => {
    const b = fenced('%% a note', 'flowchart LR', '  A --> B');
    expect(only(b, 'frontmatter-must-be-first')).toEqual([]);
  });

  it('reports a %% comment before the frontmatter', () => {
    const b = fenced(
      '%% a note',
      '---',
      'title: T',
      '---',
      'flowchart LR',
      '  A --> B',
    );
    expect(b.type).toBe('---');
    const findings = only(b, 'frontmatter-must-be-first');
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].line).toBe(2);
    expect(findings[0].message).toContain('`%%` comment');
    expect(findings[0].message).toContain('move the comment');
  });

  it('reports a single blank line before the frontmatter', () => {
    // The issue text says "a non-empty line precedes", but its own repro shows
    // a bare blank line breaks rendering too — so the rule fires on anything.
    const b = fenced('', '---', 'title: T', '---', 'flowchart LR', '  A --> B');
    expect(b.type).toBe('---');
    const findings = only(b, 'frontmatter-must-be-first');
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(2);
    expect(findings[0].message).toContain('a blank line precedes');
  });

  it('anchors to the frontmatter line, not body line 1', () => {
    const b = fenced(
      '',
      '',
      '---',
      'title: T',
      '---',
      'flowchart LR',
      '  A --> B',
    );
    const findings = only(b, 'frontmatter-must-be-first');
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(3);
  });

  it('converges in two passes when a comment and a blank line both precede', () => {
    // The comment remedy wins when both are present, so following it leaves
    // the blank line and the rule fires again with the other remedy. That is
    // deliberate: each message names one concrete edit. Do not collapse this
    // into a single message that claims to fix both — it would be wrong for
    // the far more common single-cause cases.
    const first = fenced(
      '%% a note',
      '',
      '---',
      'title: T',
      '---',
      'flowchart LR',
    );
    const a = only(first, 'frontmatter-must-be-first');
    expect(a).toHaveLength(1);
    expect(a[0].message).toContain('`%%` comment');

    // What the reader is left with after applying that remedy.
    const second = fenced(
      '',
      '---',
      'title: T',
      '---',
      '%% a note',
      'flowchart LR',
    );
    const b = only(second, 'frontmatter-must-be-first');
    expect(b).toHaveLength(1);
    expect(b[0].message).toContain('a blank line precedes');
  });

  it('stays silent on unterminated frontmatter, which the parser already rejects', () => {
    // `locateHeader` leaves an unterminated block alone, so the type is still
    // '---' and `appliesTo` passes — but nothing precedes the `---`, and
    // mermaid already errors with "Diagrams beginning with --- are not valid".
    // Reporting here would say the same thing twice.
    const b = fenced('---', 'title: T', 'flowchart LR', '  A --> B');
    expect(b.type).toBe('---');
    expect(only(b, 'frontmatter-must-be-first')).toEqual([]);
  });

  it('honors an off override', () => {
    const b = fenced('%% a note', '---', 'title: T', '---', 'flowchart LR');
    const rules: ResolvedRules = {
      ...RULE_DEFAULTS,
      'frontmatter-must-be-first': 'off',
    };
    expect(only(b, 'frontmatter-must-be-first', rules)).toEqual([]);
  });

  it('fires the same way on a standalone .mmd file', () => {
    const [b] = extractMermaidBlocks(
      'test.mmd',
      ['%% a note', '---', 'title: T', '---', 'flowchart LR', '  A --> B'].join(
        '\n',
      ),
    );
    expect(b.type).toBe('---');
    const findings = only(b, 'frontmatter-must-be-first');
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(2);
  });
});
