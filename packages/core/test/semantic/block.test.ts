import { describe, expect, it } from 'vitest';
import { block } from './helpers.js';
import { only } from './helpers.js';

describe('experimental diagram-specific rules', () => {
  it('flags block-beta with no block declarations', () => {
    const b = block('block-beta\n  columns 2', 'block-beta');
    const warnings = only(b, 'block-no-blocks');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('no blocks');
  });

  it('does not flag block-beta with a block declaration', () => {
    const b = block('block-beta\n  columns 2\n  a["A"]:1', 'block-beta');
    expect(only(b, 'block-no-blocks')).toEqual([]);
  });

  it('does not flag block-beta with a bare block declaration', () => {
    const b = block('block-beta\n  a["A"]', 'block-beta');
    expect(only(b, 'block-no-blocks')).toEqual([]);
  });
});
