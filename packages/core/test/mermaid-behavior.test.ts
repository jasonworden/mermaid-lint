import { describe, expect, it } from 'vitest';
import { detectDiagramType } from '../src/type-detect.js';
import { validateWithMermaidJS } from '../src/validate.js';

// These assertions pin *Mermaid's* behavior, not ours. If a mermaid bump
// changes any of them, the suppression design's assumptions have shifted and
// this file is where that surfaces. See
// docs/superpowers/specs/2026-07-24-suppression-directives-design.md.

const DIAGRAMS: Record<string, string> = {
  flowchart: 'flowchart LR\n  A[Start] --> B[End]',
  graph: 'graph LR\n  A --> B',
  sequenceDiagram: 'sequenceDiagram\n  Alice->>Bob: Hi',
  classDiagram: 'classDiagram\n  class Animal',
  'stateDiagram-v2': 'stateDiagram-v2\n  [*] --> Still',
  erDiagram: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places',
  pie: 'pie\n  "A" : 40',
  gitGraph: 'gitGraph\n  commit',
  mindmap: 'mindmap\n  root((mindmap))\n    A',
  timeline: 'timeline\n  title History\n  2002 : Item',
  'block-beta': 'block-beta\n  columns 1\n  A',
  'packet-beta': 'packet-beta\n  0-15: "Src"',
  journey: 'journey\n  title My day\n  section Go\n    Wake: 5: Me',
  gantt: 'gantt\n  title A\n  section S\n  Task :a1, 2014-01-01, 30d',
  quadrantChart:
    'quadrantChart\n  x-axis Low --> High\n  y-axis Low --> High\n  A: [0.3, 0.6]',
  requirementDiagram:
    'requirementDiagram\n  requirement test_req {\n  id: 1\n  text: the test\n  risk: high\n  verifymethod: test\n  }',
  C4Context: 'C4Context\n  title X\n  Person(a, "A")',
  'sankey-beta': 'sankey-beta\nA,B,10',
  'xychart-beta':
    'xychart-beta\n  x-axis [a, b]\n  y-axis "v" 0 --> 10\n  bar [1, 2]',
  'architecture-beta': 'architecture-beta\n  group api(cloud)[API]',
  kanban: 'kanban\n  Todo\n    task[A]',
  'radar-beta': 'radar-beta\n  axis a, b\n  curve c{1, 2}',
  eventmodeling: 'eventmodeling\n  tf 1\n  ui Screen ->> 1',
  'treemap-beta': 'treemap-beta\n"A"\n  "B": 10',
  'venn-beta': 'venn-beta\n  set A\n  set B',
  'ishikawa-beta': 'ishikawa-beta\n  Problem\n    Cause A\n      Sub cause',
  'wardley-beta': 'wardley-beta\n  title Map\n  component User [0.9, 0.5]',
  'treeView-beta': 'treeView-beta\n  "root"\n    "child"',
};

const DIRECTIVE = '%% mermaid-lint-disable-next-line duplicate-ids: probe';

interface ProbeNode {
  name: string;
  value?: number;
  children?: ProbeNode[];
}

/**
 * Reach past the verdict to a diagram's own db. `validateWithMermaidJS` reports
 * only whether a body parsed, and several rules below turn on the *shape*
 * Mermaid derived from it instead. The leading call is load-bearing beyond its
 * assertion: it is what installs the jsdom window mermaid needs at import time,
 * so it must stay ahead of the dynamic import.
 */
async function probeDb<T>(body: string): Promise<T> {
  expect((await validateWithMermaidJS(body)).ok).toBe(true);
  const { default: mermaid } = await import('mermaid');
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(body);
  return diagram.db as T;
}

/** The hierarchy Mermaid derived from a treemap-beta body. */
async function treemapRoot(body: string): Promise<ProbeNode> {
  return (await probeDb<{ getRoot(): ProbeNode }>(body)).getRoot();
}

interface ProbeKanbanNode {
  id: string;
  label?: string;
  isGroup: boolean;
}

/**
 * Build a kanban diagram and hand back the node list its renderer is driven
 * from. The kanban rules turn on *which* nodes mermaid emits and under which
 * ids, and `getData` is where both are decided — a verdict alone would say
 * nothing, since every body below parses clean.
 */
async function kanbanNodes(body: string): Promise<string[]> {
  const db = await probeDb<{ getData(): { nodes: ProbeKanbanNode[] } }>(body);
  return db
    .getData()
    .nodes.map(
      (n) => `${n.isGroup ? 'column' : 'card'} ${n.id}=${n.label ?? ''}`,
    );
}

interface ProbeIshikawaNode {
  text: string;
  children: ProbeIshikawaNode[];
}

/**
 * The tree mermaid derived from an ishikawa-beta body, flattened to
 * `depth:text` lines. The ishikawa rules turn on which node ends up under
 * which parent, and `IshikawaDB.addNode` resolves that differently from the
 * other indentation-based types — so a verdict says nothing here, and the
 * shape is the whole point.
 */
async function ishikawaTree(body: string): Promise<string[]> {
  const db = await probeDb<{ getRoot(): ProbeIshikawaNode | undefined }>(body);
  const walk = (node: ProbeIshikawaNode, depth: number): string[] => [
    `${depth}:${node.text}`,
    ...node.children.flatMap((child) => walk(child, depth + 1)),
  ];
  const root = db.getRoot();
  return root === undefined ? [] : walk(root, 1);
}

describe('mermaid behavior contracts', () => {
  it('parses every diagram type the README claims support for', async () => {
    // The README's "27 diagram types" table is only true as long as the
    // bundled mermaid still recognizes each keyword. Pinned here so a mermaid
    // bump that drops or renames a type fails CI instead of quietly making the
    // docs wrong.
    for (const [type, body] of Object.entries(DIAGRAMS)) {
      const result = await validateWithMermaidJS(body);
      expect(result.ok, `${type}: ${JSON.stringify(result)}`).toBe(true);
      expect(detectDiagramType(body)).toBe(type);
    }
  }, 30_000);

  it('accepts own-line %% comments in every supported diagram type', async () => {
    for (const [type, body] of Object.entries(DIAGRAMS)) {
      const leading = await validateWithMermaidJS(`${DIRECTIVE}\n${body}`);
      expect(leading.ok, `${type}: directive as leading line`).toBe(true);

      const lines = body.split('\n');
      const indent = /^\s*/.exec(lines[lines.length - 1])?.[0] ?? '';
      const mid = [
        ...lines.slice(0, -1),
        indent + DIRECTIVE,
        lines[lines.length - 1],
      ].join('\n');
      const midResult = await validateWithMermaidJS(mid);
      expect(midResult.ok, `${type}: directive mid-diagram`).toBe(true);
    }
  }, 30_000);

  it('rejects trailing %% comments — this is why -disable-line does not exist', async () => {
    // Mermaid requires comments on their own line. A trailing comment breaks
    // the diagram it annotates, so a `-disable-line` form is unimplementable.
    for (const type of ['flowchart', 'graph', 'classDiagram', 'erDiagram']) {
      const body = DIAGRAMS[type];
      const trailing = `${body} %% trailing note`;
      const result = await validateWithMermaidJS(trailing);
      expect(result.ok, `${type}: trailing comment should NOT parse`).toBe(
        false,
      );
    }
  }, 30_000);

  it('accepts positional radar-beta curves whose length does not match the axes', async () => {
    // The premise of `radar-curve-length-mismatch`: Mermaid renders a
    // misaligned polygon instead of erroring, in both directions. If a bump
    // makes either reject, the parser catches it and the rule is redundant.
    const axes = 'radar-beta\n  axis a, b, c\n';
    expect((await validateWithMermaidJS(`${axes}  curve x{1, 2}`)).ok).toBe(
      true,
    );
    expect(
      (await validateWithMermaidJS(`${axes}  curve x{1, 2, 3, 4}`)).ok,
    ).toBe(true);
  }, 30_000);

  it('rejects an incomplete keyed radar-beta curve, which is why the length rule skips them', async () => {
    // `radar-curve-length-mismatch` deliberately ignores the `{axis: value}`
    // form because Mermaid validates it ("Missing entry for axis b"). If this
    // starts passing, the rule should widen to cover keyed curves too.
    const result = await validateWithMermaidJS(
      'radar-beta\n  axis a, b, c\n  curve x{a: 1}',
    );
    expect(result.ok).toBe(false);
  }, 30_000);

  it('accepts a trailing colon only on the radar-beta header', async () => {
    // Radar's grammar uniquely allows `radar-beta:`, so the type string keeps
    // the colon and every `-beta` suffix test has to tolerate it. Pinned so a
    // bump that adds or drops the form surfaces here.
    expect(
      (await validateWithMermaidJS('radar-beta:\n  axis a, b\n  curve x{1, 2}'))
        .ok,
    ).toBe(true);
    expect(detectDiagramType('radar-beta:\n  axis a, b')).toBe('radar-beta:');
    expect(
      (
        await validateWithMermaidJS(
          'xychart-beta:\n  x-axis [a, b]\n  line [1, 2]',
        )
      ).ok,
    ).toBe(false);
  }, 30_000);

  it('accepts the treemap-beta shapes the treemap rules exist to flag', async () => {
    // Each of these parses clean under the bundled mermaid, which is the whole
    // premise of the treemap rules: they are semantic gaps, not syntax errors
    // the parser already reports. If a bump makes any of them reject, the
    // matching rule is redundant.
    const bodies = {
      'treemap-zero-value': 'treemap-beta\n"Root"\n  "A": 0\n  "B": 10',
      'treemap-no-leaves': 'treemap-beta\n"Root"',
      'treemap-duplicate-sibling': 'treemap-beta\n"Root"\n  "A": 5\n  "A": 10',
      'treemap-branch-with-value': 'treemap-beta\n"Root": 99\n  "A": 5',
    };
    for (const [rule, body] of Object.entries(bodies)) {
      const result = await validateWithMermaidJS(body);
      expect(result.ok, `${rule}: ${JSON.stringify(result)}`).toBe(true);
    }
  }, 30_000);

  it('accepts every treemap-beta row form TREEMAP_ROW_RE has to recognize', async () => {
    // A row the regex misses is a row every treemap rule goes blind on, so the
    // grammar's less obvious corners are pinned here: the separator may be a
    // comma, a leaf's `:::class` trails its value, and a value is a run of
    // digits, `.`, `_`, and `,` rather than a plain number.
    const rows = [
      '"A", 30',
      '"A",30',
      '"A" : 30',
      '"A": 5:::big',
      '"A": 1,000',
      '"A": 1_000',
      '"A": 5.',
      '"A": .5',
      '"A": 1%% trailing comment',
      "'A': 30",
    ];
    for (const row of rows) {
      const result = await validateWithMermaidJS(
        `treemap-beta\n"Root"\n  ${row}`,
      );
      expect(result.ok, `${row}: ${JSON.stringify(result)}`).toBe(true);
    }

    // The mirror image: a leaf whose selector precedes its value is a parse
    // error, so the regex is right to reject that order.
    expect(
      (await validateWithMermaidJS('treemap-beta\n"Root"\n  "A":::big: 5')).ok,
    ).toBe(false);
  }, 30_000);

  it('reads treemap-beta values by dropping group commas, then parsing', async () => {
    // What `treemapValue` reimplements, and the reason `treemap-zero-value`
    // cannot just compare the raw text to "0": `1,000` is a thousand while
    // `1_000` is one, and several spellings of zero are not the digit alone.
    const root = await treemapRoot(
      'treemap-beta\n"Root"\n  "A": 1,000\n  "B": 1_000\n  "C": 0.\n  "D": 0_0',
    );
    expect(root.children?.[0].children?.map((leaf) => leaf.value)).toEqual([
      1000, 1, 0, 0,
    ]);
  }, 30_000);

  it('rejects a negative treemap-beta value, which is why the zero rule is zero-only', async () => {
    // `treemap-zero-value` is deliberately narrower than
    // `sankey-non-positive-value`: sankey accepts `A,B,-5`, but a negative
    // treemap value is a lexer error, so only the zero half is reachable. If
    // this starts passing, the rule should widen to match sankey's.
    const result = await validateWithMermaidJS(
      'treemap-beta\n"Root"\n  "A": -5\n  "B": 10',
    );
    expect(result.ok).toBe(false);
  }, 30_000);

  it('re-parents rows indented under a valued treemap-beta row', async () => {
    // The claim `treemap-branch-with-value` makes, and the one thing parse
    // acceptance alone cannot show. Mermaid types any row carrying a value as
    // a `Leaf` and never pushes it onto its hierarchy stack, so `"A"` lands
    // beside `"Root"` instead of inside it — neither summing the children nor
    // honoring the literal, but silently flattening. `parseTreemapRows`
    // reproduces the same stack, so if this changes both the rule and that
    // parser's notion of "sibling" are wrong.
    const root = await treemapRoot('treemap-beta\n"Root": 99\n  "A": 5');
    expect(root.children?.map((child) => child.name)).toEqual(['Root', 'A']);
    expect(root.children?.[0].children).toBeUndefined();
  }, 30_000);

  it('detects the diagram type past YAML frontmatter', () => {
    // Regression pin for
    // https://github.com/jasonworden/mermaid-lint/issues/122: this returned
    // '---' before the frontmatter skip landed, which made every semantic
    // rule's `appliesTo` reject the block.
    const withFm = '---\ntitle: T\n---\nflowchart LR\n  A --> B';
    expect(detectDiagramType(withFm)).toBe('flowchart');
    expect(detectDiagramType('flowchart LR\n  A --> B')).toBe('flowchart');
  });

  it('accepts content before frontmatter, which is why parse alone cannot catch #123', async () => {
    // mermaid.parse preprocesses twice and recovers; render preprocesses once
    // and fails, so parse is strictly more permissive here — see
    // https://github.com/jasonworden/mermaid-lint/issues/123. We can only
    // assert the parse half: render needs CSSOM that jsdom does not provide.
    // The point of pinning it is that these stay `true`. If a mermaid bump
    // makes either reject, parse has become strict enough to catch #123 on its
    // own and the planned frontmatter-must-be-first rule can be reconsidered.
    const body = '---\ntitle: My Diagram\n---\nflowchart LR\n  A --> B';
    expect((await validateWithMermaidJS(body)).ok).toBe(true);
    expect((await validateWithMermaidJS(`%% note\n${body}`)).ok).toBe(true);
    // A bare blank line is enough — which is why frontmatter-must-be-first
    // fires on anything preceding the block, not just non-empty lines.
    expect((await validateWithMermaidJS(`\n${body}`)).ok).toBe(true);
  }, 20_000);

  it('still rejects unterminated frontmatter, which frontmatter-must-be-first defers to', async () => {
    // The rule stays silent when nothing precedes the `---` because this
    // syntax error already covers it. If a mermaid bump starts accepting an
    // unterminated block, that silence becomes a real gap and this fails.
    const result = await validateWithMermaidJS(
      '---\ntitle: T\nflowchart LR\n  A --> B',
    );
    expect(result.ok).toBe(false);
  }, 20_000);

  it('rejects wardley-beta coordinates above 100, which is why there is no out-of-range rule', async () => {
    // `toPercent` in mermaid's wardleyParser reads a value at or below 1 as a
    // 0-1 fraction and anything above it as a 0-100 percentage, then throws
    // past 100. So no coordinate can sit outside the unit square and still
    // parse, and issue #129's `wardley-coordinate-out-of-range` has nothing
    // left to catch. `wardley-mixed-coordinate-scale` covers the real gap —
    // the silent ambiguity between the two notations. If a bump makes 100.1
    // parse, an out-of-range rule becomes worth having again.
    expect(
      (await validateWithMermaidJS('wardley-beta\n  component A [0.9, 100.0]'))
        .ok,
    ).toBe(true);
    expect(
      (await validateWithMermaidJS('wardley-beta\n  component A [0.9, 100.1]'))
        .ok,
    ).toBe(false);
    // 1.5 is not "out of range" — it is 1.5%, which is exactly the ambiguity.
    expect(
      (await validateWithMermaidJS('wardley-beta\n  component A [0.9, 1.5]'))
        .ok,
    ).toBe(true);
  }, 20_000);

  it('rejects negative and bare-integer wardley-beta coordinates', async () => {
    // `WARDLEY_NUMBER` is /[0-9]+\.[0-9]+/, so a sign never lexes as a
    // coordinate anywhere. A bare integer does lex for `annotations` /
    // `annotation`, whose `CoordinateValue` also accepts an `INT` — it just
    // lands on the range check above instead, which rejects it all the same.
    // This is the other half of why an out-of-range rule is unimplementable,
    // and why the mixed-scale rule only has to classify values as "at or
    // below 1" versus "above 1".
    expect(
      (await validateWithMermaidJS('wardley-beta\n  component A [-0.2, 0.5]'))
        .ok,
    ).toBe(false);
    expect(
      (await validateWithMermaidJS('wardley-beta\n  component A [0, 0]')).ok,
    ).toBe(false);
    expect(
      (
        await validateWithMermaidJS(
          'wardley-beta\n  component A [0.9, 0.5]\n  annotations [1, 200]',
        )
      ).ok,
    ).toBe(false);
    // Bare integers lex for `annotations`, but [1, 4] passes the range check
    // while [1, 200] fails it. Together, these pin that bare integers do lex.
    expect(
      (
        await validateWithMermaidJS(
          'wardley-beta\n  component A [0.9, 0.5]\n  annotations [1, 4]',
        )
      ).ok,
    ).toBe(true);
    expect(
      (await validateWithMermaidJS('wardley-beta\n  component A [0.0, 1.0]'))
        .ok,
    ).toBe(true);
  }, 20_000);

  it('accepts wardley-beta links and evolves naming an undeclared component', async () => {
    // The premise of `wardley-undefined-component`. Mermaid parses both, then
    // drops them without a diagnostic: the renderer filters links whose
    // endpoints have no position, and populateDb skips an `evolve` whose
    // component it cannot find. If either starts rejecting, the parser covers
    // it and the rule is redundant.
    const base = 'wardley-beta\n  component User [0.9, 0.5]\n';
    expect((await validateWithMermaidJS(`${base}  User -> Ghost`)).ok).toBe(
      true,
    );
    expect((await validateWithMermaidJS(`${base}  Ghost -> User`)).ok).toBe(
      true,
    );
    expect((await validateWithMermaidJS(`${base}  evolve Ghost 0.8`)).ok).toBe(
      true,
    );
  }, 20_000);

  it('rejects a wardley-beta pipeline whose parent is undeclared, which is why the rule skips pipeline parents', async () => {
    // `wardley-undefined-component` deliberately ignores the `pipeline <parent>`
    // reference because mermaid validates it itself ("must reference an
    // existing component with coordinates"). If this starts passing, the rule
    // should widen to cover pipeline parents too.
    const result = await validateWithMermaidJS(
      'wardley-beta\n  component Kettle [0.5, 0.6]\n  pipeline Ghost {\n    component Electric [0.63]\n  }',
    );
    expect(result.ok).toBe(false);
  }, 20_000);

  it('accepts a repeated wardley-beta component or anchor name', async () => {
    // The premise of `wardley-duplicate-component`. `WardleyBuilder.addNode`
    // merges by id, and both `component` and `anchor` register under their bare
    // name, so each of these collapses into one node with the last coordinates
    // winning — silently, since nothing rejects. If a bump starts rejecting
    // them, the parser covers it and the rule is redundant.
    expect(
      (
        await validateWithMermaidJS(
          'wardley-beta\n  component A [0.9, 0.5]\n  component A [0.3, 0.2]',
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await validateWithMermaidJS(
          'wardley-beta\n  anchor Foo [0.95, 0.63]\n  component Foo [0.3, 0.2]',
        )
      ).ok,
    ).toBe(true);
  }, 20_000);

  it('rejects a trailing colon on the wardley-beta header, unlike radar-beta', async () => {
    // Radar uniquely allows `radar-beta:`. Wardley does not, so `isWardley`
    // does not strictly need `stripHeaderColon` — it routes through it anyway
    // so the block would not silently fall out of the wardley rules if a bump
    // added the form. Pinned so that bump surfaces here.
    expect(
      (await validateWithMermaidJS('wardley-beta:\n  component A [0.9, 0.5]'))
        .ok,
    ).toBe(false);
  }, 20_000);

  it('accepts eventmodeling defects the three new rules exist to catch', async () => {
    // eventmodeling parses through langium but runs neither validation nor
    // cross-reference linking at parse time, so all three of these are accepted
    // rather than reported. What the renderer then does with each differs, and
    // only the first is a plain no-op: it omits the arrow; it renders *both*
    // frames sharing an id and draws one arrow per frame the `->>` matches; and
    // it leaves the disallowed flow unchecked. If a mermaid bump starts
    // rejecting any of these, the matching rule
    // (eventmodeling-undefined-frame / -duplicate-frame-id / -invalid-flow)
    // becomes redundant and this is where that surfaces.
    expect(
      (
        await validateWithMermaidJS(
          'eventmodeling\n  tf 1 ui Screen\n  tf 2 cmd DoIt ->> 99',
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await validateWithMermaidJS(
          'eventmodeling\n  tf 1 ui Screen\n  tf 1 cmd DoIt',
        )
      ).ok,
    ).toBe(true);
    // mermaid's own EventModelingValidator forbids an event sourced from a
    // ui frame — evt may only follow cmd — but that validator never runs.
    expect(
      (
        await validateWithMermaidJS(
          'eventmodeling\n  tf 1 ui Screen\n  tf 2 evt ItHappened ->> 1',
        )
      ).ok,
    ).toBe(true);
  }, 20_000);

  it('accepts eventmodeling data payloads whose text reads like code', async () => {
    // A frame statement may close with an inline data payload, `EM_DATA_INLINE`
    // = /\{(.*)\}|"(.*)"|'(.*)'/, whose contents are free text. That is what
    // makes `stripEventModelingComments` skip payload spans and
    // `tokenizeEventModeling` mask them: inside one, a comment opener is not a
    // comment and a frame statement is not a declaration. Every body below is
    // accepted today. If a mermaid bump starts rejecting any of them, the
    // payload handling in semantic.ts is guarding a shape that no longer
    // parses, and this is where that surfaces.

    // A comment opener inside a quoted payload. Read as a comment, this one
    // silences every frame below it.
    expect(
      (
        await validateWithMermaidJS(
          'eventmodeling\n  tf 1 ui Screen "a /* b"\n  tf 2 cmd DoIt ->> 99',
        )
      ).ok,
    ).toBe(true);
    // Two payloads spelling a block comment's opener and closer on separate
    // rows. Read as a comment, the frame between them disappears.
    expect(
      (
        await validateWithMermaidJS(
          'eventmodeling\n  tf 1 ui A "/*"\n  tf 2 evt B "*/"\n  tf 3 cmd C ->> 2',
        )
      ).ok,
    ).toBe(true);
    // The brace spelling of the same terminal.
    expect(
      (
        await validateWithMermaidJS(
          'eventmodeling\n  tf 1 ui A {/*}\n  tf 2 cmd B ->> 99',
        )
      ).ok,
    ).toBe(true);
    // A whole frame statement written inside a payload. It declares nothing —
    // tokenized, it would invent a frame `2`.
    expect(
      (
        await validateWithMermaidJS(
          'eventmodeling\n  tf 1 ui A "tf 2 cmd B"\n  tf 3 cmd C ->> 2',
        )
      ).ok,
    ).toBe(true);
    // No whitespace either side of the payload, and a second statement on the
    // same line: the shape that says the payload must be blanked rather than
    // cut out, since a cut would fuse `A` and `tf` into one token.
    expect(
      (await validateWithMermaidJS('eventmodeling\n  tf 1 ui A"x"tf 2 cmd B'))
        .ok,
    ).toBe(true);
    // And the payload closes the statement: it follows the `->>` sources
    // rather than preceding them. This is why the fixtures above put it last.
    expect(
      (
        await validateWithMermaidJS(
          'eventmodeling\n  tf 1 ui A\n  tf 2 cmd B "x" ->> 1',
        )
      ).ok,
    ).toBe(false);
  }, 20_000);

  it('gives every card of a duplicated kanban column to all of them', async () => {
    // The whole claim of `kanban-duplicate-column`, and the reason it is the
    // most consequential of the three rather than the least. `getData` walks
    // the sections and, for each, filters *all* nodes by `parentId ===
    // section.id` — so two columns sharing an id each collect the other's
    // cards. The renderer then re-filters that already-duplicated list per
    // section, which squares it again. Only the `getData` half is asserted
    // below — mermaid's renderer needs CSSOM jsdom does not provide, the same
    // limit the frontmatter case above runs into — so the squaring is a probe
    // result quoted in `rules.ts`, not something this file pins. The six nodes
    // asserted here are the duplication it stands on. Distinct ids under one
    // label do not collide, which is why the rule keys on the id, not the
    // label.
    expect(
      await kanbanNodes('kanban\n  Todo\n    t1[A]\n  Todo\n    t2[B]'),
    ).toEqual([
      'column Todo=Todo',
      'card t1=A',
      'card t2=B',
      'column Todo=Todo',
      'card t1=A',
      'card t2=B',
    ]);
    expect(
      await kanbanNodes('kanban\n  c1[Todo]\n    t1[A]\n  c2[Todo]\n    t2[B]'),
    ).toEqual(['column c1=Todo', 'card t1=A', 'column c2=Todo', 'card t2=B']);
  }, 20_000);

  it('renders both kanban cards that share a task id, and an empty column', async () => {
    // `kanban-duplicate-task-id` is *not* about a broken reference — nothing
    // references a card id, so both cards render and their metadata stays put.
    // What collides is the DOM id the renderer derives (`<svg-id>-<node-id>`).
    // The same holds for a card colliding with its column, which is why the
    // rule reads columns and cards as one namespace.
    expect(await kanbanNodes('kanban\n  Todo\n    t1[A]\n    t1[B]')).toEqual([
      'column Todo=Todo',
      'card t1=A',
      'card t1=B',
    ]);
    expect(await kanbanNodes('kanban\n  t1[Todo]\n    t1[A]')).toEqual([
      'column t1=Todo',
      'card t1=A',
    ]);
    // `kanban-empty-column`: the column survives into the node list with no
    // children, so mermaid draws its header over empty space.
    expect(await kanbanNodes('kanban\n  Todo\n    t1[A]\n  Doing')).toEqual([
      'column Todo=Todo',
      'card t1=A',
      'column Doing=Doing',
    ]);
  }, 20_000);

  it('derives kanban ids the way kanbanNodeId does', async () => {
    // Every corner `kanbanNodeId` has to reproduce, pinned against mermaid
    // itself. A bare node is its own id; a wrapped node with no id takes its
    // label; `]` is legal inside an id while `@` is not; and neither
    // whitespace nor a trailing `%%` is stripped from a bare node — so
    // `t1 [B]` really is a different node from `t1`, and normalizing either
    // here would invent collisions mermaid does not have.
    expect(await kanbanNodes('kanban\n  Todo\n    t1[A]\n    t1 [B]')).toEqual([
      'column Todo=Todo',
      'card t1=A',
      'card t1 =B',
    ]);
    expect(await kanbanNodes('kanban\n  Todo\n    [A]\n    a]b[C]')).toEqual([
      'column Todo=Todo',
      'card A=A',
      'card a]b=C',
    ]);
    // Every wrapper an id-less node can carry, not just the square one:
    // `kanbanWrappedLabel` scans the delimiters as runs rather than matching
    // them as pairs, and the cloud and bang shapes invert the parentheses, so
    // the open and close sets are deliberately not mirror images. Without
    // these, that claim rests on the `[…]` case alone.
    expect(
      await kanbanNodes(
        'kanban\n  Todo\n    ((B))\n    {{C}}\n    ))D((\n    )E(\n    (F)',
      ),
    ).toEqual([
      'column Todo=Todo',
      'card B=B',
      'card C=C',
      'card D=D',
      'card E=E',
      'card F=F',
    ]);
    expect(
      await kanbanNodes(
        "kanban\n  Todo\n    A card %% note\n    B@{ icon: 'x' }",
      ),
    ).toEqual([
      'column Todo=Todo',
      'card A card %% note=A card %% note',
      'card B=B',
    ]);
  }, 20_000);

  it('accepts an empty kanban, which is why kanban-no-columns exists', async () => {
    // Issue #149 ruled that rule out on the grounds that an empty kanban is
    // already a parse error. It is not: a bare keyword, a body of blank
    // lines, and a body of only comments all parse clean and produce no
    // nodes, so nothing but a semantic rule reports them. If a bump makes
    // any of these reject, the rule is redundant and should go.
    for (const body of ['kanban\n', 'kanban\n\n\n', 'kanban\n  %% nothing\n']) {
      expect((await validateWithMermaidJS(body)).ok, body).toBe(true);
      expect(await kanbanNodes(body)).toEqual([]);
    }

    // The one spelling that does fail, and why the rule cannot lean on it:
    // jison wants a NEWLINE, which every fenced block and `.mmd` file has.
    expect((await validateWithMermaidJS('kanban')).ok).toBe(false);

    // Kanban's grammar has no `title` token, so this is a column named
    // `title Board` rather than a title — the board is not empty, and
    // `kanban-no-columns` must stay silent on it.
    expect(await kanbanNodes('kanban\n  title Board\n')).toEqual([
      'column title Board=title Board',
    ]);
  }, 20_000);
  it('keeps every ishikawa node under one problem, whatever its indent', async () => {
    // `IshikawaDB.addNode` pops with `while (stack.length > 1 && …)`, so the
    // first node is never popped and a fishbone has exactly one root. Both
    // shapes below would be a *second root* under mindmap's stack-of-indents
    // parser; `parseIshikawaNodes` replicates addNode instead because of this.
    expect(await ishikawaTree('ishikawa-beta\n  P1\n  P2\n    C\n')).toEqual([
      '1:P1',
      '2:P2',
      '3:C',
    ]);
    // Outdenting past the problem lands in the same place — `level` is clamped
    // to 1 rather than escaping the tree.
    expect(await ishikawaTree('ishikawa-beta\n    P1\n  P2\n')).toEqual([
      '1:P1',
      '2:P2',
    ]);
    // Three at one indent are siblings, not a chain: only the *first* node is
    // special.
    expect(await ishikawaTree('ishikawa-beta\n  P1\n  P2\n  P3\n')).toEqual([
      '1:P1',
      '2:P2',
      '2:P3',
    ]);
  }, 20_000);

  it('sets the ishikawa base indent from the second node, not the first', async () => {
    // `baseLevel ??= rawLevel` runs after the root's early return, so the
    // problem's own indent is never read and an unindented one works.
    expect(await ishikawaTree('ishikawa-beta\nProblem\n  Cause\n')).toEqual([
      '1:Problem',
      '2:Cause',
    ]);
    // Text trailing the keyword is the problem — the rules read the header
    // line for exactly this, since skipping it would lose the root.
    expect(await ishikawaTree('ishikawa-beta Problem\n    Method\n')).toEqual([
      '1:Problem',
      '2:Method',
    ]);
    // A `%%` tail on that line is not text, though — the lexer's comment rule
    // (`\s*%%.*`) is tried before `TEXT` at that position, so it wins and
    // declares nothing. Asserted on the body that isolates it: were the tail
    // read as text it would be the root, and the tree would not be empty.
    // `parseIshikawaNodes` skips it for the same reason.
    expect(await ishikawaTree('ishikawa-beta %% note\n')).toEqual([]);
  }, 20_000);

  it('normalizes an ishikawa indent jump instead of creating phantom levels', async () => {
    // `B` is indented six columns past `A` and is still just its child, and
    // `C` returning to `A`'s indent makes it `A`'s sibling. A tab counts as
    // one column, same as a space (`indentWidth`).
    expect(
      await ishikawaTree('ishikawa-beta\n  P\n    A\n          B\n    C\n'),
    ).toEqual(['1:P', '2:A', '3:B', '2:C']);
    expect(await ishikawaTree('ishikawa-beta\n  P\n\t\tA\n\t\t\tB\n')).toEqual([
      '1:P',
      '2:A',
      '3:B',
    ]);
  }, 20_000);

  it('keeps ishikawa node text verbatim, with no shapes, ids, or directives', async () => {
    // The grammar is `SPACELIST TEXT` with `TEXT` as `[^\n]+`, so unlike
    // mindmap there is nothing to unwrap: quotes stay, inner whitespace is
    // significant, a trailing `%%` is text rather than a comment, and `title`
    // is a node like any other. `parseIshikawaNodes` therefore has no
    // text-extraction step, and `ishikawa-duplicate-sibling` compares raw.
    expect(
      await ishikawaTree(
        'ishikawa-beta\n  P\n    "X"\n    a  b\n    A %% note\n    title T\n',
      ),
    ).toEqual(['1:P', '2:"X"', '2:a  b', '2:A %% note', '2:title T']);
    // Trailing whitespace *is* trimmed, by the grammar's own `.trim()`.
    expect(await ishikawaTree('ishikawa-beta\n  P\n    Same  \n')).toEqual([
      '1:P',
      '2:Same',
    ]);
    // An own-line `%%` is a comment (lexer rule 0, `\s*%%.*`) and declares no
    // node — which is what lets the rules skip those lines.
    expect(
      await ishikawaTree('ishikawa-beta\n  P\n    %% soon\n    A\n'),
    ).toEqual(['1:P', '2:A']);
  }, 20_000);

  it('parses an empty ishikawa body and gives it no root', async () => {
    // #147 excludes an empty-diagram rule as "already a parse error". It is
    // not — only the no-trailing-newline form errors, which no fenced or
    // `.mmd` diagram is. The renderer opens with `if (!root) return`, so this
    // body renders an empty `<svg>`: an `ishikawa-no-nodes` rule is reachable,
    // and `ishikawa-no-causes` stays silent here on purpose rather than naming
    // a problem node that does not exist.
    expect(await ishikawaTree('ishikawa-beta\n')).toEqual([]);
    expect((await validateWithMermaidJS('ishikawa-beta')).ok).toBe(false);
  }, 20_000);
});
