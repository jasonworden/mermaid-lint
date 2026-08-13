import { describe, expect, it } from 'vitest';
import { parseRawError } from '../../src/explain/parse-raw.js';

describe('parseRawError', () => {
  it('reads a jison parse error', () => {
    const raw = [
      'Parse error on line 2:',
      '...ce->>Bob hello there',
      '-----------------------^',
      "Expecting 'TXT', got 'NEWLINE'",
    ].join('\n');
    expect(parseRawError(raw)).toEqual({
      family: 'jison-parse',
      expected: ['TXT'],
      got: 'NEWLINE',
    });
  });

  it('keeps a comma token out of the expected-list split', () => {
    const raw =
      "Parse error on line 3:\nx\n^\nExpecting ',', 'TXT', got 'NEWLINE'";
    expect(parseRawError(raw).expected).toEqual([',', 'TXT']);
  });

  it('reads a comma as the got token', () => {
    const raw = "Parse error on line 2:\nx\n^\nExpecting 'TXT', got ','";
    expect(parseRawError(raw).got).toBe(',');
  });

  it('reads a jison lexical error', () => {
    const raw =
      'Lexical error on line 1. Unrecognized text.\nflowchart ZZZZ\n---------^';
    expect(parseRawError(raw)).toEqual({
      family: 'jison-lexical',
      expected: [],
      got: undefined,
    });
  });

  it('reads a Langium single-token error', () => {
    const raw =
      "Parsing failed:  Parse error on line 2, column 10: Expecting token of type ':' but found `386`.";
    expect(parseRawError(raw)).toEqual({
      family: 'langium',
      expected: [':'],
      got: '386',
    });
  });

  it('reads a Langium token-sequence error', () => {
    const raw = [
      'Parsing failed:  Parse error on line 3, column 11: Expecting: one of these possible Token sequences:',
      '  1. [NUMBER]',
      '  2. [NEWLINE, NUMBER]',
      '  5. [ID]',
      "but found: '{'",
    ].join('\n');
    const parsed = parseRawError(raw);
    expect(parsed.family).toBe('langium');
    expect(parsed.expected).toEqual(['NUMBER', 'NEWLINE', 'ID']);
    expect(parsed.got).toBe('{');
  });

  it('flags the whole-body echo', () => {
    const raw =
      'No diagram type detected matching given configuration for text: flowchat LR\n  A --> B';
    expect(parseRawError(raw).family).toBe('no-diagram-type');
  });

  it('treats a module-thrown error as its own family', () => {
    const raw =
      'There can be only one root. No parent could be found for ("root2")';
    expect(parseRawError(raw)).toEqual({
      family: 'module',
      expected: [],
      got: undefined,
    });
  });
});
