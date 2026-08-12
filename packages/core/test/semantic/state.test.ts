import { describe, expect, it } from 'vitest';
import { RULE_DEFAULTS } from '../../src/rules.js';
import type { ResolvedRules } from '../../src/rules.js';
import { block } from './helpers.js';
import { only } from './helpers.js';

describe('state-duplicate-transition rule', () => {
  function stateBlock(body: string): Block {
    return block(body, 'stateDiagram-v2');
  }

  it('returns [] when every transition is distinct', () => {
    const b = stateBlock(
      'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running\n  Running --> [*]',
    );
    expect(only(b, 'state-duplicate-transition')).toEqual([]);
  });

  it('fires when an identical transition is repeated (warn)', () => {
    const b = stateBlock(
      'stateDiagram-v2\n  Idle --> Running\n  Idle --> Running',
    );
    const warnings = only(b, 'state-duplicate-transition');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('`Idle`');
    expect(warnings[0].message).toContain('`Running`');
    expect(warnings[0].message).toContain('first on line 2');
    expect(warnings[0].line).toBe(3);
  });

  it('treats transitions with different labels as distinct', () => {
    const b = stateBlock(
      'stateDiagram-v2\n  Idle --> Running : start\n  Idle --> Running : resume',
    );
    expect(only(b, 'state-duplicate-transition')).toEqual([]);
  });

  it('flags a repeated transition carrying the same label', () => {
    const b = stateBlock(
      'stateDiagram-v2\n  Idle --> Running : start\n  Idle --> Running : start',
    );
    expect(only(b, 'state-duplicate-transition')).toHaveLength(1);
  });

  it('also applies to the v1 stateDiagram keyword', () => {
    const b = block('stateDiagram\n  A --> B\n  A --> B', 'stateDiagram');
    expect(only(b, 'state-duplicate-transition')).toHaveLength(1);
  });

  it('returns [] for non-state diagrams', () => {
    const b = block('flowchart LR\n  A --> B\n  A --> B');
    expect(only(b, 'state-duplicate-transition')).toEqual([]);
  });

  it('is suppressed by %% mermaid-lint-disable-diagram state-duplicate-transition', () => {
    const b = stateBlock(
      'stateDiagram-v2\n  %% mermaid-lint-disable-diagram state-duplicate-transition: legacy suppression test\n  A --> B\n  A --> B',
    );
    expect(only(b, 'state-duplicate-transition')).toEqual([]);
  });
});

describe('state-duplicate-state rule', () => {
  function stateBlock(body: string): Block {
    return block(body, 'stateDiagram-v2');
  }

  it('returns [] when state declarations are unique', () => {
    const b = stateBlock('stateDiagram-v2\n  state A\n  state B');
    expect(only(b, 'state-duplicate-state')).toEqual([]);
  });

  it('flags duplicate state declarations', () => {
    const b = stateBlock('stateDiagram-v2\n  state A\n  state A');
    const warnings = only(b, 'state-duplicate-state');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('`A`');
    expect(warnings[0].message).toContain('line 2');
    expect(warnings[0].line).toBe(3);
  });

  it('handles aliased state declarations', () => {
    const b = stateBlock(
      'stateDiagram-v2\n  state "Ready" as A\n  state "Waiting" as A',
    );
    expect(only(b, 'state-duplicate-state')).toHaveLength(1);
  });

  it('does not treat transition-only implicit states as declarations', () => {
    const b = stateBlock('stateDiagram-v2\n  A --> B\n  A --> C');
    expect(only(b, 'state-duplicate-state')).toEqual([]);
  });
});

describe('state-empty-composite rule', () => {
  function stateBlock(body: string): Block {
    return block(body, 'stateDiagram-v2');
  }

  it('returns [] when a composite state has a body', () => {
    const b = stateBlock(
      'stateDiagram-v2\n  state Configuring {\n    [*] --> Idle\n  }',
    );
    expect(only(b, 'state-empty-composite')).toEqual([]);
  });

  it('fires for an empty composite body (warn)', () => {
    const b = stateBlock('stateDiagram-v2\n  state Configuring {\n  }');
    const warnings = only(b, 'state-empty-composite');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('`Configuring`');
    expect(warnings[0].line).toBe(2);
  });

  it('treats a comment-only composite body as empty', () => {
    const b = stateBlock(
      'stateDiagram-v2\n  state Configuring {\n    %% TODO\n  }',
    );
    expect(only(b, 'state-empty-composite')).toHaveLength(1);
  });

  it('counts a nested composite as content for its parent', () => {
    const b = stateBlock(
      'stateDiagram-v2\n  state Outer {\n    state Inner {\n      [*] --> X\n    }\n  }',
    );
    // Only Outer is non-empty; Inner has a body too — zero findings.
    expect(only(b, 'state-empty-composite')).toEqual([]);
  });

  it('uses the `as` alias for the name when present', () => {
    const b = stateBlock('stateDiagram-v2\n  state "Long Name" as ln {\n  }');
    const warnings = only(b, 'state-empty-composite');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('`ln`');
  });

  it('returns [] when configured off', () => {
    const b = stateBlock('stateDiagram-v2\n  state Configuring {\n  }');
    const rules: ResolvedRules = {
      ...RULE_DEFAULTS,
      'state-empty-composite': 'off',
    };
    expect(only(b, 'state-empty-composite', rules)).toEqual([]);
  });
});

describe('state-self-transition rule', () => {
  function stateBlock(body: string): Block {
    return block(body, 'stateDiagram-v2');
  }

  const enabled: ResolvedRules = {
    ...RULE_DEFAULTS,
    'state-self-transition': 'warn',
  };

  it('is off by default', () => {
    const b = stateBlock('stateDiagram-v2\n  A --> A');
    expect(only(b, 'state-self-transition')).toEqual([]);
  });

  it('fires for a self-transition when enabled', () => {
    const b = stateBlock(
      'stateDiagram-v2\n  Idle --> Running\n  Idle --> Idle',
    );
    const warnings = only(b, 'state-self-transition', enabled);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('`Idle`');
    expect(warnings[0].line).toBe(3);
  });

  it('does not flag the [*] pseudostate', () => {
    const b = stateBlock('stateDiagram-v2\n  [*] --> A\n  A --> [*]');
    expect(only(b, 'state-self-transition', enabled)).toEqual([]);
  });
});
