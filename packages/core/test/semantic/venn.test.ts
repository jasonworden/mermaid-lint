import { describe, expect, it } from 'vitest';
import { block } from './helpers.js';
import { only } from './helpers.js';

function vn(...body: string[]): Block {
  return block(['venn-beta', ...body].join('\n'), 'venn-beta');
}

describe('venn-duplicate-set rule', () => {
  it('reports every repeat after the first, each naming the first line', () => {
    const b = vn('  set A', '  set B', '  set A', '  set A');
    const findings = only(b, 'venn-duplicate-set');
    // Reported on the later declaration, naming the first — the convention
    // `kanban-duplicate-column` and `sankey-duplicate-link` set.
    expect(findings.map((f) => f.line)).toEqual([4, 5]);
    for (const finding of findings) {
      expect(finding.severity).toBe('warn');
      expect(finding.message).toContain('`A`');
      expect(finding.message).toContain('line 2');
    }
  });

  it('collides a quoted identifier with its bare form', () => {
    // `vennDB.normalizeText` strips the quotes before anything is compared, so
    // to mermaid these are one set — as `union A, B` resolving proves.
    const b = vn('  set "A"', '  set A', '  set B');
    const findings = only(b, 'venn-duplicate-set');
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(3);
    expect(findings[0].message).toContain('`A`');
  });

  it('ignores the label, which does not make two declarations distinct', () => {
    // Both circles draw the *last* label, so differing labels are not two
    // sets — they are one set whose first label silently never renders.
    const b = vn('  set A["First"]', '  set A["Second"]', '  set B');
    expect(only(b, 'venn-duplicate-set').map((f) => f.line)).toEqual([3]);
  });

  it('does not read a union identifier as a set declaration', () => {
    // Repeating the union too: if union identifiers counted as declarations,
    // `A` and `B` would each be reported twice over.
    const b = vn('  set A', '  set B', '  union A, B', '  union A, B');
    expect(only(b, 'venn-duplicate-set')).toEqual([]);
  });
});

describe('venn-non-positive-size rule', () => {
  it('flags a zero-sized set, whose set and intersections both vanish', () => {
    const b = vn('  set A: 0', '  set B: 10', '  union A, B');
    const findings = only(b, 'venn-non-positive-size');
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].line).toBe(2);
    expect(findings[0].message).toContain('`A`');
    expect(findings[0].message).toContain('(0)');
  });

  it('flags a negative set size, which the lexer accepts', () => {
    // Unlike treemap, `NUMERIC` carries the sign (`[+-]?…`), so the negative
    // half is reachable here and `venn-non-positive-size` covers what
    // `treemap-zero-value` cannot.
    const b = vn('  set A: -5', '  set B: 10');
    const findings = only(b, 'venn-non-positive-size');
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(2);
    expect(findings[0].message).toContain('(-5)');
  });

  it('flags a non-positive union size with the union wording', () => {
    const b = vn('  set A', '  set B', '  union A, B: -3');
    const findings = only(b, 'venn-non-positive-size');
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(4);
    expect(findings[0].message).toContain('union `A, B`');
    expect(findings[0].message).toContain('nothing renders');
  });

  it('reads a size past a label, and with no space after the colon', () => {
    const b = vn('  set A["Label"]: 0', '  set B:0', '  set C: 1');
    expect(only(b, 'venn-non-positive-size').map((f) => f.line)).toEqual([
      2, 3,
    ]);
  });

  it('returns [] for positive and implicit sizes', () => {
    // A set with no `: value` is sized by `addSubsetData`'s own default, which
    // is always positive — silence here, not a default-valued finding.
    const b = vn('  set A', '  set B: +5', '  set C: .5', '  union A, B');
    expect(only(b, 'venn-non-positive-size')).toEqual([]);
  });
});

describe('venn-single-set rule', () => {
  it('flags a one-set diagram on its declaration', () => {
    const b = vn('  set A');
    const findings = only(b, 'venn-single-set');
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].line).toBe(2);
    expect(findings[0].message).toContain('`A`');
  });

  it('counts distinct identifiers, so a repeat is still one set', () => {
    // `venn-duplicate-set` answers for the repeat; this rule answers for the
    // diagram having nothing to intersect, which two `set A`s still do not.
    const b = vn('  set A', '  set A');
    expect(only(b, 'venn-single-set')).toHaveLength(1);
  });

  it('returns [] for two sets, and for a body declaring none', () => {
    expect(only(vn('  set A', '  set B'), 'venn-single-set')).toEqual([]);
    expect(only(vn('  title Empty'), 'venn-single-set')).toEqual([]);
  });
});

describe('venn-self-union rule', () => {
  it('flags an identifier repeated inside one union', () => {
    const b = vn('  set A', '  set B', '  union A, A');
    const findings = only(b, 'venn-self-union');
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].line).toBe(4);
    expect(findings[0].message).toContain('`A`');
  });

  it('flags a repeat among distinct identifiers, and normalizes quotes', () => {
    const b = vn('  set A', '  set B', '  union A, B, "A"');
    const findings = only(b, 'venn-self-union');
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(4);
    expect(findings[0].message).toContain('`A`');
  });

  it('returns [] for a union over distinct sets', () => {
    const b = vn(
      '  set A',
      '  set B',
      '  set C',
      '  union A, B',
      '  union A, B, C',
    );
    expect(only(b, 'venn-self-union')).toEqual([]);
  });
});

describe('venn-no-sets rule', () => {
  it('flags a body declaring no set, on the header line', () => {
    const findings = only(vn(), 'venn-no-sets');
    expect(findings).toHaveLength(1);
    // `error`, not `warn`, and the only no-data rule that is. Every other one
    // describes a diagram that renders an empty frame; this one describes a
    // render probe (mermaid 11.15.0) that throws `Cannot read properties of
    // undefined (reading 'set')`, so there is no judgment call to defer.
    expect(findings[0].severity).toBe('error');
    expect(findings[0].line).toBe(1);
  });

  it('anchors past frontmatter rather than at body line 1', () => {
    // `headerLine` is the header's own body line, which frontmatter pushes
    // down. Every other case here goes through `vn()`, where it is 1 and so
    // indistinguishable from a hardcoded line number.
    const b = block('---\ntitle: Sets\n---\nvenn-beta\n', 'venn-beta');
    expect(only(b, 'venn-no-sets').map((f) => f.line)).toEqual([4]);
  });

  it('flags a body carrying only decoration', () => {
    // Each of these parses clean and each crashes the renderer identically —
    // neither `title` nor `style` nor a comment contributes a subset.
    expect(only(vn('  title Hello'), 'venn-no-sets')).toHaveLength(1);
    expect(
      only(vn('  title Hello', '  style A fill:#f00'), 'venn-no-sets'),
    ).toHaveLength(1);
    expect(only(vn('  %% nothing here'), 'venn-no-sets')).toHaveLength(1);
  });

  it('returns [] as soon as one set is declared', () => {
    expect(only(vn('  set A'), 'venn-no-sets')).toEqual([]);
    // Even a set the other rules object to still counts as data.
    expect(only(vn('  set A: 0'), 'venn-no-sets')).toEqual([]);
  });

  it('still fires on a union-only body, which the syntax pass also rejects', () => {
    // `validateUnionIdentifiers` throws `unknown set identifier: …`, so this
    // body is already a syntax error and the finding is a second voice on the
    // same defect. It is kept rather than suppressed because it is the voice
    // that says what to do: a `union` over sets that were never declared is
    // fixed by declaring them.
    expect(only(vn('  union A, B'), 'venn-no-sets')).toHaveLength(1);
  });
});

describe('venn-duplicate-union rule', () => {
  it('reports every repeat after the first, each naming the first line', () => {
    const b = vn(
      '  set A',
      '  set B',
      '  union A, B',
      '  union A, B',
      '  union A, B',
    );
    const findings = only(b, 'venn-duplicate-union');
    expect(findings.map((f) => f.line)).toEqual([5, 6]);
    expect(findings[0].severity).toBe('warn');
    // Both cite the *first* sighting, not the previous one — the third union
    // duplicates line 4, not line 5.
    expect(findings[0].message).toContain('line 4');
    expect(findings[1].message).toContain('line 4');
  });

  it('omits the citation when the repeat shares its line', () => {
    // Statements are not line-terminated, so both unions sit on body line 4
    // and naming that line back would be noise. Same treatment as
    // `radar-duplicate-axis`.
    const b = vn('  set A', '  set B', '  union A, B union A, B');
    const findings = only(b, 'venn-duplicate-union');
    expect(findings.map((f) => f.line)).toEqual([4]);
    expect(findings[0].message).not.toContain('line 4');
    expect(findings[0].message).toContain('already declared;');
  });

  it('collides on a reordered list, since mermaid sorts each one', () => {
    // `addSubsetData` sorts the identifiers before storing them, so
    // `union B, A` is the same subset as `union A, B` — verified against
    // `getSubsetData()` in mermaid-behavior.test.ts. The message quotes the
    // list as written, not as sorted.
    const b = vn('  set A', '  set B', '  union A, B', '  union B, A');
    const findings = only(b, 'venn-duplicate-union');
    expect(findings.map((f) => f.line)).toEqual([5]);
    expect(findings[0].message).toContain('`B, A`');
  });

  it('normalizes quoted identifiers, and keeps case distinct', () => {
    // `normalizeText` strips a surrounding pair of quotes, so `"A"` is `A`.
    expect(
      only(
        vn('  set A', '  set B', '  union "A", B', '  union A, B'),
        'venn-duplicate-union',
      ).map((f) => f.line),
    ).toEqual([5]);
    // Nothing folds case, so `a` and `A` are two sets and these are two
    // unions — `getSubsetData()` reports `A,B` and `B,a` separately.
    expect(
      only(
        vn('  set A', '  set a', '  set B', '  union A, B', '  union a, B'),
        'venn-duplicate-union',
      ),
    ).toEqual([]);
  });

  it('does not merge two unions that differ only in size or label', () => {
    // Neither is part of the subset key mermaid stores under, so both of
    // these are the same region declared twice.
    expect(
      only(
        vn('  set A', '  set B', '  union A, B: 5', '  union A, B: 9'),
        'venn-duplicate-union',
      ).map((f) => f.line),
    ).toEqual([5]);
    expect(
      only(
        vn('  set A', '  set B', '  union A, B["One"]', '  union A, B["Two"]'),
        'venn-duplicate-union',
      ).map((f) => f.line),
    ).toEqual([5]);
  });

  it('returns [] for distinct intersections', () => {
    const b = vn(
      '  set A',
      '  set B',
      '  set C',
      '  union A, B',
      '  union B, C',
      '  union A, B, C',
    );
    expect(only(b, 'venn-duplicate-union')).toEqual([]);
  });

  it('keys on a separator no identifier can contain', () => {
    // A quoted identifier may hold a comma, so `union "A,B", C` is a
    // two-element list. Keyed on a comma it would collide with the genuinely
    // different three-element `union A, B, C`.
    expect(
      only(
        vn(
          '  set "A,B"',
          '  set A',
          '  set B',
          '  set C',
          '  union "A,B", C',
          '  union A, B, C',
        ),
        'venn-duplicate-union',
      ),
    ).toEqual([]);
    // The quoted form's body is `[^"]*`, which admits *every* character but
    // `"` — including NUL, the separator the sibling duplicate rules key on.
    // Only `"` itself is safe here.
    expect(
      only(
        vn(
          `  set "A\u0000B"`,
          '  set A',
          '  set B',
          '  set C',
          `  union "A\u0000B", C`,
          '  union A, B, C',
        ),
        'venn-duplicate-union',
      ),
    ).toEqual([]);
  });
});

describe('venn statement scanning', () => {
  it('matches keywords case-insensitively, as the mermaid lexer does', () => {
    // Every rule in venn.jison carries the `i` flag, so `SET A` parses.
    const b = vn('  SET A', '  Set A', '  set B', '  UNION A, A');
    expect(only(b, 'venn-duplicate-set').map((f) => f.line)).toEqual([3]);
    expect(only(b, 'venn-self-union').map((f) => f.line)).toEqual([5]);
  });

  it('skips comments and blank lines', () => {
    const b = vn('  set A', '', '  %% set A', '  set B');
    expect(only(b, 'venn-duplicate-set')).toEqual([]);
  });

  it('reads a statement carrying a trailing comment', () => {
    const b = vn('  set A %% first', '  set A %% again', '  set B');
    expect(only(b, 'venn-duplicate-set').map((f) => f.line)).toEqual([3]);
  });

  it('accepts identifiers containing dashes and underscores', () => {
    const b = vn('  set a-b', '  set c_d', '  set a-b', '  union a-b, c_d');
    expect(only(b, 'venn-duplicate-set').map((f) => f.line)).toEqual([4]);
  });

  it('reads every statement on a line, since newlines do not terminate them', () => {
    // `document` is a list of `line`s and `line` is `statement | NEWLINE`, so
    // a newline is a line of its own rather than a terminator and one physical
    // line may carry several statements. Verified against mermaid 11.15.0:
    // `set A set B` renders two circles, and `set A set A` renders the
    // duplicate (4 regions, labels A, A, B, "").
    expect(only(vn('  set A set B'), 'venn-single-set')).toEqual([]);
    expect(
      only(vn('  set A set A', '  set B'), 'venn-duplicate-set').map(
        (f) => f.line,
      ),
    ).toEqual([2]);
    // Both statements are on one line, so both findings cite that line.
    expect(
      only(vn('  set A set A set A', '  set B'), 'venn-duplicate-set').map(
        (f) => f.line,
      ),
    ).toEqual([2, 2]);
  });

  it('does not scan past a keyword that swallows its line', () => {
    // `title` lexes as `title\s[^#\n;]+`, so it takes the rest of the line
    // with it: the `set B` here is title text, not a declaration. Reading one
    // would invent a second set and silence `venn-single-set`.
    const b = vn('  set A', '  title Comparing set B against set C');
    expect(only(b, 'venn-single-set')).toHaveLength(1);
    expect(only(b, 'venn-duplicate-set')).toEqual([]);
  });

  it('ends a quoted label at the closing quote, not the first bracket', () => {
    // The lexer tries `["…"]` before `[…]` and its body is `[^"]*`, so a `]`
    // is legal inside a quoted label. Cutting at the first `]` would leave the
    // label's tail to be read as a size — mermaid renders this exactly as a
    // plain two-set diagram, with A labelled `]: -5`.
    expect(
      only(vn('  set A["]: -5"]', '  set B'), 'venn-non-positive-size'),
    ).toEqual([]);
    // …and the converse: a real size after such a label must still be read.
    expect(
      only(vn('  set A["x]y"]: 0', '  set B'), 'venn-non-positive-size').map(
        (f) => f.line,
      ),
    ).toEqual([2]);
    // A bare label cannot contain `]` at all, so it ends at the first one.
    expect(
      only(vn('  set A[a, b]: 0', '  set B'), 'venn-non-positive-size').map(
        (f) => f.line,
      ),
    ).toEqual([2]);
  });

  it('does not read a comment as a statement, but keeps one inside a label', () => {
    // A `%%` between statements opens a comment; a `%%` inside a label was
    // already consumed with it, the way the lexer takes `["50%% off"]` whole.
    expect(
      only(vn('  set A %% set A', '  set B'), 'venn-duplicate-set'),
    ).toEqual([]);
    expect(only(vn('  set A["50%% off"] set B'), 'venn-single-set')).toEqual(
      [],
    );
  });

  it('does not treat a keyword prefix as a statement', () => {
    // `settings` is one `IDENTIFIER` to the lexer, not `set` + `tings`; the
    // `\b` in the keyword pattern is what keeps it out.
    const b = vn('  set A', '  set B', '  text settings');
    expect(only(b, 'venn-duplicate-set')).toEqual([]);
  });

  it('scans a pathological line in linear time', () => {
    // The scan is a left-to-right pass rather than one combined regex, which
    // would stack quantifiers over overlapping character sets and backtrack
    // super-linearly. A diagram body is user input and `checkSemantics` runs
    // ahead of any parse, so an unparseable body still reaches it. Shape
    // follows the magnitude test #143 established.
    //
    // The identifiers are *distinct* deliberately. A repeated one (`A, A, …`)
    // exercises neither hot path: `venn-self-union` reports at the second
    // identifier and stops, so a quadratic dedupe would pass this test — which
    // is exactly what an earlier `indexOf`-based one did, at 255ms for this
    // input. The clean union is the adversarial case for both.
    const long = `  union ${Array.from({ length: 20_000 }, (_, i) => `A${i}`).join(', ')}`;
    const started = performance.now();
    expect(only(vn(long), 'venn-self-union')).toEqual([]);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it('keys many distinct unions in linear time', () => {
    // `venn-duplicate-union` is the one venn rule whose work spans statements:
    // it accumulates a key per union. A `Map` keeps that linear; scanning an
    // array of accumulated keys instead would be quadratic — the same mistake
    // `venn-self-union` records having already made once with `indexOf`.
    //
    // The unions are *distinct* deliberately, so every key is inserted and
    // every lookup misses. A body of repeats would report at the second union
    // and leave the accumulation shallow.
    const many = Array.from(
      { length: 20_000 },
      (_, i) => `  union A${i}, B${i}`,
    );
    const started = performance.now();
    expect(only(vn(...many), 'venn-duplicate-union')).toEqual([]);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
