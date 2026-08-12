import { describe, expect, it } from 'vitest';
import { RULE_DEFAULTS } from '../../src/rules.js';
import type { ResolvedRules } from '../../src/rules.js';
import { block } from './helpers.js';
import { only } from './helpers.js';

function ib(...body: string[]): Block {
  return block(['ishikawa-beta', ...body].join('\n'), 'ishikawa-beta');
}

describe('ishikawa node parsing', () => {
  // The hierarchy these rules read is `IshikawaDB.addNode`'s, not mindmap's.
  // The cases below are the places the two disagree; `mermaid-behavior.test.ts`
  // pins the same bodies against mermaid's own `getRoot()`.

  it('nests a second problem under the first rather than starting a new tree', () => {
    // `addNode`'s pop loop guards on `stack.length > 1`, so the first node is
    // never popped and everything after it is a descendant. Read as a second
    // root, `P2` would be a problem with a cause and nothing would fire; it is
    // really a *category*, and its own child is the cause.
    const findings = only(
      ib('  P1', '  P2', '    C'),
      'ishikawa-empty-category',
    );
    expect(findings).toEqual([]);
    expect(only(ib('  P1', '  P2'), 'ishikawa-empty-category')).toHaveLength(1);
  });

  it('keeps outdenting past the problem inside the tree', () => {
    // Same guard, reached the other way: `P2` is indented *less* than `P1` and
    // still lands under it.
    const findings = only(ib('    P1', '  P2'), 'ishikawa-empty-category');
    expect(findings.map((f) => f.line)).toEqual([3]);
  });

  it('ignores the problem line’s own indent', () => {
    // `baseLevel` is set by the *second* node, so an unindented problem works
    // and its categories are still categories.
    expect(only(ib('P', '  Method'), 'ishikawa-empty-category')).toHaveLength(
      1,
    );
    expect(only(ib('P', '  Method'), 'ishikawa-no-causes')).toEqual([]);
  });

  it('normalizes an indent jump to one level instead of inventing levels', () => {
    // `B` is indented six past `A` and is still just `A`'s child, so nothing is
    // deep here — unlike `treeView-beta`, where the same input visibly flattens.
    const withDeep: ResolvedRules = {
      ...RULE_DEFAULTS,
      'ishikawa-deep-nesting': 'warn',
    };
    const b = ib('  P', '    A', '          B', '    C');
    expect(only(b, 'ishikawa-deep-nesting', withDeep)).toEqual([]);
    // …and `C` returned to `A`'s level, so it is a sibling category, not a leaf.
    expect(only(b, 'ishikawa-empty-category').map((f) => f.line)).toEqual([5]);
  });

  it('reads a problem written on the keyword line', () => {
    // `ishikawa-beta Problem` lexes as `ISHIKAWA SPACELIST TEXT`. Skipping the
    // header line wholesale would lose the problem and make this look like a
    // one-node diagram with no causes.
    const b = block(
      'ishikawa-beta Problem\n    Method\n      a',
      'ishikawa-beta',
    );
    expect(only(b, 'ishikawa-no-causes')).toEqual([]);
    expect(only(b, 'ishikawa-empty-category')).toEqual([]);
  });

  it('does not read a `%%` tail on the keyword line as the problem', () => {
    // The lexer's comment rule beats its `TEXT` rule at that position, so the
    // tail declares nothing. Reading it as the problem would both invent a
    // finding against the comment and push `Problem` down to a category and
    // `Method` to a leaf, silencing the empty-category rule on neither.
    const b = block(
      'ishikawa-beta %% note\n  Problem\n    Method\n      a',
      'ishikawa-beta',
    );
    expect(only(b, 'ishikawa-no-causes')).toEqual([]);
    expect(only(b, 'ishikawa-empty-category')).toEqual([]);
  });

  it('skips own-line comments but keeps a trailing one as text', () => {
    // Only lexer rule 0 (`\s*%%.*`) is a comment, and it must start the line.
    // `A %% note` is one node whose text includes the tail.
    expect(
      only(ib('  P', '    %% soon', '    A'), 'ishikawa-no-causes'),
    ).toEqual([]);
    expect(
      only(ib('  P', '    A %% note', '    A'), 'ishikawa-duplicate-sibling'),
    ).toEqual([]);
  });

  it('counts a tab as one column, matching mermaid’s SPACELIST', () => {
    const b = block('ishikawa-beta\n  P\n\t\tA\n\t\t\tB', 'ishikawa-beta');
    expect(only(b, 'ishikawa-empty-category')).toEqual([]);
  });
});

describe('ishikawa-no-causes rule', () => {
  it('flags a problem with nothing under it', () => {
    const findings = only(ib('  Problem'), 'ishikawa-no-causes');
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].line).toBe(2);
    expect(findings[0].message).toContain('`Problem`');
    expect(findings[0].message).toContain('zero-length spine');
  });

  it('stays silent on a body with no nodes at all', () => {
    // `ishikawa-beta\n` parses and renders an empty `<svg>` — reachable, but a
    // different diagram from one whose problem has no causes, and there is no
    // problem here to name. Left to a follow-up `ishikawa-no-nodes` (#147).
    expect(only(ib(), 'ishikawa-no-causes')).toEqual([]);
    expect(only(ib('', '  %% nothing yet'), 'ishikawa-no-causes')).toEqual([]);
  });

  it('returns [] once the problem has a category', () => {
    expect(only(ib('  Problem', '    Method'), 'ishikawa-no-causes')).toEqual(
      [],
    );
  });
});

describe('ishikawa-empty-category rule', () => {
  it('flags every category with no causes, wherever it sits', () => {
    const b = ib(
      '  P',
      '    Method',
      '    Machine',
      '      Worn',
      '    Material',
    );
    const findings = only(b, 'ishikawa-empty-category');
    expect(findings.map((f) => f.line)).toEqual([3, 6]);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].message).toContain('`Method`');
    expect(findings[0].message).toContain('a fifth of full length');
  });

  it('leaves a childless cause alone — a leaf is the point', () => {
    // Only depth 2 draws a bone. Flagging depth 3+ would fire on every
    // well-formed fishbone.
    const b = ib('  P', '    Method', '      Rushed', '      Undocumented');
    expect(only(b, 'ishikawa-empty-category')).toEqual([]);
  });

  it('does not fire on the problem itself when it has no categories', () => {
    // That is `ishikawa-no-causes`; the problem is depth 1, not a category.
    expect(only(ib('  P'), 'ishikawa-empty-category')).toEqual([]);
  });
});

describe('ishikawa-deep-nesting rule', () => {
  const withDeep: ResolvedRules = {
    ...RULE_DEFAULTS,
    'ishikawa-deep-nesting': 'warn',
  };

  const deepBody = ib(
    '  P',
    '    A',
    '      B',
    '        C',
    '          D',
    '            E',
  );

  it('is off by default — a deep tree produces no findings', () => {
    expect(only(deepBody, 'ishikawa-deep-nesting')).toEqual([]);
  });

  it('returns [] for a shallow tree even when enabled', () => {
    const b = ib('  P', '    A', '      B');
    expect(only(b, 'ishikawa-deep-nesting', withDeep)).toEqual([]);
  });

  it('flags nodes nested beyond the threshold when enabled', () => {
    const findings = only(deepBody, 'ishikawa-deep-nesting', withDeep);
    // P=1, A=2, B=3, C=4, D=5, E=6 — only E exceeds depth 5.
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(7);
    expect(findings[0].message).toContain('`E`');
    expect(findings[0].message).toContain('6 levels deep');
  });
});

describe('ishikawa-duplicate-sibling rule', () => {
  it('reports every repeat after the first, each naming the first line', () => {
    const b = ib('  P', '    M', '      Same', '      Same', '      Same');
    const findings = only(b, 'ishikawa-duplicate-sibling');
    expect(findings.map((f) => f.line)).toEqual([5, 6]);
    for (const finding of findings) {
      expect(finding.severity).toBe('warn');
      expect(finding.message).toContain('`Same`');
      expect(finding.message).toContain('line 4');
    }
  });

  it('covers categories, which are siblings under the problem', () => {
    const b = ib('  P', '    M', '      a', '    M', '      b');
    const findings = only(b, 'ishikawa-duplicate-sibling');
    expect(findings.map((f) => f.line)).toEqual([5]);
  });

  it('returns [] for the same text under different parents', () => {
    const b = ib('  P', '    M1', '      X', '    M2', '      X');
    expect(only(b, 'ishikawa-duplicate-sibling')).toEqual([]);
  });

  it('compares text verbatim, since inner whitespace is significant', () => {
    // Mermaid trims a node's line and keeps the rest as-is: `a  b` and `a b`
    // are two labels, and quotes are part of the text rather than a wrapper.
    expect(
      only(ib('  P', '    a  b', '    a b'), 'ishikawa-duplicate-sibling'),
    ).toEqual([]);
    expect(
      only(ib('  P', '    "X"', '    X'), 'ishikawa-duplicate-sibling'),
    ).toEqual([]);
    // Trailing whitespace *is* trimmed, so these are one label twice.
    expect(
      only(ib('  P', '    Same  ', '    Same'), 'ishikawa-duplicate-sibling'),
    ).toHaveLength(1);
  });
});
