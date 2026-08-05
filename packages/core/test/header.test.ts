import { describe, expect, it } from 'vitest';
import { locateHeader } from '../src/header.js';

const at = (body: string) => locateHeader(body.split('\n'));

describe('locateHeader', () => {
  it('returns line 1 for a header on the first line', () => {
    expect(at('flowchart LR\n  A --> B')).toEqual({
      line: 1,
      text: 'flowchart LR',
    });
  });

  it('skips leading blank lines', () => {
    expect(at('\n\nflowchart LR')).toEqual({ line: 3, text: 'flowchart LR' });
  });

  it('skips %% comments', () => {
    expect(at('%% a note\nflowchart LR')).toEqual({
      line: 2,
      text: 'flowchart LR',
    });
  });

  it('skips a leading frontmatter block', () => {
    expect(at('---\ntitle: T\n---\nflowchart LR')).toEqual({
      line: 4,
      text: 'flowchart LR',
    });
  });

  it('skips comments that follow frontmatter', () => {
    expect(at('---\ntitle: T\n---\n%% a note\nflowchart LR')).toEqual({
      line: 5,
      text: 'flowchart LR',
    });
  });

  it('treats an indented frontmatter block as frontmatter', () => {
    // Indented fences keep their source indentation (see extract.ts), so the
    // delimiter match trims rather than anchoring at column 0.
    expect(at('  ---\n  title: T\n  ---\n  flowchart LR')).toEqual({
      line: 4,
      text: 'flowchart LR',
    });
  });

  it('does not skip an unterminated frontmatter block', () => {
    expect(at('---\ntitle: T\nflowchart LR')).toEqual({ line: 1, text: '---' });
  });

  it('does not treat a non-leading --- as frontmatter', () => {
    expect(at('flowchart LR\n---\ntitle: T\n---')).toEqual({
      line: 1,
      text: 'flowchart LR',
    });
  });

  it('does not treat four dashes as a delimiter', () => {
    expect(at('----\ntitle: T\n----\nflowchart LR')).toEqual({
      line: 1,
      text: '----',
    });
  });

  it('returns an empty header when the body is only frontmatter', () => {
    expect(at('---\ntitle: T\n---')).toEqual({ line: 1, text: '' });
  });

  it('returns an empty header for an empty body', () => {
    expect(at('')).toEqual({ line: 1, text: '' });
  });
});
