import { describe, expect, it } from 'vitest';
import { block } from './helpers.js';
import { only } from './helpers.js';

function kb(...body: string[]): Block {
  return block(['kanban', ...body].join('\n'), 'kanban');
}

describe('kanban-duplicate-column rule', () => {
  it('reports every repeat after the first, each naming the first line', () => {
    const b = kb(
      '  Todo',
      '    t1[A]',
      '  Todo',
      '    t2[B]',
      '  Todo',
      '    t3[C]',
    );
    const findings = only(b, 'kanban-duplicate-column');
    // Reported on the later column, naming the first — the convention
    // `wardley-duplicate-component` and `eventmodeling-duplicate-frame-id` set.
    expect(findings.map((f) => f.line)).toEqual([4, 6]);
    for (const finding of findings) {
      expect(finding.severity).toBe('warn');
      expect(finding.message).toContain('`Todo`');
      expect(finding.message).toContain('line 2');
      // The severe consequence, which only column-on-column has.
      expect(finding.message).toContain('renders several times over');
    }
  });

  it('keys on the id, not the label, so distinct ids never collide', () => {
    // `c1[Todo]` and `c2[Todo]` read alike but are two nodes to mermaid, and
    // its cards stay in their own column. Flagging the label here would fire
    // on a board that renders exactly as written.
    const b = kb('  c1[Todo]', '    t1[A]', '  c2[Todo]', '    t2[B]');
    expect(only(b, 'kanban-duplicate-column')).toEqual([]);
  });

  it('flags a column colliding with an earlier card, without the fan-out claim', () => {
    // The rules split the namespace by the *offending* declaration, so this
    // direction is a column's finding even though the holder is a card. There
    // is no card fan-out here — only the shared id collision — so the message
    // must not promise one.
    const b = kb('  Todo', '    x[A]', '  x[Doing]');
    const findings = only(b, 'kanban-duplicate-column');
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(4);
    expect(findings[0].message).toContain('a card on line 3');
    expect(findings[0].message).not.toContain('renders several times over');
    // And it is this rule's alone — the card rule answers only for cards.
    expect(only(b, 'kanban-duplicate-task-id')).toEqual([]);
  });
});

describe('kanban-duplicate-task-id rule', () => {
  it('flags two cards sharing an id in one column', () => {
    const b = kb('  Todo', '    t1[A]', '    t1[B]');
    const findings = only(b, 'kanban-duplicate-task-id');
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].line).toBe(4);
    expect(findings[0].message).toContain('`t1`');
    expect(findings[0].message).toContain('a card on line 3');
  });

  it('flags two cards sharing an id across columns', () => {
    const b = kb('  Todo', '    t1[A]', '  Doing', '    t1[B]');
    const findings = only(b, 'kanban-duplicate-task-id');
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(5);
    expect(findings[0].message).toContain('a card on line 3');
  });

  it('flags a card colliding with a column, since they share one namespace', () => {
    const b = kb('  t1[Todo]', '    t1[A]');
    const findings = only(b, 'kanban-duplicate-task-id');
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(3);
    expect(findings[0].message).toContain('a column on line 2');
  });

  it('splits every collision direction between the two rules, one each', () => {
    // The partition is by offending declaration, not by the pair of kinds, so
    // no direction goes unreported and none is reported twice. This body has
    // all four: card→card (5), card→column (7), column→column (6),
    // column→card (8).
    const b = kb(
      '  Todo', //      2  column Todo
      '    t1[A]', //   3  card   t1
      '    t1[B]', //   4  card   t1  → card→card
      '  Todo', //      5  column Todo → column→column
      '    t1[C]', //   6  card   t1  → card→card
      '    Todo', //    7  card   Todo → card→column
      '  t1[Done]', //  8  column t1  → column→card
    );
    expect(only(b, 'kanban-duplicate-task-id').map((f) => f.line)).toEqual([
      4, 6, 7,
    ]);
    expect(only(b, 'kanban-duplicate-column').map((f) => f.line)).toEqual([
      5, 8,
    ]);
  });

  it('reads a card written without an id as its label', () => {
    const b = kb('  Todo', '    [A]', '    [A]');
    const findings = only(b, 'kanban-duplicate-task-id');
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('`A`');
  });

  it('does not normalize whitespace or trailing comments into a collision', () => {
    // Mermaid's `NODE_ID` swallows both, so `t1 ` and `t1` are two nodes with
    // two DOM ids, and a bare card keeps its `%%` text. Trimming here would
    // report collisions the diagram does not have.
    expect(
      only(kb('  Todo', '    t1[A]', '    t1 [B]'), 'kanban-duplicate-task-id'),
    ).toEqual([]);
    expect(
      only(
        kb('  Todo', '    A card', '    A card %% note'),
        'kanban-duplicate-task-id',
      ),
    ).toEqual([]);
  });

  it('returns [] for a board whose card ids are all distinct', () => {
    const b = kb('  Todo', '    t1[A]', '    t2[B]', '  Doing', '    t3[C]');
    expect(only(b, 'kanban-duplicate-task-id')).toEqual([]);
  });
});

describe('kanban-empty-column rule', () => {
  it('flags an empty column wherever it sits in the board', () => {
    const b = kb(
      '  Todo',
      '    t1[A]',
      '  Doing',
      '  Done',
      '    t2[B]',
      '  Later',
    );
    const findings = only(b, 'kanban-empty-column');
    expect(findings.map((f) => f.line)).toEqual([4, 7]);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].message).toContain('`Doing`');
  });

  it('does not count a decorator, comment, or shape-data line as a card', () => {
    // `::icon(...)` decorates the node above it, an own-line `%%` declares
    // nothing, and the interior of a multi-line `@{ … }` block belongs to the
    // card that opened it. Reading any of them as a card would silence this
    // rule on a genuinely empty column.
    const b = kb(
      '  Todo',
      '    t1[A]@{',
      "      assigned: 'alice'",
      '    }',
      '    ::icon(fa fa-book)',
      '  Doing',
      '    %% nothing here yet',
    );
    const findings = only(b, 'kanban-empty-column');
    expect(findings.map((f) => f.line)).toEqual([7]);
  });

  it('reads a node indented past the column level as a card, however deep', () => {
    // Mermaid's `getSection` compares against the column level alone rather
    // than tracking a stack, so an over-indented node is still a card of the
    // column above — not a nested column, and not a reason to call `Todo`
    // empty.
    const b = kb('  Todo', '        t1[A]');
    expect(only(b, 'kanban-empty-column')).toEqual([]);
  });

  it('returns [] when every column holds a card', () => {
    const b = kb('  Todo', '    t1[A]', '  Doing', '    t2[B]');
    expect(only(b, 'kanban-empty-column')).toEqual([]);
  });
});

describe('kanban-no-columns rule', () => {
  it('flags a board with no columns, anchored at the header', () => {
    const findings = only(kb(), 'kanban-no-columns');
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].line).toBe(1);
  });

  it('flags a body of only blank lines and comments', () => {
    // Mermaid skips both, so these render exactly as an empty board does.
    // `kanban-empty-column` cannot cover this: with no column there is
    // nothing for it to report against.
    for (const body of [kb('', '  ', ''), kb('  %% nothing here yet')]) {
      expect(only(body, 'kanban-no-columns')).toHaveLength(1);
      expect(only(body, 'kanban-empty-column')).toEqual([]);
    }
  });

  it('stays silent on a `title` row, which kanban reads as a column', () => {
    // Kanban's grammar has no `title` token — unlike gantt, journey, or
    // timeline — so this declares an ordinary column named `title Board`
    // and the board is not empty. Reading it as a title would make this
    // rule fire on a diagram that renders content.
    const b = kb('  title Board');
    expect(only(b, 'kanban-no-columns')).toEqual([]);
    expect(only(b, 'kanban-empty-column').map((f) => f.line)).toEqual([2]);
  });

  it('returns [] once the board has a column', () => {
    expect(only(kb('  Todo', '    t1[A]'), 'kanban-no-columns')).toEqual([]);
    // A column with no cards is still a column — that is the empty-column
    // rule's finding, not this one's.
    expect(only(kb('  Todo'), 'kanban-no-columns')).toEqual([]);
  });

  it('anchors past frontmatter rather than at body line 1', () => {
    // `headerLine` locates the `kanban` keyword, so a frontmatter block
    // neither counts as a column nor shifts the reported line.
    const b = block('---\ntitle: Board\n---\nkanban\n', 'kanban');
    const findings = only(b, 'kanban-no-columns');
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(4);
  });

  it('does not apply to another indentation-based type', () => {
    expect(only(block('mindmap\n', 'mindmap'), 'kanban-no-columns')).toEqual(
      [],
    );
  });
});

describe('kanban id extraction', () => {
  it(
    'reads an unclosed wrapper in linear time (ReDoS regression)',
    // Same shape as the guard in suppress.test.ts, and for the same reason:
    // only the failing path is slow, so a passing run costs ~1ms while a
    // regression has to run to completion before it can be reported. A timeout
    // would hide which check failed.
    { timeout: 60_000 },
    () => {
      // `kanbanWrappedLabel` is reached for every line opening with one of
      // `([){}`, and a line of bare `(` never closes — the failing case. The
      // obvious regex for it, `/^[([){}]+(.*?)[()\]{}]+…$/`, stacks three
      // quantifiers over overlapping character sets and backtracks cubically:
      // 4 000 characters took ~25s standalone and ~74s through the rules.
      // Diagram bodies are user input and `checkSemantics` runs ahead of any
      // parse, so an unparseable body still reaches this.
      //
      // At 20 000 characters the two complexity classes are far enough apart
      // that this asserts a budget orders of magnitude from both rather than
      // measuring a growth rate — the scan is sub-millisecond, the cubic regex
      // would not finish this run.
      const b = kb('  Todo', `    ${'('.repeat(20_000)}x`);

      const start = performance.now();
      const findings = only(b, 'kanban-duplicate-task-id');
      const elapsed = performance.now() - start;

      // The line closes no wrapper, so it declares no node at all.
      expect(findings).toEqual([]);
      expect(only(b, 'kanban-empty-column').map((f) => f.line)).toEqual([2]);
      expect(elapsed).toBeLessThan(500);
    },
  );
});
