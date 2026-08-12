import type { Block } from '../../extract.js';
import type { Rule, RuleFinding } from '../types.js';

/**
 * Lines that open a gantt directive rather than declare a task. A task is
 * `name : metadata`; these keywords never are — even when their own text
 * contains a colon (e.g. `title Project: Phase 1`, or a `click t1 call cb(a:b)`
 * interaction) — so they are filtered out before the task-line check, which
 * keys only on the presence of a `:`.
 */
const GANTT_KEYWORD_RE =
  /^(?:gantt|title|dateFormat|axisFormat|tickInterval|excludes|includes|todayMarker|weekday|section|click)\b/;

/** A `section Name` line. Captures [1]=section name (trimmed). */
const GANTT_SECTION_RE = /^section\s+(.+?)\s*$/;

/**
 * Status tags that may precede a task's positional metadata fields. Mermaid
 * extracts these first, so they don't count toward the [id?, start, end]
 * positions. (`vert` is the newer vertical-marker tag.)
 */
const GANTT_TAGS = new Set(['active', 'done', 'crit', 'milestone', 'vert']);

/** A task field that references other tasks: `after <ids>` or `until <ids>`. */
const GANTT_DEP_RE = /^(?:after|until)\s+(.+)$/;

interface GanttTask {
  /** Explicit task id, or `null` when Mermaid auto-generates one. */
  id: string | null;
  /** Ids referenced via `after`/`until`. */
  deps: string[];
  /** 1-indexed body line of the task. */
  line: number;
}

/**
 * Parse a task's metadata (everything after the first `:`). Mirrors Mermaid's
 * positional grammar: the status tags are extracted first, then the remaining
 * comma fields are positionally `[id?, start, end]`. Mermaid only reads an
 * explicit id when three positional fields are present (otherwise the id is
 * auto-generated and invisible here); an `after <id>` / `until <id>` field (in
 * the start/end slots) references other tasks, and may name several
 * space-separated ids. The id slot is only taken from a plain token, never an
 * `after`/`until` phrase, so a 3-field `id, after x, 5d` task still yields id.
 */
function parseGanttMeta(data: string): { id: string | null; deps: string[] } {
  const fields = data
    .split(',')
    .map((f) => f.trim())
    .filter((f) => f.length > 0);
  const positional = fields.filter((f) => !GANTT_TAGS.has(f));

  const deps: string[] = [];
  for (const field of positional) {
    const m = GANTT_DEP_RE.exec(field);
    if (m === null) continue;
    for (const ref of m[1].split(/\s+/)) {
      if (ref.length > 0) deps.push(ref);
    }
  }

  let id: string | null = null;
  if (positional.length >= 3 && /^[A-Za-z0-9_-]+$/.test(positional[0])) {
    id = positional[0];
  }
  return { id, deps };
}

/** True when a trimmed line declares a task (`name : metadata`). */
function isGanttTaskLine(trimmed: string): boolean {
  if (GANTT_KEYWORD_RE.test(trimmed)) return false;
  const colon = trimmed.indexOf(':');
  if (colon === -1) return false;
  return trimmed.slice(0, colon).trim().length > 0;
}

function parseGanttTasks(lines: string[]): GanttTask[] {
  const tasks: GanttTask[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.length === 0 || trimmed.startsWith('%%')) continue;
    if (!isGanttTaskLine(trimmed)) continue;
    const meta = parseGanttMeta(trimmed.slice(trimmed.indexOf(':') + 1));
    tasks.push({ id: meta.id, deps: meta.deps, line: i + 1 });
  }
  return tasks;
}

function isGantt(block: Block): boolean {
  return block.type === 'gantt';
}

export const ganttDuplicateTaskId: Rule = {
  id: 'gantt-duplicate-task-id',
  appliesTo: isGantt,
  evaluate: ({ lines, fileLine }) => {
    const seen = new Map<string, number>(); // id -> first line
    const findings: RuleFinding[] = [];
    for (const task of parseGanttTasks(lines)) {
      if (task.id === null) continue;
      const first = seen.get(task.id);
      if (first === undefined) {
        seen.set(task.id, task.line);
      } else {
        findings.push({
          message: `task id \`${task.id}\` is defined more than once (first on line ${fileLine(first)}); \`after\`/\`until\` references to it are ambiguous.`,
          line: task.line,
        });
      }
    }
    return findings;
  },
};

// Collect every defined id first (a two-pass over the block), so a task that
// references a dependency declared later in the chart is not flagged — only
// references to ids that no task defines anywhere.
export const ganttUndefinedDependency: Rule = {
  id: 'gantt-undefined-dependency',
  appliesTo: isGantt,
  evaluate: ({ lines }) => {
    const tasks = parseGanttTasks(lines);
    const defined = new Set<string>();
    for (const t of tasks) {
      if (t.id !== null) defined.add(t.id);
    }
    const findings: RuleFinding[] = [];
    for (const t of tasks) {
      for (const dep of t.deps) {
        if (defined.has(dep)) continue;
        findings.push({
          message: `task references undefined dependency \`${dep}\`; no task declares the id \`${dep}\`, so Mermaid places this task at the chart start.`,
          line: t.line,
        });
      }
    }
    return findings;
  },
};

export const ganttEmptySection: Rule = {
  id: 'gantt-empty-section',
  appliesTo: isGantt,
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

      const sec = GANTT_SECTION_RE.exec(trimmed);
      if (sec !== null) {
        flush();
        current = { name: sec[1], line: i + 1, hasTask: false };
        continue;
      }
      if (current !== null && !current.hasTask && isGanttTaskLine(trimmed)) {
        current.hasTask = true;
      }
    }
    flush();
    return findings;
  },
};
