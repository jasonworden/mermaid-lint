import { describe, expect, it } from 'vitest';
import type { Block } from '../src/extract.js';
import { detectDiagramType } from '../src/type-detect.js';
import { validateBlock, validateWithMermaidJS } from '../src/validate.js';

function makeBlock(body: string): Block {
  return {
    path: 'test.md',
    line: 1,
    col: 1,
    body,
    type: detectDiagramType(body),
  };
}

describe('validateBlock', () => {
  it('accepts a valid flowchart', async () => {
    const result = await validateBlock(makeBlock('flowchart LR\n  A --> B'));
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('accepts a valid sequenceDiagram', async () => {
    const result = await validateBlock(
      makeBlock('sequenceDiagram\n  Alice->>Bob: Hello'),
    );
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('rejects an empty block', async () => {
    const result = await validateBlock(makeBlock(''));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('empty');
    expect(result.warnings).toEqual([]);
  });

  it('rejects the unclosed fence sentinel', async () => {
    const result = await validateBlock(makeBlock('__UNCLOSED_FENCE__'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('unclosed');
    expect(result.warnings).toEqual([]);
  });

  it('rejects invalid mermaid syntax', async () => {
    const result = await validateBlock(
      makeBlock('flowchart LR\n  A -->|broken label B'),
    );
    expect(result.ok).toBe(false);
    expect(result).toHaveProperty('error.message');
    expect(result.warnings).toEqual([]);
  });

  it('returns semantic findings on a valid diagram with conflicting node labels', async () => {
    const result = await validateBlock(
      makeBlock('flowchart LR\n  A[Start] --> B\n  A[Begin] --> C'),
    );
    // A semantic error does not flip parse validity — the diagram still renders.
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].rule).toBe('duplicate-ids');
    expect(result.warnings[0].severity).toBe('error');
  });
});

describe('syntax error position', () => {
  /** The body line mermaid.js blames, or `undefined` when it locates nothing. */
  const lineOf = async (body: string): Promise<number | undefined> => {
    const result = await validateWithMermaidJS(body);
    expect(result.ok).toBe(false);
    return result.ok ? undefined : result.error.line;
  };

  // Every body puts its one defect on line 3, so the expected answer is always
  // 3 and a fixture that stops failing is caught by `lineOf`'s own assertion.
  // Why the position is built from several signals: see `runMermaidValidation`.
  describe('jison grammars', () => {
    const CASES: ReadonlyArray<readonly [string, string]> = [
      ['bad arrow', 'flowchart TD\n  A --> B\n  B -> C'],
      ['stray token', 'flowchart TD\n  A --> B\n  @@@@'],
      ['unclosed bracket', 'flowchart TD\n  A --> B\n  A[Start'],
      ['unclosed label pipe', 'flowchart TD\n  A --> B\n  A -->|lbl B'],
      ['missing colon', 'sequenceDiagram\n  A->>B: hi\n  Alice-->>John Hello'],
      ['bad cardinality', 'erDiagram\n  A ||--o{ B : has\n  C }}}} D'],
      ['bad relation', 'classDiagram\n  A <|-- B\n  C ^^^^ D'],
      ['unclosed brace', 'classDiagram\n  A <|-- B\n  class Z {'],
      ['unrecognized text', 'C4Context\n  Person(a, "A")\n  ???(b)'],
      ['unclosed series', 'xychart-beta\n  title "X"\n  bar [1, 2'],
    ];

    it.each(CASES)('blames the defect line for a %s', async (_kind, body) => {
      expect(await lineOf(body)).toBe(3);
    });
  });

  // These parse via Langium rather than jison and throw plain errors carrying
  // no `hash`, so every one of them used to report no position at all and
  // collapsed onto the block's opening fence.
  describe('langium grammars', () => {
    const CASES: ReadonlyArray<readonly [string, string]> = [
      ['pie', 'pie\n  "A" : 40\n  bogus line here'],
      ['packet-beta', 'packet-beta\n  0-15: "A"\n  bogus'],
      ['gitGraph', 'gitGraph\n  commit\n  brunch foo'],
      [
        'architecture-beta',
        'architecture-beta\n  group a(cloud)[A]\n  service b(x)[B] in',
      ],
      ['treemap-beta', 'treemap-beta\n"A"\n  "B": notanumber'],
    ];

    it.each(CASES)('blames the defect line for %s', async (_type, body) => {
      expect(await lineOf(body)).toBe(3);
    });

    it('reports a column for a langium error', async () => {
      // Langium prints `on line N, column C:`; jison prints no column here.
      const result = await validateWithMermaidJS('pie\n  "A" : 40\n  bogus');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.col).toBe(3);
    });
  });

  // An unterminated block construct — the everyday "forgot `end`" — makes jison
  // fail on the EOF token, whose `loc` sits on the line *after* the body. Left
  // alone that points past the diagram: at the closing fence in Markdown, or at
  // a line that does not exist in a `.mmd` file.
  describe('errors at end of input', () => {
    const CASES: ReadonlyArray<readonly [string, string]> = [
      ['flowchart subgraph', 'flowchart TD\n  A --> B\n  subgraph S'],
      ['sequence loop', 'sequenceDiagram\n  A->>B: hi\n  loop every day'],
      ['sequence alt', 'sequenceDiagram\n  A->>B: hi\n  alt is it'],
    ];

    it.each(CASES)(
      'stays inside the body for an unclosed %s',
      async (_kind, body) => {
        expect(await lineOf(body)).toBe(body.split('\n').length);
      },
    );
  });

  it('reports no position when mermaid locates none', async () => {
    // radar-beta prints a literal `on line ?, column ?`. There is nothing to
    // recover, and inventing one would be worse than the block-level fallback.
    const result = await validateWithMermaidJS(
      'radar-beta\n  axis a, b\n  curve x{1, 2',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('on line ?');
      expect(result.error.line).toBeUndefined();
    }
  });

  it('does not mine a position out of an echoed diagram body', async () => {
    // An unrecognized type makes mermaid quote the whole body back. Any number
    // in there is the user's own text, not a citation.
    const result = await validateWithMermaidJS(
      'notADiagram\n  Parse error on line 9: whatever',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('No diagram type detected');
      expect(result.error.line).toBeUndefined();
    }
  });
});

describe('validateWithMermaidJS', () => {
  it('accepts a valid flowchart', async () => {
    const result = await validateWithMermaidJS('flowchart LR\n  A --> B');
    expect(result.ok).toBe(true);
  });

  it('rejects invalid syntax', async () => {
    const result = await validateWithMermaidJS(
      'flowchart LR\n  A -->|broken label B',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBeTruthy();
  });
});
