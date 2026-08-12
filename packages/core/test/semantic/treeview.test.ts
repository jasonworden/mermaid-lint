import { describe, expect, it } from 'vitest';
import { block } from './helpers.js';
import { only } from './helpers.js';

function tv(...body: string[]): Block {
  return block(['treeView-beta', ...body].join('\n'), 'treeView-beta');
}

describe('treeview-no-nodes rule', () => {
  it('flags a header with nothing under it', () => {
    const findings = only(tv(), 'treeview-no-nodes');
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].line).toBe(1);
    expect(findings[0].message).toContain('renders as an empty tree');
  });

  it('flags a body that is metadata and comments only', () => {
    // Every one of these can contain a quoted run, and none of them declares a
    // node. Reading `title "Releases"` as a node would silence the rule on a
    // diagram that renders empty.
    const b = tv(
      '  title "Releases"',
      '  accTitle: "Releases"',
      '  accDescr: covers "v1" and "v2"',
      '  %% "not a node"',
      '',
    );
    expect(only(b, 'treeview-no-nodes').map((f) => f.line)).toEqual([1]);
  });

  it('skips an accDescr block, in both its brace forms', () => {
    expect(
      only(
        tv('  accDescr {', '    "v1"', '    "v2"', '  }'),
        'treeview-no-nodes',
      ),
    ).toHaveLength(1);
    expect(
      only(tv('  accDescr', '  {', '    "v1"', '  }'), 'treeview-no-nodes'),
    ).toHaveLength(1);
    // A same-line block closes immediately, so what follows is nodes again.
    expect(
      only(tv('  accDescr { prose }', '  "root"'), 'treeview-no-nodes'),
    ).toEqual([]);
  });

  it('does not read a node off the header line', () => {
    // Through 11.15 the grammar took a `STRING2` straight after the keyword
    // and the scan resumed past it. 11.16.0 dropped that: `treeView-beta
    // "root"` is a parse error now, so the only thing a scan can do with the
    // header line is start below it. Still reading a node here would silence
    // the rule on a body that renders nothing at all.
    expect(
      only(block('treeView-beta "root"', 'treeView-beta'), 'treeview-no-nodes'),
    ).toHaveLength(1);
  });

  it('sees a node after an accDescr block closes on the same line', () => {
    // `ACC_DESCR` stops at the first `}` and the rest of the line keeps
    // lexing, so `accDescr { d } "p"` declares `p`. Skipping the whole line
    // would lose it.
    expect(only(tv('  accDescr { d } "p"'), 'treeview-no-nodes')).toEqual([]);
    // Same for the multi-line form's closing line.
    expect(
      only(tv('  accDescr {', '  d', '  } "p"'), 'treeview-no-nodes'),
    ).toEqual([]);
  });

  it('sees a node after a `title` with no space after it', () => {
    // `TITLE` ends with an empty alternative, so `title` only swallows its
    // line when a space or tab follows. `title"p"` is an empty title plus a
    // node `p` — mermaid renders it, so the scan must not skip the line.
    expect(only(tv('  title"p"'), 'treeview-no-nodes')).toEqual([]);
    // With a separator it does swallow the line, quotes and all.
    expect(only(tv('  title "p"'), 'treeview-no-nodes')).toHaveLength(1);
    expect(only(tv('  title\t"p"'), 'treeview-no-nodes')).toHaveLength(1);
    // A bare `title` is an empty title and swallows only itself.
    expect(only(tv('  title', '  "p"'), 'treeview-no-nodes')).toEqual([]);
  });

  it('sees a node whose name is not a statement keyword after all', () => {
    // `accTitle` and `accDescr` only exist as statements with their `:` or
    // `{`; without one, mermaid 11.16.0 lexes the line as a bare name. Reading
    // the keyword alone as metadata would call these trees empty.
    expect(only(tv('  accTitle foo'), 'treeview-no-nodes')).toEqual([]);
    expect(only(tv('  accDescr foo'), 'treeview-no-nodes')).toEqual([]);
    // A lone `accDescr` opens a block only if a `{` actually follows it, so
    // this one is a node called `accDescr`.
    expect(only(tv('  accDescr'), 'treeview-no-nodes')).toEqual([]);
    // And with the brace it is metadata again, across the newline.
    expect(
      only(tv('  accDescr', '  {', '    v1', '  }'), 'treeview-no-nodes'),
    ).toHaveLength(1);
  });

  it('returns [] once any node is declared', () => {
    expect(only(tv('  "root"'), 'treeview-no-nodes')).toEqual([]);
    // Either quote style is a node, and an empty label still is one.
    expect(only(tv("  'root'"), 'treeview-no-nodes')).toEqual([]);
    expect(only(tv('  ""'), 'treeview-no-nodes')).toEqual([]);
    // As of mermaid 11.16.0 so is a bare word, which through 11.15 was a lexer
    // error. Keying on quotes here would warn about a tree mermaid draws.
    expect(only(tv('  root'), 'treeview-no-nodes')).toEqual([]);
    expect(only(tv('  hello world'), 'treeview-no-nodes')).toEqual([]);
    // Including one that is nothing but punctuation.
    expect(only(tv('  >>>>'), 'treeview-no-nodes')).toEqual([]);
  });

  it('sees the nodes in a box-drawing body', () => {
    // The file-tree notation declares its nodes behind `├── ` / `└── `
    // prefixes rather than by indentation. A scan that only measured indents
    // would still find these, but one that skipped unrecognized leading
    // punctuation would call the whole tree empty.
    expect(
      only(
        block(
          ['treeView-beta', 'src/', '├── a.ts', '└── b.ts'].join('\n'),
          'treeView-beta',
        ),
        'treeview-no-nodes',
      ),
    ).toEqual([]);
  });

  it('does not apply to other indented diagram types', () => {
    expect(only(block('mindmap', 'mindmap'), 'treeview-no-nodes')).toEqual([]);
  });
});

describe('treeview-duplicate-sibling rule', () => {
  it('reports every repeat after the first, each naming the first line', () => {
    const b = tv('  "root"', '    "same"', '    "same"', '    "same"');
    const findings = only(b, 'treeview-duplicate-sibling');
    // Reported on the later node, naming the first — the convention
    // `mindmap-duplicate-sibling` set.
    expect(findings.map((f) => f.line)).toEqual([4, 5]);
    for (const finding of findings) {
      expect(finding.severity).toBe('warn');
      expect(finding.message).toContain('`same`');
      expect(finding.message).toContain('line 3');
    }
  });

  it('keys on the parent, so the same label under two parents is fine', () => {
    const b = tv('  "r1"', '    "x"', '  "r2"', '    "x"');
    expect(only(b, 'treeview-duplicate-sibling')).toEqual([]);
    // Nor does a child repeating its own parent's label collide.
    expect(only(tv('  "x"', '    "x"'), 'treeview-duplicate-sibling')).toEqual(
      [],
    );
  });

  it('flags duplicated top-level nodes', () => {
    // Everything at the top level shares mermaid's synthetic `/` root, so two
    // of them are siblings just as much as two children are.
    const findings = only(tv('  "r"', '  "r"'), 'treeview-duplicate-sibling');
    expect(findings.map((f) => f.line)).toEqual([3]);
    expect(findings[0].message).toContain('line 2');
  });

  it('treats the two quote styles as one label', () => {
    // Mermaid strips either quote to the same text, so `"a"` and `'a'` render
    // as one repeated branch and must read as one here too.
    expect(
      only(tv('  "a"', "  'a'"), 'treeview-duplicate-sibling'),
    ).toHaveLength(1);
  });

  it('re-parents on an outdent rather than assuming a fixed step', () => {
    // `b` outdents past `a` to a level no ancestor holds, so mermaid pops `a`
    // and lands it beside `x` under `r` — where it does duplicate. Inferring
    // an indent unit instead would put it somewhere mermaid never puts it.
    const b = tv('  "r"', '    "x"', '      "a"', '    "b"', '    "x"');
    const findings = only(b, 'treeview-duplicate-sibling');
    expect(findings.map((f) => f.line)).toEqual([6]);
    expect(findings[0].message).toContain('line 3');
  });

  it('indents a second label on a line from the space before it', () => {
    // Both labels on line 3 land under the synthetic root, not under `root` —
    // `"b"`'s indent is the single space between them, which pops `"a"` and
    // `"root"` both. So it duplicates the *top-level* `"b"`, not a child.
    const findings = only(
      tv('  "b"', '    "a" "b"'),
      'treeview-duplicate-sibling',
    );
    expect(findings.map((f) => f.line)).toEqual([3]);
    expect(findings[0].message).toContain('line 2');
  });

  it('keeps a mid-line node on the stack, so its children re-parent right', () => {
    // The node declared after the closing `}` is a real parent. Missing it
    // would drop `"p"` from the stack and land both `"x"` under the synthetic
    // root as siblings — a duplicate mermaid does not have. The edges here are
    // `/ > p`, `p > x`, `/ > x`: the two `x` sit at different depths.
    const b = tv('  accDescr { d } "p"', '    "x"', ' "x"');
    expect(only(b, 'treeview-duplicate-sibling')).toEqual([]);
  });

  it('reads bare names as nodes, and as the same label as quoted ones', () => {
    // Bare names arrived in mermaid 11.16.0. Two of them under one parent
    // collide exactly as two quoted ones do.
    expect(
      only(tv('  r', '    same', '    same'), 'treeview-duplicate-sibling').map(
        (f) => f.line,
      ),
    ).toEqual([4]);
    // And quoting one of a pair changes nothing: mermaid stores the same name
    // either way, so it draws the same branch twice.
    expect(
      only(tv('  r', '    same', '    "same"'), 'treeview-duplicate-sibling'),
    ).toHaveLength(1);
  });

  it('strips the trailing directory mark before comparing', () => {
    // `a/` and `a` are one name — the `/` marks the node a directory and is
    // not stored. Comparing the raw text would miss the repeat.
    const findings = only(
      tv('  r', '    a/', '    a'),
      'treeview-duplicate-sibling',
    );
    expect(findings.map((f) => f.line)).toEqual([4]);
    expect(findings[0].message).toContain('`a`');
  });

  it('strips annotations before comparing', () => {
    // A class, an icon, and a description are metadata on the node, not part
    // of its name, so two nodes that differ only there are still one branch
    // drawn twice.
    expect(
      only(
        tv('  r', '    a ##first', '    a ##second'),
        'treeview-duplicate-sibling',
      ).map((f) => f.line),
    ).toEqual([4]);
    expect(
      only(
        tv('  r', '    a :::one', '    a icon(folder)'),
        'treeview-duplicate-sibling',
      ),
    ).toHaveLength(1);
    // The annotation must be consumed, not merely stopped at: stepping a
    // character into `##first` would read `#first` as a second node.
    expect(only(tv('  a ##first'), 'treeview-duplicate-sibling')).toEqual([]);
  });

  it('reads a box-drawing body at the depth its prefixes imply', () => {
    // The two `a` are siblings under `src`, and `c` is not — it nests under
    // the first `a`. Reading the prefixes as part of the name, or ignoring
    // them and measuring the raw indent, would get both of those wrong.
    const b = block(
      ['treeView-beta', 'src/', '├── a', '│   └── c', '└── a', ''].join('\n'),
      'treeView-beta',
    );
    const findings = only(b, 'treeview-duplicate-sibling');
    expect(findings.map((f) => f.line)).toEqual([5]);
    expect(findings[0].message).toContain('line 3');
  });

  it('ignores quoted text inside metadata and comments', () => {
    const b = tv(
      '  title "root"',
      '  accDescr: about "root"',
      '  %% "root"',
      '  "root"',
    );
    expect(only(b, 'treeview-duplicate-sibling')).toEqual([]);
  });

  it('returns [] for a tree whose siblings are all distinct', () => {
    const b = tv('  "root"', '    "a"', '    "b"', '      "a"');
    expect(only(b, 'treeview-duplicate-sibling')).toEqual([]);
  });
});

describe('treeView label scanning', () => {
  it(
    'scans a quote-less line in linear time (ReDoS regression)',
    // Same shape and reason as the kanban guard above: only the failing path
    // is slow, so a passing run costs ~1ms while a regression has to run to
    // completion before it can be reported.
    { timeout: 60_000 },
    () => {
      // Writing the indent into `TREEVIEW_NAME_RE` as a leading `([ \t]*)`
      // re-scans the whole whitespace run at every start position it fails
      // from — quadratic on a line with nothing to anchor it. 80 000 spaces
      // took ~2.8s that way; counting the run backwards from a match is O(n)
      // over the line and does the same 80 000 in under a millisecond.
      // Diagram bodies are user input and `checkSemantics` runs ahead of any
      // parse, so an unparseable body still reaches this.
      //
      // The bare-name alternative added for mermaid 11.16.0 has to preserve
      // that: it starts on a character class that excludes whitespace, so
      // every start position in this line still fails on its first character.
      const b = tv(' '.repeat(80_000));

      const start = performance.now();
      const findings = only(b, 'treeview-duplicate-sibling');
      const elapsed = performance.now() - start;

      // Whitespace alone is not a name in either form, so no node at all.
      expect(findings).toEqual([]);
      expect(only(b, 'treeview-no-nodes').map((f) => f.line)).toEqual([1]);
      expect(elapsed).toBeLessThan(500);
    },
  );

  it(
    'looks ahead from a bare accDescr in linear time (ReDoS regression)',
    { timeout: 60_000 },
    () => {
      // The bare-`accDescr` branch has to look ahead for the `{` that may open
      // on a later line. Spelled `lines.slice(i + 1).find(…)` it copies the
      // whole remaining body once per bare `accDescr` — measured at ~8s for
      // 128 000 of them, a clean 4x per doubling. Walking an index instead
      // stops at the first non-blank line, which here is the next `accDescr`.
      const b = tv(...Array.from({ length: 60_000 }, () => '  accDescr'));

      const start = performance.now();
      const findings = only(b, 'treeview-no-nodes');
      const elapsed = performance.now() - start;

      // No `{` ever opens, so no line is an `accDescr` statement — as of
      // mermaid 11.16.0 each is a bare name instead, and the tree has 60 000
      // nodes in it. The lookahead still runs once per line, which is what
      // this measures; the verdict just changed sides with the grammar.
      expect(findings).toEqual([]);
      expect(elapsed).toBeLessThan(500);
    },
  );

  it('counts the indent of every label on a line, cheaply', () => {
    // The backwards count must stay correct where the forward capture was:
    // each label's indent is the run immediately before it, so the second
    // label on a line takes the single separating space.
    const b = tv('  "a" "a"');
    // Both land under the synthetic root — `"a"`'s indent of 1 pops the first
    // — so they are siblings and the second duplicates the first.
    expect(only(b, 'treeview-duplicate-sibling').map((f) => f.line)).toEqual([
      2,
    ]);
  });
});
