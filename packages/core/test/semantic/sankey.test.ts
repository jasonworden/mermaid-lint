import { describe, expect, it } from 'vitest';
import { RULE_DEFAULTS } from '../../src/rules.js';
import type { ResolvedRules } from '../../src/rules.js';
import { block } from './helpers.js';
import { only } from './helpers.js';

describe('experimental diagram-specific rules', () => {
  it('flags sankey-beta with a non-positive link value', () => {
    const b = block('sankey-beta\n  A,B,0\n  B,C,-1', 'sankey-beta');
    const warnings = only(b, 'sankey-non-positive-value');
    expect(warnings).toHaveLength(2);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('non-positive');
  });

  it('does not flag sankey-beta with positive link values', () => {
    const b = block('sankey-beta\n  A,B,1\n  B,C,2', 'sankey-beta');
    expect(only(b, 'sankey-non-positive-value')).toEqual([]);
  });

  it('flags sankey-beta with a self-loop link', () => {
    const b = block('sankey-beta\n  A,A,1', 'sankey-beta');
    const warnings = only(b, 'sankey-self-loop');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('self-loop');
    expect(warnings[0].message).toContain('`A`');
  });

  it('does not flag sankey-beta without self-loops', () => {
    const b = block('sankey-beta\n  A,B,1', 'sankey-beta');
    expect(only(b, 'sankey-self-loop')).toEqual([]);
  });
});

describe('sankey-beta rules', () => {
  function sankeyBlock(body: string): Block {
    return block(body, 'sankey-beta');
  }

  it('keeps a valid sankey diagram clean', () => {
    const b = sankeyBlock('sankey-beta\n  Source,Target,10\n  Target,Sink,5');
    expect(only(b, 'sankey-duplicate-link')).toEqual([]);
    expect(only(b, 'sankey-self-loop')).toEqual([]);
  });

  it('flags repeated source/target rows after trimming endpoint whitespace', () => {
    const b = sankeyBlock(
      'sankey-beta\n  Source , Target,10\n  Source,Target ,5',
    );
    const warnings = only(b, 'sankey-duplicate-link');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('Source');
    expect(warnings[0].message).toContain('Target');
    expect(warnings[0].line).toBe(3);
  });

  it('flags repeated source/target rows even when the values differ', () => {
    const b = sankeyBlock(
      'sankey-beta\n  Source,Target,10\n  Source,Target,999',
    );
    const warnings = only(b, 'sankey-duplicate-link');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('Source');
    expect(warnings[0].message).toContain('Target');
    expect(warnings[0].line).toBe(3);
  });

  it('flags self-loop rows after trimming endpoint whitespace', () => {
    const b = sankeyBlock('sankey-beta\n  Source , Source,10');
    const warnings = only(b, 'sankey-self-loop');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('Source');
    expect(warnings[0].message).toContain('self-loop');
    expect(warnings[0].line).toBe(2);
  });

  it('respects suppression directives and rule-off configuration', () => {
    const suppressed = sankeyBlock(
      'sankey-beta\n  %% mermaid-lint-disable-diagram sankey-duplicate-link: legacy suppression test\n  A,B,1\n  A,B,2',
    );
    expect(only(suppressed, 'sankey-duplicate-link')).toEqual([]);

    const b = sankeyBlock('sankey-beta\n  A,A,1');
    const rules: ResolvedRules = {
      ...RULE_DEFAULTS,
      'sankey-self-loop': 'off',
    };
    expect(only(b, 'sankey-self-loop', rules)).toEqual([]);
  });
});
