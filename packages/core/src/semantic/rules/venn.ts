import type { Block } from '../../extract.js';
import type { Rule, RuleFinding } from '../types.js';

/**
 * The `set` / `union` keyword opening a venn-beta statement. Mermaid's lexer
 * matches every keyword case-insensitively (`SET A` parses), so this does too.
 */
const VENN_STATEMENT_RE = /^(?:set|union)\b/i;

/**
 * One venn identifier: Mermaid's `IDENTIFIER` or its `STRING`. Anchored and
 * applied to a moving slice rather than scanned globally, so the identifier
 * list is read left to right exactly as the parser reads it.
 */
const VENN_IDENTIFIER_RE = /^(?:[A-Za-z_][A-Za-z0-9\-_]*|"[^"]*")/;

/**
 * Mermaid's `NUMERIC`, after the `:` that introduces an explicit size. The
 * sign is part of the token — unlike treemap, where a `-5` dies in the lexer.
 * Captures [1]=the numeric text.
 */
const VENN_SIZE_RE = /^:\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))/;

/**
 * Normalize an identifier the way `vennDB.normalizeText` does: trim, then drop
 * a surrounding pair of double quotes. This is what makes `set "A"` and
 * `set A` the same set, and it runs before anything is compared.
 */
function vennNormalize(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1)
    : trimmed;
}

interface VennStatement {
  kind: 'set' | 'union';
  /** Normalized identifiers, in source order (Mermaid sorts; order is ours). */
  identifiers: string[];
  /** The explicit `: value`, or `null` when the statement carries none. */
  size: number | null;
  /** 1-indexed body line. */
  line: number;
}

function isVenn(block: Block): boolean {
  return block.type === 'venn-beta';
}

/**
 * Scan a venn-beta body into its `set` and `union` statements.
 *
 * A statement is the keyword, then an identifier list, then an optional
 * `[label]`, then an optional `: size`. The parts are consumed in that order by
 * a single left-to-right pass rather than by one regex over the whole line: a
 * combined pattern would stack quantifiers over overlapping character sets and
 * backtrack super-linearly on the failing path, which a diagram body
 * (arbitrary user input, scanned before any parse) can reach. The scan is
 * O(line length).
 *
 * The grammar is *not* line-oriented, which is the trap here. `document` is a
 * list of `line`s and `line` is `statement | NEWLINE` — a newline is a line of
 * its own, not a statement terminator — so several statements may share one
 * physical line. `set A set B` really does declare two sets, and `set A set A`
 * really is the duplicate `venn-duplicate-set` exists for. Hence the inner
 * loop, which keeps reading statements until the line stops yielding them.
 *
 * A line that does not *open* with `set` or `union` is skipped whole rather
 * than scanned for one further in. Mermaid's `title` swallows the rest of its
 * line (`title\s[^#\n;]+`), so a `set` inside it is title text, not a
 * declaration — scanning forward would invent a set the diagram never had.
 * Skipping may miss a statement trailing some other keyword; that direction
 * costs a finding, the other direction invents one.
 */
function parseVennStatements(
  lines: string[],
  headerLine: number,
): VennStatement[] {
  const statements: VennStatement[] = [];

  for (let i = headerLine; i < lines.length; i++) {
    let rest = lines[i].trim();

    for (;;) {
      // A `%%` here opens a comment running to end of line. Reached only
      // between statements: a `%%` *inside* a label was consumed with it, the
      // way the lexer consumes `["50%% off"]` as one token.
      if (rest.startsWith('%%')) break;

      const keyword = VENN_STATEMENT_RE.exec(rest);
      if (keyword === null) break;

      const kind = keyword[0].toLowerCase() as 'set' | 'union';
      rest = rest.slice(keyword[0].length);
      const identifiers: string[] = [];

      for (;;) {
        rest = rest.trimStart();
        const identifier = VENN_IDENTIFIER_RE.exec(rest);
        if (identifier === null) break;
        identifiers.push(vennNormalize(identifier[0]));
        rest = rest.slice(identifier[0].length).trimStart();
        // Only a `union` takes more than one identifier; a comma after a `set`
        // identifier is a parse error, so stop and let the syntax pass have it.
        if (kind !== 'union' || !rest.startsWith(',')) break;
        rest = rest.slice(1);
      }
      if (identifiers.length === 0) break;

      // An optional `[label]`. The lexer tries `["…"]` before `[…]`, and the
      // quoted form's body is `[^"]*` — so a `]` is legal inside it and the
      // token ends at the first `"]`, not the first `]`. Ending a quoted label
      // early would leave its tail in `rest`, where `set A["]: -5"]` reads as
      // a size of -5 the diagram never had.
      if (rest.startsWith('[')) {
        const quoted = rest.startsWith('["');
        const close = quoted ? rest.indexOf('"]', 2) : rest.indexOf(']');
        // Unterminated: a lexical error, so leave the line to the syntax pass.
        if (close === -1) break;
        rest = rest.slice(close + (quoted ? 2 : 1)).trimStart();
      }

      const size = VENN_SIZE_RE.exec(rest);
      if (size !== null) rest = rest.slice(size[0].length).trimStart();

      statements.push({
        kind,
        identifiers,
        size: size === null ? null : Number.parseFloat(size[1]),
        line: i + 1,
      });
    }
  }

  return statements;
}

export const vennDuplicateSet: Rule = {
  id: 'venn-duplicate-set',
  appliesTo: isVenn,
  evaluate: ({ lines, headerLine, fileLine }) => {
    const seen = new Map<string, number>();
    const findings: RuleFinding[] = [];

    for (const statement of parseVennStatements(lines, headerLine)) {
      if (statement.kind !== 'set') continue;
      const id = statement.identifiers[0];
      const first = seen.get(id);
      if (first === undefined) {
        seen.set(id, statement.line);
        continue;
      }
      findings.push({
        message: `venn set \`${id}\` is declared more than once (first on line ${fileLine(first)}); Mermaid adds a second circle coincident with the first rather than replacing it, and both draw the last label, so an earlier one never renders.`,
        line: statement.line,
      });
    }

    return findings;
  },
};

export const vennNonPositiveSize: Rule = {
  id: 'venn-non-positive-size',
  appliesTo: isVenn,
  evaluate: ({ lines, headerLine }) =>
    parseVennStatements(lines, headerLine)
      .filter((statement) => statement.size !== null && statement.size <= 0)
      .map((statement) => {
        // Only the consequence differs between the two kinds; the subject
        // reads the same, since a `set` always carries exactly one identifier.
        const consequence =
          statement.kind === 'set'
            ? 'a size of 0 removes the set and every intersection over it from the diagram, and a negative one distorts the layout.'
            : 'venn areas should be greater than 0, and a negative one throws out of the layout so nothing renders.';
        return {
          message: `venn ${statement.kind} \`${statement.identifiers.join(', ')}\` has a non-positive size (${statement.size}); ${consequence}`,
          line: statement.line,
        };
      }),
};

export const vennSingleSet: Rule = {
  id: 'venn-single-set',
  appliesTo: isVenn,
  evaluate: ({ lines, headerLine }) => {
    const sets = parseVennStatements(lines, headerLine).filter(
      (statement) => statement.kind === 'set',
    );
    const distinct = new Set(sets.map((statement) => statement.identifiers[0]));
    if (distinct.size !== 1) return [];

    // Every declaration names that one set, so the first is both the name to
    // report and the line to report it on.
    const [first] = sets;
    return [
      {
        message: `venn-beta declares only one set (\`${first.identifiers[0]}\`); it renders as a single circle, with nothing to intersect.`,
        line: first.line,
      },
    ];
  },
};

export const vennSelfUnion: Rule = {
  id: 'venn-self-union',
  appliesTo: isVenn,
  evaluate: ({ lines, headerLine }) => {
    const findings: RuleFinding[] = [];

    for (const statement of parseVennStatements(lines, headerLine)) {
      if (statement.kind !== 'union') continue;
      // A `seen` set rather than `indexOf`, which rescans from the head per
      // element and so is quadratic on the path that finds *nothing* — a union
      // of distinct identifiers, which is the well-formed case every clean
      // diagram takes. Measured at 20 000 distinct identifiers: 255ms via
      // `indexOf`, 2ms here.
      const seen = new Set<string>();
      let repeated: string | undefined;
      for (const id of statement.identifiers) {
        if (seen.has(id)) {
          repeated = id;
          break;
        }
        seen.add(id);
      }
      if (repeated === undefined) continue;
      findings.push({
        message: `venn union names \`${repeated}\` more than once; Mermaid does not deduplicate the list, so the set is intersected with itself and draws a spurious extra region.`,
        line: statement.line,
      });
    }

    return findings;
  },
};

export const vennNoSets: Rule = {
  id: 'venn-no-sets',
  appliesTo: isVenn,
  evaluate: ({ lines, headerLine }) => {
    const declaresSet = parseVennStatements(lines, headerLine).some(
      (statement) => statement.kind === 'set',
    );
    if (declaresSet) return [];
    // A `union` without a declared set never reaches here — mermaid's
    // `validateUnionIdentifiers` throws in the syntax pass — so an empty `set`
    // list means the body carries no venn data at all.
    return [
      {
        message:
          'venn-beta declares no set, so nothing renders: Mermaid throws `Cannot read properties of undefined` on an empty diagram rather than drawing an empty frame. Add at least one `set` statement.',
        line: headerLine,
      },
    ];
  },
};

export const vennDuplicateUnion: Rule = {
  id: 'venn-duplicate-union',
  appliesTo: isVenn,
  evaluate: ({ lines, headerLine, fileLine }) => {
    const seen = new Map<string, number>();
    const findings: RuleFinding[] = [];

    for (const statement of parseVennStatements(lines, headerLine)) {
      if (statement.kind !== 'union') continue;
      // Sorted before keying because `addSubsetData` sorts too, which is what
      // makes `union B, A` the same subset as `union A, B`. A plain sort, on a
      // copy: identifiers are compared by code unit and case-sensitively, the
      // way mermaid compares them, and `identifiers` stays in source order for
      // the message. Keyed on `"` rather than the NUL `sankey-duplicate-link`
      // uses: a venn identifier is `[A-Za-z0-9\-_]+` or a `"[^"]*"` whose
      // quotes `vennNormalize` strips, so `"` is the one character no
      // identifier can hold — NUL is not, since `[^"]*` admits it. Without a
      // separator the list cannot hold, `union "A,B", C` would key the same
      // as the genuinely different `union A, B, C`.
      const key = [...statement.identifiers].sort().join('"');
      const first = seen.get(key);
      if (first === undefined) {
        seen.set(key, statement.line);
        continue;
      }
      // One physical line may carry several statements, so the first sighting
      // is sometimes the line being reported — naming it back would be noise.
      // `radar-duplicate-axis` drops the clause the same way.
      const origin =
        first === statement.line ? '' : ` (first on line ${fileLine(first)})`;
      findings.push({
        message: `venn union \`${statement.identifiers.join(', ')}\` declares an intersection already declared${origin}; Mermaid sorts each list but never deduplicates across statements, so a second region is drawn over the first and both take the last label.`,
        line: statement.line,
      });
    }

    return findings;
  },
};
