import { describe, expect, it } from 'vitest';
import { RULE_DEFAULTS } from '../../src/rules.js';
import type { ResolvedRules } from '../../src/rules.js';
import { block } from './helpers.js';
import { only } from './helpers.js';

describe('experimental diagram-specific rules', () => {
  it('flags packet-beta with no fields', () => {
    const b = block('packet-beta\n  %% comment', 'packet-beta');
    const warnings = only(b, 'packet-no-fields');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('no fields');
  });

  it('does not flag packet-beta with a field', () => {
    const b = block('packet-beta\n  0-7: "Source Port"', 'packet-beta');
    expect(only(b, 'packet-no-fields')).toEqual([]);
  });
});

describe('packet-beta rules', () => {
  function packetBlock(body: string): Block {
    return block(body, 'packet-beta');
  }

  it('keeps a valid packet clean', () => {
    const b = packetBlock(
      'packet-beta\n  0-7: "Source Port"\n  8-15: "Destination Port"\n  16-31: "Sequence Number"',
    );

    expect(only(b, 'packet-no-fields')).toEqual([]);
    expect(only(b, 'packet-empty-labels')).toEqual([]);
  });

  it('flags packet-beta with no field rows', () => {
    const b = packetBlock('packet-beta');
    const warnings = only(b, 'packet-no-fields');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].line).toBe(1);
    expect(warnings[0].message).toContain('no field rows');
  });

  it('flags empty and whitespace-only field labels', () => {
    const b = packetBlock(
      'packet-beta\n  0-7: ""\n  8-15: "   "\n  16-31: "Sequence Number"',
    );
    const warnings = only(b, 'packet-empty-labels');
    expect(warnings).toHaveLength(2);
    expect(warnings.map((warning) => warning.severity)).toEqual([
      'warn',
      'warn',
    ]);
    expect(warnings[0].message).toContain('0-7');
    expect(warnings[0].line).toBe(2);
    expect(warnings[1].message).toContain('8-15');
    expect(warnings[1].line).toBe(3);
  });

  it('treats +count rows as valid packet fields', () => {
    const b = packetBlock('packet-beta\n  +8: "Flags"');
    expect(only(b, 'packet-no-fields')).toEqual([]);
  });

  it('matches field rows with trailing inline comments', () => {
    const b = packetBlock('packet-beta\n  +8: "" %% reserved bits');
    const warnings = only(b, 'packet-empty-labels');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('+8');
    expect(warnings[0].line).toBe(2);
  });

  it('respects suppression directives and rule-off configuration', () => {
    const suppressed = packetBlock(
      'packet-beta\n  %% mermaid-lint-disable-diagram packet-empty-labels: legacy suppression test\n  0-7: ""',
    );
    expect(only(suppressed, 'packet-empty-labels')).toEqual([]);

    const b = packetBlock('packet-beta');
    const rules: ResolvedRules = {
      ...RULE_DEFAULTS,
      'packet-no-fields': 'off',
    };
    expect(only(b, 'packet-no-fields', rules)).toEqual([]);
  });
});
