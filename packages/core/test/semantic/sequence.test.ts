import { describe, expect, it } from 'vitest';
import { RULE_DEFAULTS } from '../../src/rules.js';
import type { ResolvedRules } from '../../src/rules.js';
import { block } from './helpers.js';
import { only } from './helpers.js';

describe('no-activate-without-deactivate rule', () => {
  function seqBlock(body: string): Block {
    return block(body, 'sequenceDiagram');
  }

  it('returns [] for a balanced explicit activate/deactivate pair', () => {
    const b = seqBlock(
      'sequenceDiagram\n  Alice->>Bob: Hello\n  activate Bob\n  Bob-->>Alice: Hi\n  deactivate Bob',
    );
    expect(only(b, 'no-activate-without-deactivate')).toEqual([]);
  });

  it('fires when activate has no matching deactivate (warn)', () => {
    const b = seqBlock(
      'sequenceDiagram\n  Alice->>Bob: Hello\n  activate Bob\n  Bob-->>Alice: Hi',
    );
    const warnings = only(b, 'no-activate-without-deactivate');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('`Bob`');
    expect(warnings[0].message).toContain('never deactivated');
  });

  it('fires when deactivate has no matching activate', () => {
    const b = seqBlock(
      'sequenceDiagram\n  Alice->>Bob: Hello\n  deactivate Bob',
    );
    const warnings = only(b, 'no-activate-without-deactivate');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('`deactivate`');
    expect(warnings[0].message).toContain('`Bob`');
    expect(warnings[0].message).toContain('no matching `activate`');
  });

  it('returns [] for balanced shorthand +/- arrows', () => {
    const b = seqBlock(
      'sequenceDiagram\n  Alice->>+Bob: Hello\n  Bob-->>-Alice: Hi',
    );
    expect(only(b, 'no-activate-without-deactivate')).toEqual([]);
  });

  it('fires when shorthand + has no matching - (dangling activation)', () => {
    const b = seqBlock(
      'sequenceDiagram\n  Alice->>+Bob: Hello\n  Bob-->>Alice: Hi',
    );
    const warnings = only(b, 'no-activate-without-deactivate');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('`Bob`');
    expect(warnings[0].message).toContain('never deactivated');
  });

  it('returns [] for multiple stacked balanced activations', () => {
    const b = seqBlock(
      'sequenceDiagram\n  activate Alice\n  activate Alice\n  deactivate Alice\n  deactivate Alice',
    );
    expect(only(b, 'no-activate-without-deactivate')).toEqual([]);
  });

  it('is suppressed by %% mermaid-lint-disable-diagram no-activate-without-deactivate', () => {
    const b = seqBlock(
      'sequenceDiagram\n  %% mermaid-lint-disable-diagram no-activate-without-deactivate: legacy suppression test\n  activate Bob\n  Alice->>Bob: Hello',
    );
    expect(only(b, 'no-activate-without-deactivate')).toEqual([]);
  });

  it('returns [] when configured off', () => {
    const b = seqBlock('sequenceDiagram\n  activate Bob\n  Alice->>Bob: Hello');
    const rules: ResolvedRules = {
      ...RULE_DEFAULTS,
      'no-activate-without-deactivate': 'off',
    };
    expect(only(b, 'no-activate-without-deactivate', rules)).toEqual([]);
  });

  it('severity defaults to warn', () => {
    const b = seqBlock('sequenceDiagram\n  activate Bob\n  Alice->>Bob: Hi');
    const warnings = only(b, 'no-activate-without-deactivate');
    expect(warnings[0].severity).toBe('warn');
  });
});

describe('prefer-explicit-participants rule', () => {
  function seqBlock(body: string): Block {
    return block(body, 'sequenceDiagram');
  }
  const enabledRules: ResolvedRules = {
    ...RULE_DEFAULTS,
    'prefer-explicit-participants': 'warn',
  };

  it('returns [] by default (rule is off)', () => {
    const b = seqBlock('sequenceDiagram\n  Alice->>Bob: Hello');
    expect(only(b, 'prefer-explicit-participants')).toEqual([]);
  });

  it('returns [] when participants are declared before use', () => {
    const b = seqBlock(
      'sequenceDiagram\n  participant Alice\n  participant Bob\n  Alice->>Bob: Hello',
    );
    expect(only(b, 'prefer-explicit-participants', enabledRules)).toEqual([]);
  });

  it('fires when a participant is used before being declared', () => {
    const b = seqBlock(
      'sequenceDiagram\n  Alice->>Bob: Hello\n  participant Alice\n  participant Bob',
    );
    const warnings = only(b, 'prefer-explicit-participants', enabledRules);
    // Alice and Bob both used before declared — 2 findings
    expect(warnings).toHaveLength(2);
    expect(warnings[0].message).toContain('`Alice`');
    expect(warnings[1].message).toContain('`Bob`');
    expect(warnings[0].message).toContain('auto-creates');
  });

  it('fires only for undeclared participant when one is declared and one is not', () => {
    // participant A as Alice declared, B never declared
    const b = seqBlock(
      'sequenceDiagram\n  participant A as Alice\n  A->>B: Hello',
    );
    const warnings = only(b, 'prefer-explicit-participants', enabledRules);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('`B`');
  });

  it('emits only one finding per undeclared id (not one per message)', () => {
    const b = seqBlock(
      'sequenceDiagram\n  Alice->>Bob: First\n  Alice->>Bob: Second',
    );
    const warnings = only(b, 'prefer-explicit-participants', enabledRules);
    // Alice and Bob each fire once
    expect(warnings).toHaveLength(2);
  });

  it('is suppressed by %% mermaid-lint-disable-diagram prefer-explicit-participants', () => {
    const b = seqBlock(
      'sequenceDiagram\n  %% mermaid-lint-disable-diagram prefer-explicit-participants: legacy suppression test\n  Alice->>Bob: Hello',
    );
    expect(only(b, 'prefer-explicit-participants', enabledRules)).toEqual([]);
  });

  it('severity follows the configured value', () => {
    const b = seqBlock('sequenceDiagram\n  Alice->>Bob: Hello');
    const warnings = only(b, 'prefer-explicit-participants', enabledRules);
    expect(warnings[0].severity).toBe('warn');
  });
});

describe('sequence-duplicate-participant rule', () => {
  function sequenceBlock(body: string): Block {
    return block(body, 'sequenceDiagram');
  }

  it('returns [] when participants are declared once', () => {
    const b = sequenceBlock(
      'sequenceDiagram\n  participant Alice\n  actor Bob\n  Alice->>Bob: Hi',
    );
    expect(only(b, 'sequence-duplicate-participant')).toEqual([]);
  });

  it('flags duplicate participant declarations', () => {
    const b = sequenceBlock(
      'sequenceDiagram\n  participant Alice\n  Alice->>Bob: Hi\n  participant Alice',
    );
    const warnings = only(b, 'sequence-duplicate-participant');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('`Alice`');
    expect(warnings[0].message).toContain('line 2');
    expect(warnings[0].line).toBe(4);
  });
});
