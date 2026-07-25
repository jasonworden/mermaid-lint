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
};

const DIRECTIVE = '%% mermaid-lint-disable-next-line duplicate-ids: probe';

describe('mermaid behavior contracts', () => {
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

  it('mis-detects the diagram type when YAML frontmatter is present', async () => {
    // Known bug, tracked in
    // https://github.com/jasonworden/mermaid-lint/issues/122. Pinned here so
    // the fix flips this assertion deliberately rather than silently.
    const withFm = '---\ntitle: T\n---\nflowchart LR\n  A --> B';
    expect(detectDiagramType(withFm)).toBe('---');
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
  }, 20_000);
});
