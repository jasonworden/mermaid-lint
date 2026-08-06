import { describe, expect, it } from 'vitest';
import { parsedLineToBodyLine } from '../src/preprocess.js';

describe('parsedLineToBodyLine', () => {
  // mermaid preprocesses a diagram before its parser ever sees it, deleting
  // whole lines: a leading frontmatter block, `%%{...}%%` directives, `%%`
  // comments, and (via `trimStart`) whatever blank lines are left at the top.
  // Every line number it then reports counts the survivors, so a body carrying
  // any of these is cited short by however many lines went away.
  const map = (body: string, parsedLine: number) =>
    parsedLineToBodyLine(body, parsedLine);

  it('is the identity when nothing is stripped', () => {
    const body = 'flowchart TD\n  A --> B\n  B -> C';
    expect(map(body, 1)).toBe(1);
    expect(map(body, 3)).toBe(3);
  });

  it('skips a leading %% comment', () => {
    const body = '%% note\nflowchart TD\n  A --> B\n  B -> C';
    expect(map(body, 1)).toBe(2);
    expect(map(body, 3)).toBe(4);
  });

  it('skips an interior %% comment', () => {
    const body = 'flowchart TD\n%% note\n  A --> B\n  B -> C';
    expect(map(body, 1)).toBe(1);
    expect(map(body, 3)).toBe(4);
  });

  it('skips an indented %% comment', () => {
    // mermaid's own pattern allows leading whitespace before `%%`.
    const body = 'flowchart TD\n    %% note\n  A --> B\n  B -> C';
    expect(map(body, 3)).toBe(4);
  });

  it('keeps a bare `%%` line, which mermaid does not strip', () => {
    // mermaid's pattern is `^\s*%%(?!{)[^\n]+`, so it needs at least one
    // character after the marker; a bare `%%` survives into the parse.
    const body = 'flowchart TD\n%%\n  A --> B\n  B -> C';
    expect(map(body, 4)).toBe(4);
  });

  it('skips a leading blank line', () => {
    const body = '\nflowchart TD\n  A --> B\n  B -> C';
    expect(map(body, 3)).toBe(4);
  });

  it('keeps an interior blank line', () => {
    // `trimStart` only reaches the top of the text, so an interior blank line
    // is still a line as far as the parser is concerned.
    const body = 'flowchart TD\n\n  A --> B\n  B -> C';
    expect(map(body, 4)).toBe(4);
  });

  it('skips a blank line left leading once comments are gone', () => {
    // Comments are removed before `trimStart` runs, so a blank line that only
    // becomes leading after that removal is trimmed too.
    const body = '%% note\n\nflowchart TD\n  A --> B\n  B -> C';
    expect(map(body, 3)).toBe(5);
  });

  it('skips a frontmatter block, delimiters included', () => {
    const body = '---\ntitle: T\n---\nflowchart TD\n  A --> B\n  B -> C';
    expect(map(body, 1)).toBe(4);
    expect(map(body, 3)).toBe(6);
  });

  it('skips a leading %%{init}%% directive', () => {
    // Leading only because the blank it leaves behind is then trimmed.
    const body =
      '%%{init: {"theme":"dark"}}%%\nflowchart TD\n  A --> B\n  B -> C';
    expect(map(body, 3)).toBe(4);
  });

  it('keeps the blank line an interior directive leaves behind', () => {
    // `removeDirectives` deletes the directive *text*, not the line, so an
    // interior directive collapses to an empty line that the parser still
    // counts. Only a leading one disappears, via `trimStart`.
    const body =
      'flowchart TD\n%%{init: {"theme":"dark"}}%%\n  B -> C\n  D --> E';
    expect(map(body, 2)).toBe(2);
    expect(map(body, 3)).toBe(3);
  });

  it('collapses a multi-line directive to one blank line', () => {
    // The regex spans the newlines inside the directive, so three body lines
    // become a single empty line rather than three.
    const body =
      'flowchart TD\n%%{init: {\n"theme":"dark"\n}}%%\n  B -> C\n  D --> E';
    expect(map(body, 3)).toBe(5);
  });

  it('skips blank lines directly above a %% comment', () => {
    // `\s` matches newlines, so `^\s*%%…` under `m` swallows the blank lines
    // above the comment along with it. A blank line above a suppression
    // directive is idiomatic, so this is the common shape, not an edge case.
    const body = 'flowchart TD\n  A --> B\n\n%% note\n  B -> C\n  D --> E';
    expect(map(body, 3)).toBe(5);
  });

  it('skips several blank lines above a %% comment', () => {
    const body = 'flowchart TD\n\n\n%% note\n  B -> C\n  D --> E';
    expect(map(body, 2)).toBe(5);
  });

  it('is not fooled by a CRLF bare `%%` line', () => {
    // mermaid normalizes CRLF first, so it sees `%%` — which its `[^\n]+`
    // rejects. Matching the raw line would let `\r` satisfy that and strip a
    // line mermaid keeps.
    const body = 'flowchart TD\r\n%%\r\n  B -> C\r\n  D --> E';
    expect(map(body, 3)).toBe(3);
  });

  it('accumulates every stripped category at once', () => {
    const body =
      '---\ntitle: T\n---\n%% note\nflowchart TD\n  A --> B\n  B -> C';
    expect(map(body, 3)).toBe(7);
  });

  it('clamps a line past the last survivor', () => {
    // Defensive: a signal pointing past the parsed text must still land on a
    // real body line rather than off the end.
    const body = '%% note\nflowchart TD\n  A --> B';
    expect(map(body, 99)).toBe(3);
  });

  it('returns the line unchanged when nothing survives', () => {
    // A body of only comments has no parsed lines to map onto.
    expect(map('%% a\n%% b', 1)).toBe(1);
  });
});
