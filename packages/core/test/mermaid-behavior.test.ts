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
});
