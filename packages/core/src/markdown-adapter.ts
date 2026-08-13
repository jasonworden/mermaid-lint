import {
  type Block,
  type ExtractOptions,
  bodyLineToFileLine,
  extractMermaidBlocks,
} from './extract.js';
import { RULE_DEFAULTS, type ResolvedRules, type RuleId } from './rules.js';
import {
  type Directive,
  SYNTAX_RULE_ID,
  type SuppressionIndex,
  buildSuppressionIndex,
  parseFileDirectives,
  unusedFileDirectives,
} from './suppress.js';
import { mapParserMessageLines, validateBlock } from './validate.js';

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
  /**
   * Human-readable message (no rule-id prefix; see `ruleId`).
   *
   * For translated syntax errors this names the defect and contains no line
   * citation. For module-raised errors that pass mermaid's own prose through
   * verbatim (e.g. treeView-beta), citations matching `citationRe` are mapped
   * into document coordinates.
   */
  message: string;
  /**
   * mermaid's own message for a syntax error, with every citation it recognizes
   * rewritten into *document* lines — so a fenced block's parse error quotes the
   * line the reader sees, not the line inside the fence.
   *
   * Present only for parser failures: semantic findings and structural defects
   * (unclosed fence, empty block) never reach a parser and carry none.
   */
  raw?: string;
  /**
   * The one corrected source line the explanation is confident about, when it
   * is confident about one — the author's own line, rewritten.
   *
   * Deliberately *not* line-mapped, unlike {@link Diagnostic.raw}: this is
   * quoted source, not parser prose, so a number in it is something the author
   * typed. See `ValidationError.suggestion`.
   */
  suggestion?: string;
  /** True when `--fix` writes exactly {@link Diagnostic.suggestion}. */
  fixable?: boolean;
  /** Stable id: `'mermaid'` for syntax errors, else the semantic rule name. */
  ruleId: string;
  severity: Severity;
}

/**
 * Map a body-relative line to its absolute document line.
 *
 * Adds the one case {@link bodyLineToFileLine} does not cover: a structural
 * error (unclosed/empty fence) carries no body line, and is reported at the
 * block's opener instead.
 *
 * @internal
 */
function toAbsLine(block: Block, relLine: number | undefined): number {
  if (relLine === undefined) return block.line;
  return bodyLineToFileLine(block, relLine);
}

/** Which scope a `directiveDiagnostics` pass is reporting for. */
type DirectiveScope = 'body' | 'file';

/**
 * `suppression-unused` wording, scaled to the scope that found it: a body
 * directive suppressed nothing in its own diagram, a file directive nothing in
 * the whole document.
 *
 * The hedging is deliberate and shared: a directive naming a rule that is
 * `off` in config, or that applies to no diagram type present, is never
 * queried and so looks unused. Both scopes say "may" rather than claiming the
 * directive is definitely stale — building them from one template is what
 * keeps that caveat identical in both.
 */
function unusedMessage(scope: DirectiveScope): string {
  const where = scope === 'file' ? 'in this document' : 'here';
  const applies =
    scope === 'file' ? 'any diagram type here' : 'this diagram type';
  return `suppression directive suppressed nothing ${where}; the named rule may be off, may not apply to ${applies}, or the directive may simply no longer be needed`;
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
 *
 * `scope` selects the `suppression-unused` wording (see {@link unusedMessage});
 * it covaries with `toLine` and `column`, which are already per-scope.
 */
function directiveDiagnostics(
  directives: readonly Directive[],
  getUnused: () => readonly Directive[],
  suppression: SuppressionIndex,
  toLine: (directiveLine: number) => number,
  column: number,
  rules: ResolvedRules,
  scope: DirectiveScope,
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
    push('suppression-unused', d.line, unusedMessage(scope));
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
 * File-scope (`<!-- -->`) directive diagnostics — both a broken directive and
 * one that suppressed nothing — are deliberately **not** reported here:
 * `block.fileDirectives` is the same array for every block in the document,
 * and this function runs once per block, so reporting them here would
 * duplicate the same diagnostic once per block. Worse for the unused case,
 * this function cannot even answer it: a file directive that fires in block 3
 * looks unused from block 1. `lintMarkdown` has the whole-document view and
 * reports both exactly once, at the directive's real document line, after
 * processing every block.
 *
 * One consequence: callers that drive `blockToDiagnostics` per block and never
 * call `lintMarkdown` — today the CLI, remark, textlint, and the test-runner
 * adapters — surface no file-scope directive diagnostics at all. Reaching them
 * means giving each a document-level path (the CLI's `--format json` shape
 * nests every finding under a diagram and has no slot for a document-level
 * one), which is a separate change.
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
  return (await blockDiagnostics(block, rules)).diagnostics;
}

/**
 * {@link blockToDiagnostics}'s body, plus which of the document's file-scope
 * directives actually fired for this block.
 *
 * `lintMarkdown` unions that second channel across every block to decide
 * whether a file directive suppressed nothing document-wide. Widening
 * `blockToDiagnostics`'s published return type for it would be a breaking
 * change to a diagnostic-only feature, so the public wrapper above keeps its
 * shape and this internal form carries the extra channel.
 *
 * Deliberately narrower than returning the whole `SuppressionIndex`: an index
 * closes over the block's split body, its parsed directives and its range map,
 * so handing them all back would keep every block's parse state alive until
 * the whole document finished. A set of directive references costs nothing.
 *
 * @internal
 */
async function blockDiagnostics(
  block: Block,
  rules: ResolvedRules,
): Promise<{
  diagnostics: Diagnostic[];
  usedFileDirectives: ReadonlySet<Directive>;
}> {
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
    const { error } = result;
    diagnostics.push({
      line: toAbsLine(block, error.line),
      column: error.col ?? 1,
      // Translated errors are citation-free; module errors passing through
      // mermaid's prose verbatim have citations mapped to document coordinates.
      message: mapParserMessageLines(error.message, (bodyLine) =>
        bodyLineToFileLine(block, bodyLine),
      ),
      // The one field that still carries mermaid's citations, and so the only
      // one mapped: the parser counts in body lines, the diagnostic is read in
      // file lines.
      raw:
        error.raw === undefined
          ? undefined
          : mapParserMessageLines(error.raw, (bodyLine) =>
              bodyLineToFileLine(block, bodyLine),
            ),
      // Never mapped. It quotes the author's own line, where a number is text
      // they typed rather than a citation — see `ValidationError.suggestion`.
      suggestion: error.suggestion,
      fixable: error.fixable,
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
      'body',
    ),
  );

  // Read after every `isSuppressed` query above has run, so it reflects the
  // block's full validation pass.
  return {
    diagnostics,
    usedFileDirectives: new Set(
      [...realFileDirectives].filter((d) => index.isUsed(d)),
    ),
  };
}

/**
 * Extract every Mermaid block from a Markdown (or `.mmd`) document and return
 * all diagnostics with absolute coordinates. Lines are clamped to the document
 * so a structural error at EOF can't point past the last line. This is the main
 * entry point for Markdown tool integrations.
 *
 * File-scope (`<!-- -->`) directive diagnostics apply to the whole document,
 * not to any one block, so they are computed and reported exactly once here —
 * see {@link blockToDiagnostics}'s doc comment for why it deliberately
 * excludes them. That covers both a broken file directive and one that
 * suppressed nothing anywhere in the document; the latter is only answerable
 * here, since it takes every block's suppression index to know that no block
 * used it.
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
    blocks.map((block) => blockDiagnostics(block, rules)),
  );
  const diagnostics = perBlock.flatMap((r) => r.diagnostics);

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
    // still be reported. The `<!--` test keeps that fallback off the common
    // case: `parseFileDirectives` scans the whole document for fences and
    // inline-code spans, and a file with no HTML comment at all can't yield a
    // directive anyway. That matters because the VS Code extension re-lints
    // on every edit, and most Markdown files carry no diagrams.
    const fileDirectives =
      blocks[0]?.fileDirectives ??
      (text.includes('<!--')
        ? parseFileDirectives(text.replace(/\r\n/g, '\n'))
        : []);
    // File directives carry no body, only the document; an empty body list
    // is fine because `isSuppressed`'s `file`/`diagram` branch never
    // consults `line` or body content.
    const fileIndex = buildSuppressionIndex([], fileDirectives);
    diagnostics.push(
      ...directiveDiagnostics(
        fileDirectives,
        // Stays a thunk for the same reason the body-scope call does: the
        // problem loop inside `directiveDiagnostics` runs first and can mark
        // a directive used on `fileIndex` — a file directive naming a
        // meta-rule can suppress *another* file directive's problem, and that
        // counts as having fired. So `used` must be assembled here, not by
        // the caller beforehand.
        //
        // Every block reports usage over the very `Directive` objects in
        // `fileDirectives` (extract.ts attaches one shared array to every
        // block), so identity comparison across blocks is sound.
        () =>
          unusedFileDirectives(
            fileDirectives,
            new Set([
              ...fileDirectives.filter((d) => fileIndex.isUsed(d)),
              ...perBlock.flatMap((r) => [...r.usedFileDirectives]),
            ]),
          ),
        fileIndex,
        (line) => line, // parseFileDirectives already yields a real document line.
        1,
        rules,
        'file',
      ),
    );
  }

  const lineCount = text.replace(/\r\n/g, '\n').split('\n').length;
  for (const d of diagnostics) {
    d.line = Math.min(Math.max(d.line, 1), lineCount);
  }
  return diagnostics;
}
