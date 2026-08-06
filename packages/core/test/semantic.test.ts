import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractMermaidBlocks } from '../src/extract.js';
import type { Block } from '../src/extract.js';
import { RULE_DEFAULTS, type ResolvedRules } from '../src/rules.js';
import {
  checkSemantics,
  parseEventModeling,
  parseWardley,
} from '../src/semantic.js';

// A whole-file `.mmd` block, so body lines and file lines coincide: a rule's
// `line` and any line it cites in its message are then the same number, and
// these stay pure rule-logic tests. The body→file mapping that makes the two
// diverge inside a Markdown fence belongs to the adapter, and is covered by
// "line citations in messages" in markdown-adapter.test.ts (#137).
function block(body: string, type = 'flowchart'): Block {
  return { path: 'test.mmd', line: 1, col: 1, body, type };
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

    it('is suppressed by %% mermaid-lint-disable-diagram prefer-flowchart', () => {
      const b = block(
        'graph LR\n  %% mermaid-lint-disable-diagram prefer-flowchart: legacy suppression test\n  A --> B',
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

    it('is suppressed by %% mermaid-lint-disable-diagram require-direction', () => {
      const b = block(
        'flowchart\n  %% mermaid-lint-disable-diagram require-direction: legacy suppression test\n  A --> B',
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

    it('is suppressed by %% mermaid-lint-disable-diagram no-experimental', () => {
      const b = block(
        'sankey-beta\n%% mermaid-lint-disable-diagram no-experimental: legacy suppression test\nA,B,1',
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

    it('flags radar-beta with axes but no curves', () => {
      const b = block('radar-beta\n  axis a, b, c', 'radar-beta');
      const warnings = only(b, 'radar-no-curves');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warn');
      expect(warnings[0].message).toContain('empty grid');
    });

    it('does not flag radar-beta when it has a curve', () => {
      const b = block(
        'radar-beta\n  axis a, b, c\n  curve x{1, 2, 3}',
        'radar-beta',
      );
      expect(only(b, 'radar-no-curves')).toEqual([]);
    });

    it('flags a radar-beta curve with too few values', () => {
      const b = block(
        'radar-beta\n  axis a, b, c\n  curve x{1, 2}',
        'radar-beta',
      );
      const warnings = only(b, 'radar-curve-length-mismatch');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].line).toBe(3);
      expect(warnings[0].message).toContain('2 values');
      expect(warnings[0].message).toContain('3 axes');
    });

    it('flags a radar-beta curve with too many values', () => {
      const b = block(
        'radar-beta\n  axis a, b, c\n  curve x{1, 2, 3, 4}',
        'radar-beta',
      );
      expect(only(b, 'radar-curve-length-mismatch')).toHaveLength(1);
    });

    it('counts radar-beta axes across every axis row', () => {
      // `axis a, b` + `axis c, d` declares four spokes, not two.
      const b = block(
        'radar-beta\n  axis a, b\n  axis c, d\n  curve x{1, 2, 3, 4}',
        'radar-beta',
      );
      expect(only(b, 'radar-curve-length-mismatch')).toEqual([]);
    });

    it('does not flag a keyed radar-beta curve', () => {
      // Mermaid rejects an incomplete `{axis: value}` curve itself
      // ("Missing entry for axis b"), so the rule would double-report.
      const b = block(
        'radar-beta\n  axis a, b, c\n  curve x{a: 1, b: 2, c: 3}',
        'radar-beta',
      );
      expect(only(b, 'radar-curve-length-mismatch')).toEqual([]);
    });

    it('does not flag a radar-beta curve when no axes are declared', () => {
      const b = block('radar-beta\n  curve x{1, 2, 3}', 'radar-beta');
      expect(only(b, 'radar-curve-length-mismatch')).toEqual([]);
    });

    it('flags a radar-beta axis id declared twice', () => {
      const b = block(
        'radar-beta\n  axis a, a, b\n  curve x{1, 2, 3}',
        'radar-beta',
      );
      const warnings = only(b, 'radar-duplicate-axis');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warn');
      expect(warnings[0].message).toContain('"a"');
      // Both spokes sit on the row being reported, so no "first on line N".
      expect(warnings[0].message).not.toContain('first on line');
    });

    it('cites the first sighting when radar-beta axis rows differ', () => {
      const b = block(
        'radar-beta\n  axis a, b\n  axis a, c\n  curve x{1, 2, 3, 4}',
        'radar-beta',
      );
      const warnings = only(b, 'radar-duplicate-axis');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].line).toBe(3);
      expect(warnings[0].message).toContain('first on line 2');
    });

    it('flags two radar-beta axes that render the same label', () => {
      const b = block(
        'radar-beta\n  axis m["Score"], s["Score"]\n  curve x{1, 2}',
        'radar-beta',
      );
      const warnings = only(b, 'radar-duplicate-axis');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toContain('"Score"');
    });

    it('does not flag distinct radar-beta axis labels', () => {
      const b = block(
        'radar-beta\n  axis m["Math"], s["Science"]\n  curve x{1, 2}',
        'radar-beta',
      );
      expect(only(b, 'radar-duplicate-axis')).toEqual([]);
    });

    it('keeps a comma inside a quoted radar-beta axis label intact', () => {
      const b = block(
        'radar-beta\n  axis a["X, Y"], b\n  curve p{1, 2}',
        'radar-beta',
      );
      expect(only(b, 'radar-curve-length-mismatch')).toEqual([]);
      expect(only(b, 'radar-duplicate-axis')).toEqual([]);
    });

    it('does not read a radar-beta title containing "axis" as an axis row', () => {
      const b = block(
        'radar-beta\n  title My axis chart\n  axis a, b\n  curve x{1, 2}',
        'radar-beta',
      );
      expect(only(b, 'radar-curve-length-mismatch')).toEqual([]);
    });

    it('applies radar rules to the `radar-beta:` header form', () => {
      // Radar alone accepts a trailing colon, and detectDiagramType reports
      // the header verbatim — so the type carries it.
      const b = block('radar-beta:\n  axis a, b, c', 'radar-beta:');
      expect(only(b, 'radar-no-curves')).toHaveLength(1);
      expect(only(b, 'no-experimental')).toHaveLength(1);
    });

    it('flags a treemap-beta leaf with a value of 0', () => {
      const b = block(
        'treemap-beta\n"Root"\n  "A": 0\n  "B": 10',
        'treemap-beta',
      );
      const warnings = only(b, 'treemap-zero-value');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warn');
      expect(warnings[0].line).toBe(3);
      expect(warnings[0].message).toContain('"A"');
      expect(warnings[0].message).toContain('zero-area');
    });

    it('flags a treemap-beta value that is zero written as 0.0', () => {
      const b = block('treemap-beta\n"Root"\n  "A": 0.0', 'treemap-beta');
      expect(only(b, 'treemap-zero-value')).toHaveLength(1);
    });

    it('does not flag positive treemap-beta leaf values', () => {
      const b = block(
        'treemap-beta\n"Root"\n  "A": 0.5\n  "B": 10',
        'treemap-beta',
      );
      expect(only(b, 'treemap-zero-value')).toEqual([]);
    });

    it('flags a treemap-beta with sections but no leaf values', () => {
      const b = block('treemap-beta\n"Root"\n  "Branch"', 'treemap-beta');
      const warnings = only(b, 'treemap-no-leaves');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warn');
      expect(warnings[0].line).toBe(1);
      expect(warnings[0].message).toContain('renders empty');
    });

    it('does not flag a treemap-beta that has a leaf value', () => {
      const b = block('treemap-beta\n"Root"\n  "A": 10', 'treemap-beta');
      expect(only(b, 'treemap-no-leaves')).toEqual([]);
    });

    it('counts a zero-valued treemap-beta row as a leaf', () => {
      // `treemap-zero-value` already covers the zero; reporting "no leaves"
      // on top of it would say the diagram has no rows at all, which is false.
      const b = block('treemap-beta\n"Root"\n  "A": 0', 'treemap-beta');
      expect(only(b, 'treemap-no-leaves')).toEqual([]);
    });

    it('flags a treemap-beta row repeated under the same parent', () => {
      const b = block(
        'treemap-beta\n"Root"\n  "A": 5\n  "A": 10',
        'treemap-beta',
      );
      const warnings = only(b, 'treemap-duplicate-sibling');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warn');
      expect(warnings[0].line).toBe(4);
      expect(warnings[0].message).toContain('"A"');
      expect(warnings[0].message).toContain('first on line 3');
    });

    it('does not flag a treemap-beta label reused under a different parent', () => {
      const b = block(
        'treemap-beta\n"Root"\n  "A": 1\n  "S"\n    "A": 2',
        'treemap-beta',
      );
      expect(only(b, 'treemap-duplicate-sibling')).toEqual([]);
    });

    it('flags a treemap-beta section repeated under the same parent', () => {
      const b = block(
        'treemap-beta\n"Root"\n  "S"\n    "A": 1\n  "S"\n    "B": 2',
        'treemap-beta',
      );
      const warnings = only(b, 'treemap-duplicate-sibling');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].line).toBe(5);
    });

    it('flags a treemap-beta row that carries a value and has children', () => {
      const b = block('treemap-beta\n"Root": 99\n  "A": 5', 'treemap-beta');
      const warnings = only(b, 'treemap-branch-with-value');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warn');
      expect(warnings[0].line).toBe(2);
      expect(warnings[0].message).toContain('"Root"');
      expect(warnings[0].message).toContain('leaf');
    });

    it('does not flag a value-less treemap-beta section with children', () => {
      const b = block('treemap-beta\n"Root"\n  "A": 5', 'treemap-beta');
      expect(only(b, 'treemap-branch-with-value')).toEqual([]);
    });

    it('does not flag a treemap-beta leaf followed by a shallower row', () => {
      const b = block(
        'treemap-beta\n"Root"\n  "S"\n    "A": 1\n  "B": 2',
        'treemap-beta',
      );
      expect(only(b, 'treemap-branch-with-value')).toEqual([]);
    });

    it('treats a treemap-beta row under a valued row as its sibling', () => {
      // Mermaid never stacks a valued row, so `"A"` re-parents to `"Root"` and
      // collides with the `"A"` above it rather than nesting under `"Mid"`.
      const b = block(
        'treemap-beta\n"Root"\n  "A": 1\n  "Mid": 2\n    "A": 3',
        'treemap-beta',
      );
      const warnings = only(b, 'treemap-duplicate-sibling');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].line).toBe(5);
      expect(warnings[0].message).toContain('first on line 3');
    });

    it('reads treemap-beta indentation in characters, so a tab is one level', () => {
      // A tab is one column to Mermaid, so `\t"A"` sits at the same depth as
      // ` "S"` and pops it — landing beside the later `"A"` under `"Root"`.
      // Were a tab counted wider, `"A"` would nest inside `"S"` and the two
      // would not be siblings at all.
      const b = block(
        'treemap-beta\n"Root"\n "S"\n\t"A": 1\n "A": 2',
        'treemap-beta',
      );
      const warnings = only(b, 'treemap-duplicate-sibling');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].line).toBe(5);
      expect(warnings[0].message).toContain('first on line 4');
    });

    it('reads a comma-separated treemap-beta value', () => {
      // `"A", 30` is a leaf just as `"A": 30` is; missing the comma form would
      // make every treemap rule blind to the row.
      const b = block(
        'treemap-beta\n"Root"\n  "A", 0\n  "B", 70',
        'treemap-beta',
      );
      expect(only(b, 'treemap-no-leaves')).toEqual([]);
      const warnings = only(b, 'treemap-zero-value');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].line).toBe(3);
    });

    it('reads a treemap-beta leaf whose `:::class` follows its value', () => {
      // A leaf's selector comes after the value — `"A":::big: 5` is a parse
      // error, so only this order has to be understood.
      const b = block('treemap-beta\n"Root"\n  "A": 0:::big', 'treemap-beta');
      expect(only(b, 'treemap-no-leaves')).toEqual([]);
      expect(only(b, 'treemap-zero-value')).toHaveLength(1);
    });

    it('reads the treemap-beta value forms that mean zero', () => {
      // Mermaid drops digit-group commas and then parses, so each of these is
      // a zero-area rectangle even though none is a plain `0`.
      for (const value of ['0.', '0_0', '0,0', '00', '0.0']) {
        const b = block(
          `treemap-beta\n"Root"\n  "A": ${value}`,
          'treemap-beta',
        );
        expect(only(b, 'treemap-zero-value'), value).toHaveLength(1);
      }
    });

    it('does not read a grouped treemap-beta value as zero', () => {
      // `1,000` is 1000, not 1 and not 0 — the comma is a digit group here,
      // not a decimal point.
      const b = block('treemap-beta\n"Root"\n  "A": 1,000', 'treemap-beta');
      expect(only(b, 'treemap-zero-value')).toEqual([]);
      expect(only(b, 'treemap-no-leaves')).toEqual([]);
    });

    it('ignores a trailing `%%` comment on a treemap-beta row', () => {
      const b = block('treemap-beta\n"Root"\n  "A": 0%% note', 'treemap-beta');
      expect(only(b, 'treemap-zero-value')).toHaveLength(1);
    });

    it('accepts single-quoted treemap-beta names', () => {
      const b = block("treemap-beta\n'Root'\n  'A': 0", 'treemap-beta');
      const warnings = only(b, 'treemap-zero-value');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toContain('"A"');
    });

    it('strips a treemap-beta `:::class` selector from the label', () => {
      const b = block(
        'treemap-beta\n"Top"\n  "S":::big\n    "A": 1\n  "S":::big\n    "B": 2',
        'treemap-beta',
      );
      const warnings = only(b, 'treemap-duplicate-sibling');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].line).toBe(5);
      expect(warnings[0].message).toContain('"S"');
    });

    it('ignores treemap-beta comments, titles, and accDescr blocks', () => {
      const b = block(
        'treemap-beta\ntitle My Map\naccDescr {\n  "A": 1\n}\n%% "A": 2\n"Root"\n  "A": 3',
        'treemap-beta',
      );
      expect(only(b, 'treemap-duplicate-sibling')).toEqual([]);
      expect(only(b, 'treemap-zero-value')).toEqual([]);
      expect(only(b, 'treemap-no-leaves')).toEqual([]);
    });

    it('flags sankey-beta with a non-positive link value', () => {
      const b = block('sankey-beta\n  A,B,0\n  B,C,-1', 'sankey-beta');
      const warnings = only(b, 'sankey-non-positive-value');
      expect(warnings).toHaveLength(2);
      expect(warnings[0].severity).toBe('warn');
      expect(warnings[0].message).toContain('non-positive');
    });

    it('does not flag sankey-beta with positive link values', () => {
      const b = block('sankey-beta\n  A,B,1\n  B,C,2', 'sankey-beta');
      expect(only(b, 'sankey-non-positive-value')).toEqual([]);
    });

    it('flags sankey-beta with a self-loop link', () => {
      const b = block('sankey-beta\n  A,A,1', 'sankey-beta');
      const warnings = only(b, 'sankey-self-loop');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warn');
      expect(warnings[0].message).toContain('self-loop');
      expect(warnings[0].message).toContain('`A`');
    });

    it('does not flag sankey-beta without self-loops', () => {
      const b = block('sankey-beta\n  A,B,1', 'sankey-beta');
      expect(only(b, 'sankey-self-loop')).toEqual([]);
    });

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

    it('flags packet-beta with no fields', () => {
      const b = block('packet-beta\n  %% comment', 'packet-beta');
      const warnings = only(b, 'packet-no-fields');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warn');
      expect(warnings[0].message).toContain('no fields');
    });

    it('does not flag packet-beta with a field', () => {
      const b = block('packet-beta\n  0-7: "Source Port"', 'packet-beta');
      expect(only(b, 'packet-no-fields')).toEqual([]);
    });

    it('flags architecture-beta with no elements', () => {
      const b = block('architecture-beta\n  %% comment', 'architecture-beta');
      const warnings = only(b, 'architecture-no-elements');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warn');
      expect(warnings[0].message).toContain('no elements');
    });

    it('does not flag architecture-beta with an element', () => {
      const b = block(
        'architecture-beta\n  service api(server)[API]',
        'architecture-beta',
      );
      expect(only(b, 'architecture-no-elements')).toEqual([]);
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

    it('is suppressed by %% mermaid-lint-disable-diagram no-activate-without-deactivate', () => {
      const b = seqBlock(
        'sequenceDiagram\n  %% mermaid-lint-disable-diagram no-activate-without-deactivate: legacy suppression test\n  activate Bob\n  Alice->>Bob: Hello',
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
      expect(warnings[0].message).toContain('first on line 3');
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

    it('is suppressed by %% mermaid-lint-disable-diagram no-duplicate-methods', () => {
      const b = classBlock(
        'classDiagram\n  %% mermaid-lint-disable-diagram no-duplicate-methods: legacy suppression test\n  class Foo {\n    +bar()\n    +bar()\n  }',
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

  describe('class-duplicate-class rule', () => {
    function classBlock(body: string): Block {
      return block(body, 'classDiagram');
    }

    it('returns [] when class declarations are unique', () => {
      const b = classBlock('classDiagram\n  class User\n  class Account');
      expect(only(b, 'class-duplicate-class')).toEqual([]);
    });

    it('flags duplicate class declarations', () => {
      const b = classBlock('classDiagram\n  class User\n  class User');
      const warnings = only(b, 'class-duplicate-class');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warn');
      expect(warnings[0].message).toContain('`User`');
      expect(warnings[0].message).toContain('line 2');
      expect(warnings[0].line).toBe(3);
    });

    it('does not treat classDef as a class declaration', () => {
      const b = classBlock(
        'classDiagram\n  class User\n  classDef active fill:#fff',
      );
      expect(only(b, 'class-duplicate-class')).toEqual([]);
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

    it('is suppressed by %% mermaid-lint-disable-diagram pie-duplicate-label', () => {
      const b = pieBlock(
        'pie\n  %% mermaid-lint-disable-diagram pie-duplicate-label: legacy suppression test\n  "Dogs" : 10\n  "Dogs" : 3',
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

    it('is suppressed by %% mermaid-lint-disable-diagram er-duplicate-attribute', () => {
      const b = erBlock(
        'erDiagram\n  %% mermaid-lint-disable-diagram er-duplicate-attribute: legacy suppression test\n  CUSTOMER {\n    string name\n    int name\n  }',
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

  describe('journey-empty-section rule', () => {
    function journeyBlock(body: string, type = 'journey'): Block {
      return block(body, type);
    }

    it('returns [] when every section has a task', () => {
      const b = journeyBlock(
        'journey\n  section Work\n    Make tea: 5: Me\n  section Home\n    Rest: 4: Me',
      );
      expect(only(b, 'journey-empty-section')).toEqual([]);
    });

    it('flags a section with no tasks', () => {
      const b = journeyBlock(
        'journey\n  section Work\n    Make tea: 5: Me\n  section Empty',
      );
      const warnings = only(b, 'journey-empty-section');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warn');
      expect(warnings[0].message).toContain('`Empty`');
      expect(warnings[0].line).toBe(4);
    });

    it('does not treat a title as a section task', () => {
      const b = journeyBlock('journey\n  title Day: One\n  section Empty');
      const warnings = only(b, 'journey-empty-section');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toContain('`Empty`');
    });

    it('also applies to userJourney blocks', () => {
      const b = journeyBlock('userJourney\n  section Empty', 'userJourney');
      expect(only(b, 'journey-empty-section')).toHaveLength(1);
    });
  });

  describe('journey-score-out-of-range rule', () => {
    function journeyBlock(body: string): Block {
      return block(body, 'journey');
    }

    it('returns [] when task scores are within 1-5', () => {
      const b = journeyBlock(
        'journey\n  section Work\n    Start: 1: Me\n    Finish: 5: Me',
      );
      expect(only(b, 'journey-score-out-of-range')).toEqual([]);
    });

    it('flags scores below 1 and above 5', () => {
      const b = journeyBlock(
        'journey\n  section Work\n    Too low: 0: Me\n    Too high: 7: Me',
      );
      const warnings = only(b, 'journey-score-out-of-range');
      expect(warnings).toHaveLength(2);
      expect(warnings[0].severity).toBe('warn');
      expect(warnings[0].message).toContain('`Too low`');
      expect(warnings[0].line).toBe(3);
      expect(warnings[1].message).toContain('`Too high`');
      expect(warnings[1].line).toBe(4);
    });

    it('flags negative scores', () => {
      const b = journeyBlock('journey\n  section Work\n    Bad day: -1: Me');
      const warnings = only(b, 'journey-score-out-of-range');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toContain('-1');
    });

    it('returns [] when configured off', () => {
      const b = journeyBlock('journey\n  section Work\n    Too high: 7: Me');
      const rules: ResolvedRules = {
        ...RULE_DEFAULTS,
        'journey-score-out-of-range': 'off',
      };
      expect(only(b, 'journey-score-out-of-range', rules)).toEqual([]);
    });
  });

  describe('journey-task-without-actor rule', () => {
    function journeyBlock(body: string): Block {
      return block(body, 'journey');
    }

    it('returns [] when every task has at least one actor', () => {
      const b = journeyBlock(
        'journey\n  section Work\n    Make tea: 5: Alice\n    Share tea: 4: Alice, Bob',
      );
      expect(only(b, 'journey-task-without-actor')).toEqual([]);
    });

    it('flags a task with no actor field', () => {
      const b = journeyBlock('journey\n  section Work\n    Make tea: 5');
      const warnings = only(b, 'journey-task-without-actor');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warn');
      expect(warnings[0].message).toContain('`Make tea`');
      expect(warnings[0].line).toBe(3);
    });

    it('flags a task with an empty actor field', () => {
      const b = journeyBlock('journey\n  section Work\n    Make tea: 5:');
      expect(only(b, 'journey-task-without-actor')).toHaveLength(1);
    });
  });

  describe('journey-no-tasks rule', () => {
    function journeyBlock(body: string): Block {
      return block(body, 'journey');
    }

    it('returns [] when the journey has at least one task', () => {
      const b = journeyBlock('journey\n  section Work\n    Make tea: 5: Me');
      expect(only(b, 'journey-no-tasks')).toEqual([]);
    });

    it('flags a journey with only the keyword', () => {
      const b = journeyBlock('journey');
      const warnings = only(b, 'journey-no-tasks');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warn');
      expect(warnings[0].line).toBe(1);
    });

    it('flags section-only and comment-only journeys', () => {
      expect(
        only(journeyBlock('journey\n  section Empty'), 'journey-no-tasks'),
      ).toHaveLength(1);
      expect(
        only(journeyBlock('journey\n  %% todo'), 'journey-no-tasks'),
      ).toHaveLength(1);
    });

    it('returns [] when configured off', () => {
      const rules: ResolvedRules = {
        ...RULE_DEFAULTS,
        'journey-no-tasks': 'off',
      };
      expect(only(journeyBlock('journey'), 'journey-no-tasks', rules)).toEqual(
        [],
      );
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
      const b = gitGraphBlock(
        'gitGraph\n  commit id: "A"\n  merge dev id: "A"',
      );
      expect(only(b, 'gitgraph-duplicate-commit-id')).toHaveLength(1);
    });
  });

  describe('gitgraph-duplicate-tag rule', () => {
    function gitGraphBlock(body: string): Block {
      return block(body, 'gitGraph');
    }

    it('returns [] when tags are unique', () => {
      const b = gitGraphBlock(
        'gitGraph\n  commit tag: "v1"\n  commit tag: "v2"',
      );
      expect(only(b, 'gitgraph-duplicate-tag')).toEqual([]);
    });

    it('flags a tag used twice', () => {
      const b = gitGraphBlock(
        'gitGraph\n  commit tag: "v1"\n  commit tag: "v1"',
      );
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

  describe('quadrant-duplicate-point rule', () => {
    function quadrantBlock(body: string): Block {
      return block(body, 'quadrantChart');
    }

    it('returns [] when point labels are unique', () => {
      const b = quadrantBlock(
        'quadrantChart\n  A: [0.3, 0.6]\n  B: [0.5, 0.2]',
      );
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

  describe('C4Context rules', () => {
    function c4Block(body: string): Block {
      return block(body, 'C4Context');
    }

    it('returns [] for a valid C4Context model', () => {
      const b = c4Block(
        'C4Context\n  Person(customer, "Customer")\n  System(banking, "Banking")\n  Rel(customer, banking, "Uses")\n  UpdateElementStyle(customer, $fontColor="green")\n  UpdateRelStyle(customer, banking, $textColor="green")',
      );
      expect(only(b, 'c4-duplicate-id')).toEqual([]);
      expect(only(b, 'c4-undefined-relationship-endpoint')).toEqual([]);
      expect(only(b, 'c4-undefined-element-style')).toEqual([]);
      expect(only(b, 'c4-undefined-relationship-style-endpoint')).toEqual([]);
    });

    it('flags duplicate element and boundary ids', () => {
      const b = c4Block(
        'C4Context\n  Person(customer, "Customer")\n  Enterprise_Boundary(customer, "Enterprise") {\n    System(banking, "Banking")\n  }',
      );
      const warnings = only(b, 'c4-duplicate-id');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warn');
      expect(warnings[0].message).toContain('`customer`');
      expect(warnings[0].message).toContain('line 2');
      expect(warnings[0].line).toBe(3);
    });

    it('tracks nested boundary element ids', () => {
      const b = c4Block(
        'C4Context\n  Enterprise_Boundary(e, "Enterprise") {\n    System(app, "App")\n    System_Boundary(scope, "Scope") {\n      System(app, "Duplicate App")\n    }\n  }',
      );
      expect(only(b, 'c4-duplicate-id')).toHaveLength(1);
    });

    it('flags relationship endpoints that are not declared', () => {
      const b = c4Block(
        'C4Context\n  Person(customer, "Customer")\n  Rel(customer, banking, "Uses")\n  BiRel(visitor, customer, "Talks to")',
      );
      const warnings = only(b, 'c4-undefined-relationship-endpoint');
      expect(warnings).toHaveLength(2);
      expect(warnings[0].message).toContain('`banking`');
      expect(warnings[0].line).toBe(3);
      expect(warnings[1].message).toContain('`visitor`');
      expect(warnings[1].line).toBe(4);
    });

    it('flags UpdateElementStyle targets that are not declared', () => {
      const b = c4Block(
        'C4Context\n  Person(customer, "Customer")\n  UpdateElementStyle(banking, $fontColor="red")',
      );
      const warnings = only(b, 'c4-undefined-element-style');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toContain('`banking`');
      expect(warnings[0].line).toBe(3);
    });

    it('flags UpdateRelStyle endpoints that are not declared', () => {
      const b = c4Block(
        'C4Context\n  Person(customer, "Customer")\n  System(banking, "Banking")\n  UpdateRelStyle(visitor, banking, $textColor="red")\n  UpdateRelStyle(customer, admin, $textColor="red")',
      );
      const warnings = only(b, 'c4-undefined-relationship-style-endpoint');
      expect(warnings).toHaveLength(2);
      expect(warnings[0].message).toContain('`visitor`');
      expect(warnings[0].line).toBe(4);
      expect(warnings[1].message).toContain('`admin`');
      expect(warnings[1].line).toBe(5);
    });

    it('is suppressed by a targeted Mermaid comment', () => {
      const b = c4Block(
        'C4Context\n  %% mermaid-lint-disable-diagram c4-undefined-relationship-endpoint: legacy suppression test\n  Person(customer, "Customer")\n  Rel(customer, banking, "Uses")',
      );
      expect(only(b, 'c4-undefined-relationship-endpoint')).toEqual([]);
    });
  });

  describe('requirement diagram rules', () => {
    function requirementBlock(body: string): Block {
      return block(body, 'requirementDiagram');
    }

    it('keeps a valid requirement diagram clean, including quoted names, class suffixes, and forward references', () => {
      const b = requirementBlock(
        'requirementDiagram\n  "API Gateway" - contains -> login_req\n  requirement login_req:::product {\n    id: REQ-1\n    text: user logs in\n    risk: medium\n    verifymethod: test\n  }\n  element "API Gateway" {\n    type: system\n  }',
      );

      expect(only(b, 'requirement-duplicate-name')).toEqual([]);
      expect(only(b, 'requirement-duplicate-id')).toEqual([]);
      expect(only(b, 'requirement-undefined-reference')).toEqual([]);
    });

    it('flags duplicate requirement and element names, including cross-kind duplicates', () => {
      const b = requirementBlock(
        'requirementDiagram\n  requirement shared_name {\n    id: REQ-1\n    text: first\n    risk: medium\n    verifymethod: test\n  }\n  element shared_name {\n    type: system\n  }\n  requirement "Quoted Name" {\n    id: REQ-2\n    text: second\n    risk: low\n    verifymethod: inspection\n  }\n  element "Quoted Name":::external {\n    type: system\n  }',
      );

      const warnings = only(b, 'requirement-duplicate-name');
      expect(warnings).toHaveLength(2);
      expect(warnings.map((warning) => warning.severity)).toEqual([
        'warn',
        'warn',
      ]);
      expect(warnings[0].message).toContain('shared_name');
      expect(warnings[0].message).toContain('line 2');
      expect(warnings[0].line).toBe(8);
      expect(warnings[1].message).toContain('Quoted Name');
      expect(warnings[1].message).toContain('line 11');
      expect(warnings[1].line).toBe(17);
    });

    it('flags duplicate requirement ids with the first definition line', () => {
      const b = requirementBlock(
        'requirementDiagram\n  requirement first_req {\n    id: REQ-42\n    text: first\n    risk: medium\n    verifymethod: test\n  }\n  requirement second_req {\n    id: REQ-42\n    text: second\n    risk: low\n    verifymethod: inspection\n  }',
      );

      const warnings = only(b, 'requirement-duplicate-id');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warn');
      expect(warnings[0].message).toContain('REQ-42');
      expect(warnings[0].message).toContain('line 3');
      expect(warnings[0].line).toBe(9);
    });

    it('flags undefined relationship endpoints after collecting all names first', () => {
      const b = requirementBlock(
        'requirementDiagram\n  known_element - traces -> missing_requirement\n  missing_source <- satisfies - known_requirement\n  requirement known_requirement {\n    id: REQ-1\n    text: first\n    risk: medium\n    verifymethod: test\n  }\n  element known_element {\n    type: system\n  }',
      );

      const warnings = only(b, 'requirement-undefined-reference');
      expect(warnings).toHaveLength(2);
      expect(warnings[0].severity).toBe('warn');
      expect(warnings[0].message).toContain('missing_requirement');
      expect(warnings[0].line).toBe(2);
      expect(warnings[1].message).toContain('missing_source');
      expect(warnings[1].line).toBe(3);
    });

    it('respects suppression directives and rule-off configuration', () => {
      const suppressed = requirementBlock(
        'requirementDiagram\n  %% mermaid-lint-disable-diagram requirement-duplicate-name: legacy suppression test\n  requirement duplicate_name {\n    id: REQ-1\n    text: first\n    risk: medium\n    verifymethod: test\n  }\n  element duplicate_name {\n    type: system\n  }',
      );
      expect(only(suppressed, 'requirement-duplicate-name')).toEqual([]);

      const b = requirementBlock(
        'requirementDiagram\n  missing_source - traces -> missing_target',
      );
      const rules: ResolvedRules = {
        ...RULE_DEFAULTS,
        'requirement-undefined-reference': 'off',
      };
      expect(only(b, 'requirement-undefined-reference', rules)).toEqual([]);
    });
  });

  describe('architecture-beta rules', () => {
    function architectureBlock(body: string): Block {
      return block(body, 'architecture-beta');
    }

    it('keeps a valid architecture model clean', () => {
      const b = architectureBlock(
        'architecture-beta\n  group api(cloud)[API]\n  service gateway(server)[Gateway] in api\n  service db(database)[Database]\n  gateway:R -- L:db',
      );

      expect(only(b, 'architecture-no-elements')).toEqual([]);
      expect(only(b, 'architecture-no-edges')).toEqual([]);
      expect(only(b, 'architecture-duplicate-edge')).toEqual([]);
    });

    it('flags architecture-beta with no declared elements', () => {
      const b = architectureBlock('architecture-beta');
      const warnings = only(b, 'architecture-no-elements');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warn');
      expect(warnings[0].line).toBe(1);
      expect(warnings[0].message).toContain('no declared elements');
    });

    it('flags architecture-beta with declarations but no edges', () => {
      const b = architectureBlock(
        'architecture-beta\n  service gateway(server)[Gateway]\n  junction hub\n  group api(cloud)[API]',
      );
      const warnings = only(b, 'architecture-no-edges');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warn');
      expect(warnings[0].line).toBe(1);
      expect(warnings[0].message).toContain('no edges');
    });

    it('flags repeated exact architecture edge declarations, including ports', () => {
      const b = architectureBlock(
        'architecture-beta\n  service gateway(server)[Gateway]\n  service db(database)[Database]\n  gateway:R -- L:db\n  gateway:R -- L:db',
      );
      const warnings = only(b, 'architecture-duplicate-edge');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warn');
      expect(warnings[0].line).toBe(5);
      expect(warnings[0].message).toContain('`gateway:R -- L:db`');
      expect(warnings[0].message).toContain('line 4');
    });

    it('treats arrow edges with {group} modifiers as valid edges', () => {
      const b = architectureBlock(
        'architecture-beta\n  group edge(cloud)[Edge]\n  group data(database)[Data]\n  service gateway(server)[Gateway] in edge\n  service db(database)[Database] in data\n  gateway{group}:R --> L:db{group}',
      );
      expect(only(b, 'architecture-no-edges')).toEqual([]);
    });

    it('accepts Mermaid-valid architecture edges with optional whitespace around ids and ports', () => {
      const b = architectureBlock(
        'architecture-beta\n  service gateway(server)[Gateway]\n  service db1(database)[Database 1]\n  service db2(database)[Database 2]\n  service db3(database)[Database 3]\n  gateway :R -- L: db1\n  gateway:R -- L: db2\n  gateway :R -- L:db3',
      );
      expect(only(b, 'architecture-no-edges')).toEqual([]);
      expect(only(b, 'architecture-duplicate-edge')).toEqual([]);
    });

    it('flags repeated exact non-bare architecture edge declarations', () => {
      const b = architectureBlock(
        'architecture-beta\n  group edge(cloud)[Edge]\n  group data(database)[Data]\n  service gateway(server)[Gateway] in edge\n  service db(database)[Database] in data\n  gateway{group}:R --> L:db{group}\n  gateway{group}:R --> L:db{group}',
      );
      const warnings = only(b, 'architecture-duplicate-edge');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].line).toBe(7);
      expect(warnings[0].message).toContain(
        '`gateway{group}:R --> L:db{group}`',
      );
      expect(warnings[0].message).toContain('line 6');
    });

    it('flags duplicate architecture edges when only endpoint whitespace differs', () => {
      const b = architectureBlock(
        'architecture-beta\n  service gateway(server)[Gateway]\n  service db(database)[Database]\n  gateway :R -- L: db\n  gateway:R -- L:db',
      );
      const warnings = only(b, 'architecture-duplicate-edge');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].line).toBe(5);
      expect(warnings[0].message).toContain('`gateway:R -- L:db`');
      expect(warnings[0].message).toContain('line 4');
    });

    it('respects suppression directives and rule-off configuration', () => {
      const suppressed = architectureBlock(
        'architecture-beta\n  %% mermaid-lint-disable-diagram architecture-no-edges: legacy suppression test\n  service gateway(server)[Gateway]',
      );
      expect(only(suppressed, 'architecture-no-edges')).toEqual([]);

      const b = architectureBlock(
        'architecture-beta\n  service gateway(server)[Gateway]\n  service db(database)[Database]\n  gateway:R -- L:db\n  gateway:R -- L:db',
      );
      const rules: ResolvedRules = {
        ...RULE_DEFAULTS,
        'architecture-duplicate-edge': 'off',
      };
      expect(only(b, 'architecture-duplicate-edge', rules)).toEqual([]);
    });
  });

  describe('packet-beta rules', () => {
    function packetBlock(body: string): Block {
      return block(body, 'packet-beta');
    }

    it('keeps a valid packet clean', () => {
      const b = packetBlock(
        'packet-beta\n  0-7: "Source Port"\n  8-15: "Destination Port"\n  16-31: "Sequence Number"',
      );

      expect(only(b, 'packet-no-fields')).toEqual([]);
      expect(only(b, 'packet-empty-labels')).toEqual([]);
    });

    it('flags packet-beta with no field rows', () => {
      const b = packetBlock('packet-beta');
      const warnings = only(b, 'packet-no-fields');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warn');
      expect(warnings[0].line).toBe(1);
      expect(warnings[0].message).toContain('no field rows');
    });

    it('flags empty and whitespace-only field labels', () => {
      const b = packetBlock(
        'packet-beta\n  0-7: ""\n  8-15: "   "\n  16-31: "Sequence Number"',
      );
      const warnings = only(b, 'packet-empty-labels');
      expect(warnings).toHaveLength(2);
      expect(warnings.map((warning) => warning.severity)).toEqual([
        'warn',
        'warn',
      ]);
      expect(warnings[0].message).toContain('0-7');
      expect(warnings[0].line).toBe(2);
      expect(warnings[1].message).toContain('8-15');
      expect(warnings[1].line).toBe(3);
    });

    it('treats +count rows as valid packet fields', () => {
      const b = packetBlock('packet-beta\n  +8: "Flags"');
      expect(only(b, 'packet-no-fields')).toEqual([]);
    });

    it('matches field rows with trailing inline comments', () => {
      const b = packetBlock('packet-beta\n  +8: "" %% reserved bits');
      const warnings = only(b, 'packet-empty-labels');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toContain('+8');
      expect(warnings[0].line).toBe(2);
    });

    it('respects suppression directives and rule-off configuration', () => {
      const suppressed = packetBlock(
        'packet-beta\n  %% mermaid-lint-disable-diagram packet-empty-labels: legacy suppression test\n  0-7: ""',
      );
      expect(only(suppressed, 'packet-empty-labels')).toEqual([]);

      const b = packetBlock('packet-beta');
      const rules: ResolvedRules = {
        ...RULE_DEFAULTS,
        'packet-no-fields': 'off',
      };
      expect(only(b, 'packet-no-fields', rules)).toEqual([]);
    });
  });

  describe('sankey-beta rules', () => {
    function sankeyBlock(body: string): Block {
      return block(body, 'sankey-beta');
    }

    it('keeps a valid sankey diagram clean', () => {
      const b = sankeyBlock('sankey-beta\n  Source,Target,10\n  Target,Sink,5');
      expect(only(b, 'sankey-duplicate-link')).toEqual([]);
      expect(only(b, 'sankey-self-loop')).toEqual([]);
    });

    it('flags repeated source/target rows after trimming endpoint whitespace', () => {
      const b = sankeyBlock(
        'sankey-beta\n  Source , Target,10\n  Source,Target ,5',
      );
      const warnings = only(b, 'sankey-duplicate-link');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warn');
      expect(warnings[0].message).toContain('Source');
      expect(warnings[0].message).toContain('Target');
      expect(warnings[0].line).toBe(3);
    });

    it('flags repeated source/target rows even when the values differ', () => {
      const b = sankeyBlock(
        'sankey-beta\n  Source,Target,10\n  Source,Target,999',
      );
      const warnings = only(b, 'sankey-duplicate-link');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toContain('Source');
      expect(warnings[0].message).toContain('Target');
      expect(warnings[0].line).toBe(3);
    });

    it('flags self-loop rows after trimming endpoint whitespace', () => {
      const b = sankeyBlock('sankey-beta\n  Source , Source,10');
      const warnings = only(b, 'sankey-self-loop');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].severity).toBe('warn');
      expect(warnings[0].message).toContain('Source');
      expect(warnings[0].message).toContain('self-loop');
      expect(warnings[0].line).toBe(2);
    });

    it('respects suppression directives and rule-off configuration', () => {
      const suppressed = sankeyBlock(
        'sankey-beta\n  %% mermaid-lint-disable-diagram sankey-duplicate-link: legacy suppression test\n  A,B,1\n  A,B,2',
      );
      expect(only(suppressed, 'sankey-duplicate-link')).toEqual([]);

      const b = sankeyBlock('sankey-beta\n  A,A,1');
      const rules: ResolvedRules = {
        ...RULE_DEFAULTS,
        'sankey-self-loop': 'off',
      };
      expect(only(b, 'sankey-self-loop', rules)).toEqual([]);
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
      const b = xychartBlock(
        'xychart-beta\n  x-axis 0 --> 10\n  bar [1, 2, 3]',
      );
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
});

// The file's own `block(body, type)` helper (defined above) already covers
// what the brief's illustrative `block()` does — pick the type explicitly
// rather than inferring it via `detectDiagramType`, and reuse `only()` to
// collect a single rule's findings.
describe('header-line anchoring', () => {
  it('anchors prefer-flowchart to the header, not body line 1', () => {
    const b = block('%% a note\ngraph LR\n  A --> B', 'graph');
    expect(only(b, 'prefer-flowchart')[0]?.line).toBe(2);
  });

  it('anchors require-direction to the header after a comment', () => {
    const b = block('%% a note\nflowchart\n  A --> B', 'flowchart');
    expect(only(b, 'require-direction')[0]?.line).toBe(2);
  });

  it('anchors absence rules to the header line', () => {
    const b = block('%% a note\npie', 'pie');
    expect(only(b, 'pie-no-data')[0]?.line).toBe(2);
  });

  it('skips leading blank lines when locating the header', () => {
    const b = block('\n\ngraph LR\n  A --> B', 'graph');
    expect(only(b, 'prefer-flowchart')[0]?.line).toBe(3);
  });

  it('still reports line 1 when the header is on line 1', () => {
    const b = block('graph LR\n  A --> B', 'graph');
    expect(only(b, 'prefer-flowchart')[0]?.line).toBe(1);
  });

  it('anchors the header past YAML frontmatter', () => {
    // Goes through the real extractor (not `block()`, which hardcodes
    // `type` and bypasses `detectDiagramType` entirely) so this fails
    // loudly if frontmatter-skipping type detection regresses.
    const md = [
      '```mermaid',
      '---',
      'title: T',
      '---',
      'graph LR',
      '  A --> B',
      '```',
    ].join('\n');
    const [b] = extractMermaidBlocks('test.md', md);
    expect(b.type).toBe('graph');
    expect(only(b, 'prefer-flowchart')[0]?.line).toBe(4);
  });

  it('reports duplicate-ids in a frontmatter diagram end to end', () => {
    // Regression for https://github.com/jasonworden/mermaid-lint/issues/122 —
    // the type came back as '---', so every rule's `appliesTo` rejected the
    // block and this finding was silently dropped. Goes through the real
    // extractor rather than `block()` because the bug was in type detection.
    const md = [
      '```mermaid',
      '---',
      'title: T',
      '---',
      'flowchart LR',
      '  A[Start] --> B',
      '  A[Begin] --> C',
      '```',
    ].join('\n');
    const [b] = extractMermaidBlocks('test.md', md);
    expect(b.type).toBe('flowchart');
    expect(only(b, 'duplicate-ids')).toHaveLength(1);
  });

  it('reports duplicate-ids identically with and without frontmatter', () => {
    // Both blocks come from the real extractor (not `block()`, which
    // hardcodes `type` and bypasses `detectDiagramType`), so this fails
    // loudly if type detection regresses for either variant.
    const body = 'flowchart LR\n  A[Start] --> B\n  A[Begin] --> C';
    const plainMd = ['```mermaid', body, '```'].join('\n');
    const withFmMd = ['```mermaid', '---', 'title: T', '---', body, '```'].join(
      '\n',
    );
    const [plainBlock] = extractMermaidBlocks('test.md', plainMd);
    const [withFmBlock] = extractMermaidBlocks('test.md', withFmMd);
    expect(plainBlock.type).toBe('flowchart');
    expect(withFmBlock.type).toBe('flowchart');

    const plain = only(plainBlock, 'duplicate-ids');
    const withFm = only(withFmBlock, 'duplicate-ids');
    expect(withFm).toHaveLength(plain.length);
    // `duplicate-ids` line numbers are body-relative (not header-anchored),
    // so the frontmatter block shifts them; normalize both sides to a
    // placeholder and compare only the non-positional content.
    const stripLines = (s: string) => s.replace(/line \d+/g, 'line N');
    expect(stripLines(withFm[0].message)).toBe(stripLines(plain[0].message));
  });

  it('reports duplicate-ids in a frontmatter diagram for a standalone .mmd file', () => {
    // Same regression as the `.md` case above, but through the `.mmd` branch
    // of `extractMermaidBlocks` (no fence — the whole file is the diagram),
    // which `toAbsLine` in markdown-adapter.ts offsets differently than a
    // fenced block. Pinned separately since the two paths could diverge.
    const md = [
      '---',
      'title: T',
      '---',
      'flowchart LR',
      '  A[Start] --> B',
      '  A[Begin] --> C',
    ].join('\n');
    const [b] = extractMermaidBlocks('test.mmd', md);
    expect(b.type).toBe('flowchart');
    const findings = only(b, 'duplicate-ids');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.line).toBe(6);
  });
});

describe('wardley-undefined-component rule', () => {
  it('flags a link endpoint that was never declared', () => {
    const b = block(
      [
        'wardley-beta',
        '  component User [0.9, 0.5]',
        '  component Kettle [0.5, 0.6]',
        '  User -> Ghost',
      ].join('\n'),
      'wardley-beta',
    );
    const warnings = only(b, 'wardley-undefined-component');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('`Ghost`');
    expect(warnings[0].message).toContain('link target');
    expect(warnings[0].line).toBe(4);
  });

  it('flags an undeclared evolve target', () => {
    const b = block(
      [
        'wardley-beta',
        '  component User [0.9, 0.5]',
        '  evolve Ghost 0.8',
      ].join('\n'),
      'wardley-beta',
    );
    const warnings = only(b, 'wardley-undefined-component');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('`Ghost`');
    expect(warnings[0].message).toContain('evolve target');
  });

  it('resolves anchors, pipeline members, and quoted names', () => {
    const b = block(
      [
        'wardley-beta',
        '  anchor Business [0.95, 0.63]',
        '  component "Cup of Tea" [0.9, 0.5]',
        '  component Kettle [0.5, 0.6]',
        '  pipeline Kettle {',
        '    component Electric [0.63]',
        '  }',
        '  Business -> Cup of Tea',
        '  Cup of Tea -> Electric',
        '  Kettle_Electric -> Business',
      ].join('\n'),
      'wardley-beta',
    );
    expect(only(b, 'wardley-undefined-component')).toEqual([]);
  });

  // `populateDb` resolves a link with `resolveNodeId` (exact id, then a label
  // scan) but an `evolve` with the bare `getNode`. A pipeline member's id is
  // `parent_child` and only its label is the bare name, so mermaid drops
  // `evolve Electric` without a diagnostic — confirmed against mermaid 11.15
  // by inspecting the built trends.
  it('flags an evolve naming a pipeline member by its bare name', () => {
    const b = block(
      [
        'wardley-beta',
        '  component Kettle [0.5, 0.6]',
        '  pipeline Kettle {',
        '    component Electric [0.63]',
        '  }',
        '  evolve Electric 0.8',
      ].join('\n'),
      'wardley-beta',
    );
    const warnings = only(b, 'wardley-undefined-component');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('`Electric`');
    expect(warnings[0].message).toContain('evolve target');
    expect(warnings[0].line).toBe(6);
  });

  it('leaves an evolve on a pipeline parent or a synthetic id alone', () => {
    const b = block(
      [
        'wardley-beta',
        '  component Kettle [0.5, 0.6]',
        '  pipeline Kettle {',
        '    component Electric [0.63]',
        '  }',
        '  evolve Kettle 0.8',
        '  evolve Kettle_Electric 0.7',
      ].join('\n'),
      'wardley-beta',
    );
    expect(only(b, 'wardley-undefined-component')).toEqual([]);
  });

  it('leaves a pipeline parent alone, since mermaid already rejects it', () => {
    const b = block(
      [
        'wardley-beta',
        '  component Kettle [0.5, 0.6]',
        '  pipeline Ghost {',
        '    component Electric [0.63]',
        '  }',
      ].join('\n'),
      'wardley-beta',
    );
    expect(only(b, 'wardley-undefined-component')).toEqual([]);
  });

  it('does not read an evolution stage row as a link', () => {
    const b = block(
      [
        'wardley-beta',
        '  component User [0.9, 0.5]',
        '  evolution Genesis -> Custom -> Product -> Commodity',
      ].join('\n'),
      'wardley-beta',
    );
    expect(only(b, 'wardley-undefined-component')).toEqual([]);
  });

  // Mermaid's `LINK_ARROW`/`ARROW` terminals admit exactly these four spellings.
  // `WARDLEY_LINK_SEP_RE` folds `->` and `-->` into one `-{1,2}>` alternative,
  // so both dash counts need a case; `-.->` and bare `>` are separate branches.
  it('splits on every arrow spelling mermaid accepts', () => {
    for (const arrow of ['->', '-->', '-.->', '>']) {
      const b = block(
        [
          'wardley-beta',
          '  component User [0.9, 0.5]',
          `  User ${arrow} Ghost`,
        ].join('\n'),
        'wardley-beta',
      );
      const warnings = only(b, 'wardley-undefined-component');
      expect(warnings, arrow).toHaveLength(1);
      // The target resolved to exactly `Ghost` — no arrow debris clinging to it.
      expect(warnings[0].message, arrow).toContain('`Ghost`');
    }
  });

  // `fromPort` and `arrow` are independently optional in mermaid's grammar,
  // so a source port with no arrow token immediately after it (`A+<> -> B`)
  // is valid. The naive separator match eats only the port, leaving the
  // arrow stuck to the front of the target text.
  it('does not misread a source port as part of the target name', () => {
    const b = block(
      [
        'wardley-beta',
        '  component User [0.9, 0.5]',
        '  component Kettle [0.5, 0.6]',
        '  User+<> -> Kettle',
      ].join('\n'),
      'wardley-beta',
    );
    expect(only(b, 'wardley-undefined-component')).toEqual([]);
  });

  it('still resolves the real target when a source port precedes the arrow', () => {
    const b = block(
      [
        'wardley-beta',
        '  component User [0.9, 0.5]',
        '  User+<> -> Ghost',
      ].join('\n'),
      'wardley-beta',
    );
    const warnings = only(b, 'wardley-undefined-component');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('`Ghost`');
    expect(warnings[0].message).not.toContain('-> Ghost');
  });

  // `SINGLE_LINE_COMMENT` is a hidden terminal that can start anywhere on a
  // line, not just in the opening column — a trailing `%%` after a link or
  // an `evolve` is real mermaid syntax, confirmed against mermaid 11.15.
  it('does not let a trailing %% comment swallow a link target', () => {
    const b = block(
      [
        'wardley-beta',
        '  component User [0.9, 0.5]',
        '  component Kettle [0.5, 0.6]',
        '  User -> Kettle %% main flow',
      ].join('\n'),
      'wardley-beta',
    );
    expect(only(b, 'wardley-undefined-component')).toEqual([]);
  });

  it('still flags an undeclared link target behind a trailing %% comment', () => {
    const b = block(
      [
        'wardley-beta',
        '  component User [0.9, 0.5]',
        '  User -> Ghost %% flow',
      ].join('\n'),
      'wardley-beta',
    );
    const warnings = only(b, 'wardley-undefined-component');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('`Ghost`');
    expect(warnings[0].message).not.toContain('%%');
  });

  it('still flags an undeclared evolve target behind a trailing %% comment', () => {
    const b = block(
      [
        'wardley-beta',
        '  component User [0.9, 0.5]',
        '  evolve Ghost 0.8 %% note',
      ].join('\n'),
      'wardley-beta',
    );
    const warnings = only(b, 'wardley-undefined-component');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('`Ghost`');
    expect(warnings[0].message).toContain('evolve target');
  });

  // `STRING` is `"([^"\\]|\\.)*"`, so a quoted name may hold any structural
  // character. Both maps below parse cleanly in mermaid 11.15; a scan that
  // ignored quote state would report the halves of the name as undefined.
  it('does not read a `>` inside a quoted name as a link separator', () => {
    const b = block(
      [
        'wardley-beta',
        '  component "Tea > Coffee" [0.9, 0.5]',
        '  component Kettle [0.5, 0.6]',
        '  "Tea > Coffee" -> Kettle',
      ].join('\n'),
      'wardley-beta',
    );
    expect(only(b, 'wardley-undefined-component')).toEqual([]);
  });

  it('does not read a `;` inside a quoted name as a link annotation', () => {
    const b = block(
      [
        'wardley-beta',
        '  component "Milk; Sugar" [0.9, 0.5]',
        '  component Kettle [0.5, 0.6]',
        '  "Milk; Sugar" -> Kettle',
      ].join('\n'),
      'wardley-beta',
    );
    expect(only(b, 'wardley-undefined-component')).toEqual([]);
  });

  // `accDescr { ... }`'s brace form is a single lexer token spanning
  // newlines, so an arrow inside it is description text, not a link.
  it('does not read an arrow inside a braced accDescr block as a link', () => {
    const b = block(
      [
        'wardley-beta',
        '  component Kettle [0.5, 0.6]',
        '  accDescr {',
        '    Kettle -> Power',
        '  }',
      ].join('\n'),
      'wardley-beta',
    );
    expect(only(b, 'wardley-undefined-component')).toEqual([]);
  });

  // `ACC_DESCR` separates the keyword from its brace with `\s*`, which spans a
  // newline, so this is the same single token as the form above.
  it('does not read an arrow inside an accDescr whose brace is on the next line', () => {
    const b = block(
      [
        'wardley-beta',
        '  accDescr',
        '  {',
        '    Kettle -> Power',
        '  }',
        '  component Kettle [0.5, 0.6]',
      ].join('\n'),
      'wardley-beta',
    );
    expect(only(b, 'wardley-undefined-component')).toEqual([]);
  });
});

describe('wardley-orphan-component rule', () => {
  const enabled: ResolvedRules = {
    ...RULE_DEFAULTS,
    'wardley-orphan-component': 'warn',
  };

  it('returns [] by default (off)', () => {
    const b = block(
      'wardley-beta\n  component Lonely [0.3, 0.3]',
      'wardley-beta',
    );
    expect(only(b, 'wardley-orphan-component')).toEqual([]);
  });

  it('fires on a component nothing references when enabled (warn)', () => {
    const b = block(
      [
        'wardley-beta',
        '  component User [0.9, 0.5]',
        '  component Lonely [0.3, 0.3]',
        '  component Kettle [0.5, 0.6]',
        '  User -> Kettle',
      ].join('\n'),
      'wardley-beta',
    );
    const warnings = only(b, 'wardley-orphan-component', enabled);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('`Lonely`');
    expect(warnings[0].line).toBe(3);
  });

  it('counts evolve targets and pipeline membership as references', () => {
    const b = block(
      [
        'wardley-beta',
        '  component Evolving [0.9, 0.5]',
        '  component Kettle [0.5, 0.6]',
        '  evolve Evolving 0.8',
        '  pipeline Kettle {',
        '    component Electric [0.63]',
        '  }',
      ].join('\n'),
      'wardley-beta',
    );
    expect(only(b, 'wardley-orphan-component', enabled)).toEqual([]);
  });

  it('does not treat an unlinked anchor as an orphan', () => {
    const b = block(
      [
        'wardley-beta',
        '  anchor Business [0.95, 0.63]',
        '  component Kettle [0.5, 0.6]',
        '  component User [0.9, 0.5]',
        '  User -> Kettle',
      ].join('\n'),
      'wardley-beta',
    );
    expect(only(b, 'wardley-orphan-component', enabled)).toEqual([]);
  });
});

describe('wardley-no-components rule', () => {
  it('flags a map with no components or anchors', () => {
    const b = block('wardley-beta\n  title Empty Map', 'wardley-beta');
    const warnings = only(b, 'wardley-no-components');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].line).toBe(1);
  });

  it('treats an anchor-only map as non-empty', () => {
    const b = block(
      'wardley-beta\n  anchor Business [0.95, 0.63]',
      'wardley-beta',
    );
    expect(only(b, 'wardley-no-components')).toEqual([]);
  });

  it('stays silent on a map that declares a component', () => {
    const b = block(
      'wardley-beta\n  component User [0.9, 0.5]',
      'wardley-beta',
    );
    expect(only(b, 'wardley-no-components')).toEqual([]);
  });

  // Notes, accelerators, and the annotations box are decorations placed on the
  // grid, not nodes — `populateDb` never routes any of them through `addNode`.
  it('still flags a map holding only decorations', () => {
    const b = block(
      [
        'wardley-beta',
        '  note "Some note" [0.4, 0.55]',
        '  accelerator Public cloud [0.62, 0.35]',
        '  annotations [0.1, 0.4]',
      ].join('\n'),
      'wardley-beta',
    );
    const warnings = only(b, 'wardley-no-components');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].line).toBe(1);
  });
});

describe('wardley-mixed-coordinate-scale rule', () => {
  it('flags a map mixing 0-1 decimal and 0-100 percentage coordinates', () => {
    const b = block(
      [
        'wardley-beta',
        '  component Search [0.9, 0.5]',
        '  component Profile [0.8, 0.4]',
        '  component Payments [50.0, 60.0]',
      ].join('\n'),
      'wardley-beta',
    );
    const warnings = only(b, 'wardley-mixed-coordinate-scale');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    // Reports on the minority spelling — the rows likely to be wrong.
    expect(warnings[0].line).toBe(4);
    expect(warnings[0].message).toContain('4 in 0-1 decimal form');
    expect(warnings[0].message).toContain('2 in 0-100 percentage form');
    // The reading is a claim about mermaid, so it is pinned in both
    // directions: a value above 1 is a percentage, one at or below it a
    // fraction. See the decimal-minority case below for the other half.
    expect(warnings[0].message).toContain('`50` here is read as a percentage');
  });

  it('stays silent on a map that uses one notation throughout', () => {
    const decimals = block(
      'wardley-beta\n  component A [0.9, 0.5]\n  component B [0.3, 0.2]',
      'wardley-beta',
    );
    expect(only(decimals, 'wardley-mixed-coordinate-scale')).toEqual([]);

    const percentages = block(
      'wardley-beta\n  component A [90.0, 50.0]\n  component B [30.0, 20.0]',
      'wardley-beta',
    );
    expect(only(percentages, 'wardley-mixed-coordinate-scale')).toEqual([]);
  });

  it('reports the decimal row when percentages are the majority', () => {
    const b = block(
      [
        'wardley-beta',
        '  component A [0.9, 0.5]',
        '  component B [30.0, 20.0]',
        '  component C [40.0, 60.0]',
      ].join('\n'),
      'wardley-beta',
    );
    const warnings = only(b, 'wardley-mixed-coordinate-scale');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].line).toBe(2);
    expect(warnings[0].message).toContain('`0.9` here is read as a fraction');
  });

  // The only case where the selection expression's `<=` decides anything: with
  // the partitions the same size it must pick the percentage one, since 0-1
  // decimals are the canonical notation and the likelier intent.
  it('reports the percentage row on an exact tie', () => {
    const b = block(
      [
        'wardley-beta',
        '  component A [0.9, 0.5]',
        '  component B [50.0, 60.0]',
      ].join('\n'),
      'wardley-beta',
    );
    const warnings = only(b, 'wardley-mixed-coordinate-scale');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].line).toBe(3);
    expect(warnings[0].message).toContain('`50` here is read as a percentage');
  });

  // `annotations` and `annotation` accept a bare integer where every other row
  // demands a decimal, and `populateDb` runs both through `toCoordinates` all
  // the same — so an integer there is a real coordinate and mixes the scale of
  // an otherwise-decimal map.
  it('counts annotation coordinates, including their bare integers', () => {
    const b = block(
      'wardley-beta\n  component A [0.9, 0.5]\n  annotations [1, 4]',
      'wardley-beta',
    );
    const warnings = only(b, 'wardley-mixed-coordinate-scale');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].line).toBe(3);
    expect(warnings[0].message).toContain('3 in 0-1 decimal form');
    expect(warnings[0].message).toContain('`4` here is read as a percentage');
  });

  it('ignores label offsets and canvas size, which are not coordinates', () => {
    const b = block(
      [
        'wardley-beta',
        '  size [800, 600]',
        '  component A [0.9, 0.5] label [10, -20]',
        '  component B [0.3, 0.2]',
      ].join('\n'),
      'wardley-beta',
    );
    expect(only(b, 'wardley-mixed-coordinate-scale')).toEqual([]);
  });
});

describe('wardley-duplicate-component rule', () => {
  it('flags a component name declared twice', () => {
    const b = block(
      [
        'wardley-beta',
        '  component User [0.9, 0.5]',
        '  component Kettle [0.5, 0.6]',
        '  component User [0.3, 0.2]',
      ].join('\n'),
      'wardley-beta',
    );
    const warnings = only(b, 'wardley-duplicate-component');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    // Reported on the later row, naming the first — the earlier row is the one
    // the reader is looking for when they wonder where the node went.
    expect(warnings[0].line).toBe(4);
    expect(warnings[0].message).toContain('`User`');
    expect(warnings[0].message).toContain('first on line 2');
  });

  // Both register through `addNode` under their bare name, so they collide.
  it('flags an anchor and a component sharing a name', () => {
    const b = block(
      [
        'wardley-beta',
        '  anchor Foo [0.95, 0.63]',
        '  component Foo [0.3, 0.2]',
      ].join('\n'),
      'wardley-beta',
    );
    const warnings = only(b, 'wardley-duplicate-component');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].line).toBe(3);
    expect(warnings[0].message).toContain('first on line 2');
  });

  it('reports every repeat after the first, each naming the first line', () => {
    const b = block(
      [
        'wardley-beta',
        '  component A [0.9, 0.5]',
        '  component A [0.5, 0.5]',
        '  component A [0.1, 0.1]',
      ].join('\n'),
      'wardley-beta',
    );
    const warnings = only(b, 'wardley-duplicate-component');
    expect(warnings.map((w) => w.line)).toEqual([3, 4]);
    for (const warning of warnings) {
      expect(warning.message).toContain('first on line 2');
    }
  });

  // A pipeline member's id is synthetic (`Kettle_Electric`), so it is a
  // genuinely different node from a top-level `component Electric`.
  it('does not flag a pipeline member sharing a top-level component name', () => {
    const b = block(
      [
        'wardley-beta',
        '  component Kettle [0.5, 0.6]',
        '  component Electric [0.1, 0.2]',
        '  pipeline Kettle {',
        '    component Electric [0.63]',
        '  }',
      ].join('\n'),
      'wardley-beta',
    );
    expect(only(b, 'wardley-duplicate-component')).toEqual([]);
  });

  it('stays silent when every name is distinct', () => {
    const b = block(
      [
        'wardley-beta',
        '  anchor Business [0.95, 0.63]',
        '  component User [0.9, 0.5]',
        '  component Kettle [0.5, 0.6]',
      ].join('\n'),
      'wardley-beta',
    );
    expect(only(b, 'wardley-duplicate-component')).toEqual([]);
  });
});

describe('parseWardley', () => {
  it('collects the coordinate value from every construct, discarding the annotation index and any trailing label', () => {
    const parsed = parseWardley([
      'wardley-beta',
      '  note "Some note" [0.4, 0.55]',
      '  accelerator Public cloud [0.62, 0.35]',
      '  annotations [1, 4]',
      '  annotation 1, [0.7, 0.8]',
      '  size [800, 600]',
      '  component Widget [0.62, 0.75] label [10, -20]',
    ]);

    expect(parsed.coordinates).toEqual([
      { value: 0.4, line: 2 },
      { value: 0.55, line: 2 },
      { value: 0.62, line: 3 },
      { value: 0.35, line: 3 },
      { value: 1, line: 4 },
      { value: 4, line: 4 },
      { value: 0.7, line: 5 },
      { value: 0.8, line: 5 },
      { value: 0.62, line: 7 },
      { value: 0.75, line: 7 },
    ]);
  });
});

// A whole `eventmodeling` body, as a block the rules will accept. The header is
// always body line 1 here, so a frame declared on the Nth source row reports
// line N and the fixtures read the way they are written.
function em(...body: string[]): Block {
  return block(['eventmodeling', ...body].join('\n'), 'eventmodeling');
}

describe('eventmodeling-undefined-frame rule', () => {
  it('flags a `->>` naming an id no frame declares', () => {
    const b = em('  tf 1 ui Screen', '  tf 2 cmd DoIt ->> 99');
    const findings = only(b, 'eventmodeling-undefined-frame');
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].line).toBe(3);
    expect(findings[0].message).toContain('`99`');
    expect(findings[0].message).toContain('`2`');
    // The renderer drops the relation without a diagnostic — the message says
    // so, and a reword that softened this into "may not render" would be wrong.
    expect(findings[0].message).toContain('never renders');
  });

  it('stays silent when every source is declared', () => {
    const b = em('  tf 1 ui Screen', '  tf 2 cmd DoIt ->> 1');
    expect(only(b, 'eventmodeling-undefined-frame')).toEqual([]);
  });

  it('resolves a source declared by an `rf` frame', () => {
    // `tf` and `rf` declare into one id namespace, so an `rf` frame is a
    // perfectly good `->>` target.
    const b = em('  rf 1 ui Screen', '  tf 2 cmd DoIt ->> 1');
    expect(only(b, 'eventmodeling-undefined-frame')).toEqual([]);
  });

  // Ids are matched as text, not as numbers: a render probe against mermaid
  // 11.15.0 draws zero relation `<path>`s for `tf 0 ui A` / `tf 1 cmd B ->> 00`
  // against one for the same diagram spelled `->> 0`. This is why the parser
  // types `id` as a string — a numeric id would make `00` resolve and the
  // finding below would vanish.
  it('treats `00` as a different id from `0`', () => {
    const b = em('  tf 0 ui Screen', '  tf 1 cmd DoIt ->> 00');
    const findings = only(b, 'eventmodeling-undefined-frame');
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('`00`');
  });

  it('resolves frame id `0` when it is spelled the same way', () => {
    const b = em('  tf 0 ui Screen', '  tf 1 cmd DoIt ->> 0');
    expect(only(b, 'eventmodeling-undefined-frame')).toEqual([]);
  });

  // Mermaid 11.15.0 accepts this body and draws the arrow. Before the comment
  // stripper learned about inline data payloads, the two payloads read as a
  // block comment opening on one line and closing on the next, which swallowed
  // frame 2 and made this rule fire at severity `error` on a valid diagram.
  it('stays silent when payloads spell out block-comment delimiters', () => {
    const b = em('  tf 1 ui A "/*"', '  tf 2 evt B "*/"', '  tf 3 cmd C ->> 2');
    expect(only(b, 'eventmodeling-undefined-frame')).toEqual([]);
  });

  // Mermaid 11.15.0 accepts this body and draws one frame, not two: the `tf 2`
  // is payload text. Frame `2` therefore does not exist, mermaid drops the
  // arrow, and this rule must say so — a phantom frame read out of the payload
  // would satisfy the reference and silence an `error`-severity finding.
  it('flags a source that only a data payload appears to declare', () => {
    const b = em('  tf 1 ui A "tf 2 cmd B"', '  tf 3 cmd C ->> 2');
    const findings = only(b, 'eventmodeling-undefined-frame');
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(3);
    expect(findings[0].message).toContain('`2`');
  });

  it('does not flag a self-reference, which declares its own source', () => {
    const b = em('  tf 1 ui Screen ->> 1');
    expect(only(b, 'eventmodeling-undefined-frame')).toEqual([]);
  });

  // Deliberate, not a defect: a frame head that does not fully parse (`uii` is
  // not an entity type) is dropped by the parser, so a later `->> 1` reads as
  // undefined and this rule fires alongside the genuine syntax error mermaid
  // reports for the same body. That is the same shape as the wardley rules,
  // which likewise report against what parsed. Do not "fix" this by teaching
  // the parser to keep half-read frames — the fix for the diagram is the
  // syntax error, and this finding disappears with it.
  it('also fires when a frame head failed to parse, which is deliberate', () => {
    const b = em('  tf 1 uii Screen', '  tf 2 cmd DoIt ->> 1');
    const findings = only(b, 'eventmodeling-undefined-frame');
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('`1`');
  });
});

describe('eventmodeling-duplicate-frame-id rule', () => {
  it('flags an id declared by two frames, naming the first line', () => {
    const b = em('  tf 1 ui Screen', '  tf 1 ui Other');
    const findings = only(b, 'eventmodeling-duplicate-frame-id');
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    // Reported on the later row, naming the first — same convention as
    // `wardley-duplicate-component`.
    expect(findings[0].line).toBe(3);
    expect(findings[0].message).toContain('`1`');
    expect(findings[0].message).toContain('first on line 2');
  });

  it('flags a `tf` and an `rf` sharing an id', () => {
    const b = em('  tf 1 ui Screen', '  rf 1 evt ItHappened');
    const findings = only(b, 'eventmodeling-duplicate-frame-id');
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(3);
    expect(findings[0].message).toContain('first on line 2');
  });

  it('reports every repeat after the first, each naming the first line', () => {
    const b = em('  tf 1 ui A', '  tf 1 ui B', '  tf 1 ui C');
    const findings = only(b, 'eventmodeling-duplicate-frame-id');
    expect(findings.map((f) => f.line)).toEqual([3, 4]);
    for (const finding of findings) {
      expect(finding.message).toContain('first on line 2');
    }
  });

  // Measured against mermaid 11.15.0: this body renders both boxes and TWO
  // relation `<path>`s. Mermaid neither drops the second declaration nor
  // resolves the `->>` first-wins, so the message must not say it does.
  it('says mermaid renders every duplicate and draws an arrow per match', () => {
    const b = em('  tf 1 ui A', '  tf 1 ui B', '  tf 2 cmd C ->> 1');
    const findings = only(b, 'eventmodeling-duplicate-frame-id');
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('renders them all');
    expect(findings[0].message).toContain('duplicate arrow per matching frame');
  });

  // The false-positive direction of the same defect: only one frame really
  // declares `2` here, and mermaid 11.15.0 accepts the body. A `tf 2` read out
  // of the payload would invent a duplicate on a valid diagram.
  it('does not count a frame statement inside a data payload as a declaration', () => {
    const b = em('  tf 1 ui A "tf 2 cmd B"', '  tf 2 evt C');
    expect(only(b, 'eventmodeling-duplicate-frame-id')).toEqual([]);
  });

  it('stays silent when every frame id is distinct', () => {
    const b = em(
      '  tf 1 ui Screen',
      '  tf 2 cmd DoIt ->> 1',
      '  rf 3 evt ItHappened ->> 2',
    );
    expect(only(b, 'eventmodeling-duplicate-frame-id')).toEqual([]);
  });
});

describe('eventmodeling-invalid-flow rule', () => {
  it('flags an event sourced from a ui frame', () => {
    const b = em('  tf 1 ui Screen', '  tf 2 evt ItHappened ->> 1');
    const findings = only(b, 'eventmodeling-invalid-flow');
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].line).toBe(3);
    expect(findings[0].message).toContain('(evt/event)');
    expect(findings[0].message).toContain('(ui)');
    expect(findings[0].message).toContain(
      'may only be sourced from cmd/command',
    );
    // The validator ships but never runs — the message's whole reason to exist.
    expect(findings[0].message).toContain('never runs it');
  });

  it('stays silent on a diagram that walks every legal flow', () => {
    const b = em(
      '  tf 1 ui Screen',
      '  tf 2 cmd DoIt ->> 1',
      '  tf 3 evt ItHappened ->> 2',
      '  tf 4 rmo Projection ->> 3',
      '  tf 5 pcr Reactor ->> 4',
      '  tf 6 cmd Followup ->> 5',
      '  tf 7 ui Refreshed ->> 4',
    );
    expect(only(b, 'eventmodeling-invalid-flow')).toEqual([]);
  });

  it('reads the long-form type keywords as the same types', () => {
    const b = em(
      '  timeframe 1 ui Screen',
      '  timeframe 2 command DoIt ->> 1',
      '  timeframe 3 event ItHappened ->> 2',
      '  timeframe 4 readmodel Projection ->> 3',
      '  timeframe 5 processor Reactor ->> 4',
    );
    expect(only(b, 'eventmodeling-invalid-flow')).toEqual([]);
  });

  it('flags a self-reference, which is defined but never a legal source', () => {
    const b = em('  tf 1 ui Screen ->> 1');
    expect(only(b, 'eventmodeling-undefined-frame')).toEqual([]);
    const findings = only(b, 'eventmodeling-invalid-flow');
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain(
      'may only be sourced from rmo/readmodel',
    );
  });

  it('does not also fire on a reference already reported as undefined', () => {
    // Nothing declares `99`, so there is no source type to judge — saying
    // "a ui may not be sourced from …" would be inventing one.
    const b = em('  tf 1 evt ItHappened', '  tf 2 ui Screen ->> 99');
    expect(only(b, 'eventmodeling-undefined-frame')).toHaveLength(1);
    expect(only(b, 'eventmodeling-invalid-flow')).toEqual([]);
  });

  // An `rf` frame's `->>` draws no relation at all: a render probe against
  // mermaid 11.15.0 measured zero relation `<path>`s for `rf` where the same
  // body with `tf` drew one. The rule still fires — mermaid registers the flow
  // check for `EmResetFrame` too — so the message may not claim the bad
  // relation renders, because on this diagram it does not.
  it('fires on an `rf` frame without claiming its relation renders', () => {
    const b = em('  tf 1 evt ItHappened', '  rf 2 ui Screen ->> 1');
    const findings = only(b, 'eventmodeling-invalid-flow');
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('(evt/event)');
    expect(findings[0].message).not.toContain('render');
  });

  // The regression guard for first-wins resolution. `1` is declared twice; the
  // first match (`ui`) is a legal source for a `cmd`, the second (`evt`) is
  // not, and mermaid dispatches a relation for BOTH — so the illegal one is
  // genuinely drawn. An implementation that stopped at the first matching
  // frame would report nothing here and this test is the only thing that says
  // so. Do not weaken it to "the first frame wins".
  it('reports an illegal source hidden behind a legal duplicate of the same id', () => {
    const b = em('  tf 1 ui A', '  tf 1 evt B', '  tf 2 cmd C ->> 1');
    const findings = only(b, 'eventmodeling-invalid-flow');
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(4);
    // The `evt` frame is the one named, not the legal `ui` one.
    expect(findings[0].message).toContain('(evt/event)');
    expect(findings[0].message).not.toContain('(ui)');
    // And the message explains why the legal duplicate does not excuse it.
    expect(findings[0].message).toContain('declared more than once');
  });

  it('stays silent when every frame sharing the id is a legal source', () => {
    const b = em('  tf 1 ui A', '  tf 1 pcr B', '  tf 2 cmd C ->> 1');
    expect(only(b, 'eventmodeling-invalid-flow')).toEqual([]);
  });

  it('reports one finding per reference, not one per matching frame', () => {
    // Two illegal matches of the same type: one thing to say, not two.
    const b = em('  tf 1 evt A', '  tf 1 evt B', '  tf 2 ui C ->> 1');
    const findings = only(b, 'eventmodeling-invalid-flow');
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('(evt/event)');
  });

  it('names both illegal types once when the duplicates differ', () => {
    const b = em('  tf 1 ui A', '  tf 1 cmd B', '  tf 2 rmo R ->> 1');
    const findings = only(b, 'eventmodeling-invalid-flow');
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('(ui and cmd/command)');
  });

  it('judges each source of a multi-source frame on its own', () => {
    const b = em(
      '  tf 1 ui Screen',
      '  tf 2 evt ItHappened',
      '  tf 3 cmd DoIt ->> 1 ->> 2',
    );
    const findings = only(b, 'eventmodeling-invalid-flow');
    expect(findings).toHaveLength(1);
    // The `ui` source is legal for a `cmd`; only the `evt` one is reported.
    expect(findings[0].message).toContain('`2`');
    expect(findings[0].message).toContain('(evt/event)');
  });
});

describe('parseEventModeling', () => {
  it('reads a frame head split across lines and a bare `->>` of its own', () => {
    // `EM_WS` is a hidden terminal that swallows newlines, so a statement is
    // not a line: each of these rows is a fragment of one frame.
    const parsed = parseEventModeling(
      [
        'eventmodeling',
        '  tf 1',
        '  ui Screen',
        '  ->> 2',
        '  tf 2 rmo Projection',
      ],
      1,
    );
    expect(parsed.frames).toEqual([
      { id: '1', kind: 'tf', type: 'ui', name: 'Screen', line: 2 },
      { id: '2', kind: 'tf', type: 'rmo', name: 'Projection', line: 5 },
    ]);
    // The reference is anchored to the id's line, not the frame keyword's.
    expect(parsed.references).toEqual([
      { sourceId: '2', line: 4, frameId: '1', frameType: 'ui' },
    ]);
  });

  it('reads repeated arrows as a multi-source frame', () => {
    // The comma- and space-separated spellings are both parse errors, so
    // repeating the arrow is the only way to write multi-source.
    const parsed = parseEventModeling(
      [
        'eventmodeling',
        '  tf 1 rmo Projection',
        '  tf 2 rmo Other',
        '  tf 3 ui Screen ->> 1 ->> 2',
      ],
      1,
    );
    expect(parsed.references).toEqual([
      { sourceId: '1', line: 4, frameId: '3', frameType: 'ui' },
      { sourceId: '2', line: 4, frameId: '3', frameType: 'ui' },
    ]);
  });

  it('strips all three comment forms, including a block spanning lines', () => {
    const parsed = parseEventModeling(
      [
        'eventmodeling',
        '  %% tf 7 ui GhostA',
        '  tf 1 ui Screen // tf 8 ui GhostB',
        '  /* tf 9 evt GhostC',
        '     still inside the comment */ tf 2 cmd DoIt ->> 1',
      ],
      1,
    );
    // None of the three ghosts parsed; the code after the block comment closes
    // on the same line still did.
    expect(parsed.frames.map((f) => f.name)).toEqual(['Screen', 'DoIt']);
    expect(parsed.frames.map((f) => f.line)).toEqual([3, 5]);
    expect(parsed.references).toEqual([
      { sourceId: '1', line: 5, frameId: '2', frameType: 'cmd' },
    ]);
  });

  // The three payload cases below were all measured as ACCEPTED by mermaid
  // 11.15.0. A frame statement may close with an `EM_DATA_INLINE` payload
  // (`/\{(.*)\}|"(.*)"|'(.*)'/`) whose contents are free text, so a comment
  // opener written inside one is payload and not a comment. The earlier
  // reasoning that no eventmodeling free text can carry frame tokens because
  // `note` does not parse was wrong: `note` does not, but inline data does.
  it('does not read a comment opener inside a quoted payload as a comment', () => {
    const parsed = parseEventModeling(
      ['eventmodeling', '  tf 1 ui Screen "a /* b"', '  tf 2 cmd DoIt ->> 99'],
      1,
    );
    // Without the payload skip the `/*` opens a block comment that never
    // closes, and everything below it — frame 2 and its undeclared source —
    // goes silently missing.
    expect(parsed.frames.map((f) => f.id)).toEqual(['1', '2']);
    expect(parsed.references).toEqual([
      { sourceId: '99', line: 3, frameId: '2', frameType: 'cmd' },
    ]);
  });

  it('does not read a comment opener inside a braced payload as a comment', () => {
    const parsed = parseEventModeling(
      ['eventmodeling', '  tf 1 ui A {/*}', '  tf 2 cmd B ->> 99'],
      1,
    );
    expect(parsed.frames.map((f) => f.id)).toEqual(['1', '2']);
    expect(parsed.references.map((r) => r.sourceId)).toEqual(['99']);
  });

  it('does not declare a phantom frame from a statement inside a payload', () => {
    // Payload text is text. `tf 2 cmd B` here names nothing — mermaid accepts
    // this body and draws exactly one frame.
    const parsed = parseEventModeling(
      ['eventmodeling', '  tf 1 ui A "tf 2 cmd B"'],
      1,
    );
    expect(parsed.frames.map((f) => f.id)).toEqual(['1']);
  });

  it('keeps the tokens either side of a payload apart, and on their line', () => {
    // Mermaid accepts this body: the payload closes frame 1 and frame 2 opens
    // on the same line with no whitespace between them. Blanking the payload in
    // place rather than slicing it out is what keeps `A` and `tf` two tokens —
    // a slice would hand the walk `Atf` and lose frame 2 entirely.
    const parsed = parseEventModeling(
      ['eventmodeling', '  tf 1 ui A"x"tf 2 cmd B ->> 1'],
      1,
    );
    expect(parsed.frames.map((f) => f.name)).toEqual(['A', 'B']);
    expect(parsed.references).toEqual([
      { sourceId: '1', line: 2, frameId: '2', frameType: 'cmd' },
    ]);
  });

  it('still strips a real comment that follows a payload on the same line', () => {
    // The skip runs to the payload's closer, not to end of line: a `%%` after
    // it is an ordinary comment and the ghost frame in it must not parse.
    const parsed = parseEventModeling(
      ['eventmodeling', '  tf 1 ui Screen "a" %% tf 9 ui GhostA'],
      1,
    );
    expect(parsed.frames.map((f) => f.name)).toEqual(['Screen']);
  });

  it('normalizes the long keywords and folds `rf` and `tf` onto one namespace', () => {
    const parsed = parseEventModeling(
      [
        'eventmodeling',
        '  timeframe 1 command DoIt',
        '  resetframe 1 event ItHappened ->> 1',
        '  tf 2 readmodel Projection',
        '  tf 3 processor Reactor',
      ],
      1,
    );
    expect(parsed.frames).toEqual([
      { id: '1', kind: 'tf', type: 'cmd', name: 'DoIt', line: 2 },
      { id: '1', kind: 'rf', type: 'evt', name: 'ItHappened', line: 3 },
      { id: '2', kind: 'tf', type: 'rmo', name: 'Projection', line: 4 },
      { id: '3', kind: 'tf', type: 'pcr', name: 'Reactor', line: 5 },
    ]);
    // The `rf` reused `1` rather than opening a namespace of its own.
    expect(parsed.references).toEqual([
      { sourceId: '1', line: 3, frameId: '1', frameType: 'evt' },
    ]);
  });

  it('keeps a qualified entity name whole', () => {
    const parsed = parseEventModeling(
      ['eventmodeling', '  tf 1 ui Screen.Login'],
      1,
    );
    expect(parsed.frames[0].name).toBe('Screen.Login');
  });

  it('keeps frame ids as text, so `0` and `00` are different frames', () => {
    const parsed = parseEventModeling(
      ['eventmodeling', '  tf 0 ui Screen', '  tf 1 cmd DoIt ->> 00'],
      1,
    );
    expect(parsed.frames.map((f) => f.id)).toEqual(['0', '1']);
    expect(parsed.references[0].sourceId).toBe('00');
  });

  it(
    'scans an unterminated payload delimiter in linear time',
    // Only the failing path is slow: the quadratic scan has to run to
    // completion (~18s idle, more on a loaded runner) before the assertion can
    // report it, and a timeout would hide which check failed. Passing costs
    // ~8ms, so this ceiling never applies on a green run.
    { timeout: 60_000 },
    () => {
      // An opener with no closer never lexed as a payload, so every position on
      // the line has to be examined. A draft looked the closer up with
      // `lastIndexOf` at each of them, which is quadratic in line length and
      // paid twice per line — once by the comment stripper, once by the
      // tokenizer. Diagram bodies come from users, so that is a real
      // denial-of-service vector, the same one `parseFileDirectives` was fixed
      // for. Hoisting the lookup to one pass per line puts the two complexity
      // classes ~2100x apart at this size: 8ms against 17,750ms.
      const pathological = `  tf 1 ui A ${'{'.repeat(200_000)}`;

      const start = performance.now();
      const parsed = parseEventModeling(['eventmodeling', pathological], 1);
      const elapsed = performance.now() - start;

      // The delimiters are text, so the frame still reads normally.
      expect(parsed.frames.map((f) => f.name)).toEqual(['A']);
      // ~60x above the real cost and still ~35x below the quadratic scan this
      // guards against. Reaching it under load alone would take a 60x stall on
      // an 8ms operation; the algorithm changing is far likelier.
      expect(elapsed).toBeLessThan(500);
    },
  );

  it('ignores frontmatter above the header line', () => {
    // Mermaid strips frontmatter before its lexer runs, so the `/*` in this
    // title is title text and must not open a block comment over the diagram.
    const parsed = parseEventModeling(
      [
        '---',
        'title: A /* title',
        '---',
        'eventmodeling',
        '  tf 1 ui Screen',
        '  tf 2 cmd DoIt ->> 1',
      ],
      4,
    );
    expect(parsed.frames.map((f) => f.line)).toEqual([5, 6]);
    expect(parsed.references).toEqual([
      { sourceId: '1', line: 6, frameId: '2', frameType: 'cmd' },
    ]);
  });
});

function kb(...body: string[]): Block {
  return block(['kanban', ...body].join('\n'), 'kanban');
}

describe('kanban-duplicate-column rule', () => {
  it('reports every repeat after the first, each naming the first line', () => {
    const b = kb(
      '  Todo',
      '    t1[A]',
      '  Todo',
      '    t2[B]',
      '  Todo',
      '    t3[C]',
    );
    const findings = only(b, 'kanban-duplicate-column');
    // Reported on the later column, naming the first — the convention
    // `wardley-duplicate-component` and `eventmodeling-duplicate-frame-id` set.
    expect(findings.map((f) => f.line)).toEqual([4, 6]);
    for (const finding of findings) {
      expect(finding.severity).toBe('warn');
      expect(finding.message).toContain('`Todo`');
      expect(finding.message).toContain('line 2');
      // The severe consequence, which only column-on-column has.
      expect(finding.message).toContain('renders several times over');
    }
  });

  it('keys on the id, not the label, so distinct ids never collide', () => {
    // `c1[Todo]` and `c2[Todo]` read alike but are two nodes to mermaid, and
    // its cards stay in their own column. Flagging the label here would fire
    // on a board that renders exactly as written.
    const b = kb('  c1[Todo]', '    t1[A]', '  c2[Todo]', '    t2[B]');
    expect(only(b, 'kanban-duplicate-column')).toEqual([]);
  });

  it('flags a column colliding with an earlier card, without the fan-out claim', () => {
    // The rules split the namespace by the *offending* declaration, so this
    // direction is a column's finding even though the holder is a card. There
    // is no card fan-out here — only the shared id collision — so the message
    // must not promise one.
    const b = kb('  Todo', '    x[A]', '  x[Doing]');
    const findings = only(b, 'kanban-duplicate-column');
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(4);
    expect(findings[0].message).toContain('a card on line 3');
    expect(findings[0].message).not.toContain('renders several times over');
    // And it is this rule's alone — the card rule answers only for cards.
    expect(only(b, 'kanban-duplicate-task-id')).toEqual([]);
  });
});

describe('kanban-duplicate-task-id rule', () => {
  it('flags two cards sharing an id in one column', () => {
    const b = kb('  Todo', '    t1[A]', '    t1[B]');
    const findings = only(b, 'kanban-duplicate-task-id');
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].line).toBe(4);
    expect(findings[0].message).toContain('`t1`');
    expect(findings[0].message).toContain('a card on line 3');
  });

  it('flags two cards sharing an id across columns', () => {
    const b = kb('  Todo', '    t1[A]', '  Doing', '    t1[B]');
    const findings = only(b, 'kanban-duplicate-task-id');
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(5);
    expect(findings[0].message).toContain('a card on line 3');
  });

  it('flags a card colliding with a column, since they share one namespace', () => {
    const b = kb('  t1[Todo]', '    t1[A]');
    const findings = only(b, 'kanban-duplicate-task-id');
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(3);
    expect(findings[0].message).toContain('a column on line 2');
  });

  it('splits every collision direction between the two rules, one each', () => {
    // The partition is by offending declaration, not by the pair of kinds, so
    // no direction goes unreported and none is reported twice. This body has
    // all four: card→card (5), card→column (7), column→column (6),
    // column→card (8).
    const b = kb(
      '  Todo', //      2  column Todo
      '    t1[A]', //   3  card   t1
      '    t1[B]', //   4  card   t1  → card→card
      '  Todo', //      5  column Todo → column→column
      '    t1[C]', //   6  card   t1  → card→card
      '    Todo', //    7  card   Todo → card→column
      '  t1[Done]', //  8  column t1  → column→card
    );
    expect(only(b, 'kanban-duplicate-task-id').map((f) => f.line)).toEqual([
      4, 6, 7,
    ]);
    expect(only(b, 'kanban-duplicate-column').map((f) => f.line)).toEqual([
      5, 8,
    ]);
  });

  it('reads a card written without an id as its label', () => {
    const b = kb('  Todo', '    [A]', '    [A]');
    const findings = only(b, 'kanban-duplicate-task-id');
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('`A`');
  });

  it('does not normalize whitespace or trailing comments into a collision', () => {
    // Mermaid's `NODE_ID` swallows both, so `t1 ` and `t1` are two nodes with
    // two DOM ids, and a bare card keeps its `%%` text. Trimming here would
    // report collisions the diagram does not have.
    expect(
      only(kb('  Todo', '    t1[A]', '    t1 [B]'), 'kanban-duplicate-task-id'),
    ).toEqual([]);
    expect(
      only(
        kb('  Todo', '    A card', '    A card %% note'),
        'kanban-duplicate-task-id',
      ),
    ).toEqual([]);
  });

  it('returns [] for a board whose card ids are all distinct', () => {
    const b = kb('  Todo', '    t1[A]', '    t2[B]', '  Doing', '    t3[C]');
    expect(only(b, 'kanban-duplicate-task-id')).toEqual([]);
  });
});

describe('kanban-empty-column rule', () => {
  it('flags an empty column wherever it sits in the board', () => {
    const b = kb(
      '  Todo',
      '    t1[A]',
      '  Doing',
      '  Done',
      '    t2[B]',
      '  Later',
    );
    const findings = only(b, 'kanban-empty-column');
    expect(findings.map((f) => f.line)).toEqual([4, 7]);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].message).toContain('`Doing`');
  });

  it('does not count a decorator, comment, or shape-data line as a card', () => {
    // `::icon(...)` decorates the node above it, an own-line `%%` declares
    // nothing, and the interior of a multi-line `@{ … }` block belongs to the
    // card that opened it. Reading any of them as a card would silence this
    // rule on a genuinely empty column.
    const b = kb(
      '  Todo',
      '    t1[A]@{',
      "      assigned: 'alice'",
      '    }',
      '    ::icon(fa fa-book)',
      '  Doing',
      '    %% nothing here yet',
    );
    const findings = only(b, 'kanban-empty-column');
    expect(findings.map((f) => f.line)).toEqual([7]);
  });

  it('reads a node indented past the column level as a card, however deep', () => {
    // Mermaid's `getSection` compares against the column level alone rather
    // than tracking a stack, so an over-indented node is still a card of the
    // column above — not a nested column, and not a reason to call `Todo`
    // empty.
    const b = kb('  Todo', '        t1[A]');
    expect(only(b, 'kanban-empty-column')).toEqual([]);
  });

  it('returns [] when every column holds a card', () => {
    const b = kb('  Todo', '    t1[A]', '  Doing', '    t2[B]');
    expect(only(b, 'kanban-empty-column')).toEqual([]);
  });
});

describe('kanban id extraction', () => {
  it(
    'reads an unclosed wrapper in linear time (ReDoS regression)',
    // Same shape as the guard in suppress.test.ts, and for the same reason:
    // only the failing path is slow, so a passing run costs ~1ms while a
    // regression has to run to completion before it can be reported. A timeout
    // would hide which check failed.
    { timeout: 60_000 },
    () => {
      // `kanbanWrappedLabel` is reached for every line opening with one of
      // `([){}`, and a line of bare `(` never closes — the failing case. The
      // obvious regex for it, `/^[([){}]+(.*?)[()\]{}]+…$/`, stacks three
      // quantifiers over overlapping character sets and backtracks cubically:
      // 4 000 characters took ~25s standalone and ~74s through the rules.
      // Diagram bodies are user input and `checkSemantics` runs ahead of any
      // parse, so an unparseable body still reaches this.
      //
      // At 20 000 characters the two complexity classes are far enough apart
      // that this asserts a budget orders of magnitude from both rather than
      // measuring a growth rate — the scan is sub-millisecond, the cubic regex
      // would not finish this run.
      const b = kb('  Todo', `    ${'('.repeat(20_000)}x`);

      const start = performance.now();
      const findings = only(b, 'kanban-duplicate-task-id');
      const elapsed = performance.now() - start;

      // The line closes no wrapper, so it declares no node at all.
      expect(findings).toEqual([]);
      expect(only(b, 'kanban-empty-column').map((f) => f.line)).toEqual([2]);
      expect(elapsed).toBeLessThan(500);
    },
  );
});

function tv(...body: string[]): Block {
  return block(['treeView-beta', ...body].join('\n'), 'treeView-beta');
}

describe('treeview-no-nodes rule', () => {
  it('flags a header with nothing under it', () => {
    const findings = only(tv(), 'treeview-no-nodes');
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].line).toBe(1);
    expect(findings[0].message).toContain('renders as an empty tree');
    // The syntax note the rule carries: an author who wrote bare words is one
    // parse error away, not one rule away, so the message says so.
    expect(findings[0].message).toContain('must be quoted');
  });

  it('flags a body that is metadata and comments only', () => {
    // Every one of these can contain a quoted run, and none of them declares a
    // node. Reading `title "Releases"` as a node would silence the rule on a
    // diagram that renders empty.
    const b = tv(
      '  title "Releases"',
      '  accTitle: "Releases"',
      '  accDescr: covers "v1" and "v2"',
      '  %% "not a node"',
      '',
    );
    expect(only(b, 'treeview-no-nodes').map((f) => f.line)).toEqual([1]);
  });

  it('skips an accDescr block, in both its brace forms', () => {
    expect(
      only(
        tv('  accDescr {', '    "v1"', '    "v2"', '  }'),
        'treeview-no-nodes',
      ),
    ).toHaveLength(1);
    expect(
      only(tv('  accDescr', '  {', '    "v1"', '  }'), 'treeview-no-nodes'),
    ).toHaveLength(1);
    // A same-line block closes immediately, so what follows is nodes again.
    expect(
      only(tv('  accDescr { prose }', '  "root"'), 'treeview-no-nodes'),
    ).toEqual([]);
  });

  it('sees a node declared on the header line itself', () => {
    // The grammar takes a `STRING2` straight after the keyword, so
    // `treeView-beta "root"` is a one-node tree, not an empty one. A scan that
    // started below the header would call this diagram empty while mermaid
    // renders a node in it.
    expect(
      only(block('treeView-beta "root"', 'treeView-beta'), 'treeview-no-nodes'),
    ).toEqual([]);
  });

  it('sees a node after an accDescr block closes on the same line', () => {
    // `ACC_DESCR` stops at the first `}` and the rest of the line keeps
    // lexing, so `accDescr { d } "p"` declares `p`. Skipping the whole line
    // would lose it.
    expect(only(tv('  accDescr { d } "p"'), 'treeview-no-nodes')).toEqual([]);
    // Same for the multi-line form's closing line.
    expect(
      only(tv('  accDescr {', '  d', '  } "p"'), 'treeview-no-nodes'),
    ).toEqual([]);
  });

  it('sees a node after a `title` with no space after it', () => {
    // `TITLE` ends with an empty alternative, so `title` only swallows its
    // line when a space or tab follows. `title"p"` is an empty title plus a
    // node `p` — mermaid renders it, so the scan must not skip the line.
    expect(only(tv('  title"p"'), 'treeview-no-nodes')).toEqual([]);
    // With a separator it does swallow the line, quotes and all.
    expect(only(tv('  title "p"'), 'treeview-no-nodes')).toHaveLength(1);
    expect(only(tv('  title\t"p"'), 'treeview-no-nodes')).toHaveLength(1);
    // A bare `title` is an empty title and swallows only itself.
    expect(only(tv('  title', '  "p"'), 'treeview-no-nodes')).toEqual([]);
  });

  it('returns [] once any node is declared', () => {
    expect(only(tv('  "root"'), 'treeview-no-nodes')).toEqual([]);
    // Either quote style is a node, and an empty label still is one.
    expect(only(tv("  'root'"), 'treeview-no-nodes')).toEqual([]);
    expect(only(tv('  ""'), 'treeview-no-nodes')).toEqual([]);
  });

  it('does not apply to other indented diagram types', () => {
    expect(only(block('mindmap', 'mindmap'), 'treeview-no-nodes')).toEqual([]);
  });
});

describe('treeview-duplicate-sibling rule', () => {
  it('reports every repeat after the first, each naming the first line', () => {
    const b = tv('  "root"', '    "same"', '    "same"', '    "same"');
    const findings = only(b, 'treeview-duplicate-sibling');
    // Reported on the later node, naming the first — the convention
    // `mindmap-duplicate-sibling` set.
    expect(findings.map((f) => f.line)).toEqual([4, 5]);
    for (const finding of findings) {
      expect(finding.severity).toBe('warn');
      expect(finding.message).toContain('`same`');
      expect(finding.message).toContain('line 3');
    }
  });

  it('keys on the parent, so the same label under two parents is fine', () => {
    const b = tv('  "r1"', '    "x"', '  "r2"', '    "x"');
    expect(only(b, 'treeview-duplicate-sibling')).toEqual([]);
    // Nor does a child repeating its own parent's label collide.
    expect(only(tv('  "x"', '    "x"'), 'treeview-duplicate-sibling')).toEqual(
      [],
    );
  });

  it('flags duplicated top-level nodes', () => {
    // Everything at the top level shares mermaid's synthetic `/` root, so two
    // of them are siblings just as much as two children are.
    const findings = only(tv('  "r"', '  "r"'), 'treeview-duplicate-sibling');
    expect(findings.map((f) => f.line)).toEqual([3]);
    expect(findings[0].message).toContain('line 2');
  });

  it('treats the two quote styles as one label', () => {
    // Mermaid strips either quote to the same text, so `"a"` and `'a'` render
    // as one repeated branch and must read as one here too.
    expect(
      only(tv('  "a"', "  'a'"), 'treeview-duplicate-sibling'),
    ).toHaveLength(1);
  });

  it('re-parents on an outdent rather than assuming a fixed step', () => {
    // `b` outdents past `a` to a level no ancestor holds, so mermaid pops `a`
    // and lands it beside `x` under `r` — where it does duplicate. Inferring
    // an indent unit instead would put it somewhere mermaid never puts it.
    const b = tv('  "r"', '    "x"', '      "a"', '    "b"', '    "x"');
    const findings = only(b, 'treeview-duplicate-sibling');
    expect(findings.map((f) => f.line)).toEqual([6]);
    expect(findings[0].message).toContain('line 3');
  });

  it('indents a second label on a line from the space before it', () => {
    // Both labels on line 3 land under the synthetic root, not under `root` —
    // `"b"`'s indent is the single space between them, which pops `"a"` and
    // `"root"` both. So it duplicates the *top-level* `"b"`, not a child.
    const findings = only(
      tv('  "b"', '    "a" "b"'),
      'treeview-duplicate-sibling',
    );
    expect(findings.map((f) => f.line)).toEqual([3]);
    expect(findings[0].message).toContain('line 2');
  });

  it('keeps a header-line node on the stack, so its children re-parent right', () => {
    // The header-line node is a real parent. Missing it would drop `"p"` from
    // the stack and land both `"x"` under the synthetic root as siblings —
    // a duplicate mermaid does not have. Its edges here are `/ > p`,
    // `p > x`, `/ > x`: the two `x` sit at different depths.
    const b = block(
      ['treeView-beta "p"', '  "x"', ' "x"'].join('\n'),
      'treeView-beta',
    );
    expect(only(b, 'treeview-duplicate-sibling')).toEqual([]);
  });

  it('keeps an accDescr tail node on the stack too', () => {
    // Same shape, with the parent declared after a closing `}` instead of
    // after the keyword.
    const b = tv('  accDescr { d } "p"', '    "x"', ' "x"');
    expect(only(b, 'treeview-duplicate-sibling')).toEqual([]);
  });

  it('ignores quoted text inside metadata and comments', () => {
    const b = tv(
      '  title "root"',
      '  accDescr: about "root"',
      '  %% "root"',
      '  "root"',
    );
    expect(only(b, 'treeview-duplicate-sibling')).toEqual([]);
  });

  it('returns [] for a tree whose siblings are all distinct', () => {
    const b = tv('  "root"', '    "a"', '    "b"', '      "a"');
    expect(only(b, 'treeview-duplicate-sibling')).toEqual([]);
  });
});

describe('treeView label scanning', () => {
  it(
    'scans a quote-less line in linear time (ReDoS regression)',
    // Same shape and reason as the kanban guard above: only the failing path
    // is slow, so a passing run costs ~1ms while a regression has to run to
    // completion before it can be reported.
    { timeout: 60_000 },
    () => {
      // Writing the indent into `TREEVIEW_LABEL_RE` as a leading `([ \t]*)`
      // re-scans the whole whitespace run at every start position it fails
      // from — quadratic on a line with no quote to anchor it. 80 000 spaces
      // took ~2.8s that way; counting the run backwards from a match is O(n)
      // over the line and does the same 80 000 in under a millisecond.
      // Diagram bodies are user input and `checkSemantics` runs ahead of any
      // parse, so an unparseable body still reaches this.
      const b = tv(' '.repeat(80_000));

      const start = performance.now();
      const findings = only(b, 'treeview-duplicate-sibling');
      const elapsed = performance.now() - start;

      // The line quotes nothing, so it declares no node at all.
      expect(findings).toEqual([]);
      expect(only(b, 'treeview-no-nodes').map((f) => f.line)).toEqual([1]);
      expect(elapsed).toBeLessThan(500);
    },
  );

  it(
    'looks ahead from a bare accDescr in linear time (ReDoS regression)',
    { timeout: 60_000 },
    () => {
      // The bare-`accDescr` branch has to look ahead for the `{` that may open
      // on a later line. Spelled `lines.slice(i + 1).find(…)` it copies the
      // whole remaining body once per bare `accDescr` — measured at ~8s for
      // 128 000 of them, a clean 4x per doubling. Walking an index instead
      // stops at the first non-blank line, which here is the next `accDescr`.
      const b = tv(...Array.from({ length: 60_000 }, () => '  accDescr'));

      const start = performance.now();
      const findings = only(b, 'treeview-no-nodes');
      const elapsed = performance.now() - start;

      // No `{` ever opens, so every line is metadata and nothing is a node.
      expect(findings.map((f) => f.line)).toEqual([1]);
      expect(elapsed).toBeLessThan(500);
    },
  );

  it('counts the indent of every label on a line, cheaply', () => {
    // The backwards count must stay correct where the forward capture was:
    // each label's indent is the run immediately before it, so the second
    // label on a line takes the single separating space.
    const b = tv('  "a" "a"');
    // Both land under the synthetic root — `"a"`'s indent of 1 pops the first
    // — so they are siblings and the second duplicates the first.
    expect(only(b, 'treeview-duplicate-sibling').map((f) => f.line)).toEqual([
      2,
    ]);
  });
});

// https://github.com/jasonworden/mermaid-lint/issues/123. Every case here goes
// through the real extractor rather than `block()`: the rule gates on
// `block.type === '---'`, so hardcoding the type would assert the rule's body
// while assuming away the type detection the rule depends on.
describe('frontmatter-must-be-first rule', () => {
  function fenced(...body: string[]): Block {
    const [b] = extractMermaidBlocks(
      'test.md',
      ['```mermaid', ...body, '```'].join('\n'),
    );
    return b;
  }

  it('returns [] when frontmatter opens the diagram', () => {
    const b = fenced('---', 'title: T', '---', 'flowchart LR', '  A --> B');
    expect(b.type).toBe('flowchart');
    expect(only(b, 'frontmatter-must-be-first')).toEqual([]);
  });

  it('returns [] when the diagram has no frontmatter at all', () => {
    const b = fenced('%% a note', 'flowchart LR', '  A --> B');
    expect(only(b, 'frontmatter-must-be-first')).toEqual([]);
  });

  it('reports a %% comment before the frontmatter', () => {
    const b = fenced(
      '%% a note',
      '---',
      'title: T',
      '---',
      'flowchart LR',
      '  A --> B',
    );
    expect(b.type).toBe('---');
    const findings = only(b, 'frontmatter-must-be-first');
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].line).toBe(2);
    expect(findings[0].message).toContain('`%%` comment');
    expect(findings[0].message).toContain('move the comment');
  });

  it('reports a single blank line before the frontmatter', () => {
    // The issue text says "a non-empty line precedes", but its own repro shows
    // a bare blank line breaks rendering too — so the rule fires on anything.
    const b = fenced('', '---', 'title: T', '---', 'flowchart LR', '  A --> B');
    expect(b.type).toBe('---');
    const findings = only(b, 'frontmatter-must-be-first');
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(2);
    expect(findings[0].message).toContain('a blank line precedes');
  });

  it('anchors to the frontmatter line, not body line 1', () => {
    const b = fenced(
      '',
      '',
      '---',
      'title: T',
      '---',
      'flowchart LR',
      '  A --> B',
    );
    const findings = only(b, 'frontmatter-must-be-first');
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(3);
  });

  it('converges in two passes when a comment and a blank line both precede', () => {
    // The comment remedy wins when both are present, so following it leaves
    // the blank line and the rule fires again with the other remedy. That is
    // deliberate: each message names one concrete edit. Do not collapse this
    // into a single message that claims to fix both — it would be wrong for
    // the far more common single-cause cases.
    const first = fenced(
      '%% a note',
      '',
      '---',
      'title: T',
      '---',
      'flowchart LR',
    );
    const a = only(first, 'frontmatter-must-be-first');
    expect(a).toHaveLength(1);
    expect(a[0].message).toContain('`%%` comment');

    // What the reader is left with after applying that remedy.
    const second = fenced(
      '',
      '---',
      'title: T',
      '---',
      '%% a note',
      'flowchart LR',
    );
    const b = only(second, 'frontmatter-must-be-first');
    expect(b).toHaveLength(1);
    expect(b[0].message).toContain('a blank line precedes');
  });

  it('stays silent on unterminated frontmatter, which the parser already rejects', () => {
    // `locateHeader` leaves an unterminated block alone, so the type is still
    // '---' and `appliesTo` passes — but nothing precedes the `---`, and
    // mermaid already errors with "Diagrams beginning with --- are not valid".
    // Reporting here would say the same thing twice.
    const b = fenced('---', 'title: T', 'flowchart LR', '  A --> B');
    expect(b.type).toBe('---');
    expect(only(b, 'frontmatter-must-be-first')).toEqual([]);
  });

  it('honors an off override', () => {
    const b = fenced('%% a note', '---', 'title: T', '---', 'flowchart LR');
    const rules: ResolvedRules = {
      ...RULE_DEFAULTS,
      'frontmatter-must-be-first': 'off',
    };
    expect(only(b, 'frontmatter-must-be-first', rules)).toEqual([]);
  });

  it('fires the same way on a standalone .mmd file', () => {
    const [b] = extractMermaidBlocks(
      'test.mmd',
      ['%% a note', '---', 'title: T', '---', 'flowchart LR', '  A --> B'].join(
        '\n',
      ),
    );
    expect(b.type).toBe('---');
    const findings = only(b, 'frontmatter-must-be-first');
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(2);
  });
});

describe('line citations in rule messages', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../src/semantic.ts'),
    'utf8',
  );
  const cites = source
    .split('\n')
    .map((text, i) => ({ line: i + 1, text }))
    .filter(({ text }) => /line \$\{/.test(text));

  // A rule counts body lines, but its message is read beside a `file:line`
  // position, so a cited number must be mapped with `ctx.fileLine` first
  // (#137). This scans the source because the rule suite above runs on `.mmd`
  // fixtures, where the two coordinate spaces coincide and a rule that forgot
  // would still pass. Its reach is the established "on line ${...}" phrasing:
  // a rule inventing new wording, or passing `fileLine` the wrong variable,
  // slips past — so a rule that cites a line also wants a fenced-Markdown case
  // in markdown-adapter.test.ts.
  it('maps every cited line number through fileLine', () => {
    const unmapped = cites
      .filter(({ text }) => !/line \$\{fileLine\(/.test(text))
      .map(({ line, text }) => `${line}: ${text.trim()}`);
    expect(unmapped).toEqual([]);
  });

  // Guards the guard. A rename that stopped the pattern matching would leave
  // the check above passing vacuously; so would rephrasing rules out of it one
  // at a time, which is why this is a floor at today's count rather than a
  // loose lower bound. Raise it when you add a citing rule.
  it('still finds every citation it is meant to police', () => {
    expect(cites.length).toBeGreaterThanOrEqual(30);
  });
});
