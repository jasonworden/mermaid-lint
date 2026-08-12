import type { Block } from '../../extract.js';
import { type AccDescrState, scanAccDescr } from '../helpers.js';
import type { Rule, RuleFinding } from '../types.js';

/**
 * The five model entity types, folded onto the short spelling. Four of them
 * have a long form as well (`command`, `event`, `readmodel`, `processor`) and
 * mermaid treats the two spellings as one type, so both are normalized here
 * and nothing downstream has to know a type has two names.
 */
type EventModelingEntityType = 'ui' | 'cmd' | 'evt' | 'rmo' | 'pcr';

interface EventModelingFrame {
  /**
   * Kept as written rather than as a number: mermaid resolves a `->>` source
   * by matching the name text, so `0` and `00` are two different frames.
   */
  id: string;
  /** `tf` or `rf`, normalized off the long forms. `rf` resets the timeline. */
  kind: 'tf' | 'rf';
  type: EventModelingEntityType;
  /** The entity identifier, possibly qualified (`Screen.Login`). */
  name: string;
  /** The line the frame keyword sits on — a frame may run past it. */
  line: number;
}

interface EventModelingReference {
  /** The frame id named after `->>`. */
  sourceId: string;
  /**
   * The line of the id itself, not of its arrow. The two can differ — `->>`
   * and its id may sit on separate lines — and the id is what a message names.
   */
  line: number;
  /** The referencing frame: its id, and the type the flow table keys on. */
  frameId: string;
  frameType: EventModelingEntityType;
}

interface ParsedEventModeling {
  frames: EventModelingFrame[];
  references: EventModelingReference[];
}

/** One lexeme plus the line it came from. */
interface EventModelingToken {
  text: string;
  line: number;
}

function isEventModeling(block: Block): boolean {
  return block.type === 'eventmodeling';
}

/** Frame openers, mapped onto the kind they declare. */
const EVENTMODELING_FRAME_KEYWORDS = new Map<string, 'tf' | 'rf'>([
  ['tf', 'tf'],
  ['timeframe', 'tf'],
  ['rf', 'rf'],
  ['resetframe', 'rf'],
]);

const EVENTMODELING_ENTITY_TYPES = new Map<string, EventModelingEntityType>([
  ['ui', 'ui'],
  ['cmd', 'cmd'],
  ['command', 'cmd'],
  ['evt', 'evt'],
  ['event', 'evt'],
  ['rmo', 'rmo'],
  ['readmodel', 'rmo'],
  ['pcr', 'pcr'],
  ['processor', 'pcr'],
]);

/** The source arrow. Compared as text, so no pattern is involved. */
const EVENTMODELING_ARROW = '->>';

/**
 * The three comment openers. `%%` and `//` run to end of line; the block form
 * is one lexer token that may span lines, so it needs its own closer.
 *
 * Sticky: it is only ever tried at positions `execOutsideEventModelingData` has
 * cleared as being outside an inline data payload.
 */
const EVENTMODELING_COMMENT_OPEN_RE = /%%|\/\/|\/\*/y;

/**
 * The delimiters of `EM_DATA_INLINE` — `/\{(.*)\}|"(.*)"|'(.*)'/`, the optional
 * payload that closes an `EmTimeFrame` or `EmResetFrame` — mapped to the closer
 * each one wants.
 */
const EVENTMODELING_DATA_CLOSERS = new Map([
  ['{', '}'],
  ['"', '"'],
  ["'", "'"],
]);

/**
 * Where each payload closer last appears on a line, keyed by the opener that
 * wants it.
 *
 * The closer that matters is the *last* one, not the first: every branch of
 * `EM_DATA_INLINE` closes on a greedy `.*`, so a payload runs to the final
 * closer and a second pair does not start a second payload.
 *
 * Hoisted to three `lastIndexOf` calls per line rather than being recomputed at
 * every scan position, which is what an earlier draft did. `lastIndexOf` does
 * not depend on where the scan has got to, and calling it per character made
 * both payload scans quadratic in line length: a line of unterminated `{` cost
 * ~9s at 200k characters, and the cost is paid twice per line, by the comment
 * stripper and by the tokenizer. Diagram bodies come from users, so that is the
 * same denial-of-service shape `parseFileDirectives` was fixed for. One pass per
 * line also restores the parallel to `execOutsideWardleyString`, which is a
 * single linear walk.
 */
function eventModelingDataEnds(raw: string): ReadonlyMap<string, number> {
  const ends = new Map<string, number>();
  for (const [opener, closer] of EVENTMODELING_DATA_CLOSERS) {
    ends.set(opener, raw.lastIndexOf(closer));
  }
  return ends;
}

/**
 * Index of the closer of the inline data payload opening at `raw[i]`, or `-1`
 * when no payload opens there. `ends` comes from `eventModelingDataEnds` for
 * this same line.
 *
 * A payload's contents are free text, so nothing inside one is code: not a
 * comment opener, and not a frame statement either. An earlier pass held that
 * no eventmodeling free text can carry frame tokens because `note` does not
 * parse. `note` indeed does not — but inline data does, and it is the carrier.
 * Do not re-derive the older conclusion from `note`.
 *
 * `EM_DATA_INLINE` cannot span a newline, so an opener with no closer after it
 * never lexed as a payload at all — for the quote forms that is the
 * unpaired-quote case, where the line's last closer is the opener itself.
 */
function eventModelingDataEnd(
  raw: string,
  i: number,
  ends: ReadonlyMap<string, number>,
): number {
  const close = ends.get(raw[i]);
  return close !== undefined && close > i ? close : -1;
}

/**
 * First comment opener that begins outside an inline data payload, or `null`
 * when every opener on the line sits inside one.
 *
 * Both failure directions were measured against mermaid 11.15.0, which accepts
 * each of them: a `/` `*` inside a payload silenced every frame below it, and a
 * payload pair opening and closing a phantom block comment across two rows made
 * the frame between them vanish and `eventmodeling-undefined-frame` fire at
 * severity `error` on a diagram mermaid draws correctly.
 *
 * This is the eventmodeling counterpart of `execOutsideWardleyString`, which
 * exists for the same class of bug: a `%%` inside a quoted name is syntax, not a
 * comment. Kept parallel rather than generalized because the run being skipped
 * is a different construct — a payload is also spelled with braces, and being a
 * single-line terminal it only counts as a payload when its closer is on the
 * same line, a rule that would be wrong for wardley's newline-free `STRING`.
 * Folding both into one helper would take more parameters than it saves lines.
 */
function execOutsideEventModelingData(raw: string): RegExpExecArray | null {
  const ends = eventModelingDataEnds(raw);
  for (let i = 0; i < raw.length; i++) {
    EVENTMODELING_COMMENT_OPEN_RE.lastIndex = i;
    const match = EVENTMODELING_COMMENT_OPEN_RE.exec(raw);
    if (match !== null) return match;

    const close = eventModelingDataEnd(raw, i, ends);
    // The loop's own step lands past the closer.
    if (close !== -1) i = close;
  }
  return null;
}

/**
 * Blank out every inline data payload on a line, one space per masked
 * character.
 *
 * Payload text is free text, so a frame statement written inside one is text:
 * `tf 1 ui A "tf 2 cmd B"` declares one frame and not two. Left tokenized, the
 * phantom `2` breaks both eventmodeling rules that read ids, in the same two
 * directions as an unmasked comment opener. It satisfies a `->> 2` that mermaid
 * itself drops, so `eventmodeling-undefined-frame` says nothing about a missing
 * arrow (a false negative on an `error` rule); and it collides with a real
 * frame `2` declared elsewhere, so `eventmodeling-duplicate-frame-id` reports a
 * duplicate on a body that has only one (a false positive).
 *
 * Spaces rather than a slice because cutting the span out would join the text
 * on either side of it into one token: mermaid lexes `Screen"a"Login` as two
 * identifiers, and a slice would hand the walk `ScreenLogin`. Every token after
 * a payload therefore keeps its column as well as its line.
 *
 * Expects a line the comment stripper has already run over: a delimiter written
 * inside a comment would otherwise pair with a real one and mask live code
 * between them.
 */
function maskEventModelingData(raw: string): string {
  const ends = eventModelingDataEnds(raw);
  let masked = '';
  for (let i = 0; i < raw.length; i++) {
    const close = eventModelingDataEnd(raw, i, ends);
    if (close === -1) {
      masked += raw[i];
      continue;
    }
    masked += ' '.repeat(close - i + 1);
    i = close;
  }
  return masked;
}

/**
 * One match per token. Anything else in a body — braces, quotes, the `[[ ]]`
 * of a data reference — is passed over by the scan, which is all a frame walk
 * needs: nothing between two frames can change how either one reads. That holds
 * only because the delimiters are stripped of their *contents* first, by
 * `maskEventModelingData`; run over a raw line this pattern happily reads a
 * frame statement out of a data payload.
 *
 * Whitespace is not a token boundary in mermaid's lexer, so `Screen->>2` is
 * three tokens and the arrow is matched first to keep it out of the name. Its
 * dash sits in a character class rather than being written bare: CodeQL's
 * `js/bad-tag-filter` reads a literal dash-arrow inside a pattern as an HTML
 * comment terminator (the same reason `WARDLEY_LINK_SEP_RE` spells its arrows
 * as quantifiers).
 */
const EVENTMODELING_TOKEN_RE = /[-]>>|[A-Za-z_][\w.]*|[0-9]+/g;

/** A frame id is a bare integer; `0` is a valid one. */
const EVENTMODELING_ID_RE = /^[0-9]+$/;

/**
 * Metadata rows are whole-line terminals, so their text never reaches the
 * token stream. None of the three parsed in any form tried against mermaid
 * 11.15 — this is a defensive skip, not a supported path.
 *
 * The keyword is closed with a lookahead over the identifier alphabet rather
 * than with `\b`, which would end the word at the `.` of a qualified name and
 * so swallow a continuation line reading `title.Bar` as metadata.
 */
const EVENTMODELING_META_RE = /^(?:title|accTitle|accDescr)(?![\w.])/;

/**
 * Blank out the comments in a body, one output entry per input line so the
 * line numbers a token reports stay true.
 *
 * All three forms are hidden terminals, so a comment may open anywhere a token
 * boundary can — mid-statement included, which is why openers are found with
 * `execOutsideEventModelingData` rather than a plain scan. The block form is
 * the reason this is a whole-body pass rather than a per-line strip: it closes
 * on a later line, so the state has to carry across the loop.
 *
 * The pass starts at the header because mermaid removes frontmatter before its
 * lexer ever runs, so a `/*` in a YAML title is title text and must not open a
 * block comment that blanks the diagram below it. The header line itself is
 * lexer input, so it is scanned rather than skipped. Preceding lines are
 * blanked instead of sliced away to keep every token's reported line true.
 */
function stripEventModelingComments(
  lines: string[],
  headerLine: number,
): string[] {
  const stripped: string[] = [];
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    if (i + 1 < headerLine) {
      stripped.push('');
      continue;
    }

    let rest = lines[i];
    let kept = '';

    while (rest !== '') {
      if (inBlockComment) {
        const close = rest.indexOf('*/');
        if (close === -1) break;
        inBlockComment = false;
        rest = rest.slice(close + 2);
        continue;
      }

      const open = execOutsideEventModelingData(rest);
      if (open === null) {
        kept += rest;
        break;
      }
      kept += rest.slice(0, open.index);
      // `%%` and `//` swallow the rest of the line; only the block form can
      // hand code back after it closes.
      if (open[0] !== '/*') break;
      inBlockComment = true;
      rest = rest.slice(open.index + 2);
    }

    stripped.push(kept);
  }

  return stripped;
}

/**
 * Flatten a comment-stripped body into `{ text, line }` records.
 *
 * A statement spans lines arbitrarily — `tf 1` / `ui` / `Screen` on three
 * separate lines parses, and so does a bare `->> 1` — because mermaid's `EM_WS`
 * is a hidden terminal that swallows a newline like any other whitespace. A
 * line-oriented scan cannot see those statements at all, so the body becomes
 * one stream and each token carries only the line it was written on.
 */
function tokenizeEventModeling(lines: string[]): EventModelingToken[] {
  const tokens: EventModelingToken[] = [];
  const accDescr: AccDescrState = { open: false };

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === '') continue;

    // eventmodeling takes one statement per line, so nothing can follow a
    // block's closing `}` and the whole line is always consumed.
    if (scanAccDescr(accDescr, lines, i, false) !== null) continue;

    if (EVENTMODELING_META_RE.test(trimmed)) continue;

    // Masked here rather than in `stripEventModelingComments` because the
    // `accDescr` gates above read braces of their own, and a description block's
    // opening `{` is not an inline payload.
    for (const match of maskEventModelingData(trimmed).matchAll(
      EVENTMODELING_TOKEN_RE,
    )) {
      tokens.push({ text: match[0], line: i + 1 });
    }
  }

  return tokens;
}

/**
 * Walk an eventmodeling body for its frame declarations and `->>` references.
 *
 * The walk is over tokens rather than lines because a frame statement is not a
 * line: see `tokenizeEventModeling`. On a frame keyword the head reads as
 * `<id> <type> <name>`, then zero or more `->> <id>` pairs — multi-source is
 * repeated arrows, since both the comma- and space-separated spellings are
 * parse errors.
 *
 * `headerLine` is the 1-indexed body line of the header (see `locateHeader`);
 * the walk ignores everything above it, which is frontmatter mermaid strips
 * before lexing. Lines keep their body numbering regardless.
 */
export function parseEventModeling(
  lines: string[],
  headerLine: number,
): ParsedEventModeling {
  const parsed: ParsedEventModeling = { frames: [], references: [] };
  const tokens = tokenizeEventModeling(
    stripEventModelingComments(lines, headerLine),
  );

  for (let i = 0; i < tokens.length; i++) {
    const kind = EVENTMODELING_FRAME_KEYWORDS.get(tokens[i].text);
    if (kind === undefined) continue;
    if (i + 3 >= tokens.length) continue;

    // All three head parts are mandatory, so a frame missing any of them never
    // parsed and belongs to the syntax linter, not here. The cursor is left on
    // the keyword rather than skipped past the malformed run — the very next
    // token may open a frame that does read.
    const id = tokens[i + 1];
    const type = EVENTMODELING_ENTITY_TYPES.get(tokens[i + 2].text);
    const name = tokens[i + 3];
    if (!EVENTMODELING_ID_RE.test(id.text)) continue;
    if (type === undefined) continue;
    // An arrow, an id, or a frame keyword in the name slot means the head ran
    // short and the token belongs to whatever comes next. A frame keyword
    // especially: mermaid's lexer hands it to the parser as a keyword and not
    // as an identifier, so `tf 2 ui` followed by `tf 3 ui Good` never named an
    // entity `tf` — it is one broken frame and one good one.
    if (
      name.text === EVENTMODELING_ARROW ||
      EVENTMODELING_ID_RE.test(name.text) ||
      EVENTMODELING_FRAME_KEYWORDS.has(name.text)
    )
      continue;

    parsed.frames.push({
      id: id.text,
      kind,
      type,
      name: name.text,
      line: tokens[i].line,
    });

    let cursor = i + 4;
    while (
      cursor + 1 < tokens.length &&
      tokens[cursor].text === EVENTMODELING_ARROW &&
      EVENTMODELING_ID_RE.test(tokens[cursor + 1].text)
    ) {
      parsed.references.push({
        sourceId: tokens[cursor + 1].text,
        line: tokens[cursor + 1].line,
        frameId: id.text,
        frameType: type,
      });
      cursor += 2;
    }
    // `cursor` is the first token past this frame; the loop's own step lands on
    // it, so a frame is never re-read as part of the one that follows.
    i = cursor - 1;
  }

  return parsed;
}

/**
 * Which source types a frame of each type may draw from, transcribed from
 * mermaid's own `EventModelingValidator`. That validator ships but never runs:
 * `parse` skips validation entirely, so every flow below is enforced here or
 * nowhere. `cmd` is the only target with two legal sources.
 *
 * A `Record` rather than a `Map` because the key is a closed union — every type
 * has an entry and `tsc` says so, which spares the lookup an unreachable
 * `undefined` branch.
 */
const EVENTMODELING_ALLOWED_SOURCES: Record<
  EventModelingEntityType,
  readonly EventModelingEntityType[]
> = {
  cmd: ['ui', 'pcr'],
  evt: ['cmd'],
  rmo: ['evt'],
  pcr: ['rmo'],
  ui: ['rmo'],
};

/**
 * How a type is named in a message. Four of the five have a long spelling too
 * and `parseEventModeling` folds both onto the short one, so a message echoing
 * only what it parsed would read as though it were correcting an author who
 * wrote `command`. Naming both spellings keeps the message about the type
 * rather than about the token.
 */
const EVENTMODELING_TYPE_LABELS: Record<EventModelingEntityType, string> = {
  ui: 'ui',
  cmd: 'cmd/command',
  evt: 'evt/event',
  rmo: 'rmo/readmodel',
  pcr: 'pcr/processor',
};

export const eventmodelingUndefinedFrame: Rule = {
  id: 'eventmodeling-undefined-frame',
  appliesTo: isEventModeling,
  evaluate: ({ lines, headerLine }) => {
    const { frames, references } = parseEventModeling(lines, headerLine);
    const declared = new Set(frames.map((frame) => frame.id));

    return references
      .filter((ref) => !declared.has(ref.sourceId))
      .map((ref) => ({
        message: `eventmodeling frame \`${ref.frameId}\` names \`${ref.sourceId}\` as a source but no frame declares that id; Mermaid drops the relation silently rather than reporting an error, so the arrow never renders.`,
        line: ref.line,
      }));
  },
};

// `tf` and `rf` declare into one shared id namespace — `tf 1` followed by
// `rf 1` parses — so a mixed pair collides just as two `tf`s would, and the
// rule keys on the id alone rather than on the id and kind together.
//
// Mermaid neither drops the second declaration nor picks one to resolve
// against: it renders every frame with the id, and dispatches one relation per
// frame whose name matches a `->>`. So `tf 1 ui A` / `tf 1 ui B` / `tf 2 cmd C
// ->> 1` draws two boxes and two arrows where one of each was meant (render
// probe, mermaid 11.15.0: two relation `<path>`s against one for the
// distinct-id control).
export const eventmodelingDuplicateFrameId: Rule = {
  id: 'eventmodeling-duplicate-frame-id',
  appliesTo: isEventModeling,
  evaluate: ({ lines, headerLine, fileLine }) => {
    const { frames } = parseEventModeling(lines, headerLine);
    // `parseEventModeling` walks the body front to back, so the frames arrive
    // in source order and the first one seen for an id is the first declared.
    const seen = new Map<string, number>();
    const findings: RuleFinding[] = [];

    for (const frame of frames) {
      const first = seen.get(frame.id);
      if (first === undefined) {
        seen.set(frame.id, frame.line);
        continue;
      }
      findings.push({
        message: `eventmodeling frame id \`${frame.id}\` is declared by more than one \`tf\` or \`rf\` frame (first on line ${fileLine(first)}); Mermaid renders them all and matches a later \`->> ${frame.id}\` against every one of them, drawing a duplicate arrow per matching frame instead of the single one intended.`,
        line: frame.line,
      });
    }

    return findings;
  },
};

// A `->>` resolves against *every* frame carrying the id, not against one of
// them, so the flow check runs over all of them: mermaid dispatches one
// relation per matching frame, and a first-wins check would miss a violation
// that is genuinely drawn. `tf 1 ui A` / `tf 1 evt B` / `tf 2 cmd C ->> 1`
// draws two relations, and the second is the illegal `cmd` ← `evt` one.
//
// The finding is still one per reference rather than one per matching frame:
// the author wrote a single arrow, and three findings for it would be noise.
//
// Nothing here claims the bad relation renders. An `rf` frame's `->>` draws no
// relation at all — `decidePositionRelation` bails on a reset frame, measured
// as zero relation `<path>`s against one for the same diagram with `tf` — yet
// the rule fires on `rf` all the same, because mermaid registers this check for
// `EmResetFrame` too. What every case does share is that the check never runs,
// so that is all the message asserts.
export const eventmodelingInvalidFlow: Rule = {
  id: 'eventmodeling-invalid-flow',
  appliesTo: isEventModeling,
  evaluate: ({ lines, headerLine }) => {
    const { frames, references } = parseEventModeling(lines, headerLine);

    const framesById = new Map<string, EventModelingFrame[]>();
    for (const frame of frames) {
      const group = framesById.get(frame.id);
      if (group === undefined) framesById.set(frame.id, [frame]);
      else group.push(frame);
    }

    const findings: RuleFinding[] = [];

    for (const ref of references) {
      const matches = framesById.get(ref.sourceId);
      // An undeclared source is `eventmodeling-undefined-frame`'s finding, and
      // there is no type to judge the flow against anyway.
      if (matches === undefined) continue;

      const allowed = EVENTMODELING_ALLOWED_SOURCES[ref.frameType];
      // Distinct types only, in declaration order: two illegal frames of the
      // same type are one thing to say, not two.
      const illegal = [
        ...new Set(
          matches
            .map((frame) => frame.type)
            .filter((type) => !allowed.includes(type)),
        ),
      ];
      if (illegal.length === 0) continue;

      const target = EVENTMODELING_TYPE_LABELS[ref.frameType];
      const sources = illegal
        .map((type) => EVENTMODELING_TYPE_LABELS[type])
        .join(' and ');
      const legal = allowed
        .map((type) => EVENTMODELING_TYPE_LABELS[type])
        .join(' or ');
      // Only the illegal types are named above, so a duplicated id needs the
      // extra sentence to explain why a legal frame of the same id does not
      // make the finding wrong.
      const ambiguity =
        matches.length > 1
          ? ` Frame id \`${ref.sourceId}\` is declared more than once and Mermaid matches all of them, so this source is reached regardless of the others.`
          : '';

      findings.push({
        message: `eventmodeling frame \`${ref.frameId}\` (${target}) is sourced from frame \`${ref.sourceId}\` (${sources}), but ${target} may only be sourced from ${legal}; Mermaid ships a validator that forbids this flow, but never runs it, so nothing reports it.${ambiguity}`,
        line: ref.line,
      });
    }

    return findings;
  },
};
