import { describe, expect, it } from 'vitest';
import { RULE_DEFAULTS } from '../../src/rules.js';
import type { ResolvedRules } from '../../src/rules.js';
import { block } from './helpers.js';
import { only } from './helpers.js';

describe('experimental diagram-specific rules', () => {
  it('flags architecture-beta with no elements', () => {
    const b = block('architecture-beta\n  %% comment', 'architecture-beta');
    const warnings = only(b, 'architecture-no-elements');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('no elements');
  });

  it('does not flag architecture-beta with an element', () => {
    const b = block(
      'architecture-beta\n  service api(server)[API]',
      'architecture-beta',
    );
    expect(only(b, 'architecture-no-elements')).toEqual([]);
  });
});

describe('architecture-beta rules', () => {
  function architectureBlock(body: string): Block {
    return block(body, 'architecture-beta');
  }

  it('keeps a valid architecture model clean', () => {
    const b = architectureBlock(
      'architecture-beta\n  group api(cloud)[API]\n  service gateway(server)[Gateway] in api\n  service db(database)[Database]\n  gateway:R -- L:db',
    );

    expect(only(b, 'architecture-no-elements')).toEqual([]);
    expect(only(b, 'architecture-no-edges')).toEqual([]);
    expect(only(b, 'architecture-duplicate-edge')).toEqual([]);
  });

  it('flags architecture-beta with no declared elements', () => {
    const b = architectureBlock('architecture-beta');
    const warnings = only(b, 'architecture-no-elements');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].line).toBe(1);
    expect(warnings[0].message).toContain('no declared elements');
  });

  it('flags architecture-beta with declarations but no edges', () => {
    const b = architectureBlock(
      'architecture-beta\n  service gateway(server)[Gateway]\n  junction hub\n  group api(cloud)[API]',
    );
    const warnings = only(b, 'architecture-no-edges');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].line).toBe(1);
    expect(warnings[0].message).toContain('no edges');
  });

  it('flags repeated exact architecture edge declarations, including ports', () => {
    const b = architectureBlock(
      'architecture-beta\n  service gateway(server)[Gateway]\n  service db(database)[Database]\n  gateway:R -- L:db\n  gateway:R -- L:db',
    );
    const warnings = only(b, 'architecture-duplicate-edge');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].line).toBe(5);
    expect(warnings[0].message).toContain('`gateway:R -- L:db`');
    expect(warnings[0].message).toContain('line 4');
  });

  it('treats arrow edges with {group} modifiers as valid edges', () => {
    const b = architectureBlock(
      'architecture-beta\n  group edge(cloud)[Edge]\n  group data(database)[Data]\n  service gateway(server)[Gateway] in edge\n  service db(database)[Database] in data\n  gateway{group}:R --> L:db{group}',
    );
    expect(only(b, 'architecture-no-edges')).toEqual([]);
  });

  it('accepts Mermaid-valid architecture edges with optional whitespace around ids and ports', () => {
    const b = architectureBlock(
      'architecture-beta\n  service gateway(server)[Gateway]\n  service db1(database)[Database 1]\n  service db2(database)[Database 2]\n  service db3(database)[Database 3]\n  gateway :R -- L: db1\n  gateway:R -- L: db2\n  gateway :R -- L:db3',
    );
    expect(only(b, 'architecture-no-edges')).toEqual([]);
    expect(only(b, 'architecture-duplicate-edge')).toEqual([]);
  });

  it('flags repeated exact non-bare architecture edge declarations', () => {
    const b = architectureBlock(
      'architecture-beta\n  group edge(cloud)[Edge]\n  group data(database)[Data]\n  service gateway(server)[Gateway] in edge\n  service db(database)[Database] in data\n  gateway{group}:R --> L:db{group}\n  gateway{group}:R --> L:db{group}',
    );
    const warnings = only(b, 'architecture-duplicate-edge');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].line).toBe(7);
    expect(warnings[0].message).toContain('`gateway{group}:R --> L:db{group}`');
    expect(warnings[0].message).toContain('line 6');
  });

  it('flags duplicate architecture edges when only endpoint whitespace differs', () => {
    const b = architectureBlock(
      'architecture-beta\n  service gateway(server)[Gateway]\n  service db(database)[Database]\n  gateway :R -- L: db\n  gateway:R -- L:db',
    );
    const warnings = only(b, 'architecture-duplicate-edge');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].line).toBe(5);
    expect(warnings[0].message).toContain('`gateway:R -- L:db`');
    expect(warnings[0].message).toContain('line 4');
  });

  it('respects suppression directives and rule-off configuration', () => {
    const suppressed = architectureBlock(
      'architecture-beta\n  %% mermaid-lint-disable-diagram architecture-no-edges: legacy suppression test\n  service gateway(server)[Gateway]',
    );
    expect(only(suppressed, 'architecture-no-edges')).toEqual([]);

    const b = architectureBlock(
      'architecture-beta\n  service gateway(server)[Gateway]\n  service db(database)[Database]\n  gateway:R -- L:db\n  gateway:R -- L:db',
    );
    const rules: ResolvedRules = {
      ...RULE_DEFAULTS,
      'architecture-duplicate-edge': 'off',
    };
    expect(only(b, 'architecture-duplicate-edge', rules)).toEqual([]);
  });
});
