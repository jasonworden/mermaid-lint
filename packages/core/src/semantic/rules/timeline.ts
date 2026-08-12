import type { Block } from '../../extract.js';
import type { Rule, RuleFinding } from '../types.js';

/**
 * Lines that open a timeline directive rather than declare a time period.
 * Everything else (a `period : event : event` line, or a `: event`
 * continuation line) is a period entry.
 */
const TIMELINE_KEYWORD_RE = /^(?:timeline|title|section)\b/;

/** A `section Name` line. Captures [1]=section name (trimmed). */
const TIMELINE_SECTION_RE = /^section\s+(.+?)\s*$/;

function isTimeline(block: Block): boolean {
  return block.type === 'timeline';
}

/** True when a trimmed line is a time-period entry (not a keyword/comment). */
function isTimelineEntry(trimmed: string): boolean {
  if (trimmed.length === 0 || trimmed.startsWith('%%')) return false;
  return !TIMELINE_KEYWORD_RE.test(trimmed);
}

export const timelineEmptySection: Rule = {
  id: 'timeline-empty-section',
  appliesTo: isTimeline,
  evaluate: ({ lines }) => {
    interface Section {
      name: string;
      line: number;
      hasEntry: boolean;
    }
    const findings: RuleFinding[] = [];
    let current: Section | null = null;

    const flush = () => {
      if (current !== null && !current.hasEntry) {
        findings.push({
          message: `section \`${current.name}\` has no entries and renders as an empty section header.`,
          line: current.line,
        });
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.length === 0 || trimmed.startsWith('%%')) continue;

      const sec = TIMELINE_SECTION_RE.exec(trimmed);
      if (sec !== null) {
        flush();
        current = { name: sec[1], line: i + 1, hasEntry: false };
        continue;
      }
      if (current !== null && !current.hasEntry && isTimelineEntry(trimmed)) {
        current.hasEntry = true;
      }
    }
    flush();
    return findings;
  },
};

// A period line is `period : event : event…`; the colon-separated fields after
// the first are events. A blank event (a trailing `:`, or `: :`) renders an
// empty event bubble. The period slot (field 0) is ignored — a leading-colon
// continuation line has an empty field 0 by design, not an empty event.
export const timelineEmptyEvent: Rule = {
  id: 'timeline-empty-event',
  appliesTo: isTimeline,
  evaluate: ({ lines }) => {
    const findings: RuleFinding[] = [];
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!isTimelineEntry(trimmed)) continue;
      const fields = trimmed.split(':');
      if (fields.length < 2) continue; // a bare period with no events
      const hasEmptyEvent = fields
        .slice(1)
        .some((event) => event.trim().length === 0);
      if (hasEmptyEvent) {
        findings.push({
          message:
            'time period has an empty event (a blank `:` field); it renders as an empty event bubble.',
          line: i + 1,
        });
      }
    }
    return findings;
  },
};

export const timelineNoEntries: Rule = {
  id: 'timeline-no-entries',
  appliesTo: isTimeline,
  evaluate: ({ lines, headerLine }) => {
    let hasSection = false;
    let hasEntry = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (TIMELINE_SECTION_RE.test(trimmed)) hasSection = true;
      else if (isTimelineEntry(trimmed)) hasEntry = true;
    }
    if (hasSection || hasEntry) return [];
    return [
      {
        message:
          'timeline has no sections or time periods; it parses but renders as an empty diagram.',
        line: headerLine,
      },
    ];
  },
};
