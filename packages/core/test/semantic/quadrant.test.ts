import { describe, expect, it } from 'vitest';
import { block } from './helpers.js';
import { only } from './helpers.js';

describe('quadrant-duplicate-point rule', () => {
  function quadrantBlock(body: string): Block {
    return block(body, 'quadrantChart');
  }

  it('returns [] when point labels are unique', () => {
    const b = quadrantBlock('quadrantChart\n  A: [0.3, 0.6]\n  B: [0.5, 0.2]');
    expect(only(b, 'quadrant-duplicate-point')).toEqual([]);
  });

  it('flags a duplicate point label, keyed by label not coordinates', () => {
    const b = quadrantBlock(
      'quadrantChart\n  Campaign A: [0.3, 0.6]\n  Campaign A: [0.5, 0.2]',
    );
    const warnings = only(b, 'quadrant-duplicate-point');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('`Campaign A`');
    expect(warnings[0].message).toContain('line 2');
    expect(warnings[0].line).toBe(3);
  });

  it('ignores the `:::class` suffix when comparing labels', () => {
    const b = quadrantBlock(
      'quadrantChart\n  A:::good: [0.3, 0.6]\n  A: [0.5, 0.2]',
    );
    expect(only(b, 'quadrant-duplicate-point')).toHaveLength(1);
  });

  it('does not treat axis or quadrant lines as points', () => {
    const b = quadrantBlock(
      'quadrantChart\n  x-axis Low --> High\n  y-axis Low --> High\n  quadrant-1 Expand\n  A: [0.3, 0.6]',
    );
    expect(only(b, 'quadrant-duplicate-point')).toEqual([]);
  });
});

describe('quadrant-no-points rule', () => {
  function quadrantBlock(body: string): Block {
    return block(body, 'quadrantChart');
  }

  it('returns [] when the chart has at least one point', () => {
    const b = quadrantBlock('quadrantChart\n  A: [0.3, 0.6]');
    expect(only(b, 'quadrant-no-points')).toEqual([]);
  });

  it('flags a quadrantChart with labels but no data points', () => {
    const b = quadrantBlock(
      'quadrantChart\n  title Reach\n  x-axis Low --> High\n  quadrant-1 Expand',
    );
    const warnings = only(b, 'quadrant-no-points');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].line).toBe(1);
  });
});

describe('quadrant-missing-x-axis rule', () => {
  function quadrantBlock(body: string): Block {
    return block(body, 'quadrantChart');
  }

  it('returns [] when the chart has an x-axis', () => {
    const b = quadrantBlock(
      'quadrantChart\n  x-axis Low --> High\n  y-axis Low --> High\n  A: [0.3, 0.6]',
    );
    expect(only(b, 'quadrant-missing-x-axis')).toEqual([]);
  });

  it('flags a chart with points and no x-axis', () => {
    const b = quadrantBlock(
      'quadrantChart\n  y-axis Low --> High\n  A: [0.3, 0.6]',
    );
    const warnings = only(b, 'quadrant-missing-x-axis');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].line).toBe(1);
  });

  it('does not fire on a chart with no points', () => {
    const b = quadrantBlock('quadrantChart\n  title Reach');
    expect(only(b, 'quadrant-missing-x-axis')).toEqual([]);
  });
});

describe('quadrant-missing-y-axis rule', () => {
  function quadrantBlock(body: string): Block {
    return block(body, 'quadrantChart');
  }

  it('returns [] when the chart has a y-axis', () => {
    const b = quadrantBlock(
      'quadrantChart\n  x-axis Low --> High\n  y-axis Low --> High\n  A: [0.3, 0.6]',
    );
    expect(only(b, 'quadrant-missing-y-axis')).toEqual([]);
  });

  it('flags a chart with points and no y-axis', () => {
    const b = quadrantBlock(
      'quadrantChart\n  x-axis Low --> High\n  A: [0.3, 0.6]',
    );
    const warnings = only(b, 'quadrant-missing-y-axis');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].line).toBe(1);
  });

  it('does not fire on a chart with no points', () => {
    const b = quadrantBlock('quadrantChart\n  title Reach');
    expect(only(b, 'quadrant-missing-y-axis')).toEqual([]);
  });
});

describe('quadrant-duplicate-quadrant rule', () => {
  function quadrantBlock(body: string): Block {
    return block(body, 'quadrantChart');
  }

  it('returns [] when each quadrant region is labeled once', () => {
    const b = quadrantBlock(
      'quadrantChart\n  quadrant-1 First\n  quadrant-2 Second\n  A: [0.3, 0.6]',
    );
    expect(only(b, 'quadrant-duplicate-quadrant')).toEqual([]);
  });

  it('flags the same quadrant region labeled twice', () => {
    const b = quadrantBlock(
      'quadrantChart\n  quadrant-1 First\n  quadrant-1 Second\n  A: [0.3, 0.6]',
    );
    const warnings = only(b, 'quadrant-duplicate-quadrant');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('quadrant-1');
    expect(warnings[0].message).toContain('line 2');
    expect(warnings[0].line).toBe(3);
  });
});
