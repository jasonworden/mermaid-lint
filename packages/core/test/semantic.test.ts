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

  describe('pie-duplicate-label rule', () => {
    function pieBlock(body: string): Block {
      return block(body, 'pie');
    }

    it('returns [] when every slice label is unique', () => {
      const b = pieBlock('pie title Pets\n  "Dogs" : 10\n  "Cats" : 5');
      expect(only(b, 'pie-duplicate-label')).toEqual([]);
    });

    it('fires when a label is repeated (warn)', () => {
      const b = pieBlock('pie\n  "Dogs" : 10\n  "Cats" : 5\n  "Dogs" : 3');
      const warnings = only(b, 'pie-duplicate-label');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warn');
      expect(warnings[0].message).toContain('"Dogs"');
      expect(warnings[0].message).toContain('first on line 2');
      expect(warnings[0].line).toBe(4);
    });

    it('fires for single-quoted labels too', () => {
      const b = pieBlock("pie\n  'Dogs' : 10\n  'Dogs' : 3");
      const warnings = only(b, 'pie-duplicate-label');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toContain('"Dogs"');
    });

    it('returns [] for non-pie diagrams', () => {
      const b = block('flowchart LR\n  A --> B');
      expect(only(b, 'pie-duplicate-label')).toEqual([]);
    });

    it('is suppressed by %% mermaid-lint-disable pie-duplicate-label', () => {
      const b = pieBlock(
        'pie\n  %% mermaid-lint-disable pie-duplicate-label\n  "Dogs" : 10\n  "Dogs" : 3',
      );
      expect(only(b, 'pie-duplicate-label')).toEqual([]);
    });

    it('returns [] when configured off', () => {
      const b = pieBlock('pie\n  "Dogs" : 10\n  "Dogs" : 3');
      const rules: ResolvedRules = {
        ...RULE_DEFAULTS,
        'pie-duplicate-label': 'off',
      };
      expect(only(b, 'pie-duplicate-label', rules)).toEqual([]);
    });
  });

  describe('pie-zero-value rule', () => {
    function pieBlock(body: string): Block {
      return block(body, 'pie');
    }

    it('returns [] when all slices have positive values', () => {
      const b = pieBlock('pie\n  "Dogs" : 10\n  "Cats" : 0.5');
      expect(only(b, 'pie-zero-value')).toEqual([]);
    });

    it('fires for a zero-valued slice (warn)', () => {
      const b = pieBlock('pie\n  "Dogs" : 10\n  "Cats" : 0');
      const warnings = only(b, 'pie-zero-value');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warn');
      expect(warnings[0].message).toContain('"Cats"');
      expect(warnings[0].line).toBe(3);
    });

    it('returns [] when configured off', () => {
      const b = pieBlock('pie\n  "Cats" : 0');
      const rules: ResolvedRules = {
        ...RULE_DEFAULTS,
        'pie-zero-value': 'off',
      };
      expect(only(b, 'pie-zero-value', rules)).toEqual([]);
    });
  });

  describe('pie-no-data rule', () => {
    function pieBlock(body: string): Block {
      return block(body, 'pie');
    }

    it('returns [] when the chart has at least one slice', () => {
      const b = pieBlock('pie title Pets\n  "Dogs" : 10');
      expect(only(b, 'pie-no-data')).toEqual([]);
    });

    it('fires when a pie has no data rows (warn)', () => {
      const b = pieBlock('pie title Empty');
      const warnings = only(b, 'pie-no-data');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warn');
      expect(warnings[0].line).toBe(1);
    });

    it('ignores comment-only bodies as still having no data', () => {
      const b = pieBlock('pie\n  %% nothing here yet');
      expect(only(b, 'pie-no-data')).toHaveLength(1);
    });

    it('does not fire when the only slice has a negative value', () => {
      // A negative value parses in Mermaid, so it still counts as a slice.
      const b = pieBlock('pie\n  "Debt" : -5');
      expect(only(b, 'pie-no-data')).toEqual([]);
    });

    it('returns [] when configured off', () => {
      const b = pieBlock('pie title Empty');
      const rules: ResolvedRules = {
        ...RULE_DEFAULTS,
        'pie-no-data': 'off',
      };
      expect(only(b, 'pie-no-data', rules)).toEqual([]);
    });
  });

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

    it('is suppressed by %% mermaid-lint-disable', () => {
      const b = stateBlock(
        'stateDiagram-v2\n  %% mermaid-lint-disable state-duplicate-transition\n  A --> B\n  A --> B',
      );
      expect(only(b, 'state-duplicate-transition')).toEqual([]);
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

  describe('er-duplicate-attribute rule', () => {
    function erBlock(body: string): Block {
      return block(body, 'erDiagram');
    }

    it('returns [] when every attribute name is unique', () => {
      const b = erBlock(
        'erDiagram\n  CUSTOMER {\n    string name\n    string email\n  }',
      );
      expect(only(b, 'er-duplicate-attribute')).toEqual([]);
    });

    it('fires when an attribute name repeats in one entity (warn)', () => {
      const b = erBlock(
        'erDiagram\n  CUSTOMER {\n    string name\n    int name\n  }',
      );
      const warnings = only(b, 'er-duplicate-attribute');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warn');
      expect(warnings[0].message).toContain('`name`');
      expect(warnings[0].message).toContain('`CUSTOMER`');
      expect(warnings[0].message).toContain('first on line 3');
      expect(warnings[0].line).toBe(4);
    });

    it('does not flag the same attribute name across different entities', () => {
      const b = erBlock(
        'erDiagram\n  CUSTOMER {\n    string id\n  }\n  ORDER {\n    string id\n  }',
      );
      expect(only(b, 'er-duplicate-attribute')).toEqual([]);
    });

    it('handles attributes carrying keys and comments', () => {
      const b = erBlock(
        'erDiagram\n  CUSTOMER {\n    string id PK\n    string id FK "dup"\n  }',
      );
      expect(only(b, 'er-duplicate-attribute')).toHaveLength(1);
    });

    it('does not collide distinct hyphenated attribute names', () => {
      const b = erBlock(
        'erDiagram\n  CUSTOMER {\n    string first-name\n    string first-address\n  }',
      );
      expect(only(b, 'er-duplicate-attribute')).toEqual([]);
    });

    it('reports the full hyphenated name on a real duplicate', () => {
      const b = erBlock(
        'erDiagram\n  CUSTOMER {\n    string first-name\n    int first-name\n  }',
      );
      const warnings = only(b, 'er-duplicate-attribute');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toContain('`first-name`');
    });

    it('returns [] for non-ER diagrams', () => {
      const b = block('flowchart LR\n  A --> B');
      expect(only(b, 'er-duplicate-attribute')).toEqual([]);
    });

    it('is suppressed by %% mermaid-lint-disable', () => {
      const b = erBlock(
        'erDiagram\n  %% mermaid-lint-disable er-duplicate-attribute\n  CUSTOMER {\n    string name\n    int name\n  }',
      );
      expect(only(b, 'er-duplicate-attribute')).toEqual([]);
    });
  });

  describe('er-duplicate-entity rule', () => {
    function erBlock(body: string): Block {
      return block(body, 'erDiagram');
    }

    it('returns [] when each entity block is defined once', () => {
      const b = erBlock(
        'erDiagram\n  CUSTOMER {\n    string name\n  }\n  ORDER {\n    int id\n  }',
      );
      expect(only(b, 'er-duplicate-entity')).toEqual([]);
    });

    it('fires when an entity block is defined twice (warn)', () => {
      const b = erBlock(
        'erDiagram\n  CUSTOMER {\n    string name\n  }\n  CUSTOMER {\n    string email\n  }',
      );
      const warnings = only(b, 'er-duplicate-entity');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warn');
      expect(warnings[0].message).toContain('`CUSTOMER`');
      expect(warnings[0].message).toContain('first on line 2');
      expect(warnings[0].line).toBe(5);
    });

    it('does not flag an entity merely reused across relationships', () => {
      const b = erBlock(
        'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  CUSTOMER ||--o{ INVOICE : receives',
      );
      expect(only(b, 'er-duplicate-entity')).toEqual([]);
    });

    it('returns [] when configured off', () => {
      const b = erBlock(
        'erDiagram\n  CUSTOMER {\n    string name\n  }\n  CUSTOMER {\n    string email\n  }',
      );
      const rules: ResolvedRules = {
        ...RULE_DEFAULTS,
        'er-duplicate-entity': 'off',
      };
      expect(only(b, 'er-duplicate-entity', rules)).toEqual([]);
    });
  });

  describe('er-standalone-entity rule', () => {
    function erBlock(body: string): Block {
      return block(body, 'erDiagram');
    }

    const enabled: ResolvedRules = {
      ...RULE_DEFAULTS,
      'er-standalone-entity': 'warn',
    };

    it('is off by default', () => {
      const b = erBlock('erDiagram\n  CUSTOMER {\n    string name\n  }');
      expect(only(b, 'er-standalone-entity')).toEqual([]);
    });

    it('fires for a blocked entity with no relationship when enabled', () => {
      const b = erBlock(
        'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  AUDIT {\n    string event\n  }',
      );
      const warnings = only(b, 'er-standalone-entity', enabled);
      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toContain('`AUDIT`');
      expect(warnings[0].line).toBe(3);
    });

    it('does not fire when the blocked entity is in a relationship', () => {
      const b = erBlock(
        'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  CUSTOMER {\n    string name\n  }',
      );
      expect(only(b, 'er-standalone-entity', enabled)).toEqual([]);
    });

    it('matches relationship entities through hyphens and cardinalities', () => {
      const b = erBlock(
        'erDiagram\n  ORDER ||--|{ LINE-ITEM : contains\n  LINE-ITEM {\n    int qty\n  }',
      );
      expect(only(b, 'er-standalone-entity', enabled)).toEqual([]);
    });

    it('recognizes the prose-cardinality relationship form', () => {
      const b = erBlock(
        'erDiagram\n  CUSTOMER one to zero or more ORDER : places\n  CUSTOMER {\n    string name\n  }\n  ORDER {\n    int id\n  }',
      );
      expect(only(b, 'er-standalone-entity', enabled)).toEqual([]);
    });
  });

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

  describe('mindmap-duplicate-sibling rule', () => {
    function mindmapBlock(body: string): Block {
      return block(body, 'mindmap');
    }

    it('returns [] when all siblings are unique', () => {
      const b = mindmapBlock('mindmap\n  root((Main))\n    Alpha\n    Beta');
      expect(only(b, 'mindmap-duplicate-sibling')).toEqual([]);
    });

    it('flags two siblings with identical text', () => {
      const b = mindmapBlock(
        'mindmap\n  root((Main))\n    Alpha\n    Beta\n    Alpha',
      );
      const warnings = only(b, 'mindmap-duplicate-sibling');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warn');
      expect(warnings[0].message).toContain('`Alpha`');
      expect(warnings[0].message).toContain('line 3');
      expect(warnings[0].line).toBe(5);
    });

    it('does not flag identical text under different parents', () => {
      const b = mindmapBlock(
        'mindmap\n  root((Main))\n    A\n      Leaf\n    B\n      Leaf',
      );
      expect(only(b, 'mindmap-duplicate-sibling')).toEqual([]);
    });

    it('compares display text, ignoring shape wrapper and leading id', () => {
      const b = mindmapBlock(
        'mindmap\n  root((Main))\n    Alpha\n    id1[Alpha]',
      );
      const warnings = only(b, 'mindmap-duplicate-sibling');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].line).toBe(4);
    });

    it('skips ::icon decorator lines (not treated as nodes)', () => {
      const b = mindmapBlock(
        'mindmap\n  root((Main))\n    Alpha\n    ::icon(fa fa-book)\n    Beta',
      );
      expect(only(b, 'mindmap-duplicate-sibling')).toEqual([]);
    });
  });

  describe('mindmap-no-nodes rule', () => {
    function mindmapBlock(body: string): Block {
      return block(body, 'mindmap');
    }

    it('returns [] when the mindmap has nodes', () => {
      const b = mindmapBlock('mindmap\n  root((Main))\n    Alpha');
      expect(only(b, 'mindmap-no-nodes')).toEqual([]);
    });

    it('flags a mindmap with only the keyword', () => {
      const b = mindmapBlock('mindmap');
      const warnings = only(b, 'mindmap-no-nodes');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warn');
      expect(warnings[0].line).toBe(1);
    });

    it('flags a mindmap whose only content is a comment', () => {
      const b = mindmapBlock('mindmap\n  %% just a note');
      expect(only(b, 'mindmap-no-nodes')).toHaveLength(1);
    });
  });

  describe('mindmap-deep-nesting rule', () => {
    function mindmapBlock(body: string): Block {
      return block(body, 'mindmap');
    }

    const withDeep: ResolvedRules = {
      ...RULE_DEFAULTS,
      'mindmap-deep-nesting': 'warn',
    };

    const deepBody =
      'mindmap\n  root((Main))\n    A\n      B\n        C\n          D\n            E\n              F';

    it('is off by default — a deep tree produces no findings', () => {
      expect(only(mindmapBlock(deepBody), 'mindmap-deep-nesting')).toEqual([]);
    });

    it('returns [] for a shallow tree even when enabled', () => {
      const b = mindmapBlock('mindmap\n  root((Main))\n    A\n      B');
      expect(only(b, 'mindmap-deep-nesting', withDeep)).toEqual([]);
    });

    it('flags nodes nested beyond the threshold when enabled', () => {
      const warnings = only(
        mindmapBlock(deepBody),
        'mindmap-deep-nesting',
        withDeep,
      );
      // root=1, A=2, B=3, C=4, D=5, E=6, F=7 — E and F exceed depth 5.
      expect(warnings).toHaveLength(2);
      expect(warnings[0].line).toBe(7);
      expect(warnings[0].message).toContain('6 levels deep');
      expect(warnings[1].line).toBe(8);
      expect(warnings[1].message).toContain('7 levels deep');
    });
  });

  describe('timeline-empty-section rule', () => {
    function timelineBlock(body: string): Block {
      return block(body, 'timeline');
    }

    it('returns [] when every section has an entry', () => {
      const b = timelineBlock(
        'timeline\n  section A\n    2002 : X\n  section B\n    2004 : Y',
      );
      expect(only(b, 'timeline-empty-section')).toEqual([]);
    });

    it('flags a section with no entries', () => {
      const b = timelineBlock(
        'timeline\n  section A\n    2002 : X\n  section Empty',
      );
      const warnings = only(b, 'timeline-empty-section');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warn');
      expect(warnings[0].message).toContain('`Empty`');
      expect(warnings[0].line).toBe(4);
    });

    it('does not treat a title as a section entry', () => {
      const b = timelineBlock('timeline\n  title History\n  section Empty');
      const warnings = only(b, 'timeline-empty-section');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toContain('`Empty`');
    });
  });

  describe('timeline-empty-event rule', () => {
    function timelineBlock(body: string): Block {
      return block(body, 'timeline');
    }

    it('returns [] for periods with non-empty events', () => {
      const b = timelineBlock(
        'timeline\n  2002 : LinkedIn\n  2004 : Facebook : Google',
      );
      expect(only(b, 'timeline-empty-event')).toEqual([]);
    });

    it('does not flag a bare period with no events', () => {
      const b = timelineBlock('timeline\n  2002\n  2004 : Facebook');
      expect(only(b, 'timeline-empty-event')).toEqual([]);
    });

    it('flags an empty event between two colons', () => {
      const b = timelineBlock('timeline\n  2002 : : Facebook');
      const warnings = only(b, 'timeline-empty-event');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warn');
      expect(warnings[0].line).toBe(2);
    });

    it('flags a trailing empty event', () => {
      const b = timelineBlock('timeline\n  2004 : Twitter :');
      expect(only(b, 'timeline-empty-event')).toHaveLength(1);
    });

    it('does not flag a leading-colon continuation event', () => {
      const b = timelineBlock('timeline\n  2002 : LinkedIn\n       : Facebook');
      expect(only(b, 'timeline-empty-event')).toEqual([]);
    });
  });

  describe('timeline-no-entries rule', () => {
    function timelineBlock(body: string): Block {
      return block(body, 'timeline');
    }

    it('returns [] when the timeline has time periods', () => {
      const b = timelineBlock('timeline\n  2002 : LinkedIn');
      expect(only(b, 'timeline-no-entries')).toEqual([]);
    });

    it('returns [] when the timeline has a section (covered by empty-section)', () => {
      const b = timelineBlock('timeline\n  section A');
      expect(only(b, 'timeline-no-entries')).toEqual([]);
    });

    it('flags a timeline with only a title', () => {
      const b = timelineBlock('timeline\n  title Just a title');
      const warnings = only(b, 'timeline-no-entries');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warn');
      expect(warnings[0].line).toBe(1);
    });
  });
});
