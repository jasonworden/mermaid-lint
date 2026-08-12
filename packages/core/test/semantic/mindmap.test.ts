import { describe, expect, it } from 'vitest';
import { RULE_DEFAULTS } from '../../src/rules.js';
import type { ResolvedRules } from '../../src/rules.js';
import { block } from './helpers.js';
import { only } from './helpers.js';

describe('mindmap-duplicate-sibling rule', () => {
  function mindmapBlock(body: string): Block {
    return block(body, 'mindmap');
  }

  it('returns [] when all siblings are unique', () => {
    const b = mindmapBlock('mindmap\n  root((Main))\n    Alpha\n    Beta');
    expect(only(b, 'mindmap-duplicate-sibling')).toEqual([]);
  });

  it('flags two siblings with identical text', () => {
    const b = mindmapBlock(
      'mindmap\n  root((Main))\n    Alpha\n    Beta\n    Alpha',
    );
    const warnings = only(b, 'mindmap-duplicate-sibling');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('`Alpha`');
    expect(warnings[0].message).toContain('line 3');
    expect(warnings[0].line).toBe(5);
  });

  it('does not flag identical text under different parents', () => {
    const b = mindmapBlock(
      'mindmap\n  root((Main))\n    A\n      Leaf\n    B\n      Leaf',
    );
    expect(only(b, 'mindmap-duplicate-sibling')).toEqual([]);
  });

  it('compares display text, ignoring shape wrapper and leading id', () => {
    const b = mindmapBlock(
      'mindmap\n  root((Main))\n    Alpha\n    id1[Alpha]',
    );
    const warnings = only(b, 'mindmap-duplicate-sibling');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].line).toBe(4);
  });

  it('skips ::icon decorator lines (not treated as nodes)', () => {
    const b = mindmapBlock(
      'mindmap\n  root((Main))\n    Alpha\n    ::icon(fa fa-book)\n    Beta',
    );
    expect(only(b, 'mindmap-duplicate-sibling')).toEqual([]);
  });
});

describe('mindmap-no-nodes rule', () => {
  function mindmapBlock(body: string): Block {
    return block(body, 'mindmap');
  }

  it('returns [] when the mindmap has nodes', () => {
    const b = mindmapBlock('mindmap\n  root((Main))\n    Alpha');
    expect(only(b, 'mindmap-no-nodes')).toEqual([]);
  });

  it('flags a mindmap with only the keyword', () => {
    const b = mindmapBlock('mindmap');
    const warnings = only(b, 'mindmap-no-nodes');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].line).toBe(1);
  });

  it('flags a mindmap whose only content is a comment', () => {
    const b = mindmapBlock('mindmap\n  %% just a note');
    expect(only(b, 'mindmap-no-nodes')).toHaveLength(1);
  });
});

describe('mindmap-deep-nesting rule', () => {
  function mindmapBlock(body: string): Block {
    return block(body, 'mindmap');
  }

  const withDeep: ResolvedRules = {
    ...RULE_DEFAULTS,
    'mindmap-deep-nesting': 'warn',
  };

  const deepBody =
    'mindmap\n  root((Main))\n    A\n      B\n        C\n          D\n            E\n              F';

  it('is off by default — a deep tree produces no findings', () => {
    expect(only(mindmapBlock(deepBody), 'mindmap-deep-nesting')).toEqual([]);
  });

  it('returns [] for a shallow tree even when enabled', () => {
    const b = mindmapBlock('mindmap\n  root((Main))\n    A\n      B');
    expect(only(b, 'mindmap-deep-nesting', withDeep)).toEqual([]);
  });

  it('flags nodes nested beyond the threshold when enabled', () => {
    const warnings = only(
      mindmapBlock(deepBody),
      'mindmap-deep-nesting',
      withDeep,
    );
    // root=1, A=2, B=3, C=4, D=5, E=6, F=7 — E and F exceed depth 5.
    expect(warnings).toHaveLength(2);
    expect(warnings[0].line).toBe(7);
    expect(warnings[0].message).toContain('6 levels deep');
    expect(warnings[1].line).toBe(8);
    expect(warnings[1].message).toContain('7 levels deep');
  });
});
