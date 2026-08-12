import { describe, expect, it } from 'vitest';
import { RULE_DEFAULTS } from '../../src/rules.js';
import type { ResolvedRules } from '../../src/rules.js';
import { block } from './helpers.js';
import { only } from './helpers.js';

describe('duplicate-ids rule', () => {
  it('returns [] for flowchart with no conflicts', () => {
    const b = block('flowchart LR\n  A[Start] --> B[End]');
    expect(only(b, 'duplicate-ids')).toEqual([]);
  });

  it('returns [] when same ID declared twice with identical label', () => {
    const b = block('flowchart LR\n  A[Same] --> B\n  A[Same] --> C');
    expect(only(b, 'duplicate-ids')).toEqual([]);
  });

  it('returns one finding when same ID has conflicting labels', () => {
    const b = block('flowchart LR\n  A[Start] --> B\n  A[Begin] --> C');
    const warnings = only(b, 'duplicate-ids');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].rule).toBe('duplicate-ids');
    expect(warnings[0].severity).toBe('error');
    expect(warnings[0].message).toContain('"A"');
    expect(warnings[0].message).toContain('Start');
    expect(warnings[0].message).toContain('Begin');
    expect(warnings[0].line).toBe(3);
  });

  it('returns one finding per conflict when multiple IDs conflict', () => {
    const b = block(
      'flowchart LR\n  A[First] --> B[Good]\n  A[Second] --> C\n  B[Bad] --> D',
    );
    const warnings = only(b, 'duplicate-ids');
    expect(warnings).toHaveLength(2);
    expect(warnings.map((w) => w.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('"A"'),
        expect.stringContaining('"B"'),
      ]),
    );
  });

  it('detects conflict on a multi-declaration line', () => {
    const b = block('flowchart LR\n  A[Start]\n  A[Other] --> B[End]');
    const warnings = only(b, 'duplicate-ids');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('"A"');
  });

  it('also runs for graph type', () => {
    const b = block('graph LR\n  A[First] --> B\n  A[Second] --> C', 'graph');
    expect(only(b, 'duplicate-ids')).toHaveLength(1);
  });

  it('returns [] for sequenceDiagram (not checked)', () => {
    const b = block('sequenceDiagram\n  Alice->>Bob: Hi', 'sequenceDiagram');
    expect(only(b, 'duplicate-ids')).toEqual([]);
  });

  it('returns [] when %% mermaid-lint-disable-diagram all is present', () => {
    const b = block(
      'flowchart LR\n  %% mermaid-lint-disable-diagram all: legacy suppression test\n  A[Start] --> B\n  A[Begin] --> C',
    );
    expect(only(b, 'duplicate-ids')).toEqual([]);
  });

  it('returns [] when %% mermaid-lint-disable-diagram duplicate-ids is present', () => {
    const b = block(
      'flowchart LR\n  %% mermaid-lint-disable-diagram duplicate-ids: legacy suppression test\n  A[Start] --> B\n  A[Begin] --> C',
    );
    expect(only(b, 'duplicate-ids')).toEqual([]);
  });

  it('returns [] when the rule is configured off', () => {
    const b = block('flowchart LR\n  A[Start] --> B\n  A[Begin] --> C');
    const rules: ResolvedRules = { ...RULE_DEFAULTS, 'duplicate-ids': 'off' };
    expect(only(b, 'duplicate-ids', rules)).toEqual([]);
  });

  it('emits warn severity when the rule is configured to warn', () => {
    const b = block('flowchart LR\n  A[Start] --> B\n  A[Begin] --> C');
    const rules: ResolvedRules = {
      ...RULE_DEFAULTS,
      'duplicate-ids': 'warn',
    };
    const warnings = only(b, 'duplicate-ids', rules);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
  });

  it('detects rectangle [label]', () => {
    const b = block('flowchart LR\n  N[Alpha] --> X\n  N[Beta] --> Y');
    expect(only(b, 'duplicate-ids')).toHaveLength(1);
  });

  it('detects rounded (label)', () => {
    const b = block('flowchart LR\n  N(Alpha) --> X\n  N(Beta) --> Y');
    expect(only(b, 'duplicate-ids')).toHaveLength(1);
  });

  it('detects rhombus {label}', () => {
    const b = block('flowchart LR\n  N{Alpha} --> X\n  N{Beta} --> Y');
    expect(only(b, 'duplicate-ids')).toHaveLength(1);
  });

  it('detects circle ((label))', () => {
    const b = block('flowchart LR\n  N((Alpha)) --> X\n  N((Beta)) --> Y');
    expect(only(b, 'duplicate-ids')).toHaveLength(1);
  });

  it('detects subroutine [[label]]', () => {
    const b = block('flowchart LR\n  N[[Alpha]] --> X\n  N[[Beta]] --> Y');
    expect(only(b, 'duplicate-ids')).toHaveLength(1);
  });

  it('detects stadium ([label])', () => {
    const b = block('flowchart LR\n  N([Alpha]) --> X\n  N([Beta]) --> Y');
    expect(only(b, 'duplicate-ids')).toHaveLength(1);
  });

  it('detects hexagon {{label}}', () => {
    const b = block('flowchart LR\n  N{{Alpha}} --> X\n  N{{Beta}} --> Y');
    expect(only(b, 'duplicate-ids')).toHaveLength(1);
  });

  it('skips %% comment lines in the body', () => {
    const b = block(
      'flowchart LR\n  A[Start]\n  %% N[Fake] is a comment\n  N[Real] --> A',
    );
    expect(only(b, 'duplicate-ids')).toEqual([]);
  });

  it('detects duplicate with numeric node ID', () => {
    const b = block('flowchart LR\n  1[Start]\n  1[Begin]');
    const warnings = only(b, 'duplicate-ids');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].rule).toBe('duplicate-ids');
  });
});

describe('no-duplicate-node-declarations rule', () => {
  it('returns [] when node ids are declared once', () => {
    const b = block('flowchart LR\n  A[Same] --> B');
    expect(only(b, 'no-duplicate-node-declarations')).toEqual([]);
  });

  it('flags duplicate node declarations with the same label', () => {
    const b = block('flowchart LR\n  A[Same] --> B\n  A[Same] --> C');
    const warnings = only(b, 'no-duplicate-node-declarations');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('`A`');
    expect(warnings[0].message).toContain('line 2');
    expect(warnings[0].line).toBe(3);
  });

  it('does not duplicate the conflicting-label duplicate-ids finding', () => {
    const b = block('flowchart LR\n  A[Start] --> B\n  A[Begin] --> C');
    expect(only(b, 'no-duplicate-node-declarations')).toEqual([]);
    expect(only(b, 'duplicate-ids')).toHaveLength(1);
  });

  it('also runs for graph type', () => {
    const b = block('graph LR\n  A[Same]\n  A[Same]', 'graph');
    expect(only(b, 'no-duplicate-node-declarations')).toHaveLength(1);
  });
});

describe('no-duplicate-edges rule', () => {
  it('fires on a duplicate edge (warn)', () => {
    const b = block('flowchart LR\n  A --> B\n  A --> B');
    const warnings = only(b, 'no-duplicate-edges');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].line).toBe(3);
    expect(warnings[0].message).toContain('duplicate edge');
    expect(warnings[0].message).toContain('`A`');
    expect(warnings[0].message).toContain('`B`');
    expect(warnings[0].message).toContain('first on line 2');
  });

  it('returns [] when no duplicates', () => {
    const b = block('flowchart LR\n  A --> B\n  A --> C');
    expect(only(b, 'no-duplicate-edges')).toEqual([]);
  });

  it('does NOT fire when edges have distinct labels (A -->|yes| B and A -->|no| B)', () => {
    const b = block('flowchart LR\n  A -->|yes| B\n  A -->|no| B');
    expect(only(b, 'no-duplicate-edges')).toEqual([]);
  });

  it('fires when both edges have the same non-empty label (A -->|x| B twice)', () => {
    const b = block('flowchart LR\n  A -->|x| B\n  A -->|x| B');
    const warnings = only(b, 'no-duplicate-edges');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('duplicate edge');
  });

  it('fires when both edges are unlabelled (A --> B twice)', () => {
    const b = block('flowchart LR\n  A --> B\n  A --> B');
    expect(only(b, 'no-duplicate-edges')).toHaveLength(1);
  });

  it('does NOT fire when one edge is labelled and one is not (A --> B and A -->|x| B)', () => {
    const b = block('flowchart LR\n  A --> B\n  A -->|x| B');
    expect(only(b, 'no-duplicate-edges')).toEqual([]);
  });

  it('is suppressed by %% mermaid-lint-disable-diagram no-duplicate-edges', () => {
    const b = block(
      'flowchart LR\n  %% mermaid-lint-disable-diagram no-duplicate-edges: legacy suppression test\n  A --> B\n  A --> B',
    );
    expect(only(b, 'no-duplicate-edges')).toEqual([]);
  });

  it('returns [] when configured off', () => {
    const b = block('flowchart LR\n  A --> B\n  A --> B');
    const rules: ResolvedRules = {
      ...RULE_DEFAULTS,
      'no-duplicate-edges': 'off',
    };
    expect(only(b, 'no-duplicate-edges', rules)).toEqual([]);
  });
});

describe('no-self-loop rule', () => {
  it('fires on a self-loop (warn)', () => {
    const b = block('flowchart LR\n  A --> A');
    const warnings = only(b, 'no-self-loop');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].line).toBe(2);
    expect(warnings[0].message).toContain('`A`');
    expect(warnings[0].message).toContain('self-loop');
  });

  it('returns [] when no self-loops', () => {
    const b = block('flowchart LR\n  A --> B');
    expect(only(b, 'no-self-loop')).toEqual([]);
  });

  it('is suppressed by %% mermaid-lint-disable-diagram no-self-loop', () => {
    const b = block(
      'flowchart LR\n  %% mermaid-lint-disable-diagram no-self-loop: legacy suppression test\n  A --> A',
    );
    expect(only(b, 'no-self-loop')).toEqual([]);
  });

  it('returns [] when configured off', () => {
    const b = block('flowchart LR\n  A --> A');
    const rules: ResolvedRules = {
      ...RULE_DEFAULTS,
      'no-self-loop': 'off',
    };
    expect(only(b, 'no-self-loop', rules)).toEqual([]);
  });
});

describe('no-empty-labels rule', () => {
  it('fires on a node with an empty label (warn)', () => {
    const b = block('flowchart LR\n  A[ ] --> B');
    const warnings = only(b, 'no-empty-labels');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('`A`');
    expect(warnings[0].message).toContain('empty label');
  });

  it('returns [] when all labels are non-empty', () => {
    const b = block('flowchart LR\n  A[Start] --> B[End]');
    expect(only(b, 'no-empty-labels')).toEqual([]);
  });

  it('returns [] for bare id with no brackets', () => {
    const b = block('flowchart LR\n  A --> B');
    expect(only(b, 'no-empty-labels')).toEqual([]);
  });

  it('is suppressed by %% mermaid-lint-disable-diagram no-empty-labels', () => {
    const b = block(
      'flowchart LR\n  %% mermaid-lint-disable-diagram no-empty-labels: legacy suppression test\n  A[ ] --> B',
    );
    expect(only(b, 'no-empty-labels')).toEqual([]);
  });

  it('fires on empty parens A() (rounded shape with empty label)', () => {
    const b = block('flowchart LR\n  A() --> B');
    const warnings = only(b, 'no-empty-labels');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('`A`');
    expect(warnings[0].message).toContain('empty label');
  });

  it('returns [] when configured off', () => {
    const b = block('flowchart LR\n  A[ ] --> B');
    const rules: ResolvedRules = {
      ...RULE_DEFAULTS,
      'no-empty-labels': 'off',
    };
    expect(only(b, 'no-empty-labels', rules)).toEqual([]);
  });
});

describe('no-orphan-nodes rule', () => {
  it('returns [] by default (off)', () => {
    const b = block('flowchart LR\n  A --> B\n  C[Lonely]');
    expect(only(b, 'no-orphan-nodes')).toEqual([]);
  });

  it('fires on an orphan node when enabled (warn)', () => {
    const b = block('flowchart LR\n  A --> B\n  C[Lonely]');
    const rules: ResolvedRules = {
      ...RULE_DEFAULTS,
      'no-orphan-nodes': 'warn',
    };
    const warnings = only(b, 'no-orphan-nodes', rules);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].line).toBe(3);
    expect(warnings[0].message).toContain('`C`');
    expect(warnings[0].message).toContain('never connected');
  });

  it('returns [] when all declared nodes are referenced in edges', () => {
    const b = block('flowchart LR\n  A[Start] --> B[End]');
    const rules: ResolvedRules = {
      ...RULE_DEFAULTS,
      'no-orphan-nodes': 'warn',
    };
    expect(only(b, 'no-orphan-nodes', rules)).toEqual([]);
  });

  it('is suppressed by %% mermaid-lint-disable-diagram no-orphan-nodes', () => {
    const b = block(
      'flowchart LR\n  %% mermaid-lint-disable-diagram no-orphan-nodes: legacy suppression test\n  A --> B\n  C[Lonely]',
    );
    const rules: ResolvedRules = {
      ...RULE_DEFAULTS,
      'no-orphan-nodes': 'warn',
    };
    expect(only(b, 'no-orphan-nodes', rules)).toEqual([]);
  });
});
