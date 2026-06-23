import { describe, expect, it } from 'vitest';
import {
  ALL_RULE_IDS,
  RULE_DEFAULTS,
  isRuleSeverity,
  resolveRules,
} from '../src/rules.js';

describe('isRuleSeverity', () => {
  it('accepts the three valid severities', () => {
    expect(isRuleSeverity('off')).toBe(true);
    expect(isRuleSeverity('warn')).toBe(true);
    expect(isRuleSeverity('error')).toBe(true);
  });

  it('rejects anything else', () => {
    for (const v of ['warning', 'ERROR', '', 0, null, undefined, {}]) {
      expect(isRuleSeverity(v)).toBe(false);
    }
  });
});

describe('resolveRules', () => {
  it('returns the defaults when given nothing', () => {
    expect(resolveRules()).toEqual(RULE_DEFAULTS);
  });

  it('defaults duplicate-ids to error and the rest to warn', () => {
    expect(RULE_DEFAULTS['duplicate-ids']).toBe('error');
    expect(RULE_DEFAULTS['prefer-flowchart']).toBe('warn');
    expect(RULE_DEFAULTS['require-direction']).toBe('warn');
    expect(RULE_DEFAULTS['no-experimental']).toBe('warn');
    expect(RULE_DEFAULTS['no-duplicate-edges']).toBe('warn');
    expect(RULE_DEFAULTS['no-self-loop']).toBe('warn');
    expect(RULE_DEFAULTS['no-empty-labels']).toBe('warn');
    expect(RULE_DEFAULTS['no-orphan-nodes']).toBe('off');
    expect(RULE_DEFAULTS['no-activate-without-deactivate']).toBe('warn');
    expect(RULE_DEFAULTS['prefer-explicit-participants']).toBe('off');
    expect(RULE_DEFAULTS['no-duplicate-methods']).toBe('warn');
    expect(RULE_DEFAULTS['pie-duplicate-label']).toBe('warn');
    expect(RULE_DEFAULTS['pie-zero-value']).toBe('warn');
    expect(RULE_DEFAULTS['pie-no-data']).toBe('warn');
    expect(RULE_DEFAULTS['state-duplicate-transition']).toBe('warn');
    expect(RULE_DEFAULTS['state-empty-composite']).toBe('warn');
    expect(RULE_DEFAULTS['state-self-transition']).toBe('off');
    expect(RULE_DEFAULTS['er-duplicate-attribute']).toBe('warn');
    expect(RULE_DEFAULTS['er-duplicate-entity']).toBe('warn');
    expect(RULE_DEFAULTS['er-standalone-entity']).toBe('off');
    expect(RULE_DEFAULTS['gantt-duplicate-task-id']).toBe('warn');
    expect(RULE_DEFAULTS['gantt-undefined-dependency']).toBe('warn');
    expect(RULE_DEFAULTS['gantt-empty-section']).toBe('warn');
  });

  it('layers user overrides over the defaults', () => {
    const resolved = resolveRules({
      rules: { 'prefer-flowchart': 'off', 'no-experimental': 'error' },
    });
    expect(resolved['prefer-flowchart']).toBe('off');
    expect(resolved['no-experimental']).toBe('error');
    // Untouched rules keep their default.
    expect(resolved['duplicate-ids']).toBe('error');
  });

  it('disables every rule when semantic is false', () => {
    const resolved = resolveRules({
      semantic: false,
      rules: { 'duplicate-ids': 'error' },
    });
    for (const id of ALL_RULE_IDS) expect(resolved[id]).toBe('off');
  });
});
