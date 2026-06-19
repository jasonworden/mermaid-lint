import { describe, expect, it } from 'vitest';
import { fixText } from '../src/fix.js';

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

  describe('idempotency', () => {
    it('is idempotent on already-valid diagrams', () => {
      const input = '```mermaid\nflowchart LR\n  A --> B\n```\n';
      expect(fixText(fixText(input))).toBe(fixText(input));
    });
  });
});
