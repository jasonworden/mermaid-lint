import { describe, expect, it } from 'vitest';
import { extractEdges } from '../src/edges.js';

/** Split a diagram body string on newlines and pass to extractEdges. */
function edges(body: string) {
  return extractEdges(body.split('\n'));
}

describe('extractEdges', () => {
  // -------------------------------------------------------------------------
  // Basic operators
  // -------------------------------------------------------------------------
  describe('basic operators', () => {
    it('parses --> (arrow)', () => {
      expect(edges('A --> B')).toEqual([{ source: 'A', target: 'B', line: 1 }]);
    });

    it('parses --- (undirected, no spaces)', () => {
      expect(edges('A---B')).toEqual([{ source: 'A', target: 'B', line: 1 }]);
    });

    it('parses --- (undirected, with spaces)', () => {
      expect(edges('A --- B')).toEqual([{ source: 'A', target: 'B', line: 1 }]);
    });

    it('parses -.-> (dotted arrow)', () => {
      expect(edges('A -.-> B')).toEqual([
        { source: 'A', target: 'B', line: 1 },
      ]);
    });

    it('parses ==> (thick arrow)', () => {
      expect(edges('A ==> B')).toEqual([{ source: 'A', target: 'B', line: 1 }]);
    });

    it('parses ~~~ (invisible link)', () => {
      expect(edges('A ~~~ B')).toEqual([{ source: 'A', target: 'B', line: 1 }]);
    });
  });

  // -------------------------------------------------------------------------
  // Edge labels (label ignored, just A→B)
  // -------------------------------------------------------------------------
  describe('edge labels', () => {
    it('parses -- text --> (inline text on dashed)', () => {
      expect(edges('A -- text --> B')).toEqual([
        { source: 'A', target: 'B', line: 1 },
      ]);
    });

    it('parses -->|label| (pipe label)', () => {
      expect(edges('A -->|label| B')).toEqual([
        { source: 'A', target: 'B', line: 1 },
      ]);
    });

    it('parses -. text .-> (inline text on dotted)', () => {
      expect(edges('A -. text .-> B')).toEqual([
        { source: 'A', target: 'B', line: 1 },
      ]);
    });

    it('parses == text ==> (inline text on thick)', () => {
      expect(edges('A == text ==> B')).toEqual([
        { source: 'A', target: 'B', line: 1 },
      ]);
    });

    it('parses ---|label| (undirected pipe label)', () => {
      expect(edges('A ---|label| B')).toEqual([
        { source: 'A', target: 'B', line: 1 },
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Node shapes on endpoints (ids only, label text ignored)
  // -------------------------------------------------------------------------
  describe('node shapes', () => {
    it('parses A[Start] --> B[End]', () => {
      expect(edges('A[Start] --> B[End]')).toEqual([
        { source: 'A', target: 'B', line: 1 },
      ]);
    });

    it('parses A(Round) --> B((Circle))', () => {
      expect(edges('A(Round) --> B((Circle))')).toEqual([
        { source: 'A', target: 'B', line: 1 },
      ]);
    });

    it('parses A{Rhombus} --> B[[Sub]]', () => {
      expect(edges('A{Rhombus} --> B[[Sub]]')).toEqual([
        { source: 'A', target: 'B', line: 1 },
      ]);
    });

    it('parses A([Stadium]) --> B{{Hexagon}}', () => {
      expect(edges('A([Stadium]) --> B{{Hexagon}}')).toEqual([
        { source: 'A', target: 'B', line: 1 },
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Chains (consecutive pairs, &-groups)
  // -------------------------------------------------------------------------
  describe('chains and groups', () => {
    it('A --> B --> C produces A→B and B→C', () => {
      expect(edges('A --> B --> C')).toEqual([
        { source: 'A', target: 'B', line: 1 },
        { source: 'B', target: 'C', line: 1 },
      ]);
    });

    it('A --> B & C produces A→B and A→C', () => {
      expect(edges('A --> B & C')).toEqual([
        { source: 'A', target: 'B', line: 1 },
        { source: 'A', target: 'C', line: 1 },
      ]);
    });

    it('A & B --> C produces A→C and B→C', () => {
      expect(edges('A & B --> C')).toEqual([
        { source: 'A', target: 'C', line: 1 },
        { source: 'B', target: 'C', line: 1 },
      ]);
    });

    it('A & B --> C & D produces cartesian product (A→C, A→D, B→C, B→D)', () => {
      expect(edges('A & B --> C & D')).toEqual([
        { source: 'A', target: 'C', line: 1 },
        { source: 'A', target: 'D', line: 1 },
        { source: 'B', target: 'C', line: 1 },
        { source: 'B', target: 'D', line: 1 },
      ]);
    });

    it('A & B --> C --> D produces A→C, B→C, C→D', () => {
      expect(edges('A & B --> C --> D')).toEqual([
        { source: 'A', target: 'C', line: 1 },
        { source: 'B', target: 'C', line: 1 },
        { source: 'C', target: 'D', line: 1 },
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Traps: false edges must NOT be produced
  // -------------------------------------------------------------------------
  describe('traps — no false edges', () => {
    it('A["a --> b"] --> B produces exactly one edge A→B (quoted label not parsed as operator)', () => {
      expect(edges('A["a --> b"] --> B')).toEqual([
        { source: 'A', target: 'B', line: 1 },
      ]);
    });

    it('A["pipe|inside"] --> B produces one edge A→B (pipe in brackets not a pipe label)', () => {
      expect(edges('A["pipe|inside"] --> B')).toEqual([
        { source: 'A', target: 'B', line: 1 },
      ]);
    });

    it('A[Label] --> B[Other] produces one edge A→B', () => {
      expect(edges('A[Label] --> B[Other]')).toEqual([
        { source: 'A', target: 'B', line: 1 },
      ]);
    });

    it('standalone node declaration A[Start] produces no edges', () => {
      expect(edges('A[Start]')).toEqual([]);
    });

    it('bare id B produces no edges', () => {
      expect(edges('B')).toEqual([]);
    });

    it('flowchart LR (header line) produces no edges', () => {
      expect(edges('flowchart LR')).toEqual([]);
    });

    it('subgraph foo produces no edges', () => {
      expect(edges('subgraph foo')).toEqual([]);
    });

    it('end produces no edges', () => {
      expect(edges('end')).toEqual([]);
    });

    it('direction TB produces no edges', () => {
      expect(edges('direction TB')).toEqual([]);
    });

    it('%% comment line is skipped entirely (even containing -->)', () => {
      expect(edges('%% A --> B')).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Hyphenated / special-char inline labels (regression: labels with - or =)
  // -------------------------------------------------------------------------
  describe('hyphenated and special-char inline labels', () => {
    it('-- start-to-end --> yields A→B (hyphen in dash-inline label)', () => {
      expect(edges('A -- start-to-end --> B')).toEqual([
        { source: 'A', target: 'B', line: 1 },
      ]);
    });

    it('-- yes-or-no --> yields A→B', () => {
      expect(edges('A -- yes-or-no --> B')).toEqual([
        { source: 'A', target: 'B', line: 1 },
      ]);
    });

    it('-- some-text --- yields A→B (hyphen in undirected dash-inline label)', () => {
      expect(edges('A -- some-text --- B')).toEqual([
        { source: 'A', target: 'B', line: 1 },
      ]);
    });

    it('== a=b ==> yields A→B (= in thick-inline label)', () => {
      expect(edges('A == a=b ==> B')).toEqual([
        { source: 'A', target: 'B', line: 1 },
      ]);
    });

    it('-. a-b .-> yields A→B (hyphen in dotted-inline label)', () => {
      expect(edges('A -. a-b .-> B')).toEqual([
        { source: 'A', target: 'B', line: 1 },
      ]);
    });

    it('two-inline-label chain A -- x --> B -- y --> C yields A→B and B→C', () => {
      expect(edges('A -- x --> B -- y --> C')).toEqual([
        { source: 'A', target: 'B', line: 1 },
        { source: 'B', target: 'C', line: 1 },
      ]);
    });

    it('two-hyphen-label chain A -- x-y --> B -- p-q --> C yields A→B and B→C', () => {
      expect(edges('A -- x-y --> B -- p-q --> C')).toEqual([
        { source: 'A', target: 'B', line: 1 },
        { source: 'B', target: 'C', line: 1 },
      ]);
    });

    it('A == B (bare two-char ==) produces no edge (not a valid Mermaid link)', () => {
      expect(edges('A == B')).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Multi-line and line numbers
  // -------------------------------------------------------------------------
  describe('multi-line and line numbers', () => {
    it('assigns correct 1-indexed line numbers across body lines', () => {
      const body = 'flowchart LR\n  A --> B\n  B --> C';
      expect(edges(body)).toEqual([
        { source: 'A', target: 'B', line: 2 },
        { source: 'B', target: 'C', line: 3 },
      ]);
    });

    it('all edges in a chain on one line share that line number', () => {
      const body = 'flowchart LR\n  A --> B --> C';
      expect(edges(body)).toEqual([
        { source: 'A', target: 'B', line: 2 },
        { source: 'B', target: 'C', line: 2 },
      ]);
    });

    it('skips %% comment lines and still numbers subsequent lines correctly', () => {
      const body = 'flowchart LR\n%% A --> B\n  A --> B';
      expect(edges(body)).toEqual([{ source: 'A', target: 'B', line: 3 }]);
    });
  });
});
