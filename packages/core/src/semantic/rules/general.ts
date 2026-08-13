import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DIRECTION_RE, isFlowchartOrGraph, isGantt } from '../helpers.js';
import { stripHeaderColon } from '../helpers.js';
import type { Rule, RuleFinding } from '../types.js';

/**
 * Mermaid only honors frontmatter that opens the body, so anything before it —
 * a `%%` comment or even a blank line — silently disables the block.
 *
 * `appliesTo` is a type check rather than a scan. Since #132 taught
 * `locateHeader` to skip a leading, terminated frontmatter block, a well-formed
 * frontmatter diagram types as its real keyword; `'---'` is left meaning
 * "frontmatter present but misplaced or unterminated" and nothing else.
 *
 * `headerLine === 1` is the unterminated case — nothing precedes the `---`, and
 * the parser already rejects it with "Diagrams beginning with --- are not
 * valid", so staying silent here avoids double-reporting the same body.
 *
 * Note that a `%% mermaid-lint-disable-next-line` above the frontmatter would
 * suppress this finding while itself being the content that breaks the render.
 * The escape hatch that actually works is a file-scope
 * `<!-- mermaid-lint-disable-file -->` directive, which lives outside the body.
 *
 * @see https://github.com/jasonworden/mermaid-lint/issues/123
 */
export const frontmatterMustBeFirst: Rule = {
  id: 'frontmatter-must-be-first',
  appliesTo: (block) => block.type === '---',
  evaluate: ({ lines, headerLine }) => {
    // Nothing precedes the `---`: unterminated frontmatter, already a syntax
    // error. Reporting it here would say the same thing twice.
    if (headerLine === 1) return [];

    // The two remedies differ in kind, so they are worth distinguishing: a
    // comment should be moved (it carries information), blank lines deleted.
    const [cause, remedy] = lines
      .slice(0, headerLine - 1)
      .some((l) => l.trim().startsWith('%%'))
      ? [
          'a `%%` comment precedes it',
          'move the comment below the closing `---`',
        ]
      : ['a blank line precedes it', 'delete the blank lines above it'];

    return [
      {
        message: `YAML frontmatter must open the diagram, but ${cause}. Mermaid only strips frontmatter at the very start of a body, so this parses but fails to render — ${remedy}.`,
        line: headerLine,
      },
    ];
  },
};

export const preferFlowchart: Rule = {
  id: 'prefer-flowchart',
  appliesTo: (block) => block.type === 'graph',
  evaluate: ({ headerLine }) => [
    {
      message:
        'use `flowchart` instead of `graph`: `graph` is legacy Mermaid syntax. `flowchart` is the current keyword and enables per-subgraph `direction` control.',
      line: headerLine,
    },
  ],
};

export const requireDirection: Rule = {
  id: 'require-direction',
  appliesTo: isFlowchartOrGraph,
  evaluate: ({ block, headerLine, headerText }) => {
    if (DIRECTION_RE.test(headerText)) return [];
    return [
      {
        message: `\`${block.type}\` has no direction and defaults to \`TD\`. Prefer an explicit direction, e.g. \`${block.type} TD\`, to make layout intent clear.`,
        line: headerLine,
      },
    ];
  },
};

export const noExperimental: Rule = {
  id: 'no-experimental',
  appliesTo: (block) => stripHeaderColon(block.type).endsWith('-beta'),
  evaluate: ({ block, headerLine }) => [
    {
      message: `\`${block.type}\` is an experimental Mermaid diagram type. Its syntax is unstable and may break on a Mermaid upgrade; prefer a stable diagram type where possible.`,
      line: headerLine,
    },
  ],
};

/**
 * A `click <id> [href] "target"` statement. The tooltip string and trailing
 * `_blank`/`_self`/etc. that may follow the target are irrelevant here, so
 * the match stops at the first quoted string; the `call callback(...)` and
 * bare-callback forms never have a quoted string in this position, so they
 * never match.
 */
const CLICK_HREF_RE = /^\s*click\s+\S+\s+(?:href\s+)?"([^"]*)"/;

/**
 * An RFC 3986 scheme prefix (`http:`, `mailto:`, `javascript:`, ...).
 * Incidentally also matches a Windows drive letter (`C:`) — deliberately
 * treated the same way: not a checkable relative path.
 */
const URI_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/**
 * Flags a `click` target that looks like a local relative file path but does
 * not resolve to a real file next to the diagram's containing file. Tier 1
 * of #185: local file targets only — no anchor-fragment validation (#186)
 * and no remote-URL checks (network in a linter means CI flakiness).
 *
 * `appliesTo` is deliberately narrowed to `flowchart`/`graph`/`gantt` — the
 * two diagram families this repo's own code already had to special-case for
 * `click` (`edges.ts`'s `SKIP_KEYWORDS` and the gantt task-line regex both
 * carve it out specifically for these). This is a Tier-1 scope choice, not a
 * claim that `click` is unsupported elsewhere: mermaid also accepts
 * `click X href "..."` in `classDiagram` and `stateDiagram-v2`. Covering
 * those is a known follow-up, not part of this rule.
 *
 * Only runs when `block.path` exists on disk — see the guard below for why.
 *
 * `CLICK_HREF_RE` requires `click` to open the line, so a `;`-separated
 * statement sharing a line with something else (`A-->B; click A "..."`) is
 * never seen. That's the same one-statement-per-line assumption every rule
 * in this codebase makes (`edges.ts`'s `SKIP_KEYWORDS`, every other file in
 * `semantic/rules/`) — a shared, pre-existing limitation of the line-based
 * scanner, not something specific to this rule.
 */
export const clickTargetNotFound: Rule = {
  id: 'click-target-not-found',
  appliesTo: (block) => isFlowchartOrGraph(block) || isGantt(block),
  evaluate: ({ block, lines }) => {
    const findings: RuleFinding[] = [];
    // Resolved lazily: most diagrams have no checkable click target, and
    // every line in a block shares the same containing directory, so this
    // is at most one stat and one `dirname` call per block, not per line.
    let containingDir: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (raw.trimStart().startsWith('%%')) continue;
      const match = CLICK_HREF_RE.exec(raw);
      if (match === null) continue;

      const target = match[1].trim();
      if (target === '') continue;
      if (URI_SCHEME_RE.test(target)) continue; // remote URL / mailto: / etc.
      if (target.startsWith('/')) continue; // ambiguous absolute/site-root path

      const filePart = target.split('#')[0];
      if (filePart === '') continue; // pure same-page anchor

      if (containingDir === null) {
        // `<stdin>` (CLI stdin mode) and other virtual paths have no real
        // containing directory to resolve a relative target against, so
        // every target would otherwise read as broken.
        if (!existsSync(block.path)) return [];
        containingDir = dirname(block.path);
      }

      // Tier 1 doesn't distinguish file from directory: a same-named
      // directory counts as "exists" here, same as a file would.
      const resolved = resolve(containingDir, filePart);
      if (existsSync(resolved)) continue;

      findings.push({
        message: `click target \`${target}\` does not exist relative to this file`,
        line: i + 1,
      });
    }
    return findings;
  },
};
