import { DIRECTION_RE, isFlowchartOrGraph } from '../helpers.js';
import type { Rule } from '../types.js';

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

/**
 * Strip the trailing colon `radar-beta:` is allowed to carry. Radar is the only
 * diagram whose grammar accepts a colon after the keyword — `xychart-beta:` and
 * `treemap-beta:` are both parse errors — and `detectDiagramType` reports the
 * header verbatim, so the colon reaches `block.type`. Every `-beta` suffix test
 * goes through here so that form is not silently exempt from the beta rules.
 */
export function stripHeaderColon(type: string): string {
  return type.endsWith(':') ? type.slice(0, -1) : type;
}

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
