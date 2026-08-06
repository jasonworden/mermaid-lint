import { locateFrontmatter } from './header.js';

/**
 * A `%%` comment line, as mermaid's `cleanupComments` matches it:
 * `/^\s*%%(?!{)[^\n]+\n?/gm`. The negative lookahead spares `%%{...}%%`
 * directives, which are removed earlier and differently; the trailing `[^\n]+`
 * means a bare `%%` with nothing after it is not a comment and survives.
 */
const COMMENT_RE = /^[^\S\n]*%%(?!\{)[^\n]+/;

/** A `%%{...}%%` directive, which may open and close on different lines. */
const DIRECTIVE_OPEN_RE = /%%\{/;
const DIRECTIVE_CLOSE_RE = /\}%%/;

/** One line of mermaid's preprocessed text, and the body line it came from. */
interface ParsedLine {
  text: string;
  /** 0-indexed line in the original body. */
  body: number;
}

/**
 * Rebuild the text mermaid's parser actually sees, keeping each line's origin.
 *
 * `preprocessDiagram` runs four passes in this order, and the order is what
 * makes the result non-obvious:
 *
 * 1. **Frontmatter** — `frontMatterRegex` consumes the block *and* its trailing
 *    newlines, so those lines are gone outright.
 * 2. **Directives** — `removeDirectives` deletes the matched `%%{...}%%` *text*,
 *    not the line around it. A directive alone on a line therefore leaves an
 *    empty line behind, and one spanning several lines collapses them to a
 *    single empty line, because the match swallowed the newlines between.
 * 3. **Comments** — `cleanupComments`' `\s*` matches newlines under `m`, so a
 *    comment takes the blank lines directly above it with it.
 * 4. **`trimStart`** — whatever blank lines are left at the very top go too,
 *    which is the only reason a *leading* directive seems to vanish entirely.
 *
 * Simulating the passes beats classifying lines: the same construct is deleted
 * or merely blanked depending on where it sits.
 */
function parsedLines(body: string): ParsedLine[] {
  // mermaid normalizes line endings before anything else. Matching on the
  // stripped text rather than re-splitting keeps our indices aligned with the
  // caller's body, which a re-split on a lone `\r` would not.
  const raw = body.split('\n');
  let lines: ParsedLine[] = raw.map((text, body) => ({
    text: text.replace(/\r$/, ''),
    body,
  }));

  const frontmatter = locateFrontmatter(lines.map((l) => l.text));
  if (frontmatter) {
    lines = lines.filter(
      (_, i) => i < frontmatter.start || i > frontmatter.end,
    );
  }

  const afterDirectives: ParsedLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!DIRECTIVE_OPEN_RE.test(lines[i].text)) {
      afterDirectives.push(lines[i]);
      continue;
    }
    let close = i;
    while (close < lines.length && !DIRECTIVE_CLOSE_RE.test(lines[close].text))
      close++;
    if (close >= lines.length) {
      // Unterminated: mermaid's regex does not match, so the text stays put.
      afterDirectives.push(lines[i]);
      continue;
    }
    const open = lines[i].text;
    const shut = lines[close].text;
    const merged =
      open.slice(0, open.indexOf('%%{')) +
      shut.slice(shut.indexOf('}%%') + '}%%'.length);
    afterDirectives.push({ text: merged, body: lines[i].body });
    i = close;
  }
  lines = afterDirectives;

  const afterComments: ParsedLine[] = [];
  for (const line of lines) {
    if (COMMENT_RE.test(line.text)) {
      // The comment's leading `\s*` reaches back over the blank lines above it.
      while (
        afterComments.length > 0 &&
        afterComments[afterComments.length - 1].text.trim() === ''
      )
        afterComments.pop();
      continue;
    }
    afterComments.push(line);
  }
  lines = afterComments;

  let start = 0;
  while (start < lines.length && lines[start].text.trim() === '') start++;
  return lines.slice(start);
}

/**
 * Translate a line number mermaid reported into the body line it belongs to.
 *
 * mermaid parses a preprocessed copy of the diagram, so its line numbers count
 * only what survived — a body carrying frontmatter, a `%%{init}%%` directive or
 * a `%%` comment is cited short by however many lines went away. That bites
 * this project in particular, because its own suppression directives are `%%`
 * comments.
 *
 * @param body - The raw diagram body, exactly as handed to mermaid.
 * @param parsedLine - A 1-indexed line in mermaid's preprocessed text.
 * @returns The matching 1-indexed body line, clamped to the last survivor.
 * @internal
 */
export function parsedLineToBodyLine(body: string, parsedLine: number): number {
  const lines = parsedLines(body);
  // A body of nothing but comments has no lines to index into, and no diagram
  // either — mermaid rejects it on other grounds and cites nothing.
  if (lines.length === 0) return parsedLine;
  const index = Math.min(Math.max(parsedLine, 1), lines.length) - 1;
  return lines[index].body + 1;
}
