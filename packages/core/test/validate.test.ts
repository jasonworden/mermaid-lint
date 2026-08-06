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

  // Most jison errors name a token that sits on one line, so `loc.first_line`
  // and `loc.last_line` agree. These are the cases where they diverge, and the
  // two ends stop meaning the same thing — see `jisonPosition`.
  describe('tokens that span a newline', () => {
    // The offending character sits on line 3; `first_line` is line 2, where the
    // whitespace run leading up to it began.
    const WITH_TOKEN: ReadonlyArray<readonly [string, string]> = [
      ['erDiagram', 'erDiagram\n  A ||--o{ B : has\n  @@@@'],
      [
        'erDiagram with another stray token',
        'erDiagram\n  A ||--o{ B : has\n  ####',
      ],
      ['timeline', 'timeline\n  2024 : a\n  ::: bad'],
      ['timeline after a title', 'timeline\n  title T\n  ::: bad'],
      ['journey', 'journey\n  section S\n  ::::'],
    ];

    it.each(WITH_TOKEN)(
      'blames the line the token sits on for %s',
      async (_type, body) => {
        expect(await lineOf(body)).toBe(3);
      },
    );

    it.each(WITH_TOKEN)(
      'agrees with the line mermaid cites for %s',
      async (_type, body) => {
        // A diagnostic printed as `file:2:1: Parse error on line 3` contradicts
        // itself in public. Both numbers are body-relative here, so they must be
        // the same number.
        const result = await validateWithMermaidJS(body);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        const cited = /on line (\d+)/.exec(result.error.message);
        expect(cited).not.toBeNull();
        expect(Number(cited?.[1])).toBe(result.error.line);
      },
    );

    // The other half of the divergence: with no token in `hash.text` the lexer
    // ran off the end of an unterminated construct and swallowed every line
    // below it, so `last_line` is where scanning gave up, not where the defect
    // is. `first_line` opens the construct, and stays the answer.
    const UNTERMINATED: ReadonlyArray<readonly [string, string]> = [
      ['bracket', 'flowchart TD\n  A[Start --> B\n  C --> D'],
      ['paren', 'flowchart TD\n  A(Start --> B\n  C --> D'],
      ['brace', 'flowchart TD\n  A{Start --> B\n  C --> D'],
      ['quote', 'flowchart TD\n  A["Start] --> B\n  C --> D'],
    ];

    it.each(UNTERMINATED)(
      'blames the opening line for an unterminated %s',
      async (_kind, body) => {
        expect(await lineOf(body)).toBe(2);
      },
    );
  });

  // mermaid parses a preprocessed copy of the diagram, so anything it strips
  // first — frontmatter, `%%{init}%%` directives, `%%` comments, leading blank
  // lines — shifts every number it reports. That bites this project especially:
  // its own suppression directives are `%%` comments, so a diagram carrying one
  // had misplaced diagnostics. See `parsedLineToBodyLine`.
  describe('bodies mermaid preprocesses', () => {
    const CASES: ReadonlyArray<readonly [string, string]> = [
      ['a leading %% comment', '%% note\nflowchart TD\n  A --> B\n  B -> C'],
      ['an interior %% comment', 'flowchart TD\n%% note\n  A --> B\n  B -> C'],
      ['two %% comments', '%% a\n%% b\nflowchart TD\n  A --> B\n  B -> C'],
      ['frontmatter', '---\ntitle: T\n---\nflowchart TD\n  A --> B\n  B -> C'],
      [
        'a %%{init}%% directive',
        '%%{init: {"theme":"dark"}}%%\nflowchart TD\n  A --> B\n  B -> C',
      ],
      ['a leading blank line', '\nflowchart TD\n  A --> B\n  B -> C'],
      ['a Langium grammar', '%% note\npie\n  "A" : 40\n  bogus here'],
    ];

    // Every body ends with its one defect, so the answer is always the last
    // line however many lines were stripped above it.
    it.each(CASES)('blames the defect line past %s', async (_kind, body) => {
      expect(await lineOf(body)).toBe(body.split('\n').length);
    });

    it('shifts by exactly what mermaid strips, not by a fixed guess', async () => {
      // A drift guard that asks mermaid rather than hardcoding: the same defect,
      // with and without a comment above it, must be blamed one line apart. If
      // upstream changes what it strips, our replication stops agreeing here.
      const without = 'flowchart TD\n  A --> B\n  B -> C';
      const withComment = 'flowchart TD\n%% note\n  A --> B\n  B -> C';
      const bare = await lineOf(without);
      expect(bare).toBe(3);
      expect(await lineOf(withComment)).toBe((bare as number) + 1);
    });
  });

  // jison takes `first_column` from where the *previous* token ended, so it
  // lands on the whitespace before the defect — and sometimes past the end of
  // the line entirely. `hash.text` carries the real token; see `refineColumn`.
  describe('column', () => {
    const colOf = async (body: string): Promise<number | undefined> => {
      const result = await validateWithMermaidJS(body);
      expect(result.ok).toBe(false);
      return result.ok ? undefined : result.error.col;
    };

    const CASES: ReadonlyArray<readonly [string, string, number]> = [
      ['bad arrow', 'flowchart TD\n  A --> B\n  B -> C', 5],
      ['indented defect', 'flowchart TD\n  A --> B\n      B -> C', 9],
      ['stray token', 'flowchart TD\n  A --> B\n  @@@@', 3],
      ['er cardinality', 'erDiagram\n  A ||--o{ B : has\n  C }}}} D', 5],
      ['unclosed series', 'xychart-beta\n  title "X"\n  bar [1, 2', 11],
      ['langium column', 'pie\n  "A" : 40\n  bogus', 3],
    ];

    it.each(CASES)('points at the %s', async (_kind, body, want) => {
      expect(await colOf(body)).toBe(want);
    });

    it('never points past the end of the line it lands on', async () => {
      // jison named column 19 on a six-character line, and 11 on a nine — a
      // caret with nowhere to land. Measure against the line the diagnostic
      // actually reports rather than assuming which line that is, so this keeps
      // checking the column against the string it is a column of even if the
      // blamed line moves.
      for (const body of [
        'erDiagram\n  A ||--o{ B : has\n  @@@@',
        'timeline\n  2024 : a\n  ::: bad',
        'classDiagram\n  A <|-- B\n  C ^^^^ D',
      ]) {
        const result = await validateWithMermaidJS(body);
        expect(result.ok).toBe(false);
        if (result.ok) continue;
        const { line, col } = result.error;
        expect(line).toBeDefined();
        expect(col).toBeDefined();
        const blamed = body.split('\n')[(line as number) - 1];
        expect(blamed).toBeDefined();
        expect(col).toBeGreaterThanOrEqual(1);
        expect(col).toBeLessThanOrEqual(blamed.length);
      }
    });
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
