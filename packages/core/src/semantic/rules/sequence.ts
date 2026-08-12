import type { Rule, RuleFinding } from '../types.js';

/**
 * Sequence message regex. Captures:
 *   [1] SRC participant token
 *   [2] arrow (->  -->  ->>  -->>  -x  --x  -)  --))
 *   [3] optional '+' or '-' activation shorthand
 *   [4] TGT participant token
 * Participant tokens are word characters only; the colon+text after TGT is
 * intentionally not captured (not needed).
 */
const SEQ_MSG_RE =
  /^\s*([A-Za-z0-9_]+)\s*(->>?|-->>?|-x|--x|-\)|--\))\s*([+-])?\s*([A-Za-z0-9_]+)\s*:/;

/** Explicit `activate X` / `deactivate X` line (possibly indented). */
const SEQ_ACTIVATE_RE = /^\s*(activate|deactivate)\s+([A-Za-z0-9_]+)\s*$/;

/** Participant / actor declaration: `participant X` or `participant X as Alias`. */
const SEQ_PARTICIPANT_RE =
  /^\s*(?:participant|actor)\s+([A-Za-z0-9_]+)(?:\s+as\s+\S+)?\s*$/;

export const noActivateWithoutDeactivate: Rule = {
  id: 'no-activate-without-deactivate',
  appliesTo: (block) => block.type === 'sequenceDiagram',
  evaluate: ({ lines }) => {
    // count[participant] = current activation depth
    const count = new Map<string, number>();
    // firstOpenLine[participant] = line index (1-based) of earliest still-open activation
    const firstOpenLine = new Map<string, number>();
    const findings: RuleFinding[] = [];

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const bodyLine = i + 1;
      if (raw.trimStart().startsWith('%%')) continue;

      // Explicit activate / deactivate keyword
      const explicit = SEQ_ACTIVATE_RE.exec(raw);
      if (explicit !== null) {
        const keyword = explicit[1];
        const participant = explicit[2];
        if (keyword === 'activate') {
          const prev = count.get(participant) ?? 0;
          count.set(participant, prev + 1);
          if (prev === 0) firstOpenLine.set(participant, bodyLine);
        } else {
          // deactivate
          const prev = count.get(participant) ?? 0;
          if (prev <= 0) {
            findings.push({
              message: `\`deactivate\` for \`${participant}\` has no matching \`activate\`.`,
              line: bodyLine,
            });
            count.set(participant, 0);
          } else {
            count.set(participant, prev - 1);
            if (prev - 1 === 0) firstOpenLine.delete(participant);
          }
        }
        continue;
      }

      // Shorthand +/- on message arrow
      const msg = SEQ_MSG_RE.exec(raw);
      if (msg !== null) {
        const src = msg[1];
        const suffix = msg[3]; // '+' | '-' | undefined
        const tgt = msg[4];

        if (suffix === '+') {
          // activate TGT
          const prev = count.get(tgt) ?? 0;
          count.set(tgt, prev + 1);
          if (prev === 0) firstOpenLine.set(tgt, bodyLine);
        } else if (suffix === '-') {
          // deactivate SRC
          const prev = count.get(src) ?? 0;
          if (prev <= 0) {
            findings.push({
              message: `\`deactivate\` for \`${src}\` has no matching \`activate\`.`,
              line: bodyLine,
            });
            count.set(src, 0);
          } else {
            count.set(src, prev - 1);
            if (prev - 1 === 0) firstOpenLine.delete(src);
          }
        }
      }
    }

    // Any participant with count > 0 is dangling
    for (const [participant, depth] of count) {
      if (depth > 0) {
        findings.push({
          message: `participant \`${participant}\` is activated but never deactivated (dangling activation bar).`,
          line: firstOpenLine.get(participant),
        });
      }
    }

    return findings;
  },
};

export const preferExplicitParticipants: Rule = {
  id: 'prefer-explicit-participants',
  appliesTo: (block) => block.type === 'sequenceDiagram',
  evaluate: ({ lines }) => {
    const declared = new Set<string>(); // declared ids seen so far
    const reported = new Set<string>(); // ids already emitted a finding for
    const findings: RuleFinding[] = [];

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const bodyLine = i + 1;
      if (raw.trimStart().startsWith('%%')) continue;

      // Check for participant/actor declaration first
      const decl = SEQ_PARTICIPANT_RE.exec(raw);
      if (decl !== null) {
        declared.add(decl[1]);
        continue;
      }

      // Check for message reference
      const msg = SEQ_MSG_RE.exec(raw);
      if (msg !== null) {
        const src = msg[1];
        const tgt = msg[4];
        for (const id of [src, tgt]) {
          if (!declared.has(id) && !reported.has(id)) {
            reported.add(id);
            findings.push({
              message: `participant \`${id}\` is used in a message before being declared; Mermaid auto-creates it. Declare it with \`participant ${id}\` for explicit ordering.`,
              line: bodyLine,
            });
          }
        }
      }
    }

    return findings;
  },
};

export const sequenceDuplicateParticipant: Rule = {
  id: 'sequence-duplicate-participant',
  appliesTo: (block) => block.type === 'sequenceDiagram',
  evaluate: ({ lines, fileLine }) => {
    const seen = new Map<string, number>();
    const findings: RuleFinding[] = [];

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (raw.trimStart().startsWith('%%')) continue;
      const decl = SEQ_PARTICIPANT_RE.exec(raw);
      if (decl === null) continue;
      const id = decl[1];
      const first = seen.get(id);
      if (first === undefined) {
        seen.set(id, i + 1);
      } else {
        findings.push({
          message: `participant \`${id}\` is declared more than once (first on line ${fileLine(first)}); duplicate declarations make participant ordering and labels ambiguous.`,
          line: i + 1,
        });
      }
    }

    return findings;
  },
};

/**
 * Class member syntax supported:
 *   Block:  `class Foo {` … member lines … `}`
 *   Inline: `Foo : +int bar()` or `Foo : bar()`
 * A method is any member line containing `(...)`. The signature key is
 * `name(params)` with internal whitespace collapsed.
 */
