import { describe, expect, it } from 'vitest';
import { humanizeToken, summarizeExpected } from '../../src/explain/tokens.js';

describe('humanizeToken', () => {
  it('translates the collapsed-newline artifact', () => {
    expect(humanizeToken('1')).toBe('the end of the line');
  });
  it('translates a text token', () => {
    expect(humanizeToken('TXT')).toBe('message text');
  });
  it('renders a bracket token as a literal', () => {
    expect(humanizeToken('SQE')).toBe('`]`');
  });
  it('passes an unmapped token through as a literal rather than inventing meaning', () => {
    expect(humanizeToken('WELDING_TORCH')).toBe('`WELDING_TORCH`');
  });
});

describe('summarizeExpected', () => {
  it('dedupes after humanizing', () => {
    expect(summarizeExpected(['NEWLINE', 'NL'])).toBe('the end of the line');
  });
  it('joins a short list', () => {
    expect(summarizeExpected(['end', 'SQE'])).toBe('`end` or `]`');
  });
  it('caps a long list and counts the remainder', () => {
    const many = ['end', 'SQE', 'PE', 'PIPE', 'TXT', 'NUM', 'COMMA', 'BRKT'];
    expect(summarizeExpected(many, 3)).toMatch(/, or 5 more$/);
  });
  it('returns an empty string for no expectations', () => {
    expect(summarizeExpected([])).toBe('');
  });
});
