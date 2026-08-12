import { describe, expect, it } from 'vitest';
import { parseEventModeling } from '../../src/semantic/index.js';
import { block } from './helpers.js';
import { only } from './helpers.js';

// A whole `eventmodeling` body, as a block the rules will accept. The header is
// always body line 1 here, so a frame declared on the Nth source row reports
// line N and the fixtures read the way they are written.
function em(...body: string[]): Block {
  return block(['eventmodeling', ...body].join('\n'), 'eventmodeling');
}

describe('eventmodeling-undefined-frame rule', () => {
  it('flags a `->>` naming an id no frame declares', () => {
    const b = em('  tf 1 ui Screen', '  tf 2 cmd DoIt ->> 99');
    const findings = only(b, 'eventmodeling-undefined-frame');
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].line).toBe(3);
    expect(findings[0].message).toContain('`99`');
    expect(findings[0].message).toContain('`2`');
    // The renderer drops the relation without a diagnostic — the message says
    // so, and a reword that softened this into "may not render" would be wrong.
    expect(findings[0].message).toContain('never renders');
  });

  it('stays silent when every source is declared', () => {
    const b = em('  tf 1 ui Screen', '  tf 2 cmd DoIt ->> 1');
    expect(only(b, 'eventmodeling-undefined-frame')).toEqual([]);
  });

  it('resolves a source declared by an `rf` frame', () => {
    // `tf` and `rf` declare into one id namespace, so an `rf` frame is a
    // perfectly good `->>` target.
    const b = em('  rf 1 ui Screen', '  tf 2 cmd DoIt ->> 1');
    expect(only(b, 'eventmodeling-undefined-frame')).toEqual([]);
  });

  // Ids are matched as text, not as numbers: a render probe against mermaid
  // 11.15.0 draws zero relation `<path>`s for `tf 0 ui A` / `tf 1 cmd B ->> 00`
  // against one for the same diagram spelled `->> 0`. This is why the parser
  // types `id` as a string — a numeric id would make `00` resolve and the
  // finding below would vanish.
  it('treats `00` as a different id from `0`', () => {
    const b = em('  tf 0 ui Screen', '  tf 1 cmd DoIt ->> 00');
    const findings = only(b, 'eventmodeling-undefined-frame');
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('`00`');
  });

  it('resolves frame id `0` when it is spelled the same way', () => {
    const b = em('  tf 0 ui Screen', '  tf 1 cmd DoIt ->> 0');
    expect(only(b, 'eventmodeling-undefined-frame')).toEqual([]);
  });

  // Mermaid 11.15.0 accepts this body and draws the arrow. Before the comment
  // stripper learned about inline data payloads, the two payloads read as a
  // block comment opening on one line and closing on the next, which swallowed
  // frame 2 and made this rule fire at severity `error` on a valid diagram.
  it('stays silent when payloads spell out block-comment delimiters', () => {
    const b = em('  tf 1 ui A "/*"', '  tf 2 evt B "*/"', '  tf 3 cmd C ->> 2');
    expect(only(b, 'eventmodeling-undefined-frame')).toEqual([]);
  });

  // Mermaid 11.15.0 accepts this body and draws one frame, not two: the `tf 2`
  // is payload text. Frame `2` therefore does not exist, mermaid drops the
  // arrow, and this rule must say so — a phantom frame read out of the payload
  // would satisfy the reference and silence an `error`-severity finding.
  it('flags a source that only a data payload appears to declare', () => {
    const b = em('  tf 1 ui A "tf 2 cmd B"', '  tf 3 cmd C ->> 2');
    const findings = only(b, 'eventmodeling-undefined-frame');
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(3);
    expect(findings[0].message).toContain('`2`');
  });

  it('does not flag a self-reference, which declares its own source', () => {
    const b = em('  tf 1 ui Screen ->> 1');
    expect(only(b, 'eventmodeling-undefined-frame')).toEqual([]);
  });

  // Deliberate, not a defect: a frame head that does not fully parse (`uii` is
  // not an entity type) is dropped by the parser, so a later `->> 1` reads as
  // undefined and this rule fires alongside the genuine syntax error mermaid
  // reports for the same body. That is the same shape as the wardley rules,
  // which likewise report against what parsed. Do not "fix" this by teaching
  // the parser to keep half-read frames — the fix for the diagram is the
  // syntax error, and this finding disappears with it.
  it('also fires when a frame head failed to parse, which is deliberate', () => {
    const b = em('  tf 1 uii Screen', '  tf 2 cmd DoIt ->> 1');
    const findings = only(b, 'eventmodeling-undefined-frame');
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('`1`');
  });
});

describe('eventmodeling-duplicate-frame-id rule', () => {
  it('flags an id declared by two frames, naming the first line', () => {
    const b = em('  tf 1 ui Screen', '  tf 1 ui Other');
    const findings = only(b, 'eventmodeling-duplicate-frame-id');
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    // Reported on the later row, naming the first — same convention as
    // `wardley-duplicate-component`.
    expect(findings[0].line).toBe(3);
    expect(findings[0].message).toContain('`1`');
    expect(findings[0].message).toContain('first on line 2');
  });

  it('flags a `tf` and an `rf` sharing an id', () => {
    const b = em('  tf 1 ui Screen', '  rf 1 evt ItHappened');
    const findings = only(b, 'eventmodeling-duplicate-frame-id');
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(3);
    expect(findings[0].message).toContain('first on line 2');
  });

  it('reports every repeat after the first, each naming the first line', () => {
    const b = em('  tf 1 ui A', '  tf 1 ui B', '  tf 1 ui C');
    const findings = only(b, 'eventmodeling-duplicate-frame-id');
    expect(findings.map((f) => f.line)).toEqual([3, 4]);
    for (const finding of findings) {
      expect(finding.message).toContain('first on line 2');
    }
  });

  // Measured against mermaid 11.15.0: this body renders both boxes and TWO
  // relation `<path>`s. Mermaid neither drops the second declaration nor
  // resolves the `->>` first-wins, so the message must not say it does.
  it('says mermaid renders every duplicate and draws an arrow per match', () => {
    const b = em('  tf 1 ui A', '  tf 1 ui B', '  tf 2 cmd C ->> 1');
    const findings = only(b, 'eventmodeling-duplicate-frame-id');
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('renders them all');
    expect(findings[0].message).toContain('duplicate arrow per matching frame');
  });

  // The false-positive direction of the same defect: only one frame really
  // declares `2` here, and mermaid 11.15.0 accepts the body. A `tf 2` read out
  // of the payload would invent a duplicate on a valid diagram.
  it('does not count a frame statement inside a data payload as a declaration', () => {
    const b = em('  tf 1 ui A "tf 2 cmd B"', '  tf 2 evt C');
    expect(only(b, 'eventmodeling-duplicate-frame-id')).toEqual([]);
  });

  it('stays silent when every frame id is distinct', () => {
    const b = em(
      '  tf 1 ui Screen',
      '  tf 2 cmd DoIt ->> 1',
      '  rf 3 evt ItHappened ->> 2',
    );
    expect(only(b, 'eventmodeling-duplicate-frame-id')).toEqual([]);
  });
});

describe('eventmodeling-invalid-flow rule', () => {
  it('flags an event sourced from a ui frame', () => {
    const b = em('  tf 1 ui Screen', '  tf 2 evt ItHappened ->> 1');
    const findings = only(b, 'eventmodeling-invalid-flow');
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].line).toBe(3);
    expect(findings[0].message).toContain('(evt/event)');
    expect(findings[0].message).toContain('(ui)');
    expect(findings[0].message).toContain(
      'may only be sourced from cmd/command',
    );
    // The validator ships but never runs — the message's whole reason to exist.
    expect(findings[0].message).toContain('never runs it');
  });

  it('stays silent on a diagram that walks every legal flow', () => {
    const b = em(
      '  tf 1 ui Screen',
      '  tf 2 cmd DoIt ->> 1',
      '  tf 3 evt ItHappened ->> 2',
      '  tf 4 rmo Projection ->> 3',
      '  tf 5 pcr Reactor ->> 4',
      '  tf 6 cmd Followup ->> 5',
      '  tf 7 ui Refreshed ->> 4',
    );
    expect(only(b, 'eventmodeling-invalid-flow')).toEqual([]);
  });

  it('reads the long-form type keywords as the same types', () => {
    const b = em(
      '  timeframe 1 ui Screen',
      '  timeframe 2 command DoIt ->> 1',
      '  timeframe 3 event ItHappened ->> 2',
      '  timeframe 4 readmodel Projection ->> 3',
      '  timeframe 5 processor Reactor ->> 4',
    );
    expect(only(b, 'eventmodeling-invalid-flow')).toEqual([]);
  });

  it('flags a self-reference, which is defined but never a legal source', () => {
    const b = em('  tf 1 ui Screen ->> 1');
    expect(only(b, 'eventmodeling-undefined-frame')).toEqual([]);
    const findings = only(b, 'eventmodeling-invalid-flow');
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain(
      'may only be sourced from rmo/readmodel',
    );
  });

  it('does not also fire on a reference already reported as undefined', () => {
    // Nothing declares `99`, so there is no source type to judge — saying
    // "a ui may not be sourced from …" would be inventing one.
    const b = em('  tf 1 evt ItHappened', '  tf 2 ui Screen ->> 99');
    expect(only(b, 'eventmodeling-undefined-frame')).toHaveLength(1);
    expect(only(b, 'eventmodeling-invalid-flow')).toEqual([]);
  });

  // An `rf` frame's `->>` draws no relation at all: a render probe against
  // mermaid 11.15.0 measured zero relation `<path>`s for `rf` where the same
  // body with `tf` drew one. The rule still fires — mermaid registers the flow
  // check for `EmResetFrame` too — so the message may not claim the bad
  // relation renders, because on this diagram it does not.
  it('fires on an `rf` frame without claiming its relation renders', () => {
    const b = em('  tf 1 evt ItHappened', '  rf 2 ui Screen ->> 1');
    const findings = only(b, 'eventmodeling-invalid-flow');
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('(evt/event)');
    expect(findings[0].message).not.toContain('render');
  });

  // The regression guard for first-wins resolution. `1` is declared twice; the
  // first match (`ui`) is a legal source for a `cmd`, the second (`evt`) is
  // not, and mermaid dispatches a relation for BOTH — so the illegal one is
  // genuinely drawn. An implementation that stopped at the first matching
  // frame would report nothing here and this test is the only thing that says
  // so. Do not weaken it to "the first frame wins".
  it('reports an illegal source hidden behind a legal duplicate of the same id', () => {
    const b = em('  tf 1 ui A', '  tf 1 evt B', '  tf 2 cmd C ->> 1');
    const findings = only(b, 'eventmodeling-invalid-flow');
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(4);
    // The `evt` frame is the one named, not the legal `ui` one.
    expect(findings[0].message).toContain('(evt/event)');
    expect(findings[0].message).not.toContain('(ui)');
    // And the message explains why the legal duplicate does not excuse it.
    expect(findings[0].message).toContain('declared more than once');
  });

  it('stays silent when every frame sharing the id is a legal source', () => {
    const b = em('  tf 1 ui A', '  tf 1 pcr B', '  tf 2 cmd C ->> 1');
    expect(only(b, 'eventmodeling-invalid-flow')).toEqual([]);
  });

  it('reports one finding per reference, not one per matching frame', () => {
    // Two illegal matches of the same type: one thing to say, not two.
    const b = em('  tf 1 evt A', '  tf 1 evt B', '  tf 2 ui C ->> 1');
    const findings = only(b, 'eventmodeling-invalid-flow');
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('(evt/event)');
  });

  it('names both illegal types once when the duplicates differ', () => {
    const b = em('  tf 1 ui A', '  tf 1 cmd B', '  tf 2 rmo R ->> 1');
    const findings = only(b, 'eventmodeling-invalid-flow');
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('(ui and cmd/command)');
  });

  it('judges each source of a multi-source frame on its own', () => {
    const b = em(
      '  tf 1 ui Screen',
      '  tf 2 evt ItHappened',
      '  tf 3 cmd DoIt ->> 1 ->> 2',
    );
    const findings = only(b, 'eventmodeling-invalid-flow');
    expect(findings).toHaveLength(1);
    // The `ui` source is legal for a `cmd`; only the `evt` one is reported.
    expect(findings[0].message).toContain('`2`');
    expect(findings[0].message).toContain('(evt/event)');
  });
});

describe('parseEventModeling', () => {
  it('reads a frame head split across lines and a bare `->>` of its own', () => {
    // `EM_WS` is a hidden terminal that swallows newlines, so a statement is
    // not a line: each of these rows is a fragment of one frame.
    const parsed = parseEventModeling(
      [
        'eventmodeling',
        '  tf 1',
        '  ui Screen',
        '  ->> 2',
        '  tf 2 rmo Projection',
      ],
      1,
    );
    expect(parsed.frames).toEqual([
      { id: '1', kind: 'tf', type: 'ui', name: 'Screen', line: 2 },
      { id: '2', kind: 'tf', type: 'rmo', name: 'Projection', line: 5 },
    ]);
    // The reference is anchored to the id's line, not the frame keyword's.
    expect(parsed.references).toEqual([
      { sourceId: '2', line: 4, frameId: '1', frameType: 'ui' },
    ]);
  });

  it('reads repeated arrows as a multi-source frame', () => {
    // The comma- and space-separated spellings are both parse errors, so
    // repeating the arrow is the only way to write multi-source.
    const parsed = parseEventModeling(
      [
        'eventmodeling',
        '  tf 1 rmo Projection',
        '  tf 2 rmo Other',
        '  tf 3 ui Screen ->> 1 ->> 2',
      ],
      1,
    );
    expect(parsed.references).toEqual([
      { sourceId: '1', line: 4, frameId: '3', frameType: 'ui' },
      { sourceId: '2', line: 4, frameId: '3', frameType: 'ui' },
    ]);
  });

  it('strips all three comment forms, including a block spanning lines', () => {
    const parsed = parseEventModeling(
      [
        'eventmodeling',
        '  %% tf 7 ui GhostA',
        '  tf 1 ui Screen // tf 8 ui GhostB',
        '  /* tf 9 evt GhostC',
        '     still inside the comment */ tf 2 cmd DoIt ->> 1',
      ],
      1,
    );
    // None of the three ghosts parsed; the code after the block comment closes
    // on the same line still did.
    expect(parsed.frames.map((f) => f.name)).toEqual(['Screen', 'DoIt']);
    expect(parsed.frames.map((f) => f.line)).toEqual([3, 5]);
    expect(parsed.references).toEqual([
      { sourceId: '1', line: 5, frameId: '2', frameType: 'cmd' },
    ]);
  });

  // The three payload cases below were all measured as ACCEPTED by mermaid
  // 11.15.0. A frame statement may close with an `EM_DATA_INLINE` payload
  // (`/\{(.*)\}|"(.*)"|'(.*)'/`) whose contents are free text, so a comment
  // opener written inside one is payload and not a comment. The earlier
  // reasoning that no eventmodeling free text can carry frame tokens because
  // `note` does not parse was wrong: `note` does not, but inline data does.
  it('does not read a comment opener inside a quoted payload as a comment', () => {
    const parsed = parseEventModeling(
      ['eventmodeling', '  tf 1 ui Screen "a /* b"', '  tf 2 cmd DoIt ->> 99'],
      1,
    );
    // Without the payload skip the `/*` opens a block comment that never
    // closes, and everything below it — frame 2 and its undeclared source —
    // goes silently missing.
    expect(parsed.frames.map((f) => f.id)).toEqual(['1', '2']);
    expect(parsed.references).toEqual([
      { sourceId: '99', line: 3, frameId: '2', frameType: 'cmd' },
    ]);
  });

  it('does not read a comment opener inside a braced payload as a comment', () => {
    const parsed = parseEventModeling(
      ['eventmodeling', '  tf 1 ui A {/*}', '  tf 2 cmd B ->> 99'],
      1,
    );
    expect(parsed.frames.map((f) => f.id)).toEqual(['1', '2']);
    expect(parsed.references.map((r) => r.sourceId)).toEqual(['99']);
  });

  it('does not declare a phantom frame from a statement inside a payload', () => {
    // Payload text is text. `tf 2 cmd B` here names nothing — mermaid accepts
    // this body and draws exactly one frame.
    const parsed = parseEventModeling(
      ['eventmodeling', '  tf 1 ui A "tf 2 cmd B"'],
      1,
    );
    expect(parsed.frames.map((f) => f.id)).toEqual(['1']);
  });

  it('keeps the tokens either side of a payload apart, and on their line', () => {
    // Mermaid accepts this body: the payload closes frame 1 and frame 2 opens
    // on the same line with no whitespace between them. Blanking the payload in
    // place rather than slicing it out is what keeps `A` and `tf` two tokens —
    // a slice would hand the walk `Atf` and lose frame 2 entirely.
    const parsed = parseEventModeling(
      ['eventmodeling', '  tf 1 ui A"x"tf 2 cmd B ->> 1'],
      1,
    );
    expect(parsed.frames.map((f) => f.name)).toEqual(['A', 'B']);
    expect(parsed.references).toEqual([
      { sourceId: '1', line: 2, frameId: '2', frameType: 'cmd' },
    ]);
  });

  it('still strips a real comment that follows a payload on the same line', () => {
    // The skip runs to the payload's closer, not to end of line: a `%%` after
    // it is an ordinary comment and the ghost frame in it must not parse.
    const parsed = parseEventModeling(
      ['eventmodeling', '  tf 1 ui Screen "a" %% tf 9 ui GhostA'],
      1,
    );
    expect(parsed.frames.map((f) => f.name)).toEqual(['Screen']);
  });

  it('normalizes the long keywords and folds `rf` and `tf` onto one namespace', () => {
    const parsed = parseEventModeling(
      [
        'eventmodeling',
        '  timeframe 1 command DoIt',
        '  resetframe 1 event ItHappened ->> 1',
        '  tf 2 readmodel Projection',
        '  tf 3 processor Reactor',
      ],
      1,
    );
    expect(parsed.frames).toEqual([
      { id: '1', kind: 'tf', type: 'cmd', name: 'DoIt', line: 2 },
      { id: '1', kind: 'rf', type: 'evt', name: 'ItHappened', line: 3 },
      { id: '2', kind: 'tf', type: 'rmo', name: 'Projection', line: 4 },
      { id: '3', kind: 'tf', type: 'pcr', name: 'Reactor', line: 5 },
    ]);
    // The `rf` reused `1` rather than opening a namespace of its own.
    expect(parsed.references).toEqual([
      { sourceId: '1', line: 3, frameId: '1', frameType: 'evt' },
    ]);
  });

  it('keeps a qualified entity name whole', () => {
    const parsed = parseEventModeling(
      ['eventmodeling', '  tf 1 ui Screen.Login'],
      1,
    );
    expect(parsed.frames[0].name).toBe('Screen.Login');
  });

  it('keeps frame ids as text, so `0` and `00` are different frames', () => {
    const parsed = parseEventModeling(
      ['eventmodeling', '  tf 0 ui Screen', '  tf 1 cmd DoIt ->> 00'],
      1,
    );
    expect(parsed.frames.map((f) => f.id)).toEqual(['0', '1']);
    expect(parsed.references[0].sourceId).toBe('00');
  });

  it(
    'scans an unterminated payload delimiter in linear time',
    // Only the failing path is slow: the quadratic scan has to run to
    // completion (~18s idle, more on a loaded runner) before the assertion can
    // report it, and a timeout would hide which check failed. Passing costs
    // ~8ms, so this ceiling never applies on a green run.
    { timeout: 60_000 },
    () => {
      // An opener with no closer never lexed as a payload, so every position on
      // the line has to be examined. A draft looked the closer up with
      // `lastIndexOf` at each of them, which is quadratic in line length and
      // paid twice per line — once by the comment stripper, once by the
      // tokenizer. Diagram bodies come from users, so that is a real
      // denial-of-service vector, the same one `parseFileDirectives` was fixed
      // for. Hoisting the lookup to one pass per line puts the two complexity
      // classes ~2100x apart at this size: 8ms against 17,750ms.
      const pathological = `  tf 1 ui A ${'{'.repeat(200_000)}`;

      const start = performance.now();
      const parsed = parseEventModeling(['eventmodeling', pathological], 1);
      const elapsed = performance.now() - start;

      // The delimiters are text, so the frame still reads normally.
      expect(parsed.frames.map((f) => f.name)).toEqual(['A']);
      // ~60x above the real cost and still ~35x below the quadratic scan this
      // guards against. Reaching it under load alone would take a 60x stall on
      // an 8ms operation; the algorithm changing is far likelier.
      expect(elapsed).toBeLessThan(500);
    },
  );

  it('ignores frontmatter above the header line', () => {
    // Mermaid strips frontmatter before its lexer runs, so the `/*` in this
    // title is title text and must not open a block comment over the diagram.
    const parsed = parseEventModeling(
      [
        '---',
        'title: A /* title',
        '---',
        'eventmodeling',
        '  tf 1 ui Screen',
        '  tf 2 cmd DoIt ->> 1',
      ],
      4,
    );
    expect(parsed.frames.map((f) => f.line)).toEqual([5, 6]);
    expect(parsed.references).toEqual([
      { sourceId: '1', line: 6, frameId: '2', frameType: 'cmd' },
    ]);
  });
});
