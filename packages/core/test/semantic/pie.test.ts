import { describe, expect, it } from 'vitest';
import { RULE_DEFAULTS } from '../../src/rules.js';
import type { ResolvedRules } from '../../src/rules.js';
import { block } from './helpers.js';
import { only } from './helpers.js';

describe('pie-duplicate-label rule', () => {
  function pieBlock(body: string): Block {
    return block(body, 'pie');
  }

  it('returns [] when every slice label is unique', () => {
    const b = pieBlock('pie title Pets\n  "Dogs" : 10\n  "Cats" : 5');
    expect(only(b, 'pie-duplicate-label')).toEqual([]);
  });

  it('fires when a label is repeated (warn)', () => {
    const b = pieBlock('pie\n  "Dogs" : 10\n  "Cats" : 5\n  "Dogs" : 3');
    const warnings = only(b, 'pie-duplicate-label');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('"Dogs"');
    expect(warnings[0].message).toContain('first on line 2');
    expect(warnings[0].line).toBe(4);
  });

  it('fires for single-quoted labels too', () => {
    const b = pieBlock("pie\n  'Dogs' : 10\n  'Dogs' : 3");
    const warnings = only(b, 'pie-duplicate-label');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('"Dogs"');
  });

  it('returns [] for non-pie diagrams', () => {
    const b = block('flowchart LR\n  A --> B');
    expect(only(b, 'pie-duplicate-label')).toEqual([]);
  });

  it('is suppressed by %% mermaid-lint-disable-diagram pie-duplicate-label', () => {
    const b = pieBlock(
      'pie\n  %% mermaid-lint-disable-diagram pie-duplicate-label: legacy suppression test\n  "Dogs" : 10\n  "Dogs" : 3',
    );
    expect(only(b, 'pie-duplicate-label')).toEqual([]);
  });

  it('returns [] when configured off', () => {
    const b = pieBlock('pie\n  "Dogs" : 10\n  "Dogs" : 3');
    const rules: ResolvedRules = {
      ...RULE_DEFAULTS,
      'pie-duplicate-label': 'off',
    };
    expect(only(b, 'pie-duplicate-label', rules)).toEqual([]);
  });
});

describe('pie-zero-value rule', () => {
  function pieBlock(body: string): Block {
    return block(body, 'pie');
  }

  it('returns [] when all slices have positive values', () => {
    const b = pieBlock('pie\n  "Dogs" : 10\n  "Cats" : 0.5');
    expect(only(b, 'pie-zero-value')).toEqual([]);
  });

  it('fires for a zero-valued slice (warn)', () => {
    const b = pieBlock('pie\n  "Dogs" : 10\n  "Cats" : 0');
    const warnings = only(b, 'pie-zero-value');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('"Cats"');
    expect(warnings[0].line).toBe(3);
  });

  it('returns [] when configured off', () => {
    const b = pieBlock('pie\n  "Cats" : 0');
    const rules: ResolvedRules = {
      ...RULE_DEFAULTS,
      'pie-zero-value': 'off',
    };
    expect(only(b, 'pie-zero-value', rules)).toEqual([]);
  });
});

describe('pie-no-data rule', () => {
  function pieBlock(body: string): Block {
    return block(body, 'pie');
  }

  it('returns [] when the chart has at least one slice', () => {
    const b = pieBlock('pie title Pets\n  "Dogs" : 10');
    expect(only(b, 'pie-no-data')).toEqual([]);
  });

  it('fires when a pie has no data rows (warn)', () => {
    const b = pieBlock('pie title Empty');
    const warnings = only(b, 'pie-no-data');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].line).toBe(1);
  });

  it('ignores comment-only bodies as still having no data', () => {
    const b = pieBlock('pie\n  %% nothing here yet');
    expect(only(b, 'pie-no-data')).toHaveLength(1);
  });

  it('does not fire when the only slice has a negative value', () => {
    // A negative value parses in Mermaid, so it still counts as a slice.
    const b = pieBlock('pie\n  "Debt" : -5');
    expect(only(b, 'pie-no-data')).toEqual([]);
  });

  it('returns [] when configured off', () => {
    const b = pieBlock('pie title Empty');
    const rules: ResolvedRules = {
      ...RULE_DEFAULTS,
      'pie-no-data': 'off',
    };
    expect(only(b, 'pie-no-data', rules)).toEqual([]);
  });
});
