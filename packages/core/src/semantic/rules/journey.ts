import type { Block } from '../../extract.js';
import type { Rule, RuleFinding } from '../types.js';

/**
 * Lines that open a journey directive rather than declare a task. A task is
 * `name: score: actors`, so directives with free text must be filtered before
 * the task-line check.
 */
const JOURNEY_KEYWORD_RE =
  /^(?:journey|userJourney|title|section|accTitle|accDescr)\b/;

/** A `section Name` line. Captures [1]=section name (trimmed). */
const JOURNEY_SECTION_RE = /^section\s+(.+?)\s*$/;

/** A journey task line. Captures [1]=task name, [2]=happiness score, [3]=actors. */
const JOURNEY_TASK_RE = /^(.+?)\s*:\s*(-?\d+(?:\.\d+)?)(?:\s*:\s*(.*))?$/;

interface JourneyTask {
  name: string;
  score: number;
  actors: string[];
  line: number;
}

function isJourney(block: Block): boolean {
  return block.type === 'journey' || block.type === 'userJourney';
}

function parseJourneyTasks(lines: string[]): JourneyTask[] {
  const tasks: JourneyTask[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.length === 0 || trimmed.startsWith('%%')) continue;
    if (JOURNEY_KEYWORD_RE.test(trimmed)) continue;
    const m = JOURNEY_TASK_RE.exec(trimmed);
    if (m === null) continue;
    tasks.push({
      name: m[1].trim(),
      score: Number(m[2]),
      actors:
        m[3] === undefined
          ? []
          : m[3]
              .split(',')
              .map((actor) => actor.trim())
              .filter((actor) => actor.length > 0),
      line: i + 1,
    });
  }
  return tasks;
}

function isJourneyTaskLine(trimmed: string): boolean {
  if (trimmed.length === 0 || trimmed.startsWith('%%')) return false;
  if (JOURNEY_KEYWORD_RE.test(trimmed)) return false;
  return JOURNEY_TASK_RE.test(trimmed);
}

export const journeyEmptySection: Rule = {
  id: 'journey-empty-section',
  appliesTo: isJourney,
  evaluate: ({ lines }) => {
    interface Section {
      name: string;
      line: number;
      hasTask: boolean;
    }
    const findings: RuleFinding[] = [];
    let current: Section | null = null;

    const flush = () => {
      if (current !== null && !current.hasTask) {
        findings.push({
          message: `section \`${current.name}\` has no tasks and renders as an empty section header.`,
          line: current.line,
        });
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.length === 0 || trimmed.startsWith('%%')) continue;

      const sec = JOURNEY_SECTION_RE.exec(trimmed);
      if (sec !== null) {
        flush();
        current = { name: sec[1], line: i + 1, hasTask: false };
        continue;
      }
      if (current !== null && !current.hasTask && isJourneyTaskLine(trimmed)) {
        current.hasTask = true;
      }
    }
    flush();
    return findings;
  },
};

export const journeyScoreOutOfRange: Rule = {
  id: 'journey-score-out-of-range',
  appliesTo: isJourney,
  evaluate: ({ lines }) =>
    parseJourneyTasks(lines)
      .filter((task) => task.score < 1 || task.score > 5)
      .map((task) => ({
        message: `journey task \`${task.name}\` has score ${task.score}; Mermaid journey scores should be between 1 and 5.`,
        line: task.line,
      })),
};

export const journeyTaskWithoutActor: Rule = {
  id: 'journey-task-without-actor',
  appliesTo: isJourney,
  evaluate: ({ lines }) =>
    parseJourneyTasks(lines)
      .filter((task) => task.actors.length === 0)
      .map((task) => ({
        message: `journey task \`${task.name}\` has no actors; it renders without an owner lane and is usually incomplete.`,
        line: task.line,
      })),
};

export const journeyNoTasks: Rule = {
  id: 'journey-no-tasks',
  appliesTo: isJourney,
  evaluate: ({ lines, headerLine }) => {
    if (parseJourneyTasks(lines).length > 0) return [];
    return [
      {
        message:
          'journey has no tasks; it parses but renders as an empty diagram.',
        line: headerLine,
      },
    ];
  },
};
