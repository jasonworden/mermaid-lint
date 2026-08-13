import { describe, expect, it } from 'vitest';
import {
  LINK_START_RE,
  blankQuoted,
  scanShapes,
  withCloserCorrected,
  withCloserInserted,
} from '../../src/explain/shapes.js';

describe('blankQuoted', () => {
  it('replaces a quoted segment with spaces of the same width', () => {
    const line = '  A["hi"] --> B';
    const blanked = blankQuoted(line);
    expect(blanked).toBe('  A[    ] --> B');
    expect(blanked.length).toBe(line.length);
  });

  it('leaves indices aligned so a scan can report positions in the original', () => {
    const line = '  A["x]y" --> B';
    expect(blankQuoted(line).indexOf('[')).toBe(line.indexOf('['));
  });

  // `A[don't]` is a valid node. Treating `'` as a delimiter made a pair of
  // apostrophes swallow the arrow between them.
  it('does not treat apostrophes as quotes', () => {
    const line = "  A[don't] --> B[won't]";
    expect(blankQuoted(line)).toBe(line);
  });

  it('leaves an unterminated quote alone', () => {
    const line = '  A["Start] --> B';
    expect(blankQuoted(line)).toBe(line);
  });
});

describe('scanShapes', () => {
  it('returns undefined when every delimiter pairs up', () => {
    expect(scanShapes('  A[call foo(bar)] --> B')).toBeUndefined();
    expect(scanShapes('  A{is (x)?} --> B')).toBeUndefined();
  });

  it('ignores a surplus closer with nothing open', () => {
    expect(scanShapes('  A[Start]] --> B')).toBeUndefined();
  });

  it('reports an unclosed opener with its index', () => {
    const defect = scanShapes('  A[Start --> B');
    expect(defect?.kind).toBe('unclosed');
    expect(defect?.opener).toBe('[');
    expect(defect?.openerIndex).toBe(3);
  });

  it('reports a mismatched pair with both delimiters', () => {
    const defect = scanShapes('  A[Start) --> B');
    expect(defect?.kind).toBe('mismatched');
    expect(defect?.opener).toBe('[');
    expect(defect?.closer).toBe(')');
    expect(defect?.closerIndex).toBe(9);
  });

  it('reports the innermost opener when several are unclosed', () => {
    const defect = scanShapes('  A[call foo(bar --> B');
    expect(defect?.kind).toBe('unclosed');
    expect(defect?.opener).toBe('(');
    expect(defect?.openerIndex).toBe(12);
  });

  it('finds a later unclosed opener after an earlier balanced pair', () => {
    const defect = scanShapes('  A[Start] --> B[End');
    expect(defect?.kind).toBe('unclosed');
    expect(defect?.openerIndex).toBe(16);
  });

  it('does not pair a quoted closer with a real opener', () => {
    const defect = scanShapes('  A["x]y" --> B');
    expect(defect?.kind).toBe('unclosed');
    expect(defect?.opener).toBe('[');
  });

  // Without ignoring quoted text this reads as `(` closed by `]`.
  it('does not invent a mismatch from a quoted paren', () => {
    const defect = scanShapes('  A["x(y"] --> B[');
    expect(defect?.kind).toBe('unclosed');
    expect(defect?.opener).toBe('[');
  });

  it('treats brackets as balanced when only a quote is unterminated', () => {
    expect(scanShapes('  A["Start] --> B')).toBeUndefined();
  });

  it('reports the shape opening its opener belongs to', () => {
    expect(scanShapes('  A[Start) --> B')?.openerRun).toBe('[');
    expect(scanShapes('  A([foo} --> B')?.openerRun).toBe('([');
    expect(scanShapes('  A[[foo} --> B')?.openerRun).toBe('[[');
  });

  // The `[` was matched by the first `]`, so it is no longer on the stack — but
  // the shape being repaired is still the stadium `([`, which is why the run is
  // read off the text rather than the stack.
  it('reports the whole opening even when part of it is already closed', () => {
    expect(scanShapes('  A([foo]] --> B')?.openerRun).toBe('([');
  });

  // Two live openers that do not touch are two different nodes.
  it('reports no opening when an unrelated opener is also live', () => {
    expect(scanShapes('  A[x ([foo} --> B')?.openerRun).toBe('');
  });
});

describe('withCloserInserted', () => {
  function insert(line: string) {
    const defect = scanShapes(line);
    return defect === undefined ? undefined : withCloserInserted(line, defect);
  }

  it('closes the label before the link, not at end of line', () => {
    expect(insert('  A[Start --> B')).toBe('  A[Start] --> B');
  });

  it('appends when no link follows the opener', () => {
    expect(insert('  A[Start')).toBe('  A[Start]');
  });

  // Appending would make one node labelled "Start --- B" — it parses, but it
  // is not what the author wrote.
  it('closes before a headless link too', () => {
    expect(insert('  A[Start --- B')).toBe('  A[Start] --- B');
    expect(insert('  A[Start === B')).toBe('  A[Start] === B');
    expect(insert('  A[a -.- b')).toBe('  A[a] -.- b');
  });

  // A bare `--`/`==` is not a link (mermaid's shortest open link is `---`), so
  // it is label text and the closer belongs at the end. Cutting there gave
  // `A[Start] --End`, which mermaid rejects.
  it('does not cut at two bare dashes inside a label', () => {
    expect(insert('  A[Start--End')).toBe('  A[Start--End]');
    expect(insert('  A[Phase 1 -- Phase 2')).toBe('  A[Phase 1 -- Phase 2]');
    expect(insert('  A[Start == End')).toBe('  A[Start == End]');
  });

  // `-- x ---` is the edge-text form, so the first complete run wins and the
  // bare `--` stays where the author put it.
  it('cuts at the first complete link in an edge-text run', () => {
    expect(insert('  A[Start -- x --- B')).toBe('  A[Start -- x] --- B');
  });

  // The arrow inside the label must not choose the cut point.
  it('ignores a link inside a quoted label', () => {
    expect(insert('  A["a -->  b" --> B')).toBe('  A["a -->  b"] --> B');
  });

  it('declines when there is no label text to close around', () => {
    expect(insert('  C[')).toBeUndefined();
  });

  // One `]` would still leave `[` open, so there is no single-insertion repair.
  it('declines when more than one opener is unmatched', () => {
    expect(insert('  A[call foo(bar --> B')).toBeUndefined();
  });

  it('declines on a mismatched defect', () => {
    const line = '  A[Start) --> B';
    const defect = scanShapes(line);
    expect(defect).toBeDefined();
    expect(defect && withCloserInserted(line, defect)).toBeUndefined();
  });

  // `[/` opens a shape whose closer is `/]` or `\]`, so a bare `]` spells
  // nothing mermaid has — `A[/foo] --> B` is not a node. Which slash was meant
  // is a coin flip (`A[/foo/]` and `A[/foo\]` both parse, and mean different
  // shapes), so there is nothing to offer.
  it('declines an asymmetric shape whose closing slash is missing', () => {
    expect(insert('  A[/foo --> B')).toBeUndefined();
    expect(insert('  A[/foo bar --> B')).toBeUndefined();
    expect(insert('  A --> B[/foo')).toBeUndefined();
    expect(insert('  A[\\foo --> B')).toBeUndefined();
    expect(insert('  A[\\foo bar --> B')).toBeUndefined();
    expect(insert('  A --> B[\\foo')).toBeUndefined();
  });

  // With the closing slash already written, the one missing character really is
  // the `]`, and all four crossings are real shapes.
  it('closes an asymmetric shape whose closing slash is there', () => {
    expect(insert('  A[/foo/ --> B')).toBe('  A[/foo/] --> B');
    expect(insert('  A[/foo\\ --> B')).toBe('  A[/foo\\] --> B');
    expect(insert('  A[\\foo\\ --> B')).toBe('  A[\\foo\\] --> B');
    expect(insert('  A[\\foo/ --> B')).toBe('  A[\\foo/] --> B');
    expect(insert('  A --> B[/foo/')).toBe('  A --> B[/foo/]');
  });

  // The second slash has to close a label, not be the opening one over again:
  // mermaid rejects `A[/]` and `A[//]` alike.
  it('declines an asymmetric shape with nothing between the slashes', () => {
    expect(insert('  A[/ --> B')).toBeUndefined();
    expect(insert('  A[// --> B')).toBeUndefined();
  });

  // Only `[` opens an asymmetric shape. A round or rhombus label may start with
  // a slash, and closing it plainly is the right answer.
  it('leaves a slash label alone under any other opener', () => {
    expect(insert('  A(/foo --> B')).toBe('  A(/foo) --> B');
    expect(insert('  A{/foo --> B')).toBe('  A{/foo} --> B');
  });

  // A quoted label is not a shape token, and a label that merely *ends* with a
  // slash never was one either.
  it('leaves a slash alone when it does not open the shape', () => {
    expect(insert('  A["/x" --> B')).toBe('  A["/x"] --> B');
    expect(insert('  A[foo/ --> B')).toBe('  A[foo/] --> B');
  });
});

describe('withCloserCorrected', () => {
  function correct(line: string) {
    const defect = scanShapes(line);
    return defect === undefined ? undefined : withCloserCorrected(line, defect);
  }

  it('swaps the disagreeing closer for the opener’s own', () => {
    expect(correct('  A[Start) --> B')).toBe('  A[Start] --> B');
    expect(correct('  A(Start] --> B')).toBe('  A(Start) --> B');
    expect(correct('  A{Start] --> B')).toBe('  A{Start} --> B');
  });

  it('declines on an unclosed defect', () => {
    const line = '  A[Start --> B';
    const defect = scanShapes(line);
    expect(defect).toBeDefined();
    expect(defect && withCloserCorrected(line, defect)).toBeUndefined();
  });

  // `A([foo}` is a stadium whose closer was mistyped and whose `(` never closes
  // at all, so one substitution cannot repair the line.
  it('declines when an enclosing opener stays unmatched to end of line', () => {
    expect(correct('  A([foo} --> B')).toBeUndefined();
    expect(correct('  A[(foo} --> B')).toBeUndefined();
  });

  // The same shape of input, except the enclosing opener *does* close later on
  // the line — so the rewrite balances, and balance alone waves it through. It
  // still does not parse: a stadium closes with `])`, and `A([foo] bar)` puts
  // text between the two halves. This is the case the balance check cannot see.
  it('declines when an enclosing opener closes later on the line', () => {
    expect(correct('  A([foo} bar) --> B')).toBeUndefined();
    expect(correct('  A((foo} bar) --> B')).toBeUndefined();
    expect(correct('  A((foo} bar)) --> B')).toBeUndefined();
    expect(correct('  A[[foo} bar] --> B')).toBeUndefined();
    expect(correct('  A --> B([x} y)')).toBeUndefined();
  });

  // The opener that survives can also sit to the *right* of the mismatch, where
  // the scan had not yet reached it — which is why this is checked by re-scanning
  // the corrected line rather than by counting the scan's stack.
  it('declines when a later opener is still unmatched', () => {
    expect(correct('  A[foo} --> B[bar')).toBeUndefined();
    expect(correct('  A[foo} --> B(bar')).toBeUndefined();
    expect(correct('  A(foo} --> B[bar')).toBeUndefined();
  });

  it('still corrects when the rest of the line is balanced', () => {
    expect(correct('  A[foo} --> B[bar]')).toBe('  A[foo] --> B[bar]');
  });

  // Balance is not the bar — a compound shape has to come out whole. All of
  // these do, and mermaid accepts every result.
  it('corrects a compound shape when the repair completes it', () => {
    expect(correct('  A([foo}) --> B')).toBe('  A([foo]) --> B');
    expect(correct('  A[[foo}] --> B')).toBe('  A[[foo]] --> B');
    expect(correct('  A((foo}) --> B')).toBe('  A((foo)) --> B');
    expect(correct('  A[(foo}] --> B')).toBe('  A[(foo)] --> B');
  });

  // The mistyped half can be the outer one, which the scan sees only after the
  // inner pair has already matched and left the stack.
  it('corrects a compound shape whose outer closer was mistyped', () => {
    expect(correct('  A([foo]] --> B')).toBe('  A([foo]) --> B');
    expect(correct('  A((foo)] --> B')).toBe('  A((foo)) --> B');
  });

  // `]]` is not how a rectangle closes; the surplus `]` is a second defect.
  it('declines when the closer run is longer than the shape', () => {
    expect(correct('  A[foo}] --> B')).toBeUndefined();
    expect(correct('  A((foo})) --> B')).toBeUndefined();
  });

  // `[([` is not a shape mermaid has, so nothing can be vouched for around it.
  it('declines when the opener run is not a shape mermaid has', () => {
    expect(correct('  A[([foo})] --> B')).toBeUndefined();
  });

  // The delimiters mirror, but the label carries unquoted parens, which mermaid
  // rejects — so the two tokens matched are not the whole shape.
  it('declines when the label still holds a bare delimiter', () => {
    expect(correct('  A[foo (bar) baz) --> B')).toBeUndefined();
    expect(correct('  A([foo] bar] --> B')).toBeUndefined();
  });

  // Quoting is how mermaid takes brackets in a label, and quoted text is blank
  // to the scan, so it must not trip the same guard.
  it('corrects around a quoted label containing brackets', () => {
    expect(correct('  A["[x] y") --> B')).toBe('  A["[x] y"] --> B');
  });
});

describe('LINK_START_RE', () => {
  it.each([
    '-->',
    '->',
    '==>',
    '-.->',
    '-.-->',
    '--x',
    '--o',
    '==x',
    // Headless links are links too; missing them mislocated the label end.
    '---',
    '----',
    '===',
    '-.-',
  ])('matches %s', (link) => {
    expect(LINK_START_RE.test(`A ${link} B`)).toBe(true);
  });

  it('matches at the start of the link, not partway through', () => {
    expect(LINK_START_RE.exec('A --> B')?.index).toBe(2);
    expect(LINK_START_RE.exec('A -.-> B')?.index).toBe(2);
  });

  // `--` and `==` are not links: mermaid's shortest open link is `---`, and
  // `A -- B` is a parse error. Two dashes in a label are just text.
  it.each(['-', '--', '=', '==', 'A B'])('does not match %s', (text) => {
    expect(LINK_START_RE.test(`A ${text} B`)).toBe(false);
  });
});
