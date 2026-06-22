import { describe, expect, it } from 'vitest';
import type { Block } from '../src/extract.js';
import { RULE_DEFAULTS, type ResolvedRules } from '../src/rules.js';
import { checkSemantics } from '../src/semantic.js';

function block(body: string, type = 'flowchart'): Block {
  return { path: 'test.md', line: 1, col: 1, body, type };
}

// Focus a single rule's findings — `checkSemantics` runs every rule, so the
// duplicate-id tests below filter to that rule to stay isolated from, e.g.,
// `prefer-flowchart` also firing on a `graph` fixture.
function only(b: Block, rule: string, rules?: ResolvedRules) {
  return checkSemantics(b, rules ?? RULE_DEFAULTS).filter(
    (w) => w.rule === rule,
  );
}

describe('checkSemantics', () => {
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

    it('returns [] when %% mermaid-lint-disable is present', () => {
      const b = block(
        'flowchart LR\n  %% mermaid-lint-disable\n  A[Start] --> B\n  A[Begin] --> C',
      );
      expect(only(b, 'duplicate-ids')).toEqual([]);
    });

    it('returns [] when %% mermaid-lint-disable duplicate-ids is present', () => {
      const b = block(
        'flowchart LR\n  %% mermaid-lint-disable duplicate-ids\n  A[Start] --> B\n  A[Begin] --> C',
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

  describe('prefer-flowchart rule', () => {
    it('flags the legacy `graph` keyword (warn)', () => {
      const b = block('graph LR\n  A --> B', 'graph');
      const warnings = only(b, 'prefer-flowchart');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warn');
      expect(warnings[0].line).toBe(1);
      expect(warnings[0].message).toContain('flowchart');
    });

    it('does not flag `flowchart`', () => {
      const b = block('flowchart LR\n  A --> B', 'flowchart');
      expect(only(b, 'prefer-flowchart')).toEqual([]);
    });

    it('is suppressed by %% mermaid-lint-disable prefer-flowchart', () => {
      const b = block(
        'graph LR\n  %% mermaid-lint-disable prefer-flowchart\n  A --> B',
        'graph',
      );
      expect(only(b, 'prefer-flowchart')).toEqual([]);
    });

    it('returns [] when configured off', () => {
      const b = block('graph LR\n  A --> B', 'graph');
      const rules: ResolvedRules = {
        ...RULE_DEFAULTS,
        'prefer-flowchart': 'off',
      };
      expect(only(b, 'prefer-flowchart', rules)).toEqual([]);
    });
  });

  describe('require-direction rule', () => {
    it('flags a flowchart with no direction (warn)', () => {
      const b = block('flowchart\n  A --> B', 'flowchart');
      const warnings = only(b, 'require-direction');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warn');
      expect(warnings[0].message).toContain('TD');
    });

    it('does not flag a flowchart with an explicit direction', () => {
      for (const dir of ['TB', 'TD', 'BT', 'RL', 'LR']) {
        const b = block(`flowchart ${dir}\n  A --> B`, 'flowchart');
        expect(only(b, 'require-direction')).toEqual([]);
      }
    });

    it('flags a directionless graph too', () => {
      const b = block('graph\n  A --> B', 'graph');
      expect(only(b, 'require-direction')).toHaveLength(1);
    });

    it('ignores leading comment lines when finding the keyword', () => {
      const b = block('%% a title\nflowchart LR\n  A --> B', 'flowchart');
      expect(only(b, 'require-direction')).toEqual([]);
    });

    it('is suppressed by %% mermaid-lint-disable require-direction', () => {
      const b = block(
        'flowchart\n  %% mermaid-lint-disable require-direction\n  A --> B',
        'flowchart',
      );
      expect(only(b, 'require-direction')).toEqual([]);
    });
  });

  describe('no-experimental rule', () => {
    it('flags a *-beta diagram type (warn)', () => {
      const b = block('xychart-beta\n  title "x"', 'xychart-beta');
      const warnings = only(b, 'no-experimental');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warn');
      expect(warnings[0].message).toContain('xychart-beta');
    });

    it('does not flag a stable diagram type', () => {
      const b = block('flowchart LR\n  A --> B', 'flowchart');
      expect(only(b, 'no-experimental')).toEqual([]);
    });

    it('is suppressed by %% mermaid-lint-disable no-experimental', () => {
      const b = block(
        'sankey-beta\n%% mermaid-lint-disable no-experimental\nA,B,1',
        'sankey-beta',
      );
      expect(only(b, 'no-experimental')).toEqual([]);
    });

    it('returns [] when configured off', () => {
      const b = block('packet-beta\n  0-7: "x"', 'packet-beta');
      const rules: ResolvedRules = {
        ...RULE_DEFAULTS,
        'no-experimental': 'off',
      };
      expect(only(b, 'no-experimental', rules)).toEqual([]);
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

    it('is suppressed by %% mermaid-lint-disable no-duplicate-edges', () => {
      const b = block(
        'flowchart LR\n  %% mermaid-lint-disable no-duplicate-edges\n  A --> B\n  A --> B',
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

    it('is suppressed by %% mermaid-lint-disable no-self-loop', () => {
      const b = block(
        'flowchart LR\n  %% mermaid-lint-disable no-self-loop\n  A --> A',
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

    it('is suppressed by %% mermaid-lint-disable no-empty-labels', () => {
      const b = block(
        'flowchart LR\n  %% mermaid-lint-disable no-empty-labels\n  A[ ] --> B',
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

    it('is suppressed by %% mermaid-lint-disable no-orphan-nodes', () => {
      const b = block(
        'flowchart LR\n  %% mermaid-lint-disable no-orphan-nodes\n  A --> B\n  C[Lonely]',
      );
      const rules: ResolvedRules = {
        ...RULE_DEFAULTS,
        'no-orphan-nodes': 'warn',
      };
      expect(only(b, 'no-orphan-nodes', rules)).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Sequence & class diagram rules
  // ---------------------------------------------------------------------------

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

    it('is suppressed by %% mermaid-lint-disable no-activate-without-deactivate', () => {
      const b = seqBlock(
        'sequenceDiagram\n  %% mermaid-lint-disable no-activate-without-deactivate\n  activate Bob\n  Alice->>Bob: Hello',
      );
      expect(only(b, 'no-activate-without-deactivate')).toEqual([]);
    });

    it('returns [] when configured off', () => {
      const b = seqBlock(
        'sequenceDiagram\n  activate Bob\n  Alice->>Bob: Hello',
      );
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

    it('is suppressed by %% mermaid-lint-disable prefer-explicit-participants', () => {
      const b = seqBlock(
        'sequenceDiagram\n  %% mermaid-lint-disable prefer-explicit-participants\n  Alice->>Bob: Hello',
      );
      expect(only(b, 'prefer-explicit-participants', enabledRules)).toEqual([]);
    });

    it('severity follows the configured value', () => {
      const b = seqBlock('sequenceDiagram\n  Alice->>Bob: Hello');
      const warnings = only(b, 'prefer-explicit-participants', enabledRules);
      expect(warnings[0].severity).toBe('warn');
    });
  });

  describe('no-duplicate-methods rule', () => {
    function classBlock(body: string): Block {
      return block(body, 'classDiagram');
    }

    it('returns [] when no duplicate methods exist', () => {
      const b = classBlock(
        'classDiagram\n  class Foo {\n    +bar() int\n    +baz() string\n  }',
      );
      expect(only(b, 'no-duplicate-methods')).toEqual([]);
    });

    it('fires when a method is declared twice in a class block (warn)', () => {
      const b = classBlock(
        'classDiagram\n  class Foo {\n    +bar() int\n    +bar() int\n  }',
      );
      const warnings = only(b, 'no-duplicate-methods');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warn');
      expect(warnings[0].message).toContain('`bar()`');
      expect(warnings[0].message).toContain('`Foo`');
      expect(warnings[0].message).toContain('first on line');
    });

    it('fires when a method is declared twice via inline syntax', () => {
      const b = classBlock('classDiagram\n  Foo : +bar()\n  Foo : +bar()');
      const warnings = only(b, 'no-duplicate-methods');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toContain('`bar()`');
      expect(warnings[0].message).toContain('`Foo`');
    });

    it('returns [] for distinct overloads (different param signatures)', () => {
      const b = classBlock(
        'classDiagram\n  class Foo {\n    +bar(int x) string\n    +bar(String s) string\n  }',
      );
      expect(only(b, 'no-duplicate-methods')).toEqual([]);
    });

    it('returns [] when same method name appears on two different classes', () => {
      const b = classBlock(
        'classDiagram\n  class Foo {\n    +bar()\n  }\n  class Baz {\n    +bar()\n  }',
      );
      expect(only(b, 'no-duplicate-methods')).toEqual([]);
    });

    it('returns [] for repeated attribute (no parens) — not a method', () => {
      const b = classBlock(
        'classDiagram\n  class Foo {\n    +int count\n    +int count\n  }',
      );
      expect(only(b, 'no-duplicate-methods')).toEqual([]);
    });

    it('is suppressed by %% mermaid-lint-disable no-duplicate-methods', () => {
      const b = classBlock(
        'classDiagram\n  %% mermaid-lint-disable no-duplicate-methods\n  class Foo {\n    +bar()\n    +bar()\n  }',
      );
      expect(only(b, 'no-duplicate-methods')).toEqual([]);
    });

    it('returns [] when configured off', () => {
      const b = classBlock(
        'classDiagram\n  class Foo {\n    +bar()\n    +bar()\n  }',
      );
      const rules: ResolvedRules = {
        ...RULE_DEFAULTS,
        'no-duplicate-methods': 'off',
      };
      expect(only(b, 'no-duplicate-methods', rules)).toEqual([]);
    });

    it('severity defaults to warn', () => {
      const b = classBlock(
        'classDiagram\n  class Foo {\n    +bar()\n    +bar()\n  }',
      );
      const warnings = only(b, 'no-duplicate-methods');
      expect(warnings[0].severity).toBe('warn');
    });
  });
});
