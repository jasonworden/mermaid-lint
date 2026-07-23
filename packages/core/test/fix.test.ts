import { describe, expect, it } from 'vitest';
import { fixBlockBody, fixText } from '../src/fix.js';

describe('fixText', () => {
  describe('unclosed fence', () => {
    it('closes an unclosed mermaid fence', () => {
      const input = 'hello\n```mermaid\nflowchart LR\n  A --> B\n';
      const output = fixText(input);
      expect(output).toBe('hello\n```mermaid\nflowchart LR\n  A --> B\n```\n');
    });

    it('does not modify a properly closed fence', () => {
      const input = '```mermaid\nflowchart LR\n  A --> B\n```\n';
      expect(fixText(input)).toBe(input);
    });

    it('handles multiple fences where only last is unclosed', () => {
      const input =
        '```mermaid\nflowchart LR\n  A --> B\n```\n\n' +
        '```mermaid\ngraph TD\n  C --> D\n';
      const output = fixText(input);
      expect(output).toBe(
        '```mermaid\nflowchart LR\n  A --> B\n```\n\n' +
          '```mermaid\ngraph TD\n  C --> D\n```\n',
      );
    });
  });

  describe('flowchart arrow normalization', () => {
    it('normalizes -> to --> in flowchart blocks', () => {
      const input = '```mermaid\nflowchart LR\n  A -> B\n```\n';
      expect(fixText(input)).toBe('```mermaid\nflowchart LR\n  A --> B\n```\n');
    });

    it('normalizes -> to --> in graph blocks', () => {
      const input = '```mermaid\ngraph TD\n  A -> B -> C\n```\n';
      expect(fixText(input)).toBe(
        '```mermaid\ngraph TD\n  A --> B --> C\n```\n',
      );
    });

    it('does not change ->> in flowchart', () => {
      const input = '```mermaid\nflowchart LR\n  A ->> B\n```\n';
      expect(fixText(input)).toBe(input);
    });

    it('does not change --> (already correct)', () => {
      const input = '```mermaid\nflowchart LR\n  A --> B\n```\n';
      expect(fixText(input)).toBe(input);
    });

    it('does not normalize -> in sequenceDiagram (valid there)', () => {
      const input = '```mermaid\nsequenceDiagram\n  Alice->Bob: hi\n```\n';
      expect(fixText(input)).toBe(input);
    });

    it('does not normalize -> inside quoted labels', () => {
      const input = '```mermaid\nflowchart LR\n  A["a->b"] --> C\n```\n';
      expect(fixText(input)).toBe(input);
    });

    it('does not corrupt dotted arrows (-.->)', () => {
      const input = '```mermaid\nflowchart LR\n  A -.-> B\n```\n';
      expect(fixText(input)).toBe(input);
    });

    it('does not corrupt dotted arrows with label (-. text .->)', () => {
      const input = '```mermaid\nflowchart LR\n  A -. label .-> B\n```\n';
      expect(fixText(input)).toBe(input);
    });

    it('works on .mmd file with path option', () => {
      const input = 'flowchart LR\n  A -> B\n';
      expect(fixText(input, { path: 'diagram.mmd' })).toBe(
        'flowchart LR\n  A --> B\n',
      );
    });
  });

  describe('sequence diagram missing colon', () => {
    it('does not modify lines that already have colon', () => {
      const input = '```mermaid\nsequenceDiagram\n  Alice->>Bob: hello\n```\n';
      expect(fixText(input)).toBe(input);
    });

    it('inserts colon when missing from ->> message', () => {
      const input =
        '```mermaid\nsequenceDiagram\n  Alice->>Bob hello world\n```\n';
      expect(fixText(input)).toBe(
        '```mermaid\nsequenceDiagram\n  Alice->>Bob: hello world\n```\n',
      );
    });

    it('inserts colon when missing from --> message', () => {
      const input = '```mermaid\nsequenceDiagram\n  Alice-->Bob hello\n```\n';
      expect(fixText(input)).toBe(
        '```mermaid\nsequenceDiagram\n  Alice-->Bob: hello\n```\n',
      );
    });

    it('does not modify non-message lines in sequenceDiagram', () => {
      const input =
        '```mermaid\nsequenceDiagram\n  participant Alice\n' +
        '  Alice->>Bob: hello\n```\n';
      expect(fixText(input)).toBe(input);
    });
  });

  describe('commonmark fences', () => {
    it('normalizes arrows inside a tilde fence', () => {
      const input = '~~~mermaid\nflowchart LR\n  A -> B\n~~~\n';
      expect(fixText(input)).toBe('~~~mermaid\nflowchart LR\n  A --> B\n~~~\n');
    });

    it('normalizes arrows inside a four-backtick fence', () => {
      const input = '````mermaid\nflowchart LR\n  A -> B\n````\n';
      expect(fixText(input)).toBe(
        '````mermaid\nflowchart LR\n  A --> B\n````\n',
      );
    });

    it('closes an unclosed tilde fence with a tilde fence', () => {
      const input = '~~~mermaid\nflowchart LR\n  A --> B\n';
      expect(fixText(input)).toBe('~~~mermaid\nflowchart LR\n  A --> B\n~~~\n');
    });

    it('closes an unclosed four-backtick fence with four backticks', () => {
      const input = '````mermaid\nflowchart LR\n  A --> B\n';
      expect(fixText(input)).toBe(
        '````mermaid\nflowchart LR\n  A --> B\n````\n',
      );
    });

    it('leaves tilde fences untouched when restricted to backtick', () => {
      const input = '~~~mermaid\nflowchart LR\n  A -> B\n~~~\n';
      expect(fixText(input, { fences: ['backtick'] })).toBe(input);
    });
  });

  describe('idempotency', () => {
    it('is idempotent on already-valid diagrams', () => {
      const input = '```mermaid\nflowchart LR\n  A --> B\n```\n';
      expect(fixText(fixText(input))).toBe(fixText(input));
    });
  });
});

describe('fixBlockBody', () => {
  it('normalizes flowchart arrows in a raw body', () => {
    expect(fixBlockBody('flowchart LR\n  A -> B')).toBe(
      'flowchart LR\n  A --> B',
    );
  });

  it('normalizes graph arrows in a raw body', () => {
    expect(fixBlockBody('graph TD\n  A -> B -> C')).toBe(
      'graph TD\n  A --> B --> C',
    );
  });

  it('inserts a missing sequence-message colon', () => {
    expect(fixBlockBody('sequenceDiagram\n  Alice->>Bob hello')).toBe(
      'sequenceDiagram\n  Alice->>Bob: hello',
    );
  });

  it('returns the body unchanged when nothing matches', () => {
    const body = 'flowchart LR\n  A --> B';
    expect(fixBlockBody(body)).toBe(body);
  });

  it('does not touch -> in a sequenceDiagram (valid there)', () => {
    const body = 'sequenceDiagram\n  Alice->Bob: hi';
    expect(fixBlockBody(body)).toBe(body);
  });

  it('preserves the line count so callers can map fixes line-by-line', () => {
    const body = 'flowchart LR\n  A -> B\n  C -> D';
    const fixed = fixBlockBody(body);
    expect(fixed.split('\n')).toHaveLength(body.split('\n').length);
    expect(fixed).toBe('flowchart LR\n  A --> B\n  C --> D');
  });

  it('preserves leading indentation on fixed lines', () => {
    expect(fixBlockBody('flowchart LR\n      A -> B')).toBe(
      'flowchart LR\n      A --> B',
    );
  });

  it('does not add a closing fence (no fence-level work)', () => {
    // A bare body never grows the way fixText would when closing a fence.
    const body = 'flowchart LR\n  A -> B';
    expect(fixBlockBody(body).split('\n')).toHaveLength(2);
  });
});

describe('SEQ_MISSING_COLON_RE (via fixBlockBody)', () => {
  // Regression for the js/polynomial-redos alert: an arrow followed by a long
  // run of spaces and no target used to trigger quadratic backtracking in the
  // missing-colon matcher. A pathological line must still resolve near-instantly.
  it('does not backtrack quadratically on an arrow with a long space run', () => {
    const body = `sequenceDiagram\n0->${' '.repeat(50_000)}`;
    const start = performance.now();
    const out = fixBlockBody(body);
    const elapsedMs = performance.now() - start;
    expect(out).toBe(body); // no colon inserted — there is no message
    expect(elapsedMs).toBeLessThan(500);
  });

  // The matcher supports sequence activation markers (`+`/`-`) between the arrow
  // and the target; the ReDoS fix must preserve that.
  it('inserts a colon when an activation marker follows the arrow', () => {
    expect(fixBlockBody('sequenceDiagram\n  Alice->>+Bob hello')).toBe(
      'sequenceDiagram\n  Alice->>+Bob: hello',
    );
    expect(fixBlockBody('sequenceDiagram\n  Alice->>-Bob bye')).toBe(
      'sequenceDiagram\n  Alice->>-Bob: bye',
    );
  });

  it('inserts a colon for an -x arrow missing its colon', () => {
    expect(fixBlockBody('sequenceDiagram\n  Alice-xBob boom')).toBe(
      'sequenceDiagram\n  Alice-xBob: boom',
    );
  });
});
