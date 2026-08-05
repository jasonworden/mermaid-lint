import {
  type Block,
  type ExtractOptions,
  extractMermaidBlocks,
} from './extract.js';
import { RULE_DEFAULTS, type ResolvedRules, type RuleId } from './rules.js';
import {
  type Directive,
  SYNTAX_RULE_ID,
  type SuppressionIndex,
  buildSuppressionIndex,
  parseFileDirectives,
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

/**
 * One diagnostic per directive problem, plus one per directive that never
 * suppressed anything, each reported at the directive's own line (mapped
 * through `toLine`).
 *
 * The meta-rules this reports (`suppression-unknown-rule`, `suppression-unused`,
 * `suppression-malformed`) are themselves suppressible — see
 * `RULE_IDS_EXCLUDED_FROM_ALL`'s doc comment in suppress.ts: naming one
 * explicitly (they're excluded from the `all` wildcard) quiets it. Routing
 * through `suppression.isSuppressed` here is what makes that real, and the
 * query marks the suppressing directive used so it doesn't also show up as
 * `suppression-unused`. A directive that is itself malformed is already
 * inert to `isSuppressed` (problem-carrying directives never match), so it
 * still cannot suppress the diagnostic reporting its own malformedness even
 * if it names the relevant meta-rule.
 *
 * `getUnused` is a thunk, not a plain array: `SuppressionIndex.unused()`
 * reflects which directives were queried so far, and the problem-reporting
 * loop below can itself mark a directive used (a directive naming
 * `suppression-unknown-rule` etc. gets queried via `isSuppressed`). Passing
 * an already-evaluated array would race that - JS evaluates call arguments
 * before the function body runs, so `unused()` must be called from inside
 * this function, after the problem loop, not by the caller beforehand.
 */
function directiveDiagnostics(
  directives: readonly Directive[],
  getUnused: () => readonly Directive[],
  suppression: SuppressionIndex,
  toLine: (directiveLine: number) => number,
  column: number,
  rules: ResolvedRules,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const push = (ruleId: RuleId, line: number, message: string) => {
    if (suppression.isSuppressed(ruleId, line)) return;
    const severity = rules[ruleId];
    if (severity === 'off') return;
    out.push({
      line: toLine(line),
      column,
      message,
      ruleId,
      severity: severity === 'error' ? 'error' : 'warning',
    });
  };

  for (const d of directives) {
    for (const p of d.problems) {
      switch (p.kind) {
        case 'unknown-rule':
          push(
            'suppression-unknown-rule',
            d.line,
            `unknown rule "${p.rule}" in suppression directive; the whole directive is inert, not just this id`,
          );
          break;
        case 'missing-reason':
          push(
            'suppression-malformed',
            d.line,
            'suppression directive needs a reason, e.g. `%% mermaid-lint-disable-next-line duplicate-ids: ids collide upstream`',
          );
          break;
        case 'empty-rules':
          push(
            'suppression-malformed',
            d.line,
            'suppression directive names no rules; list rule ids or use `all`',
          );
          break;
        case 'empty-directive':
          push(
            'suppression-malformed',
            d.line,
            'suppression directive has no rule ids and no reason, e.g. `%% mermaid-lint-disable-next-line duplicate-ids: ids collide upstream`',
          );
          break;
        case 'wrong-scope':
          push(
            'suppression-malformed',
            d.line,
            p.expected === 'file'
              ? `\`${p.keyword}\` only works as a Markdown HTML comment (\`<!-- ${p.keyword} <rules>: <reason> -->\`), not inside a \`%%\` diagram comment`
              : `\`${p.keyword}\` only works as a \`%%\` diagram comment (\`%% ${p.keyword} <rules>: <reason>\`), not inside an HTML comment`,
          );
          break;
        case 'unmatched-enable':
          push(
            'suppression-malformed',
            d.line,
            '`mermaid-lint-enable` has no matching `mermaid-lint-disable`',
          );
          break;
        case 'syntax-rule-at-line-scope':
          push(
            'suppression-malformed',
            d.line,
            `\`${SYNTAX_RULE_ID}\` can only be suppressed with -disable-diagram or -disable-file, not at line scope`,
          );
          break;
        default: {
          // Exhaustiveness guard: a new `DirectiveProblem` variant that isn't
          // handled above fails to compile here instead of silently falling
          // through to some other case's message.
          const exhaustive: never = p;
          throw new Error(
            `unhandled directive problem kind: ${JSON.stringify(exhaustive)}`,
          );
        }
      }
    }
  }

  for (const d of getUnused()) {
    push(
      'suppression-unused',
      d.line,
      'suppression directive suppressed nothing here; the named rule may be off, may not apply to this diagram type, or the directive may simply no longer be needed',
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
 * coordinates before conversion — and broken *body*-scope directives are
 * reported via the `suppression-*` meta-rules.
 *
 * Broken file-scope (`<!-- -->`) directives are deliberately **not** reported
 * here: `block.fileDirectives` is the same array for every block in the
 * document, and this function runs once per block, so reporting them here
 * would duplicate the same diagnostic once per block. `lintMarkdown` reports
 * them exactly once, at the directive's real document line, after processing
 * all blocks. One consequence: adapters that call `blockToDiagnostics`
 * directly per block (remark, textlint) and never call `lintMarkdown` will
 * not surface file-directive problems — consistent with `unused()` already
 * excluding file-scope directives for the same per-block-vs-once-per-document
 * reason (see suppress.ts).
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
  //
  // Structural errors (unclosed fence, empty block) are never suppressible:
  // they describe the document, not the diagram, and an unclosed fence has no
  // parseable body for a `%%` directive to live in — so honoring suppression
  // there would let a single `-disable-file mermaid` hide broken Markdown
  // indefinitely. See `ValidationError.structural`.
  const suppressible = !result.ok && !result.error.structural;
  if (
    !result.ok &&
    (!suppressible || !index.isSuppressed(SYNTAX_RULE_ID, result.error.line))
  ) {
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

  // Only body-scope directives are reported per block — see the doc comment
  // above. `index.unused()` already excludes file-scope directives, so it
  // needs no filtering here. The suppression index still spans body + file
  // directives, so a file-scope directive naming a meta-rule can suppress a
  // body-scope directive problem, matching how file scope applies everywhere
  // else.
  //
  // Filtered by identity against `block.fileDirectives`, not by
  // `d.kind !== 'file'`: a `%% mermaid-lint-disable-file ...` written in the
  // diagram body (wrong scope) parses to a *body*-sourced `Directive` whose
  // `kind` is still `'file'` (see `wrongScopeDirective` in suppress.ts) - a
  // kind-based filter would silently drop it here, and it isn't in
  // `block.fileDirectives` either, so it would never be reported anywhere.
  const realFileDirectives = new Set(block.fileDirectives ?? []);
  const bodyDirectives = index.directives.filter(
    (d) => !realFileDirectives.has(d),
  );
  diagnostics.push(
    ...directiveDiagnostics(
      bodyDirectives,
      () => index.unused(),
      index,
      (line) => toAbsLine(block, line),
      block.col,
      rules,
    ),
  );

  return diagnostics;
}

/**
 * Extract every Mermaid block from a Markdown (or `.mmd`) document and return
 * all diagnostics with absolute coordinates. Lines are clamped to the document
 * so a structural error at EOF can't point past the last line. This is the main
 * entry point for Markdown tool integrations.
 *
 * File-scope (`<!-- -->`) directive problems apply to the whole document, not
 * to any one block, so they are computed and reported exactly once here —
 * see {@link blockToDiagnostics}'s doc comment for why it deliberately
 * excludes them.
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
  const diagnostics = perBlock.flat();

  // Mirrors extract.ts: a `.mmd` file is a whole-file diagram, not Markdown,
  // so `<!-- -->` file directives are not meaningful for it (extract.ts
  // always attaches `fileDirectives: []` for `.mmd`).
  if (!path.endsWith('.mmd')) {
    // Reuse the array `extractMermaidBlocks` already parsed and attached to
    // every block, rather than re-running `parseFileDirectives` over the
    // same text a second time. Only falls back to parsing directly when the
    // document has no Mermaid blocks at all (so nothing to reuse it from) —
    // a document can still carry a file directive with no diagrams to apply
    // it to, and that directive's own problems (e.g. unknown-rule) should
    // still be reported.
    const fileDirectives =
      blocks[0]?.fileDirectives ??
      parseFileDirectives(text.replace(/\r\n/g, '\n'));
    // File directives carry no body, only the document; an empty body list
    // is fine because `isSuppressed`'s `file`/`diagram` branch never
    // consults `line` or body content.
    const fileIndex = buildSuppressionIndex([], fileDirectives);
    diagnostics.push(
      ...directiveDiagnostics(
        fileDirectives,
        () => fileIndex.unused(), // always [] - unused() excludes file-scope directives.
        fileIndex,
        (line) => line, // parseFileDirectives already yields a real document line.
        1,
        rules,
      ),
    );
  }

  const lineCount = text.replace(/\r\n/g, '\n').split('\n').length;
  for (const d of diagnostics) {
    d.line = Math.min(Math.max(d.line, 1), lineCount);
  }
  return diagnostics;
}
