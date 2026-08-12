import { describe, expect, it } from 'vitest';
import { block } from './helpers.js';
import { only } from './helpers.js';

describe('gitgraph-duplicate-commit-id rule', () => {
  function gitGraphBlock(body: string): Block {
    return block(body, 'gitGraph');
  }

  it('returns [] when commit ids are unique', () => {
    const b = gitGraphBlock('gitGraph\n  commit id: "A"\n  commit id: "B"');
    expect(only(b, 'gitgraph-duplicate-commit-id')).toEqual([]);
  });

  it('returns [] for commits without explicit ids', () => {
    const b = gitGraphBlock('gitGraph\n  commit\n  commit');
    expect(only(b, 'gitgraph-duplicate-commit-id')).toEqual([]);
  });

  it('flags a commit id used twice', () => {
    const b = gitGraphBlock('gitGraph\n  commit id: "A"\n  commit id: "A"');
    const warnings = only(b, 'gitgraph-duplicate-commit-id');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('`A`');
    expect(warnings[0].message).toContain('line 2');
    expect(warnings[0].line).toBe(3);
  });

  it('does not count a cherry-pick id reference as a duplicate', () => {
    // `cherry-pick id: "A"` references the existing commit, it does not
    // declare a new id — so it must not be flagged against `commit id: "A"`.
    const b = gitGraphBlock(
      'gitGraph\n  commit id: "A"\n  cherry-pick id: "A"',
    );
    expect(only(b, 'gitgraph-duplicate-commit-id')).toEqual([]);
  });

  it('detects an id reused on a merge line', () => {
    const b = gitGraphBlock('gitGraph\n  commit id: "A"\n  merge dev id: "A"');
    expect(only(b, 'gitgraph-duplicate-commit-id')).toHaveLength(1);
  });
});

describe('gitgraph-duplicate-tag rule', () => {
  function gitGraphBlock(body: string): Block {
    return block(body, 'gitGraph');
  }

  it('returns [] when tags are unique', () => {
    const b = gitGraphBlock('gitGraph\n  commit tag: "v1"\n  commit tag: "v2"');
    expect(only(b, 'gitgraph-duplicate-tag')).toEqual([]);
  });

  it('flags a tag used twice', () => {
    const b = gitGraphBlock('gitGraph\n  commit tag: "v1"\n  commit tag: "v1"');
    const warnings = only(b, 'gitgraph-duplicate-tag');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].line).toBe(3);
  });
});

describe('gitgraph-no-commits rule', () => {
  function gitGraphBlock(body: string): Block {
    return block(body, 'gitGraph');
  }

  it('returns [] when the graph has a commit', () => {
    const b = gitGraphBlock('gitGraph\n  commit');
    expect(only(b, 'gitgraph-no-commits')).toEqual([]);
  });

  it('flags a gitGraph with only a branch and no commits', () => {
    const b = gitGraphBlock('gitGraph\n  branch dev');
    const warnings = only(b, 'gitgraph-no-commits');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].line).toBe(1);
  });
});
