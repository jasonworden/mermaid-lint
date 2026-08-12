import { describe, expect, it } from 'vitest';
import { RULE_DEFAULTS } from '../../src/rules.js';
import type { ResolvedRules } from '../../src/rules.js';
import { parseWardley } from '../../src/semantic/index.js';
import { block } from './helpers.js';
import { only } from './helpers.js';

describe('wardley-undefined-component rule', () => {
  it('flags a link endpoint that was never declared', () => {
    const b = block(
      [
        'wardley-beta',
        '  component User [0.9, 0.5]',
        '  component Kettle [0.5, 0.6]',
        '  User -> Ghost',
      ].join('\n'),
      'wardley-beta',
    );
    const warnings = only(b, 'wardley-undefined-component');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('`Ghost`');
    expect(warnings[0].message).toContain('link target');
    expect(warnings[0].line).toBe(4);
  });

  it('flags an undeclared evolve target', () => {
    const b = block(
      [
        'wardley-beta',
        '  component User [0.9, 0.5]',
        '  evolve Ghost 0.8',
      ].join('\n'),
      'wardley-beta',
    );
    const warnings = only(b, 'wardley-undefined-component');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('`Ghost`');
    expect(warnings[0].message).toContain('evolve target');
  });

  it('resolves anchors, pipeline members, and quoted names', () => {
    const b = block(
      [
        'wardley-beta',
        '  anchor Business [0.95, 0.63]',
        '  component "Cup of Tea" [0.9, 0.5]',
        '  component Kettle [0.5, 0.6]',
        '  pipeline Kettle {',
        '    component Electric [0.63]',
        '  }',
        '  Business -> Cup of Tea',
        '  Cup of Tea -> Electric',
        '  Kettle_Electric -> Business',
      ].join('\n'),
      'wardley-beta',
    );
    expect(only(b, 'wardley-undefined-component')).toEqual([]);
  });

  // `populateDb` resolves a link with `resolveNodeId` (exact id, then a label
  // scan) but an `evolve` with the bare `getNode`. A pipeline member's id is
  // `parent_child` and only its label is the bare name, so mermaid drops
  // `evolve Electric` without a diagnostic — confirmed against mermaid 11.15
  // by inspecting the built trends.
  it('flags an evolve naming a pipeline member by its bare name', () => {
    const b = block(
      [
        'wardley-beta',
        '  component Kettle [0.5, 0.6]',
        '  pipeline Kettle {',
        '    component Electric [0.63]',
        '  }',
        '  evolve Electric 0.8',
      ].join('\n'),
      'wardley-beta',
    );
    const warnings = only(b, 'wardley-undefined-component');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('`Electric`');
    expect(warnings[0].message).toContain('evolve target');
    expect(warnings[0].line).toBe(6);
  });

  it('leaves an evolve on a pipeline parent or a synthetic id alone', () => {
    const b = block(
      [
        'wardley-beta',
        '  component Kettle [0.5, 0.6]',
        '  pipeline Kettle {',
        '    component Electric [0.63]',
        '  }',
        '  evolve Kettle 0.8',
        '  evolve Kettle_Electric 0.7',
      ].join('\n'),
      'wardley-beta',
    );
    expect(only(b, 'wardley-undefined-component')).toEqual([]);
  });

  it('leaves a pipeline parent alone, since mermaid already rejects it', () => {
    const b = block(
      [
        'wardley-beta',
        '  component Kettle [0.5, 0.6]',
        '  pipeline Ghost {',
        '    component Electric [0.63]',
        '  }',
      ].join('\n'),
      'wardley-beta',
    );
    expect(only(b, 'wardley-undefined-component')).toEqual([]);
  });

  it('does not read an evolution stage row as a link', () => {
    const b = block(
      [
        'wardley-beta',
        '  component User [0.9, 0.5]',
        '  evolution Genesis -> Custom -> Product -> Commodity',
      ].join('\n'),
      'wardley-beta',
    );
    expect(only(b, 'wardley-undefined-component')).toEqual([]);
  });

  // Mermaid's `LINK_ARROW`/`ARROW` terminals admit exactly these four spellings.
  // `WARDLEY_LINK_SEP_RE` folds `->` and `-->` into one `-{1,2}>` alternative,
  // so both dash counts need a case; `-.->` and bare `>` are separate branches.
  it('splits on every arrow spelling mermaid accepts', () => {
    for (const arrow of ['->', '-->', '-.->', '>']) {
      const b = block(
        [
          'wardley-beta',
          '  component User [0.9, 0.5]',
          `  User ${arrow} Ghost`,
        ].join('\n'),
        'wardley-beta',
      );
      const warnings = only(b, 'wardley-undefined-component');
      expect(warnings, arrow).toHaveLength(1);
      // The target resolved to exactly `Ghost` — no arrow debris clinging to it.
      expect(warnings[0].message, arrow).toContain('`Ghost`');
    }
  });

  // `fromPort` and `arrow` are independently optional in mermaid's grammar,
  // so a source port with no arrow token immediately after it (`A+<> -> B`)
  // is valid. The naive separator match eats only the port, leaving the
  // arrow stuck to the front of the target text.
  it('does not misread a source port as part of the target name', () => {
    const b = block(
      [
        'wardley-beta',
        '  component User [0.9, 0.5]',
        '  component Kettle [0.5, 0.6]',
        '  User+<> -> Kettle',
      ].join('\n'),
      'wardley-beta',
    );
    expect(only(b, 'wardley-undefined-component')).toEqual([]);
  });

  it('still resolves the real target when a source port precedes the arrow', () => {
    const b = block(
      [
        'wardley-beta',
        '  component User [0.9, 0.5]',
        '  User+<> -> Ghost',
      ].join('\n'),
      'wardley-beta',
    );
    const warnings = only(b, 'wardley-undefined-component');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('`Ghost`');
    expect(warnings[0].message).not.toContain('-> Ghost');
  });

  // `SINGLE_LINE_COMMENT` is a hidden terminal that can start anywhere on a
  // line, not just in the opening column — a trailing `%%` after a link or
  // an `evolve` is real mermaid syntax, confirmed against mermaid 11.15.
  it('does not let a trailing %% comment swallow a link target', () => {
    const b = block(
      [
        'wardley-beta',
        '  component User [0.9, 0.5]',
        '  component Kettle [0.5, 0.6]',
        '  User -> Kettle %% main flow',
      ].join('\n'),
      'wardley-beta',
    );
    expect(only(b, 'wardley-undefined-component')).toEqual([]);
  });

  it('still flags an undeclared link target behind a trailing %% comment', () => {
    const b = block(
      [
        'wardley-beta',
        '  component User [0.9, 0.5]',
        '  User -> Ghost %% flow',
      ].join('\n'),
      'wardley-beta',
    );
    const warnings = only(b, 'wardley-undefined-component');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('`Ghost`');
    expect(warnings[0].message).not.toContain('%%');
  });

  it('still flags an undeclared evolve target behind a trailing %% comment', () => {
    const b = block(
      [
        'wardley-beta',
        '  component User [0.9, 0.5]',
        '  evolve Ghost 0.8 %% note',
      ].join('\n'),
      'wardley-beta',
    );
    const warnings = only(b, 'wardley-undefined-component');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('`Ghost`');
    expect(warnings[0].message).toContain('evolve target');
  });

  // `STRING` is `"([^"\\]|\\.)*"`, so a quoted name may hold any structural
  // character. Both maps below parse cleanly in mermaid 11.15; a scan that
  // ignored quote state would report the halves of the name as undefined.
  it('does not read a `>` inside a quoted name as a link separator', () => {
    const b = block(
      [
        'wardley-beta',
        '  component "Tea > Coffee" [0.9, 0.5]',
        '  component Kettle [0.5, 0.6]',
        '  "Tea > Coffee" -> Kettle',
      ].join('\n'),
      'wardley-beta',
    );
    expect(only(b, 'wardley-undefined-component')).toEqual([]);
  });

  it('does not read a `;` inside a quoted name as a link annotation', () => {
    const b = block(
      [
        'wardley-beta',
        '  component "Milk; Sugar" [0.9, 0.5]',
        '  component Kettle [0.5, 0.6]',
        '  "Milk; Sugar" -> Kettle',
      ].join('\n'),
      'wardley-beta',
    );
    expect(only(b, 'wardley-undefined-component')).toEqual([]);
  });

  // `accDescr { ... }`'s brace form is a single lexer token spanning
  // newlines, so an arrow inside it is description text, not a link.
  it('does not read an arrow inside a braced accDescr block as a link', () => {
    const b = block(
      [
        'wardley-beta',
        '  component Kettle [0.5, 0.6]',
        '  accDescr {',
        '    Kettle -> Power',
        '  }',
      ].join('\n'),
      'wardley-beta',
    );
    expect(only(b, 'wardley-undefined-component')).toEqual([]);
  });

  // `ACC_DESCR` separates the keyword from its brace with `\s*`, which spans a
  // newline, so this is the same single token as the form above.
  it('does not read an arrow inside an accDescr whose brace is on the next line', () => {
    const b = block(
      [
        'wardley-beta',
        '  accDescr',
        '  {',
        '    Kettle -> Power',
        '  }',
        '  component Kettle [0.5, 0.6]',
      ].join('\n'),
      'wardley-beta',
    );
    expect(only(b, 'wardley-undefined-component')).toEqual([]);
  });
});

describe('wardley-orphan-component rule', () => {
  const enabled: ResolvedRules = {
    ...RULE_DEFAULTS,
    'wardley-orphan-component': 'warn',
  };

  it('returns [] by default (off)', () => {
    const b = block(
      'wardley-beta\n  component Lonely [0.3, 0.3]',
      'wardley-beta',
    );
    expect(only(b, 'wardley-orphan-component')).toEqual([]);
  });

  it('fires on a component nothing references when enabled (warn)', () => {
    const b = block(
      [
        'wardley-beta',
        '  component User [0.9, 0.5]',
        '  component Lonely [0.3, 0.3]',
        '  component Kettle [0.5, 0.6]',
        '  User -> Kettle',
      ].join('\n'),
      'wardley-beta',
    );
    const warnings = only(b, 'wardley-orphan-component', enabled);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('`Lonely`');
    expect(warnings[0].line).toBe(3);
  });

  it('counts evolve targets and pipeline membership as references', () => {
    const b = block(
      [
        'wardley-beta',
        '  component Evolving [0.9, 0.5]',
        '  component Kettle [0.5, 0.6]',
        '  evolve Evolving 0.8',
        '  pipeline Kettle {',
        '    component Electric [0.63]',
        '  }',
      ].join('\n'),
      'wardley-beta',
    );
    expect(only(b, 'wardley-orphan-component', enabled)).toEqual([]);
  });

  it('does not treat an unlinked anchor as an orphan', () => {
    const b = block(
      [
        'wardley-beta',
        '  anchor Business [0.95, 0.63]',
        '  component Kettle [0.5, 0.6]',
        '  component User [0.9, 0.5]',
        '  User -> Kettle',
      ].join('\n'),
      'wardley-beta',
    );
    expect(only(b, 'wardley-orphan-component', enabled)).toEqual([]);
  });
});

describe('wardley-no-components rule', () => {
  it('flags a map with no components or anchors', () => {
    const b = block('wardley-beta\n  title Empty Map', 'wardley-beta');
    const warnings = only(b, 'wardley-no-components');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].line).toBe(1);
  });

  it('treats an anchor-only map as non-empty', () => {
    const b = block(
      'wardley-beta\n  anchor Business [0.95, 0.63]',
      'wardley-beta',
    );
    expect(only(b, 'wardley-no-components')).toEqual([]);
  });

  it('stays silent on a map that declares a component', () => {
    const b = block(
      'wardley-beta\n  component User [0.9, 0.5]',
      'wardley-beta',
    );
    expect(only(b, 'wardley-no-components')).toEqual([]);
  });

  // Notes, accelerators, and the annotations box are decorations placed on the
  // grid, not nodes — `populateDb` never routes any of them through `addNode`.
  it('still flags a map holding only decorations', () => {
    const b = block(
      [
        'wardley-beta',
        '  note "Some note" [0.4, 0.55]',
        '  accelerator Public cloud [0.62, 0.35]',
        '  annotations [0.1, 0.4]',
      ].join('\n'),
      'wardley-beta',
    );
    const warnings = only(b, 'wardley-no-components');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].line).toBe(1);
  });
});

describe('wardley-mixed-coordinate-scale rule', () => {
  it('flags a map mixing 0-1 decimal and 0-100 percentage coordinates', () => {
    const b = block(
      [
        'wardley-beta',
        '  component Search [0.9, 0.5]',
        '  component Profile [0.8, 0.4]',
        '  component Payments [50.0, 60.0]',
      ].join('\n'),
      'wardley-beta',
    );
    const warnings = only(b, 'wardley-mixed-coordinate-scale');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    // Reports on the minority spelling — the rows likely to be wrong.
    expect(warnings[0].line).toBe(4);
    expect(warnings[0].message).toContain('4 in 0-1 decimal form');
    expect(warnings[0].message).toContain('2 in 0-100 percentage form');
    // The reading is a claim about mermaid, so it is pinned in both
    // directions: a value above 1 is a percentage, one at or below it a
    // fraction. See the decimal-minority case below for the other half.
    expect(warnings[0].message).toContain('`50` here is read as a percentage');
  });

  it('stays silent on a map that uses one notation throughout', () => {
    const decimals = block(
      'wardley-beta\n  component A [0.9, 0.5]\n  component B [0.3, 0.2]',
      'wardley-beta',
    );
    expect(only(decimals, 'wardley-mixed-coordinate-scale')).toEqual([]);

    const percentages = block(
      'wardley-beta\n  component A [90.0, 50.0]\n  component B [30.0, 20.0]',
      'wardley-beta',
    );
    expect(only(percentages, 'wardley-mixed-coordinate-scale')).toEqual([]);
  });

  it('reports the decimal row when percentages are the majority', () => {
    const b = block(
      [
        'wardley-beta',
        '  component A [0.9, 0.5]',
        '  component B [30.0, 20.0]',
        '  component C [40.0, 60.0]',
      ].join('\n'),
      'wardley-beta',
    );
    const warnings = only(b, 'wardley-mixed-coordinate-scale');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].line).toBe(2);
    expect(warnings[0].message).toContain('`0.9` here is read as a fraction');
  });

  // The only case where the selection expression's `<=` decides anything: with
  // the partitions the same size it must pick the percentage one, since 0-1
  // decimals are the canonical notation and the likelier intent.
  it('reports the percentage row on an exact tie', () => {
    const b = block(
      [
        'wardley-beta',
        '  component A [0.9, 0.5]',
        '  component B [50.0, 60.0]',
      ].join('\n'),
      'wardley-beta',
    );
    const warnings = only(b, 'wardley-mixed-coordinate-scale');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].line).toBe(3);
    expect(warnings[0].message).toContain('`50` here is read as a percentage');
  });

  // `annotations` and `annotation` accept a bare integer where every other row
  // demands a decimal, and `populateDb` runs both through `toCoordinates` all
  // the same — so an integer there is a real coordinate and mixes the scale of
  // an otherwise-decimal map.
  it('counts annotation coordinates, including their bare integers', () => {
    const b = block(
      'wardley-beta\n  component A [0.9, 0.5]\n  annotations [1, 4]',
      'wardley-beta',
    );
    const warnings = only(b, 'wardley-mixed-coordinate-scale');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].line).toBe(3);
    expect(warnings[0].message).toContain('3 in 0-1 decimal form');
    expect(warnings[0].message).toContain('`4` here is read as a percentage');
  });

  it('ignores label offsets and canvas size, which are not coordinates', () => {
    const b = block(
      [
        'wardley-beta',
        '  size [800, 600]',
        '  component A [0.9, 0.5] label [10, -20]',
        '  component B [0.3, 0.2]',
      ].join('\n'),
      'wardley-beta',
    );
    expect(only(b, 'wardley-mixed-coordinate-scale')).toEqual([]);
  });
});

describe('wardley-duplicate-component rule', () => {
  it('flags a component name declared twice', () => {
    const b = block(
      [
        'wardley-beta',
        '  component User [0.9, 0.5]',
        '  component Kettle [0.5, 0.6]',
        '  component User [0.3, 0.2]',
      ].join('\n'),
      'wardley-beta',
    );
    const warnings = only(b, 'wardley-duplicate-component');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    // Reported on the later row, naming the first — the earlier row is the one
    // the reader is looking for when they wonder where the node went.
    expect(warnings[0].line).toBe(4);
    expect(warnings[0].message).toContain('`User`');
    expect(warnings[0].message).toContain('first on line 2');
  });

  // Both register through `addNode` under their bare name, so they collide.
  it('flags an anchor and a component sharing a name', () => {
    const b = block(
      [
        'wardley-beta',
        '  anchor Foo [0.95, 0.63]',
        '  component Foo [0.3, 0.2]',
      ].join('\n'),
      'wardley-beta',
    );
    const warnings = only(b, 'wardley-duplicate-component');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].line).toBe(3);
    expect(warnings[0].message).toContain('first on line 2');
  });

  it('reports every repeat after the first, each naming the first line', () => {
    const b = block(
      [
        'wardley-beta',
        '  component A [0.9, 0.5]',
        '  component A [0.5, 0.5]',
        '  component A [0.1, 0.1]',
      ].join('\n'),
      'wardley-beta',
    );
    const warnings = only(b, 'wardley-duplicate-component');
    expect(warnings.map((w) => w.line)).toEqual([3, 4]);
    for (const warning of warnings) {
      expect(warning.message).toContain('first on line 2');
    }
  });

  // A pipeline member's id is synthetic (`Kettle_Electric`), so it is a
  // genuinely different node from a top-level `component Electric`.
  it('does not flag a pipeline member sharing a top-level component name', () => {
    const b = block(
      [
        'wardley-beta',
        '  component Kettle [0.5, 0.6]',
        '  component Electric [0.1, 0.2]',
        '  pipeline Kettle {',
        '    component Electric [0.63]',
        '  }',
      ].join('\n'),
      'wardley-beta',
    );
    expect(only(b, 'wardley-duplicate-component')).toEqual([]);
  });

  it('stays silent when every name is distinct', () => {
    const b = block(
      [
        'wardley-beta',
        '  anchor Business [0.95, 0.63]',
        '  component User [0.9, 0.5]',
        '  component Kettle [0.5, 0.6]',
      ].join('\n'),
      'wardley-beta',
    );
    expect(only(b, 'wardley-duplicate-component')).toEqual([]);
  });
});

describe('parseWardley', () => {
  it('collects the coordinate value from every construct, discarding the annotation index and any trailing label', () => {
    const parsed = parseWardley([
      'wardley-beta',
      '  note "Some note" [0.4, 0.55]',
      '  accelerator Public cloud [0.62, 0.35]',
      '  annotations [1, 4]',
      '  annotation 1, [0.7, 0.8]',
      '  size [800, 600]',
      '  component Widget [0.62, 0.75] label [10, -20]',
    ]);

    expect(parsed.coordinates).toEqual([
      { value: 0.4, line: 2 },
      { value: 0.55, line: 2 },
      { value: 0.62, line: 3 },
      { value: 0.35, line: 3 },
      { value: 1, line: 4 },
      { value: 4, line: 4 },
      { value: 0.7, line: 5 },
      { value: 0.8, line: 5 },
      { value: 0.62, line: 7 },
      { value: 0.75, line: 7 },
    ]);
  });
});
