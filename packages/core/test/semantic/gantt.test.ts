import { describe, expect, it } from 'vitest';
import { block } from './helpers.js';
import { only } from './helpers.js';

describe('gantt-duplicate-task-id rule', () => {
  function ganttBlock(body: string): Block {
    return block(body, 'gantt');
  }

  it('returns [] when task ids are unique', () => {
    const b = ganttBlock(
      'gantt\n  section S\n    A :a1, 2024-01-01, 3d\n    B :b1, 2024-01-04, 2d',
    );
    expect(only(b, 'gantt-duplicate-task-id')).toEqual([]);
  });

  it('flags a task id defined more than once', () => {
    const b = ganttBlock(
      'gantt\n  section S\n    A :a1, 2024-01-01, 3d\n    B :a1, 2024-01-04, 2d',
    );
    const warnings = only(b, 'gantt-duplicate-task-id');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('`a1`');
    expect(warnings[0].line).toBe(4);
  });

  it('ignores auto-generated ids (tasks without an explicit id)', () => {
    const b = ganttBlock(
      'gantt\n  section S\n    A :2024-01-01, 3d\n    B :2024-01-04, 2d',
    );
    expect(only(b, 'gantt-duplicate-task-id')).toEqual([]);
  });

  it('reads the id past leading status tags', () => {
    const b = ganttBlock(
      'gantt\n  section S\n    A :done, t1, 2024-01-01, 3d\n    B :crit, t1, 2024-01-04, 2d',
    );
    const warnings = only(b, 'gantt-duplicate-task-id');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('`t1`');
  });
});

describe('gantt-undefined-dependency rule', () => {
  function ganttBlock(body: string): Block {
    return block(body, 'gantt');
  }

  it('returns [] when every dependency is defined', () => {
    const b = ganttBlock(
      'gantt\n  section S\n    A :a1, 2024-01-01, 3d\n    B :b1, after a1, 2d',
    );
    expect(only(b, 'gantt-undefined-dependency')).toEqual([]);
  });

  it('flags a reference to an undefined task id', () => {
    const b = ganttBlock(
      'gantt\n  section S\n    A :a1, 2024-01-01, 3d\n    B :b1, after zzz, 2d',
    );
    const warnings = only(b, 'gantt-undefined-dependency');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('`zzz`');
    expect(warnings[0].line).toBe(4);
  });

  it('does not flag a forward reference to a later task', () => {
    const b = ganttBlock(
      'gantt\n  section S\n    A :a1, after b1, 2d\n    B :b1, 2024-01-04, 3d',
    );
    expect(only(b, 'gantt-undefined-dependency')).toEqual([]);
  });

  it('resolves multiple space-separated dependencies', () => {
    const b = ganttBlock(
      'gantt\n  section S\n    A :a1, 2024-01-01, 3d\n    B :b1, 2024-01-01, 2d\n    C :c1, after a1 b1, 1d',
    );
    expect(only(b, 'gantt-undefined-dependency')).toEqual([]);
  });

  it('handles the until dependency keyword', () => {
    const b = ganttBlock(
      'gantt\n  section S\n    A :a1, 2024-01-01, 3d\n    B :b1, after a1, until nope',
    );
    const warnings = only(b, 'gantt-undefined-dependency');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('`nope`');
  });

  it('does not misread a click interaction line as a task', () => {
    const b = ganttBlock(
      'gantt\n  section S\n    A :a1, 2024-01-01, 3d\n  click a1 call cb(after x, foo)',
    );
    expect(only(b, 'gantt-undefined-dependency')).toEqual([]);
    expect(only(b, 'gantt-duplicate-task-id')).toEqual([]);
  });

  it('does not flag a time-of-day colon inside the start field', () => {
    const b = ganttBlock(
      'gantt\n  dateFormat YYYY-MM-DD HH:mm\n  section S\n    A :a1, 2024-01-01 09:00, 3d\n    B :b1, after a1, 2d',
    );
    expect(only(b, 'gantt-undefined-dependency')).toEqual([]);
  });
});

describe('gantt-empty-section rule', () => {
  function ganttBlock(body: string): Block {
    return block(body, 'gantt');
  }

  it('returns [] when every section has a task', () => {
    const b = ganttBlock(
      'gantt\n  section S\n    A :a1, 2024-01-01, 3d\n  section T\n    B :b1, 2024-01-04, 2d',
    );
    expect(only(b, 'gantt-empty-section')).toEqual([]);
  });

  it('flags a section with no tasks', () => {
    const b = ganttBlock(
      'gantt\n  section S\n    A :a1, 2024-01-01, 3d\n  section Empty',
    );
    const warnings = only(b, 'gantt-empty-section');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('`Empty`');
    expect(warnings[0].line).toBe(4);
  });

  it('does not treat a colon in the title as a task', () => {
    const b = ganttBlock(
      'gantt\n  title Project: Phase 1\n  section Empty\n  section S\n    A :a1, 2024-01-01, 3d',
    );
    const warnings = only(b, 'gantt-empty-section');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('`Empty`');
  });
});
