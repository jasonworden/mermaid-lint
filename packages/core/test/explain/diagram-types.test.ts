import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  KNOWN_DIAGRAM_TYPES,
  nearestDiagramType,
} from '../../src/explain/diagram-types.js';

describe('nearestDiagramType', () => {
  it('corrects a one-character typo', () => {
    expect(nearestDiagramType('flowchat')).toBe('flowchart');
  });
  it('corrects a case-only mismatch', () => {
    expect(nearestDiagramType('sequencediagram')).toBe('sequenceDiagram');
  });
  it('declines when nothing is close', () => {
    expect(nearestDiagramType('xyzchart_nonexistent')).toBeUndefined();
  });
  it('breaks a real tie deterministically', () => {
    // 'ganh' is distance 2 from both 'gantt' and 'graph'; same length, so
    // the alphabetical rule decides.
    expect(nearestDiagramType('ganh')).toBe('gantt');
  });
});

describe('KNOWN_DIAGRAM_TYPES', () => {
  it('covers every README diagram keyword', async () => {
    const src = await readFile(
      join(fileURLToPath(import.meta.url), '..', '..', '..', 'src', 'rules.ts'),
      'utf8',
    );
    const union = /export type ReadmeDiagramKeyword =([\s\S]*?);/.exec(src);
    expect(union).not.toBeNull();
    const keywords = [
      ...(union as RegExpExecArray)[1].matchAll(/'([^']+)'/g),
    ].map((m) => m[1]);
    expect(keywords.length).toBeGreaterThan(20);
    const missing = keywords.filter((k) => !KNOWN_DIAGRAM_TYPES.includes(k));
    expect(
      missing,
      `not in KNOWN_DIAGRAM_TYPES: ${missing.join(', ')}`,
    ).toEqual([]);
  });
});
