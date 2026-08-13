import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

describe('click-target-not-found rule', () => {
  // Off by default (false-positive risk: mermaid resolves a click href
  // against the rendered page URL, not the source file on disk — see the
  // rationale beside `RULE_METADATA['click-target-not-found']`). Every test
  // below that exercises the rule's actual matching/skip logic opts it on
  // explicitly, the same pattern the other rules' "returns [] when
  // configured off" tests use, just inverted: this rule needs an explicit
  // *on* override to be exercised at all.
  const WARN_ON: ResolvedRules = {
    ...RULE_DEFAULTS,
    'click-target-not-found': 'warn',
  };

  // Every `click`-line test below writes its `body` to a real temp file and
  // builds the matching `Block` in one step, so the diagram source appears
  // exactly once per test instead of twice (as a file-write argument and
  // again as a separately typed `body` field). `extraFiles` writes sibling
  // files into the same temp dir first, for tests whose target must resolve.
  function clickBlock(
    body: string,
    type = 'flowchart',
    extraFiles: Record<string, string> = {},
  ) {
    const dir = mkdtempSync(join(tmpdir(), 'mermaid-lint-click-target-'));
    for (const [name, content] of Object.entries(extraFiles)) {
      writeFileSync(join(dir, name), content);
    }
    const path = join(dir, 'diagram.mmd');
    writeFileSync(path, body);
    return { path, line: 1, col: 1, type, body };
  }

  it('flags a click target that does not resolve to a real file (warn)', () => {
    const b = clickBlock('flowchart LR\n  A --> B\n  click A "./missing.md"');
    const warnings = only(b, 'click-target-not-found', WARN_ON);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].line).toBe(3);
    expect(warnings[0].message).toContain('./missing.md');
  });

  it('defaults to off, so a broken target produces no findings without an explicit override', () => {
    const b = clickBlock('flowchart LR\n  A --> B\n  click A "./missing.md"');
    // No `rules` argument: `only()` falls back to `RULE_DEFAULTS`, which is
    // exactly the config a real run uses unless the user opts in.
    expect(only(b, 'click-target-not-found')).toEqual([]);
  });

  it('does not flag a click target that resolves to a real file', () => {
    const b = clickBlock(
      'flowchart LR\n  A --> B\n  click A "./architecture.md"',
      'flowchart',
      { 'architecture.md': '# Architecture\n' },
    );
    expect(only(b, 'click-target-not-found', WARN_ON)).toEqual([]);
  });

  it('supports the `href` keyword form', () => {
    const b = clickBlock(
      'flowchart LR\n  A --> B\n  click A href "./missing.md"',
    );
    expect(only(b, 'click-target-not-found', WARN_ON)).toHaveLength(1);
  });

  it('ignores a trailing tooltip and _blank after the target', () => {
    const b = clickBlock(
      'flowchart LR\n  A --> B\n  click A "./missing.md" "tooltip" _blank',
    );
    expect(only(b, 'click-target-not-found', WARN_ON)).toHaveLength(1);
  });

  it('does not flag a bare callback (no href target)', () => {
    const b = clickBlock('flowchart LR\n  A --> B\n  click A myCallback');
    expect(only(b, 'click-target-not-found', WARN_ON)).toEqual([]);
  });

  it('does not flag `call callback(...)` even with a tooltip string', () => {
    const b = clickBlock(
      'flowchart LR\n  A --> B\n  click A call myCallback() "tooltip"',
    );
    expect(only(b, 'click-target-not-found', WARN_ON)).toEqual([]);
  });

  it('does not flag a scheme-prefixed target (remote URL, mailto:)', () => {
    for (const target of ['https://example.com/docs', 'mailto:a@example.com']) {
      const b = clickBlock(`flowchart LR\n  A --> B\n  click A "${target}"`);
      expect(only(b, 'click-target-not-found', WARN_ON)).toEqual([]);
    }
  });

  it('does not flag a Windows drive letter target', () => {
    // Unlike the other URI_SCHEME_RE cases above, this one is not a real
    // scheme — it's the regex's deliberate side effect (see the comment on
    // URI_SCHEME_RE) of treating `C:` the same way it treats `http:`.
    const b = clickBlock('flowchart LR\n  A --> B\n  click A "C:/docs/x.md"');
    expect(only(b, 'click-target-not-found', WARN_ON)).toEqual([]);
  });

  it('does not flag an absolute path', () => {
    const b = clickBlock('flowchart LR\n  A --> B\n  click A "/docs/foo.md"');
    expect(only(b, 'click-target-not-found', WARN_ON)).toEqual([]);
  });

  it('does not flag a pure same-page anchor', () => {
    const b = clickBlock('flowchart LR\n  A --> B\n  click A "#some-heading"');
    expect(only(b, 'click-target-not-found', WARN_ON)).toEqual([]);
  });

  it('ignores the anchor and checks only the file part', () => {
    const b = clickBlock(
      'flowchart LR\n  A --> B\n  click A "./architecture.md#some-heading"',
      'flowchart',
      { 'architecture.md': '# Architecture\n' },
    );
    expect(only(b, 'click-target-not-found', WARN_ON)).toEqual([]);
  });

  it('flags a missing file even with an anchor appended', () => {
    const b = clickBlock(
      'flowchart LR\n  A --> B\n  click A "./missing.md#some-heading"',
    );
    expect(only(b, 'click-target-not-found', WARN_ON)).toHaveLength(1);
  });

  it('applies to gantt diagrams', () => {
    const b = clickBlock(
      'gantt\n  section S\n    A :a1, 2024-01-01, 3d\n  click a1 "./missing.md"',
      'gantt',
    );
    expect(only(b, 'click-target-not-found', WARN_ON)).toHaveLength(1);
  });

  it('does not match a `call cb(a:b)` line at all, on a gantt click line', () => {
    // This does not exercise URI_SCHEME_RE — CLICK_HREF_RE itself never
    // matches a `call cb(...)` line (no quoted string in href position), so
    // the colon inside `cb(after x, foo)` never reaches the scheme check.
    // See "does not flag a Windows drive letter target" above for a case
    // that actually exercises URI_SCHEME_RE.
    const b = clickBlock(
      'gantt\n  section S\n    A :a1, 2024-01-01, 3d\n  click a1 call cb(after x, foo)',
      'gantt',
    );
    expect(only(b, 'click-target-not-found', WARN_ON)).toEqual([]);
  });

  it('does not apply outside flowchart/graph/gantt, even with a broken-looking click line', () => {
    // `appliesTo` gates on diagram type before the line scan ever runs — a
    // pie chart never has real `click` syntax, but this proves the gate
    // itself (not just "no click line present") is what suppresses it.
    const b = clickBlock(
      'pie\n  title T\n  click A "./missing.md"\n  "A" : 10',
      'pie',
    );
    expect(only(b, 'click-target-not-found', WARN_ON)).toEqual([]);
  });

  it('ignores a %% comment line even when it looks like a broken click', () => {
    // Proves the `%%`-comment skip is load-bearing: without it, this line
    // would match CLICK_HREF_RE and report a finding for a target that is
    // commented out, not live diagram content.
    const b = clickBlock(
      'flowchart LR\n  A --> B\n  %% click A "./missing.md"',
    );
    expect(only(b, 'click-target-not-found', WARN_ON)).toEqual([]);
  });

  it('does not flag when the containing file does not exist on disk (e.g. stdin)', () => {
    // The shared `block()` helper stubs path: 'test.mmd', which does not
    // exist relative to the test runner's cwd — this is also what a `<stdin>`
    // CLI run looks like. There is no real directory to resolve a relative
    // target against, so the rule must decline rather than flag every target.
    const b = block(
      'flowchart LR\n  A --> B\n  click A "./definitely-missing.md"',
      'flowchart',
    );
    expect(only(b, 'click-target-not-found', WARN_ON)).toEqual([]);
  });

  it('is suppressed by %% mermaid-lint-disable-diagram click-target-not-found', () => {
    const b = clickBlock(
      'flowchart LR\n  %% mermaid-lint-disable-diagram click-target-not-found: legacy suppression test\n  A --> B\n  click A "./missing.md"',
    );
    expect(only(b, 'click-target-not-found', WARN_ON)).toEqual([]);
  });

  it('returns [] when explicitly configured off, same as the default', () => {
    const b = clickBlock('flowchart LR\n  A --> B\n  click A "./missing.md"');
    const rules: ResolvedRules = {
      ...RULE_DEFAULTS,
      'click-target-not-found': 'off',
    };
    expect(only(b, 'click-target-not-found', rules)).toEqual([]);
  });

  it('is exercised through extractMermaidBlocks on a real fenced-Markdown file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mermaid-lint-click-target-'));
    const mdPath = join(dir, 'doc.md');
    const md = [
      '# Doc',
      '',
      '```mermaid',
      'flowchart LR',
      '  A --> B',
      '  click A "./missing.md"',
      '```',
      '',
    ].join('\n');
    writeFileSync(mdPath, md);
    const [b] = extractMermaidBlocks(mdPath, md);
    const warnings = only(b, 'click-target-not-found', WARN_ON);
    expect(warnings).toHaveLength(1);
  });
});
