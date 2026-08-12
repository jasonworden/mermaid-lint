import { describe, expect, it } from 'vitest';
import { block } from './helpers.js';
import { only } from './helpers.js';

describe('timeline-empty-section rule', () => {
  function timelineBlock(body: string): Block {
    return block(body, 'timeline');
  }

  it('returns [] when every section has an entry', () => {
    const b = timelineBlock(
      'timeline\n  section A\n    2002 : X\n  section B\n    2004 : Y',
    );
    expect(only(b, 'timeline-empty-section')).toEqual([]);
  });

  it('flags a section with no entries', () => {
    const b = timelineBlock(
      'timeline\n  section A\n    2002 : X\n  section Empty',
    );
    const warnings = only(b, 'timeline-empty-section');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('`Empty`');
    expect(warnings[0].line).toBe(4);
  });

  it('does not treat a title as a section entry', () => {
    const b = timelineBlock('timeline\n  title History\n  section Empty');
    const warnings = only(b, 'timeline-empty-section');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('`Empty`');
  });
});

describe('timeline-empty-event rule', () => {
  function timelineBlock(body: string): Block {
    return block(body, 'timeline');
  }

  it('returns [] for periods with non-empty events', () => {
    const b = timelineBlock(
      'timeline\n  2002 : LinkedIn\n  2004 : Facebook : Google',
    );
    expect(only(b, 'timeline-empty-event')).toEqual([]);
  });

  it('does not flag a bare period with no events', () => {
    const b = timelineBlock('timeline\n  2002\n  2004 : Facebook');
    expect(only(b, 'timeline-empty-event')).toEqual([]);
  });

  it('flags an empty event between two colons', () => {
    const b = timelineBlock('timeline\n  2002 : : Facebook');
    const warnings = only(b, 'timeline-empty-event');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].line).toBe(2);
  });

  it('flags a trailing empty event', () => {
    const b = timelineBlock('timeline\n  2004 : Twitter :');
    expect(only(b, 'timeline-empty-event')).toHaveLength(1);
  });

  it('does not flag a leading-colon continuation event', () => {
    const b = timelineBlock('timeline\n  2002 : LinkedIn\n       : Facebook');
    expect(only(b, 'timeline-empty-event')).toEqual([]);
  });
});

describe('timeline-no-entries rule', () => {
  function timelineBlock(body: string): Block {
    return block(body, 'timeline');
  }

  it('returns [] when the timeline has time periods', () => {
    const b = timelineBlock('timeline\n  2002 : LinkedIn');
    expect(only(b, 'timeline-no-entries')).toEqual([]);
  });

  it('returns [] when the timeline has a section (covered by empty-section)', () => {
    const b = timelineBlock('timeline\n  section A');
    expect(only(b, 'timeline-no-entries')).toEqual([]);
  });

  it('flags a timeline with only a title', () => {
    const b = timelineBlock('timeline\n  title Just a title');
    const warnings = only(b, 'timeline-no-entries');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].line).toBe(1);
  });
});
