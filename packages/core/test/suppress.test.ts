import { describe, expect, it } from 'vitest';
import {
  buildSuppressionIndex,
  parseBodyDirectives,
  parseFileDirectives,
} from '../src/suppress.js';

describe('parseBodyDirectives', () => {
  it('parses a next-line directive with one rule and a reason', () => {
    const [d] = parseBodyDirectives([
      '%% mermaid-lint-disable-next-line duplicate-ids: ids collide upstream',
    ]);
    expect(d.kind).toBe('next-line');
    expect(d.rules).toEqual(['duplicate-ids']);
    expect(d.reason).toBe('ids collide upstream');
    expect(d.line).toBe(1);
    expect(d.problems).toEqual([]);
  });

  it('parses space- and comma-separated rule lists', () => {
    const [space] = parseBodyDirectives([
      '%% mermaid-lint-disable-diagram duplicate-ids no-self-loop: legacy',
    ]);
    expect(space.rules).toEqual(['duplicate-ids', 'no-self-loop']);
    const [comma] = parseBodyDirectives([
      '%% mermaid-lint-disable-diagram duplicate-ids, no-self-loop: legacy',
    ]);
    expect(comma.rules).toEqual(['duplicate-ids', 'no-self-loop']);
  });

  it('parses the `all` wildcard', () => {
    const [d] = parseBodyDirectives([
      '%% mermaid-lint-disable-diagram all: vendored diagram',
    ]);
    expect(d.rules).toBe('all');
  });

  it('resolves `all` mixed with named rule ids to the wildcard, no problem', () => {
    const [d] = parseBodyDirectives([
      '%% mermaid-lint-disable-diagram all duplicate-ids: why',
    ]);
    expect(d.rules).toBe('all');
    expect(d.problems).toEqual([]);
  });

  it('parses range start and end', () => {
    const ds = parseBodyDirectives([
      'flowchart LR',
      '%% mermaid-lint-disable duplicate-ids: generated section',
      '  A --> B',
      '%% mermaid-lint-enable duplicate-ids',
    ]);
    expect(ds.map((d) => d.kind)).toEqual(['range-start', 'range-end']);
    expect(ds[0].line).toBe(2);
    expect(ds[1].line).toBe(4);
  });

  it('does not require a reason on enable', () => {
    const [d] = parseBodyDirectives(['%% mermaid-lint-enable duplicate-ids']);
    expect(d.problems).toEqual([]);
  });

  it('flags a missing reason', () => {
    const [d] = parseBodyDirectives(['%% mermaid-lint-disable duplicate-ids']);
    expect(d.problems).toEqual([{ kind: 'missing-reason' }]);
  });

  it('flags a blank reason', () => {
    const [d] = parseBodyDirectives([
      '%% mermaid-lint-disable duplicate-ids:   ',
    ]);
    expect(d.problems).toEqual([{ kind: 'missing-reason' }]);
  });

  it('flags an empty rule list', () => {
    const [d] = parseBodyDirectives(['%% mermaid-lint-disable : why']);
    expect(d.problems).toEqual([{ kind: 'empty-rules' }]);
  });

  it('flags an unknown rule id', () => {
    const [d] = parseBodyDirectives([
      '%% mermaid-lint-disable-diagram duplicat-ids: typo',
    ]);
    expect(d.problems).toEqual([
      { kind: 'unknown-rule', rule: 'duplicat-ids' },
    ]);
  });

  it('flags `mermaid` named at line scope', () => {
    const [d] = parseBodyDirectives([
      '%% mermaid-lint-disable-next-line mermaid: bleeding edge',
    ]);
    expect(d.problems).toEqual([{ kind: 'syntax-rule-at-line-scope' }]);
  });

  it('accepts `mermaid` at diagram scope', () => {
    const [d] = parseBodyDirectives([
      '%% mermaid-lint-disable-diagram mermaid: parser predates v11',
    ]);
    expect(d.problems).toEqual([]);
  });

  it('ignores unrelated comments and mermaid init directives', () => {
    expect(
      parseBodyDirectives(['%% just a note', "%%{init: {'theme':'dark'}}%%"]),
    ).toEqual([]);
  });

  it('tolerates indentation', () => {
    const [d] = parseBodyDirectives([
      '    %% mermaid-lint-disable-next-line duplicate-ids: indented',
    ]);
    expect(d.kind).toBe('next-line');
  });
});

describe('parseFileDirectives', () => {
  it('parses an HTML-comment file directive', () => {
    const [d] = parseFileDirectives(
      '# Doc\n\n<!-- mermaid-lint-disable-file duplicate-ids: vendored docs -->\n',
    );
    expect(d.kind).toBe('file');
    expect(d.rules).toEqual(['duplicate-ids']);
    expect(d.reason).toBe('vendored docs');
  });

  it('ignores unrelated HTML comments', () => {
    expect(parseFileDirectives('<!-- prettier-ignore -->')).toEqual([]);
  });

  it('flags a missing reason at file scope', () => {
    const [d] = parseFileDirectives('<!-- mermaid-lint-disable-file all -->');
    expect(d.problems).toEqual([{ kind: 'missing-reason' }]);
  });

  it('parses two directives packed into one HTML comment', () => {
    const ds = parseFileDirectives(
      '<!-- mermaid-lint-disable-file duplicate-ids: first reason\n' +
        'mermaid-lint-disable-file no-self-loop: second reason -->',
    );
    expect(ds).toHaveLength(2);
    expect(ds[0].kind).toBe('file');
    expect(ds[0].rules).toEqual(['duplicate-ids']);
    expect(ds[0].reason).toBe('first reason');
    expect(ds[0].problems).toEqual([]);
    expect(ds[1].kind).toBe('file');
    expect(ds[1].rules).toEqual(['no-self-loop']);
    expect(ds[1].reason).toBe('second reason');
    expect(ds[1].problems).toEqual([]);
  });

  it('parses a single directive in a comment unchanged', () => {
    const ds = parseFileDirectives(
      '<!-- mermaid-lint-disable-file duplicate-ids: vendored docs -->',
    );
    expect(ds).toHaveLength(1);
    expect(ds[0].rules).toEqual(['duplicate-ids']);
    expect(ds[0].reason).toBe('vendored docs');
  });

  it('yields no directives from a comment with none', () => {
    expect(
      parseFileDirectives('<!-- just a note, nothing to see here -->'),
    ).toEqual([]);
  });
});

describe('buildSuppressionIndex', () => {
  const idx = (body: string) => buildSuppressionIndex(body.split('\n'));

  it('suppresses the line after a next-line directive', () => {
    const i = idx(
      'flowchart LR\n%% mermaid-lint-disable-next-line duplicate-ids: why\n  A[x] --> B',
    );
    expect(i.isSuppressed('duplicate-ids', 3)).toBe(true);
    expect(i.isSuppressed('duplicate-ids', 4)).toBe(false);
    expect(i.isSuppressed('no-self-loop', 3)).toBe(false);
  });

  it('skips over stacked directives to find the next real line', () => {
    const i = idx(
      '%% mermaid-lint-disable-next-line duplicate-ids: a\n%% mermaid-lint-disable-next-line no-self-loop: b\n  A --> A',
    );
    expect(i.isSuppressed('duplicate-ids', 3)).toBe(true);
    expect(i.isSuppressed('no-self-loop', 3)).toBe(true);
  });

  it('suppresses a range until the matching enable', () => {
    const i = idx(
      'flowchart LR\n%% mermaid-lint-disable duplicate-ids: gen\n  A --> B\n%% mermaid-lint-enable duplicate-ids\n  C --> D',
    );
    expect(i.isSuppressed('duplicate-ids', 3)).toBe(true);
    expect(i.isSuppressed('duplicate-ids', 5)).toBe(false);
  });

  it('runs an unterminated range to the end of the diagram', () => {
    const i = idx(
      'flowchart LR\n%% mermaid-lint-disable duplicate-ids: gen\n  A --> B',
    );
    expect(i.isSuppressed('duplicate-ids', 3)).toBe(true);
    expect(i.isSuppressed('duplicate-ids', 999)).toBe(true);
  });

  it('suppresses everywhere for diagram scope, regardless of position', () => {
    const i = idx(
      'flowchart LR\n  A --> B\n%% mermaid-lint-disable-diagram duplicate-ids: legacy',
    );
    expect(i.isSuppressed('duplicate-ids', 1)).toBe(true);
    expect(i.isSuppressed('duplicate-ids', undefined)).toBe(true);
  });

  it('treats `all` as every semantic rule but not the syntax rule', () => {
    const i = idx('%% mermaid-lint-disable-diagram all: vendored');
    expect(i.isSuppressed('duplicate-ids', 2)).toBe(true);
    expect(i.isSuppressed('mermaid', 2)).toBe(false);
  });

  it('suppresses the syntax rule only when named at diagram scope', () => {
    const ok = idx('%% mermaid-lint-disable-diagram mermaid: parser lags');
    expect(ok.isSuppressed('mermaid', 2)).toBe(true);
    const bad = idx('%% mermaid-lint-disable-next-line mermaid: parser lags');
    expect(bad.isSuppressed('mermaid', 2)).toBe(false);
  });

  it('applies file directives to every line', () => {
    const file = parseFileDirectives(
      '<!-- mermaid-lint-disable-file duplicate-ids: docs -->',
    );
    const i = buildSuppressionIndex(
      'flowchart LR\n  A --> B'.split('\n'),
      file,
    );
    expect(i.isSuppressed('duplicate-ids', 2)).toBe(true);
  });

  it('reports directives that suppressed nothing', () => {
    const i = idx(
      'flowchart LR\n%% mermaid-lint-disable-next-line duplicate-ids: why\n  A --> B',
    );
    expect(i.unused().map((d) => d.line)).toEqual([2]);
    i.isSuppressed('duplicate-ids', 3);
    expect(i.unused()).toEqual([]);
  });

  it('flags an enable with no matching disable', () => {
    const i = idx('flowchart LR\n%% mermaid-lint-enable duplicate-ids');
    const enable = i.directives.find((d) => d.kind === 'range-end');
    expect(enable?.problems).toContainEqual({ kind: 'unmatched-enable' });
  });

  it('does not count a malformed directive as unused', () => {
    // A directive with problems is already reported by suppression-malformed;
    // also flagging it unused would double-report the same mistake.
    const i = idx('flowchart LR\n%% mermaid-lint-disable duplicate-ids');
    expect(i.unused()).toEqual([]);
  });

  // --- Ranges are keyed per rule id, not per directive. ---
  // The brief's draft matched an `enable` to the nearest `disable` whose
  // rule set merely overlapped, treating a whole directive as one range.
  // That's wrong once a `disable` names several rules (or `all`): an
  // `enable` that only names some of them should close the range for those
  // rules and leave the rest open. These cases aren't in the brief's test
  // list; they pin down the corrected behavior.

  it('closes a multi-rule range only for the rules the enable names', () => {
    const i = idx(
      [
        'flowchart LR',
        '%% mermaid-lint-disable all: gen',
        '  A --> B',
        '%% mermaid-lint-enable duplicate-ids',
        '  C --> D',
      ].join('\n'),
    );
    // duplicate-ids was closed by the enable at line 4.
    expect(i.isSuppressed('duplicate-ids', 3)).toBe(true);
    expect(i.isSuppressed('duplicate-ids', 5)).toBe(false);
    // no-self-loop was never named by the enable, so it's still open.
    expect(i.isSuppressed('no-self-loop', 3)).toBe(true);
    expect(i.isSuppressed('no-self-loop', 5)).toBe(true);
    const enable = i.directives.find((d) => d.kind === 'range-end');
    expect(enable?.problems).toEqual([]);
  });

  it('does not let an enable for one rule close an open range for a different rule', () => {
    const i = idx(
      [
        'flowchart LR',
        '%% mermaid-lint-disable duplicate-ids: a',
        '  A --> B',
        '%% mermaid-lint-enable no-self-loop',
        '  C --> D',
      ].join('\n'),
    );
    // duplicate-ids' range was never closed by an enable naming a different
    // rule, so it stays open to the end of the diagram.
    expect(i.isSuppressed('duplicate-ids', 3)).toBe(true);
    expect(i.isSuppressed('duplicate-ids', 5)).toBe(true);
    // The enable closed nothing (no-self-loop was never opened), so it's
    // flagged even though a disable for a different rule is in scope.
    const enable = i.directives.find((d) => d.kind === 'range-end');
    expect(enable?.problems).toContainEqual({ kind: 'unmatched-enable' });
  });

  it('drains every open same-rule range on one enable, not just the innermost', () => {
    // Two stacked disables for the same rule - either genuinely nested, or a
    // redundant copy-pasted `disable duplicate-ids` twice - must both be
    // closed by a single matching enable. LIFO (closing only the innermost)
    // would leave the outer range open to the end of the diagram with no
    // diagnostic ever firing, silently hiding findings for the very rule the
    // user named most explicitly.
    const i = idx(
      [
        'flowchart LR',
        '%% mermaid-lint-disable duplicate-ids: outer',
        '  A --> B',
        '%% mermaid-lint-disable duplicate-ids: inner',
        '  C --> D',
        '%% mermaid-lint-enable duplicate-ids',
        '  E --> F',
      ].join('\n'),
    );
    // The inner range (lines 4-6) is closed.
    expect(i.isSuppressed('duplicate-ids', 5)).toBe(true);
    // The outer range is also closed by the same enable - it does not leak
    // past line 6.
    expect(i.isSuppressed('duplicate-ids', 7)).toBe(false);
    const enable = i.directives.find((d) => d.kind === 'range-end');
    expect(enable?.problems).toEqual([]);
  });

  it('closes every open range via `enable all`', () => {
    const i = idx(
      [
        'flowchart LR',
        '%% mermaid-lint-disable duplicate-ids: gen',
        '  A --> B',
        '%% mermaid-lint-enable all',
        '  C --> D',
      ].join('\n'),
    );
    expect(i.isSuppressed('duplicate-ids', 3)).toBe(true);
    expect(i.isSuppressed('duplicate-ids', 5)).toBe(false);
    const enable = i.directives.find((d) => d.kind === 'range-end');
    expect(enable?.problems).toEqual([]);
  });

  it('partially closes an explicit multi-rule disable', () => {
    const i = idx(
      [
        'flowchart LR',
        '%% mermaid-lint-disable duplicate-ids no-self-loop: gen',
        '  A --> B',
        '%% mermaid-lint-enable duplicate-ids',
        '  C --> D',
      ].join('\n'),
    );
    expect(i.isSuppressed('duplicate-ids', 5)).toBe(false);
    expect(i.isSuppressed('no-self-loop', 5)).toBe(true);
  });

  it('does not double-report an enable whose rule list failed to parse', () => {
    // A bare enable and an enable naming only the syntax rule each already
    // carry a parse problem. Since they can never have matched a range, they
    // must not also pick up `unmatched-enable` - that would report the same
    // mistake twice.
    const bare = idx('flowchart LR\n%% mermaid-lint-enable');
    const bareEnable = bare.directives.find((d) => d.kind === 'range-end');
    expect(bareEnable?.problems).toEqual([{ kind: 'empty-rules' }]);

    const syntaxRule = idx('flowchart LR\n%% mermaid-lint-enable mermaid');
    const syntaxEnable = syntaxRule.directives.find(
      (d) => d.kind === 'range-end',
    );
    expect(syntaxEnable?.problems).toEqual([
      { kind: 'syntax-rule-at-line-scope' },
    ]);
  });

  it('does not let a malformed disable consume a matching enable', () => {
    // isSuppressed already treats a problem-carrying directive as inert;
    // matching must agree. A malformed (missing-reason) disable must not
    // count as something an enable can close.
    const i = idx(
      [
        'flowchart LR',
        '%% mermaid-lint-disable duplicate-ids',
        '  A --> B',
        '%% mermaid-lint-enable duplicate-ids',
        '  C --> D',
      ].join('\n'),
    );
    expect(i.isSuppressed('duplicate-ids', 3)).toBe(false);
    const enable = i.directives.find((d) => d.kind === 'range-end');
    expect(enable?.problems).toContainEqual({ kind: 'unmatched-enable' });
  });

  it('excludes the suppression meta-rule ids from the `all` wildcard', () => {
    const i = idx('%% mermaid-lint-disable-diagram all: vendored');
    expect(i.isSuppressed('suppression-unknown-rule', 2)).toBe(false);
    expect(i.isSuppressed('suppression-unused', 2)).toBe(false);
    expect(i.isSuppressed('suppression-malformed', 2)).toBe(false);
    // Ordinary semantic rules are still covered by the wildcard.
    expect(i.isSuppressed('duplicate-ids', 2)).toBe(true);
  });

  it('reports an unclosed range-start as unused when it never suppressed anything', () => {
    const i = idx(
      'flowchart LR\n%% mermaid-lint-disable duplicate-ids: gen\n  A --> B\n%% mermaid-lint-enable duplicate-ids',
    );
    const rangeStart = i.directives.find((d) => d.kind === 'range-start');
    expect(i.unused()).toContainEqual(rangeStart);
  });
});
