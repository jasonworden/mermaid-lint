import type { Block } from '../../extract.js';
import type { Rule, RuleFinding } from '../types.js';

/**
 * A state-diagram transition: `src --> tgt` with an optional `: label`. Both
 * endpoints may be the `[*]` start/end pseudostate or a plain state id. State
 * diagrams only ever use the `-->` arrow, so a line containing it is
 * unambiguously a transition — declarations (`state X { `, `state "d" as Y`),
 * `direction`, and `note` lines never match. Captures [1]=source, [2]=target,
 * [3]=label (the text after `:`, trimmed; `undefined` when absent).
 */
const STATE_TRANSITION_RE =
  /^\s*(\[\*\]|[A-Za-z0-9_]+)\s*-->\s*(\[\*\]|[A-Za-z0-9_]+)\s*(?::\s*(.*\S))?\s*$/;

/**
 * Opening line of a composite state: `state Foo {` (optionally `state "desc" as
 * Foo {`). The brace must end the line — the inline single-line form is not a
 * composite. Captures [1]=quoted-or-bare name, [2]=`as` alias (when present).
 */
const STATE_COMPOSITE_OPEN_RE =
  /^\s*state\s+("[^"]*"|[A-Za-z0-9_]+)(?:\s+as\s+([A-Za-z0-9_]+))?\s*\{\s*$/;

/** A lone closing brace for a composite state block. */
const STATE_COMPOSITE_CLOSE_RE = /^\s*\}\s*$/;

/** Explicit state declaration: `state Foo` or `state "Description" as Foo`. */
const STATE_DECL_RE =
  /^\s*state\s+(?:"[^"]*"\s+as\s+)?([A-Za-z0-9_]+)(?:\s*(?:\{|$))/;

interface StateTransition {
  source: string;
  target: string;
  label: string;
  line: number;
}

function parseStateTransitions(lines: string[]): StateTransition[] {
  const transitions: StateTransition[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trimStart().startsWith('%%')) continue;
    const m = STATE_TRANSITION_RE.exec(raw);
    if (m === null) continue;
    transitions.push({
      source: m[1],
      target: m[2],
      label: m[3] ?? '',
      line: i + 1,
    });
  }
  return transitions;
}

function isState(block: Block): boolean {
  return block.type === 'stateDiagram' || block.type === 'stateDiagram-v2';
}

export const stateDuplicateState: Rule = {
  id: 'state-duplicate-state',
  appliesTo: isState,
  evaluate: ({ lines, fileLine }) => {
    const seen = new Map<string, number>();
    const findings: RuleFinding[] = [];

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (raw.trimStart().startsWith('%%')) continue;
      const decl = STATE_DECL_RE.exec(raw);
      if (decl === null) continue;
      const id = decl[1];
      const first = seen.get(id);
      if (first === undefined) {
        seen.set(id, i + 1);
      } else {
        findings.push({
          message: `state \`${id}\` is declared more than once (first on line ${fileLine(first)}); duplicate state declarations make labels and composite bodies ambiguous.`,
          line: i + 1,
        });
      }
    }

    return findings;
  },
};

export const stateDuplicateTransition: Rule = {
  id: 'state-duplicate-transition',
  appliesTo: isState,
  evaluate: ({ lines, fileLine }) => {
    const seen = new Map<string, number>(); // key -> first line
    const findings: RuleFinding[] = [];
    for (const t of parseStateTransitions(lines)) {
      const key = `${t.source} ${t.target} ${t.label}`;
      const firstLine = seen.get(key);
      if (firstLine === undefined) {
        seen.set(key, t.line);
      } else {
        findings.push({
          message: `duplicate transition: \`${t.source}\` → \`${t.target}\` is defined more than once (first on line ${fileLine(firstLine)}); duplicate transitions render stacked and are usually a copy-paste mistake.`,
          line: t.line,
        });
      }
    }
    return findings;
  },
};

// A composite state with no body renders as an empty container box. Brace depth
// is tracked with a stack so nested composites are handled; a nested composite
// counts as content for its parent.
export const stateEmptyComposite: Rule = {
  id: 'state-empty-composite',
  appliesTo: isState,
  evaluate: ({ lines }) => {
    interface Frame {
      name: string;
      line: number;
      hasContent: boolean;
    }
    const stack: Frame[] = [];
    const findings: RuleFinding[] = [];

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (raw.trimStart().startsWith('%%')) continue;

      const open = STATE_COMPOSITE_OPEN_RE.exec(raw);
      if (open !== null) {
        // The composite itself is content for any enclosing composite.
        if (stack.length > 0) stack[stack.length - 1].hasContent = true;
        const name = (open[2] ?? open[1]).replace(/^"|"$/g, '');
        stack.push({ name, line: i + 1, hasContent: false });
        continue;
      }

      if (STATE_COMPOSITE_CLOSE_RE.test(raw)) {
        const frame = stack.pop();
        if (frame !== undefined && !frame.hasContent) {
          findings.push({
            message: `composite state \`${frame.name}\` has an empty body and renders as an empty box; add its substates or remove the braces.`,
            line: frame.line,
          });
        }
        continue;
      }

      // Any other non-blank line is body content for the innermost composite.
      if (raw.trim().length > 0 && stack.length > 0) {
        stack[stack.length - 1].hasContent = true;
      }
    }

    return findings;
  },
};

export const stateSelfTransition: Rule = {
  id: 'state-self-transition',
  appliesTo: isState,
  evaluate: ({ lines }) =>
    parseStateTransitions(lines)
      .filter((t) => t.source === t.target && t.source !== '[*]')
      .map((t) => ({
        message: `state \`${t.source}\` has a transition to itself (\`${t.source} --> ${t.source}\`); self-transitions are valid in state machines but are sometimes unintentional.`,
        line: t.line,
      })),
};
