import { describe, expect, it } from 'vitest';
import { RULE_DEFAULTS } from '../../src/rules.js';
import type { ResolvedRules } from '../../src/rules.js';
import { block } from './helpers.js';
import { only } from './helpers.js';

describe('experimental diagram-specific rules', () => {
  it('flags xychart-beta with series but no x-axis', () => {
    const b = block(
      'xychart-beta\n  y-axis "Revenue" 0 --> 10\n  line [1, 2, 3]',
      'xychart-beta',
    );
    const warnings = only(b, 'xychart-missing-x-axis');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('x-axis');
  });

  it('does not flag xychart-beta with an x-axis', () => {
    const b = block(
      'xychart-beta\n  x-axis [Jan, Feb, Mar]\n  y-axis "Revenue" 0 --> 10\n  line [1, 2, 3]',
      'xychart-beta',
    );
    expect(only(b, 'xychart-missing-x-axis')).toEqual([]);
  });

  it('flags xychart-beta with series but no y-axis', () => {
    const b = block(
      'xychart-beta\n  x-axis [Jan, Feb, Mar]\n  line [1, 2, 3]',
      'xychart-beta',
    );
    const warnings = only(b, 'xychart-missing-y-axis');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('y-axis');
  });

  it('does not flag xychart-beta with a y-axis', () => {
    const b = block(
      'xychart-beta\n  x-axis [Jan, Feb, Mar]\n  y-axis "Revenue" 0 --> 10\n  line [1, 2, 3]',
      'xychart-beta',
    );
    expect(only(b, 'xychart-missing-y-axis')).toEqual([]);
  });

  it('flags xychart-beta with axes but no series', () => {
    const b = block(
      'xychart-beta\n  x-axis [Jan, Feb, Mar]\n  y-axis "Revenue" 0 --> 10',
      'xychart-beta',
    );
    const warnings = only(b, 'xychart-no-series');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('no data series');
  });

  it('does not flag xychart-beta when it has a series', () => {
    const b = block(
      'xychart-beta\n  x-axis [Jan, Feb, Mar]\n  y-axis "Revenue" 0 --> 10\n  line [1, 2, 3]',
      'xychart-beta',
    );
    expect(only(b, 'xychart-no-series')).toEqual([]);
  });

  it('flags xychart-beta when a series length does not match the categorical x-axis', () => {
    const b = block(
      'xychart-beta\n  x-axis [Jan, Feb, Mar]\n  y-axis "Revenue" 0 --> 10\n  line [1, 2]',
      'xychart-beta',
    );
    const warnings = only(b, 'xychart-series-length-mismatch');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].line).toBe(4);
    expect(warnings[0].message).toContain('series');
    expect(warnings[0].message).toContain('3');
    expect(warnings[0].message).toContain('2');
  });

  it('flags xychart-beta when series lengths disagree with each other', () => {
    const b = block(
      'xychart-beta\n  x-axis 0 --> 10\n  y-axis "Revenue" 0 --> 10\n  line [1, 2, 3]\n  bar [1, 2]',
      'xychart-beta',
    );
    const warnings = only(b, 'xychart-series-length-mismatch');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].line).toBe(5);
    expect(warnings[0].message).toContain('bar');
  });
});

describe('xychart-beta rules', () => {
  function xychartBlock(body: string): Block {
    return block(body, 'xychart-beta');
  }

  it('keeps a valid categorical xychart clean', () => {
    const b = xychartBlock(
      'xychart-beta\n  x-axis [Jan, Feb]\n  bar [10, 20]\n  line [12, 18]',
    );
    expect(only(b, 'xychart-no-series')).toEqual([]);
    expect(only(b, 'xychart-series-length-mismatch')).toEqual([]);
  });

  it('flags an xychart-beta with no bar or line series rows', () => {
    const b = xychartBlock(
      'xychart-beta\n  title "Quarterly Revenue"\n  x-axis [Q1, Q2]',
    );
    const warnings = only(b, 'xychart-no-series');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('renders no data');
    expect(warnings[0].line).toBe(1);
  });

  it('flags a categorical series whose item count does not match the x-axis labels', () => {
    const b = xychartBlock('xychart-beta\n  x-axis [Jan, Feb]\n  bar [10]');
    const warnings = only(b, 'xychart-series-length-mismatch');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('x-axis');
    expect(warnings[0].message).toContain('2');
    expect(warnings[0].message).toContain('1');
    expect(warnings[0].line).toBe(3);
  });

  it('does not apply series-length-mismatch to numeric range x-axes', () => {
    const b = xychartBlock('xychart-beta\n  x-axis 0 --> 10\n  bar [1, 2, 3]');
    expect(only(b, 'xychart-series-length-mismatch')).toEqual([]);
  });

  it('respects suppression directives and rule-off configuration', () => {
    const suppressed = xychartBlock(
      'xychart-beta\n  %% mermaid-lint-disable-diagram xychart-no-series: legacy suppression test\n  x-axis [Jan, Feb]',
    );
    expect(only(suppressed, 'xychart-no-series')).toEqual([]);

    const b = xychartBlock('xychart-beta\n  x-axis [Jan, Feb]\n  line [1]');
    const rules: ResolvedRules = {
      ...RULE_DEFAULTS,
      'xychart-series-length-mismatch': 'off',
    };
    expect(only(b, 'xychart-series-length-mismatch', rules)).toEqual([]);
  });
});
