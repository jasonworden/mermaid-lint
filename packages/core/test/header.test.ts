import { describe, expect, it } from 'vitest';
import { locateFrontmatter, locateHeader } from '../src/header.js';

const at = (body: string) => locateHeader(body.split('\n'));
const span = (body: string) => locateFrontmatter(body.split('\n'));

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

  it('does not treat a four-dash line as a closing delimiter', () => {
    // Opening `---` is valid, but Mermaid's regex is `-{3}\s*`, so a fourth
    // dash on the closing line is not whitespace and does not match. The
    // block is therefore unterminated, and the header falls back to '---'.
    expect(at('---\ntitle: T\n----\nflowchart LR')).toEqual({
      line: 1,
      text: '---',
    });
  });

  it('returns an empty header when the body is only frontmatter', () => {
    expect(at('---\ntitle: T\n---')).toEqual({ line: 1, text: '' });
  });

  it('returns an empty header for an empty body', () => {
    expect(at('')).toEqual({ line: 1, text: '' });
  });
});

describe('locateFrontmatter', () => {
  it('spans the block including both delimiters', () => {
    expect(span('---\ntitle: T\n---\nflowchart LR')).toEqual({
      start: 0,
      end: 2,
    });
  });

  it('closes on the first delimiter after the opener', () => {
    // A later `---` pair in the body is not part of the leading block.
    expect(span('---\ntitle: T\n---\nflowchart LR\n---\nx\n---')).toEqual({
      start: 0,
      end: 2,
    });
  });

  it('matches indented delimiters', () => {
    expect(span('  ---\n  title: T\n  ---\n  flowchart LR')).toEqual({
      start: 0,
      end: 2,
    });
  });

  it('spans the whole body when frontmatter is all there is', () => {
    expect(span('---\ntitle: T\n---')).toEqual({ start: 0, end: 2 });
  });

  it('returns null when there is no frontmatter', () => {
    expect(span('flowchart LR\n  A --> B')).toBeNull();
  });

  it('returns null for an unterminated block', () => {
    expect(span('---\ntitle: T\nflowchart LR')).toBeNull();
  });

  it('returns null for a non-leading ---', () => {
    expect(span('flowchart LR\n---\ntitle: T\n---')).toBeNull();
  });

  it('returns null for four-dash delimiters', () => {
    expect(span('----\ntitle: T\n----\nflowchart LR')).toBeNull();
  });

  it('returns null for an empty body', () => {
    expect(span('')).toBeNull();
  });
});
