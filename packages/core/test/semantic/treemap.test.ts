import { describe, expect, it } from 'vitest';
import { block } from './helpers.js';
import { only } from './helpers.js';

describe('experimental diagram-specific rules', () => {
  it('flags a treemap-beta leaf with a value of 0', () => {
    const b = block(
      'treemap-beta\n"Root"\n  "A": 0\n  "B": 10',
      'treemap-beta',
    );
    const warnings = only(b, 'treemap-zero-value');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].line).toBe(3);
    expect(warnings[0].message).toContain('"A"');
    expect(warnings[0].message).toContain('zero-area');
  });

  it('flags a treemap-beta value that is zero written as 0.0', () => {
    const b = block('treemap-beta\n"Root"\n  "A": 0.0', 'treemap-beta');
    expect(only(b, 'treemap-zero-value')).toHaveLength(1);
  });

  it('does not flag positive treemap-beta leaf values', () => {
    const b = block(
      'treemap-beta\n"Root"\n  "A": 0.5\n  "B": 10',
      'treemap-beta',
    );
    expect(only(b, 'treemap-zero-value')).toEqual([]);
  });

  it('flags a treemap-beta with sections but no leaf values', () => {
    const b = block('treemap-beta\n"Root"\n  "Branch"', 'treemap-beta');
    const warnings = only(b, 'treemap-no-leaves');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].line).toBe(1);
    expect(warnings[0].message).toContain('renders empty');
  });

  it('does not flag a treemap-beta that has a leaf value', () => {
    const b = block('treemap-beta\n"Root"\n  "A": 10', 'treemap-beta');
    expect(only(b, 'treemap-no-leaves')).toEqual([]);
  });

  it('counts a zero-valued treemap-beta row as a leaf', () => {
    // `treemap-zero-value` already covers the zero; reporting "no leaves"
    // on top of it would say the diagram has no rows at all, which is false.
    const b = block('treemap-beta\n"Root"\n  "A": 0', 'treemap-beta');
    expect(only(b, 'treemap-no-leaves')).toEqual([]);
  });

  it('flags a treemap-beta row repeated under the same parent', () => {
    const b = block(
      'treemap-beta\n"Root"\n  "A": 5\n  "A": 10',
      'treemap-beta',
    );
    const warnings = only(b, 'treemap-duplicate-sibling');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].line).toBe(4);
    expect(warnings[0].message).toContain('"A"');
    expect(warnings[0].message).toContain('first on line 3');
  });

  it('does not flag a treemap-beta label reused under a different parent', () => {
    const b = block(
      'treemap-beta\n"Root"\n  "A": 1\n  "S"\n    "A": 2',
      'treemap-beta',
    );
    expect(only(b, 'treemap-duplicate-sibling')).toEqual([]);
  });

  it('flags a treemap-beta section repeated under the same parent', () => {
    const b = block(
      'treemap-beta\n"Root"\n  "S"\n    "A": 1\n  "S"\n    "B": 2',
      'treemap-beta',
    );
    const warnings = only(b, 'treemap-duplicate-sibling');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].line).toBe(5);
  });

  it('flags a treemap-beta row that carries a value and has children', () => {
    const b = block('treemap-beta\n"Root": 99\n  "A": 5', 'treemap-beta');
    const warnings = only(b, 'treemap-branch-with-value');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].line).toBe(2);
    expect(warnings[0].message).toContain('"Root"');
    expect(warnings[0].message).toContain('leaf');
  });

  it('does not flag a value-less treemap-beta section with children', () => {
    const b = block('treemap-beta\n"Root"\n  "A": 5', 'treemap-beta');
    expect(only(b, 'treemap-branch-with-value')).toEqual([]);
  });

  it('does not flag a treemap-beta leaf followed by a shallower row', () => {
    const b = block(
      'treemap-beta\n"Root"\n  "S"\n    "A": 1\n  "B": 2',
      'treemap-beta',
    );
    expect(only(b, 'treemap-branch-with-value')).toEqual([]);
  });

  it('treats a treemap-beta row under a valued row as its sibling', () => {
    // Mermaid never stacks a valued row, so `"A"` re-parents to `"Root"` and
    // collides with the `"A"` above it rather than nesting under `"Mid"`.
    const b = block(
      'treemap-beta\n"Root"\n  "A": 1\n  "Mid": 2\n    "A": 3',
      'treemap-beta',
    );
    const warnings = only(b, 'treemap-duplicate-sibling');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].line).toBe(5);
    expect(warnings[0].message).toContain('first on line 3');
  });

  it('reads treemap-beta indentation in characters, so a tab is one level', () => {
    // A tab is one column to Mermaid, so `\t"A"` sits at the same depth as
    // ` "S"` and pops it — landing beside the later `"A"` under `"Root"`.
    // Were a tab counted wider, `"A"` would nest inside `"S"` and the two
    // would not be siblings at all.
    const b = block(
      'treemap-beta\n"Root"\n "S"\n\t"A": 1\n "A": 2',
      'treemap-beta',
    );
    const warnings = only(b, 'treemap-duplicate-sibling');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].line).toBe(5);
    expect(warnings[0].message).toContain('first on line 4');
  });

  it('reads a comma-separated treemap-beta value', () => {
    // `"A", 30` is a leaf just as `"A": 30` is; missing the comma form would
    // make every treemap rule blind to the row.
    const b = block(
      'treemap-beta\n"Root"\n  "A", 0\n  "B", 70',
      'treemap-beta',
    );
    expect(only(b, 'treemap-no-leaves')).toEqual([]);
    const warnings = only(b, 'treemap-zero-value');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].line).toBe(3);
  });

  it('reads a treemap-beta leaf whose `:::class` follows its value', () => {
    // A leaf's selector comes after the value — `"A":::big: 5` is a parse
    // error, so only this order has to be understood.
    const b = block('treemap-beta\n"Root"\n  "A": 0:::big', 'treemap-beta');
    expect(only(b, 'treemap-no-leaves')).toEqual([]);
    expect(only(b, 'treemap-zero-value')).toHaveLength(1);
  });

  it('reads the treemap-beta value forms that mean zero', () => {
    // Mermaid drops digit-group commas and then parses, so each of these is
    // a zero-area rectangle even though none is a plain `0`.
    for (const value of ['0.', '0_0', '0,0', '00', '0.0']) {
      const b = block(`treemap-beta\n"Root"\n  "A": ${value}`, 'treemap-beta');
      expect(only(b, 'treemap-zero-value'), value).toHaveLength(1);
    }
  });

  it('does not read a grouped treemap-beta value as zero', () => {
    // `1,000` is 1000, not 1 and not 0 — the comma is a digit group here,
    // not a decimal point.
    const b = block('treemap-beta\n"Root"\n  "A": 1,000', 'treemap-beta');
    expect(only(b, 'treemap-zero-value')).toEqual([]);
    expect(only(b, 'treemap-no-leaves')).toEqual([]);
  });

  it('ignores a trailing `%%` comment on a treemap-beta row', () => {
    const b = block('treemap-beta\n"Root"\n  "A": 0%% note', 'treemap-beta');
    expect(only(b, 'treemap-zero-value')).toHaveLength(1);
  });

  it('accepts single-quoted treemap-beta names', () => {
    const b = block("treemap-beta\n'Root'\n  'A': 0", 'treemap-beta');
    const warnings = only(b, 'treemap-zero-value');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('"A"');
  });

  it('strips a treemap-beta `:::class` selector from the label', () => {
    const b = block(
      'treemap-beta\n"Top"\n  "S":::big\n    "A": 1\n  "S":::big\n    "B": 2',
      'treemap-beta',
    );
    const warnings = only(b, 'treemap-duplicate-sibling');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].line).toBe(5);
    expect(warnings[0].message).toContain('"S"');
  });

  it('ignores treemap-beta comments, titles, and accDescr blocks', () => {
    const b = block(
      'treemap-beta\ntitle My Map\naccDescr {\n  "A": 1\n}\n%% "A": 2\n"Root"\n  "A": 3',
      'treemap-beta',
    );
    expect(only(b, 'treemap-duplicate-sibling')).toEqual([]);
    expect(only(b, 'treemap-zero-value')).toEqual([]);
    expect(only(b, 'treemap-no-leaves')).toEqual([]);
  });

  it('ignores a treemap-beta accDescr whose brace opens on a later line', () => {
    // `ACC_DESCR`'s `\s*` spans newlines, so the block opens from a bare
    // `accDescr` too and its interior is still prose. Without the lookahead
    // the interior row lexes as a real row here, and `"X": 0` raises a
    // `treemap-zero-value` on a diagram mermaid draws nothing for.
    const b = block(
      [
        'treemap-beta',
        '  accDescr',
        '  {',
        '  "X": 0',
        '  }',
        '  "A"',
        '    "B": 10',
      ].join('\n'),
      'treemap-beta',
    );
    expect(only(b, 'treemap-zero-value')).toEqual([]);
    expect(only(b, 'treemap-duplicate-sibling')).toEqual([]);
  });

  it('reads a treemap-beta row after an accDescr block closes on its line', () => {
    // `ACC_DESCR` stops at the first `}` and the rest of the line keeps
    // lexing, so `accDescr { d } "A"` declares a row indented by the gap
    // after the brace — one column (probe, mermaid 11.15.0). Skipping the
    // line loses the row, and with it every finding that depends on it.
    const b = block(
      [
        'treemap-beta',
        '  accDescr { d } "A"',
        '    "B": 10',
        ' "A"',
        '    "C": 5',
      ].join('\n'),
      'treemap-beta',
    );
    // Both `"A"` rows sit at indent 1, so the second re-parents to the root
    // beside the first and duplicates it.
    const dup = only(b, 'treemap-duplicate-sibling');
    expect(dup).toHaveLength(1);
    expect(dup[0].line).toBe(4);
    expect(dup[0].message).toContain('line 2');
    // And the tail row is a section, not a leaf, so it carries no value.
    expect(only(b, 'treemap-branch-with-value')).toEqual([]);
  });
});
