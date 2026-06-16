import { describe, expect, it } from 'vitest';
import { detectDiagramType } from '../src/type-detect.js';

describe('detectDiagramType', () => {
  it('detects flowchart', () => {
    expect(detectDiagramType('flowchart LR\n  A-->B')).toBe('flowchart');
  });

  it('detects sequenceDiagram', () => {
    expect(detectDiagramType('sequenceDiagram\n  Alice->>Bob: hi')).toBe('sequenceDiagram');
  });

  it('detects classDiagram', () => {
    expect(detectDiagramType('classDiagram\n  class Foo')).toBe('classDiagram');
  });

  it('detects stateDiagram-v2', () => {
    expect(detectDiagramType('stateDiagram-v2\n  [*] --> s1')).toBe('stateDiagram-v2');
  });

  it('detects graph (alias for flowchart)', () => {
    expect(detectDiagramType('graph TD\n  A-->B')).toBe('graph');
  });

  it('skips leading comment lines', () => {
    expect(detectDiagramType('%% comment\nflowchart LR\n  A-->B')).toBe('flowchart');
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
});
