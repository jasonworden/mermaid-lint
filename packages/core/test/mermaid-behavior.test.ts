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
 * Build a treemap-beta diagram and hand back the hierarchy Mermaid derived from
 * it. `validateWithMermaidJS` only reports a verdict, and the treemap rules
 * depend on *shape* — so this reaches past it to the diagram's own db. The
 * leading call is what installs the jsdom window mermaid needs at import time.
 */
async function treemapRoot(body: string): Promise<ProbeNode> {
  expect((await validateWithMermaidJS(body)).ok).toBe(true);
  const { default: mermaid } = await import('mermaid');
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(body);
  return (diagram.db as { getRoot(): ProbeNode }).getRoot();
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
});
