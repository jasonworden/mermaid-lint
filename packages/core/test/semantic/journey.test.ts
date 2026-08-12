import { describe, expect, it } from 'vitest';
import { RULE_DEFAULTS } from '../../src/rules.js';
import type { ResolvedRules } from '../../src/rules.js';
import { block } from './helpers.js';
import { only } from './helpers.js';

describe('journey-empty-section rule', () => {
  function journeyBlock(body: string, type = 'journey'): Block {
    return block(body, type);
  }

  it('returns [] when every section has a task', () => {
    const b = journeyBlock(
      'journey\n  section Work\n    Make tea: 5: Me\n  section Home\n    Rest: 4: Me',
    );
    expect(only(b, 'journey-empty-section')).toEqual([]);
  });

  it('flags a section with no tasks', () => {
    const b = journeyBlock(
      'journey\n  section Work\n    Make tea: 5: Me\n  section Empty',
    );
    const warnings = only(b, 'journey-empty-section');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('`Empty`');
    expect(warnings[0].line).toBe(4);
  });

  it('does not treat a title as a section task', () => {
    const b = journeyBlock('journey\n  title Day: One\n  section Empty');
    const warnings = only(b, 'journey-empty-section');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('`Empty`');
  });

  it('also applies to userJourney blocks', () => {
    const b = journeyBlock('userJourney\n  section Empty', 'userJourney');
    expect(only(b, 'journey-empty-section')).toHaveLength(1);
  });
});

describe('journey-score-out-of-range rule', () => {
  function journeyBlock(body: string): Block {
    return block(body, 'journey');
  }

  it('returns [] when task scores are within 1-5', () => {
    const b = journeyBlock(
      'journey\n  section Work\n    Start: 1: Me\n    Finish: 5: Me',
    );
    expect(only(b, 'journey-score-out-of-range')).toEqual([]);
  });

  it('flags scores below 1 and above 5', () => {
    const b = journeyBlock(
      'journey\n  section Work\n    Too low: 0: Me\n    Too high: 7: Me',
    );
    const warnings = only(b, 'journey-score-out-of-range');
    expect(warnings).toHaveLength(2);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('`Too low`');
    expect(warnings[0].line).toBe(3);
    expect(warnings[1].message).toContain('`Too high`');
    expect(warnings[1].line).toBe(4);
  });

  it('flags negative scores', () => {
    const b = journeyBlock('journey\n  section Work\n    Bad day: -1: Me');
    const warnings = only(b, 'journey-score-out-of-range');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('-1');
  });

  it('returns [] when configured off', () => {
    const b = journeyBlock('journey\n  section Work\n    Too high: 7: Me');
    const rules: ResolvedRules = {
      ...RULE_DEFAULTS,
      'journey-score-out-of-range': 'off',
    };
    expect(only(b, 'journey-score-out-of-range', rules)).toEqual([]);
  });
});

describe('journey-task-without-actor rule', () => {
  function journeyBlock(body: string): Block {
    return block(body, 'journey');
  }

  it('returns [] when every task has at least one actor', () => {
    const b = journeyBlock(
      'journey\n  section Work\n    Make tea: 5: Alice\n    Share tea: 4: Alice, Bob',
    );
    expect(only(b, 'journey-task-without-actor')).toEqual([]);
  });

  it('flags a task with no actor field', () => {
    const b = journeyBlock('journey\n  section Work\n    Make tea: 5');
    const warnings = only(b, 'journey-task-without-actor');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('`Make tea`');
    expect(warnings[0].line).toBe(3);
  });

  it('flags a task with an empty actor field', () => {
    const b = journeyBlock('journey\n  section Work\n    Make tea: 5:');
    expect(only(b, 'journey-task-without-actor')).toHaveLength(1);
  });
});

describe('journey-no-tasks rule', () => {
  function journeyBlock(body: string): Block {
    return block(body, 'journey');
  }

  it('returns [] when the journey has at least one task', () => {
    const b = journeyBlock('journey\n  section Work\n    Make tea: 5: Me');
    expect(only(b, 'journey-no-tasks')).toEqual([]);
  });

  it('flags a journey with only the keyword', () => {
    const b = journeyBlock('journey');
    const warnings = only(b, 'journey-no-tasks');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].line).toBe(1);
  });

  it('flags section-only and comment-only journeys', () => {
    expect(
      only(journeyBlock('journey\n  section Empty'), 'journey-no-tasks'),
    ).toHaveLength(1);
    expect(
      only(journeyBlock('journey\n  %% todo'), 'journey-no-tasks'),
    ).toHaveLength(1);
  });

  it('returns [] when configured off', () => {
    const rules: ResolvedRules = {
      ...RULE_DEFAULTS,
      'journey-no-tasks': 'off',
    };
    expect(only(journeyBlock('journey'), 'journey-no-tasks', rules)).toEqual(
      [],
    );
  });
});
