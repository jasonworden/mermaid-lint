import { describe, expect, it } from 'vitest';
import type { Block } from '../src/extract.js';
import { checkSemantics } from '../src/semantic.js';

function block(body: string, type = 'flowchart'): Block {
  return { path: 'test.md', line: 1, col: 1, body, type };
}

describe('checkSemantics', () => {
  describe('duplicate-id rule', () => {
    it('returns [] for flowchart with no conflicts', () => {
      const b = block('flowchart LR\n  A[Start] --> B[End]');
      expect(checkSemantics(b)).toEqual([]);
    });

    it('returns [] when same ID declared twice with identical label', () => {
      const b = block('flowchart LR\n  A[Same] --> B\n  A[Same] --> C');
      expect(checkSemantics(b)).toEqual([]);
    });

    it('returns one warning when same ID has conflicting labels', () => {
      const b = block('flowchart LR\n  A[Start] --> B\n  A[Begin] --> C');
      const warnings = checkSemantics(b);
      expect(warnings).toHaveLength(1);
      expect(warnings[0].rule).toBe('duplicate-ids');
      expect(warnings[0].message).toContain('"A"');
      expect(warnings[0].message).toContain('Start');
      expect(warnings[0].message).toContain('Begin');
      expect(warnings[0].line).toBe(3);
    });

    it('returns one warning per conflict when multiple IDs conflict', () => {
      const b = block(
        'flowchart LR\n  A[First] --> B[Good]\n  A[Second] --> C\n  B[Bad] --> D',
      );
      const warnings = checkSemantics(b);
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
      const warnings = checkSemantics(b);
      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toContain('"A"');
    });

    it('also runs for graph type', () => {
      const b = block('graph LR\n  A[First] --> B\n  A[Second] --> C', 'graph');
      expect(checkSemantics(b)).toHaveLength(1);
    });

    it('returns [] for sequenceDiagram (not checked)', () => {
      const b = block('sequenceDiagram\n  Alice->>Bob: Hi', 'sequenceDiagram');
      expect(checkSemantics(b)).toEqual([]);
    });

    it('returns [] when %% mermaid-lint-disable is present', () => {
      const b = block(
        'flowchart LR\n  %% mermaid-lint-disable\n  A[Start] --> B\n  A[Begin] --> C',
      );
      expect(checkSemantics(b)).toEqual([]);
    });

    it('returns [] when %% mermaid-lint-disable duplicate-ids is present', () => {
      const b = block(
        'flowchart LR\n  %% mermaid-lint-disable duplicate-ids\n  A[Start] --> B\n  A[Begin] --> C',
      );
      expect(checkSemantics(b)).toEqual([]);
    });

    it('detects rectangle [label]', () => {
      const b = block('flowchart LR\n  N[Alpha] --> X\n  N[Beta] --> Y');
      expect(checkSemantics(b)).toHaveLength(1);
    });

    it('detects rounded (label)', () => {
      const b = block('flowchart LR\n  N(Alpha) --> X\n  N(Beta) --> Y');
      expect(checkSemantics(b)).toHaveLength(1);
    });

    it('detects rhombus {label}', () => {
      const b = block('flowchart LR\n  N{Alpha} --> X\n  N{Beta} --> Y');
      expect(checkSemantics(b)).toHaveLength(1);
    });

    it('detects circle ((label))', () => {
      const b = block('flowchart LR\n  N((Alpha)) --> X\n  N((Beta)) --> Y');
      expect(checkSemantics(b)).toHaveLength(1);
    });

    it('detects subroutine [[label]]', () => {
      const b = block('flowchart LR\n  N[[Alpha]] --> X\n  N[[Beta]] --> Y');
      expect(checkSemantics(b)).toHaveLength(1);
    });

    it('detects stadium ([label])', () => {
      const b = block('flowchart LR\n  N([Alpha]) --> X\n  N([Beta]) --> Y');
      expect(checkSemantics(b)).toHaveLength(1);
    });

    it('detects hexagon {{label}}', () => {
      const b = block('flowchart LR\n  N{{Alpha}} --> X\n  N{{Beta}} --> Y');
      expect(checkSemantics(b)).toHaveLength(1);
    });

    it('skips %% comment lines in the body', () => {
      const b = block(
        'flowchart LR\n  A[Start]\n  %% N[Fake] is a comment\n  N[Real] --> A',
      );
      expect(checkSemantics(b)).toEqual([]);
    });
  });
});
