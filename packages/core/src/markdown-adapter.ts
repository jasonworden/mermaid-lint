import {
  type Block,
  type ExtractOptions,
  extractMermaidBlocks,
} from './extract.js';
import { RULE_DEFAULTS, type ResolvedRules, type RuleId } from './rules.js';
import {
  type Directive,
  SYNTAX_RULE_ID,
  buildSuppressionIndex,
} from './suppress.js';
import { validateBlock } from './validate.js';

/**
 * Diagnostic severity: a syntax `error` or a semantic `warning`.
 *
 * @public
 */
export type Severity = 'error' | 'warning';

/**
 * A normalized diagnostic with absolute (document-relative) coordinates.
 *
 * This is the single shape every Markdown integration (markdownlint, remark,
 * textlint, …) consumes, so they all share one extract → validate → report
 * path instead of each re-deriving line mapping and error shaping.
 *
 * @public
 */
export interface Diagnostic {
  /** 1-indexed line in the source document. */
  line: number;
  /** 1-indexed column in the source document. */
  column: number;
  /** Human-readable message (no rule-id prefix; see `ruleId`). */
  message: string;
  /** Stable id: `'mermaid'` for syntax errors, else the semantic rule name. */
  ruleId: string;
  severity: Severity;
}

/**
 * Map a body-relative line to its absolute document line.
 *
 * - A structural error (unclosed/empty fence) carries no line; report it at the
 *   block's opener line (`block.line`).
 * - For a fenced block, the body starts one line after the opener, so the
 *   opener line itself is the offset added to the 1-indexed body line.
 * - For a whole-file `.mmd` block, the body starts at line 1, so the offset is
 *   `block.line - 1` (i.e. 0 when `block.line` is 1).
 *
 * @internal
 */
function toAbsLine(block: Block, relLine: number | undefined): number {
  if (relLine === undefined) return block.line;
  const bodyOffset = block.path.endsWith('.mmd') ? block.line - 1 : block.line;
  return bodyOffset + relLine;
}

/** One message per directive problem, reported at the directive's own line. */
function directiveDiagnostics(
  block: Block,
  directives: readonly Directive[],
  unused: readonly Directive[],
  rules: ResolvedRules,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const push = (ruleId: RuleId, line: number, message: string) => {
    const severity = rules[ruleId];
    if (severity === 'off') return;
    out.push({
      line: toAbsLine(block, line),
      column: block.col,
      message,
      ruleId,
      severity: severity === 'error' ? 'error' : 'warning',
    });
  };

  for (const d of directives) {
    for (const p of d.problems) {
      if (p.kind === 'unknown-rule') {
        push(
          'suppression-unknown-rule',
          d.line,
          `unknown rule "${p.rule}" in suppression directive; it suppresses nothing`,
        );
      } else if (p.kind === 'missing-reason') {
        push(
          'suppression-malformed',
          d.line,
          'suppression directive needs a reason, e.g. `%% mermaid-lint-disable-next-line duplicate-ids: ids collide upstream`',
        );
      } else if (p.kind === 'empty-rules') {
        push(
          'suppression-malformed',
          d.line,
          'suppression directive names no rules; list rule ids or use `all`',
        );
      } else if (p.kind === 'unmatched-enable') {
        push(
          'suppression-malformed',
          d.line,
          '`mermaid-lint-enable` has no matching `mermaid-lint-disable`',
        );
      } else {
        push(
          'suppression-malformed',
          d.line,
          `\`${SYNTAX_RULE_ID}\` can only be suppressed with -disable-diagram or -disable-file, not at line scope`,
        );
      }
    }
  }

  for (const d of unused) {
    push(
      'suppression-unused',
      d.line,
      'suppression directive suppressed nothing; remove it or fix the rule ids',
    );
  }

  return out;
}

/**
 * Validate a single extracted block and return its diagnostics with absolute
 * coordinates. Both syntax errors (severity `error`) and semantic warnings
 * (severity `warning`) are returned; consumers filter by severity as needed
 * (e.g. markdownlint surfaces only errors; remark/textlint add warnings in
 * strict mode). Suppression directives are honored — filtered in body-relative
 * coordinates before conversion — and broken directives are reported via the
 * `suppression-*` meta-rules.
 *
 * @param block - The block to validate.
 * @param rules - Resolved per-rule severities for the semantic pass. Defaults
 *   to {@link RULE_DEFAULTS}.
 * @returns Diagnostics with document-absolute line/column coordinates.
 * @public
 */
export async function blockToDiagnostics(
  block: Block,
  rules: ResolvedRules = RULE_DEFAULTS,
): Promise<Diagnostic[]> {
  const bodyLines = block.body.split('\n');
  const index = buildSuppressionIndex(bodyLines, block.fileDirectives);
  const result = await validateBlock(block, rules, index);
  const diagnostics: Diagnostic[] = [];

  // Filter on body-relative lines — the same space directives are parsed in —
  // then convert. Doing it after toAbsLine would compare document lines against
  // body lines.
  if (!result.ok && !index.isSuppressed(SYNTAX_RULE_ID, result.error.line)) {
    diagnostics.push({
      line: toAbsLine(block, result.error.line),
      column: result.error.col ?? 1,
      message: result.error.message,
      ruleId: SYNTAX_RULE_ID,
      severity: 'error',
    });
  }

  for (const w of result.warnings) {
    diagnostics.push({
      line: toAbsLine(block, w.line),
      column: block.col,
      message: w.message,
      ruleId: w.rule,
      // A semantic rule resolved to `error` is reported as an error diagnostic;
      // `warn` becomes a `warning`.
      severity: w.severity === 'error' ? 'error' : 'warning',
    });
  }

  diagnostics.push(
    ...directiveDiagnostics(block, index.directives, index.unused(), rules),
  );

  return diagnostics;
}

/**
 * Extract every Mermaid block from a Markdown (or `.mmd`) document and return
 * all diagnostics with absolute coordinates. Lines are clamped to the document
 * so a structural error at EOF can't point past the last line. This is the main
 * entry point for Markdown tool integrations.
 *
 * @param path - Source path (a `.mmd` extension switches to whole-file mode).
 * @param text - Document contents.
 * @param options - Fence markers to recognize (see {@link ExtractOptions}).
 * @param rules - Resolved per-rule severities for the semantic pass. Defaults
 *   to {@link RULE_DEFAULTS}.
 * @returns Every diagnostic across all blocks, with absolute coordinates.
 * @public
 */
export async function lintMarkdown(
  path: string,
  text: string,
  options: ExtractOptions = {},
  rules: ResolvedRules = RULE_DEFAULTS,
): Promise<Diagnostic[]> {
  const blocks = extractMermaidBlocks(path, text, options);
  const perBlock = await Promise.all(
    blocks.map((block) => blockToDiagnostics(block, rules)),
  );
  const lineCount = text.replace(/\r\n/g, '\n').split('\n').length;
  const diagnostics = perBlock.flat();
  for (const d of diagnostics) {
    d.line = Math.min(Math.max(d.line, 1), lineCount);
  }
  return diagnostics;
}
