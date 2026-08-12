import { describe, expect, it } from 'vitest';
import { block } from './helpers.js';
import { only } from './helpers.js';

describe('experimental diagram-specific rules', () => {
  it('flags radar-beta with axes but no curves', () => {
    const b = block('radar-beta\n  axis a, b, c', 'radar-beta');
    const warnings = only(b, 'radar-no-curves');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('empty grid');
  });

  it('does not flag radar-beta when it has a curve', () => {
    const b = block(
      'radar-beta\n  axis a, b, c\n  curve x{1, 2, 3}',
      'radar-beta',
    );
    expect(only(b, 'radar-no-curves')).toEqual([]);
  });

  it('flags a radar-beta curve with too few values', () => {
    const b = block(
      'radar-beta\n  axis a, b, c\n  curve x{1, 2}',
      'radar-beta',
    );
    const warnings = only(b, 'radar-curve-length-mismatch');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].line).toBe(3);
    expect(warnings[0].message).toContain('2 values');
    expect(warnings[0].message).toContain('3 axes');
  });

  it('flags a radar-beta curve with too many values', () => {
    const b = block(
      'radar-beta\n  axis a, b, c\n  curve x{1, 2, 3, 4}',
      'radar-beta',
    );
    expect(only(b, 'radar-curve-length-mismatch')).toHaveLength(1);
  });

  it('counts radar-beta axes across every axis row', () => {
    // `axis a, b` + `axis c, d` declares four spokes, not two.
    const b = block(
      'radar-beta\n  axis a, b\n  axis c, d\n  curve x{1, 2, 3, 4}',
      'radar-beta',
    );
    expect(only(b, 'radar-curve-length-mismatch')).toEqual([]);
  });

  it('does not flag a keyed radar-beta curve', () => {
    // Mermaid rejects an incomplete `{axis: value}` curve itself
    // ("Missing entry for axis b"), so the rule would double-report.
    const b = block(
      'radar-beta\n  axis a, b, c\n  curve x{a: 1, b: 2, c: 3}',
      'radar-beta',
    );
    expect(only(b, 'radar-curve-length-mismatch')).toEqual([]);
  });

  it('does not flag a radar-beta curve when no axes are declared', () => {
    const b = block('radar-beta\n  curve x{1, 2, 3}', 'radar-beta');
    expect(only(b, 'radar-curve-length-mismatch')).toEqual([]);
  });

  it('flags a radar-beta axis id declared twice', () => {
    const b = block(
      'radar-beta\n  axis a, a, b\n  curve x{1, 2, 3}',
      'radar-beta',
    );
    const warnings = only(b, 'radar-duplicate-axis');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('"a"');
    // Both spokes sit on the row being reported, so no "first on line N".
    expect(warnings[0].message).not.toContain('first on line');
  });

  it('cites the first sighting when radar-beta axis rows differ', () => {
    const b = block(
      'radar-beta\n  axis a, b\n  axis a, c\n  curve x{1, 2, 3, 4}',
      'radar-beta',
    );
    const warnings = only(b, 'radar-duplicate-axis');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].line).toBe(3);
    expect(warnings[0].message).toContain('first on line 2');
  });

  it('flags two radar-beta axes that render the same label', () => {
    const b = block(
      'radar-beta\n  axis m["Score"], s["Score"]\n  curve x{1, 2}',
      'radar-beta',
    );
    const warnings = only(b, 'radar-duplicate-axis');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('"Score"');
  });

  it('does not flag distinct radar-beta axis labels', () => {
    const b = block(
      'radar-beta\n  axis m["Math"], s["Science"]\n  curve x{1, 2}',
      'radar-beta',
    );
    expect(only(b, 'radar-duplicate-axis')).toEqual([]);
  });

  it('keeps a comma inside a quoted radar-beta axis label intact', () => {
    const b = block(
      'radar-beta\n  axis a["X, Y"], b\n  curve p{1, 2}',
      'radar-beta',
    );
    expect(only(b, 'radar-curve-length-mismatch')).toEqual([]);
    expect(only(b, 'radar-duplicate-axis')).toEqual([]);
  });

  it('does not read a radar-beta title containing "axis" as an axis row', () => {
    const b = block(
      'radar-beta\n  title My axis chart\n  axis a, b\n  curve x{1, 2}',
      'radar-beta',
    );
    expect(only(b, 'radar-curve-length-mismatch')).toEqual([]);
  });

  it('applies radar rules to the `radar-beta:` header form', () => {
    // Radar alone accepts a trailing colon, and detectDiagramType reports
    // the header verbatim — so the type carries it.
    const b = block('radar-beta:\n  axis a, b, c', 'radar-beta:');
    expect(only(b, 'radar-no-curves')).toHaveLength(1);
    expect(only(b, 'no-experimental')).toHaveLength(1);
  });
});
