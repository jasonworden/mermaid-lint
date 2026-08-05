import { describe, expect, it } from 'vitest';
import { detectDiagramType } from '../src/type-detect.js';

describe('detectDiagramType', () => {
  it('detects flowchart', () => {
    expect(detectDiagramType('flowchart LR\n  A-->B')).toBe('flowchart');
  });

  it('detects sequenceDiagram', () => {
    expect(detectDiagramType('sequenceDiagram\n  Alice->>Bob: hi')).toBe(
      'sequenceDiagram',
    );
  });

  it('detects classDiagram', () => {
    expect(detectDiagramType('classDiagram\n  class Foo')).toBe('classDiagram');
  });

  it('detects stateDiagram-v2', () => {
    expect(detectDiagramType('stateDiagram-v2\n  [*] --> s1')).toBe(
      'stateDiagram-v2',
    );
  });

  it('detects graph (alias for flowchart)', () => {
    expect(detectDiagramType('graph TD\n  A-->B')).toBe('graph');
  });

  it('skips leading comment lines', () => {
    expect(detectDiagramType('%% comment\nflowchart LR\n  A-->B')).toBe(
      'flowchart',
    );
  });

  it('returns unknown for empty body', () => {
    expect(detectDiagramType('')).toBe('unknown');
  });

  it('returns unknown for unclosed fence sentinel', () => {
    expect(detectDiagramType('__UNCLOSED_FENCE__')).toBe('unknown');
  });

  it('returns unknown for comment-only body', () => {
    expect(detectDiagramType('%% only a comment')).toBe('unknown');
  });

  it('detects the type past leading YAML frontmatter', () => {
    expect(
      detectDiagramType('---\ntitle: T\n---\nflowchart LR\n  A --> B'),
    ).toBe('flowchart');
  });

  it('detects the type past frontmatter followed by a comment', () => {
    expect(
      detectDiagramType('---\ntitle: T\n---\n%% note\nsequenceDiagram'),
    ).toBe('sequenceDiagram');
  });

  it('returns --- for unterminated frontmatter', () => {
    expect(detectDiagramType('---\ntitle: T\nflowchart LR')).toBe('---');
  });

  it('returns unknown when the body is only frontmatter', () => {
    expect(detectDiagramType('---\ntitle: T\n---')).toBe('unknown');
  });

  it('ignores a --- that does not open the body', () => {
    expect(detectDiagramType('flowchart LR\n---\ntitle: T\n---')).toBe(
      'flowchart',
    );
  });

  it('returns --- for frontmatter preceded by a blank line', () => {
    // This looks like it should detect 'flowchart', but a leading blank line
    // means the frontmatter does not open the body, so it is not skipped —
    // matching Mermaid's own behavior under a single preprocessing pass.
    // Mermaid's `cleanupText` does not trim, and `cleanupComments`'s
    // `trimStart()` runs *after* `processFrontmatter`, so a body that starts
    // with a blank line still has that blank line when frontmatter detection
    // runs, and the block is not recognized as frontmatter. This is what
    // `render` does (one preprocessing pass); `mermaid.parse` survives it only
    // because it preprocesses twice. See the pinned boundary for issue #123
    // at `mermaid-behavior.test.ts:81` ('accepts content before frontmatter,
    // which is why parse alone cannot catch #123') — do not "fix" this case
    // without re-checking that boundary, since the two are the same
    // single-vs-double-preprocessing distinction.
    expect(detectDiagramType('\n---\ntitle: T\n---\nflowchart LR')).toBe('---');
  });
});
