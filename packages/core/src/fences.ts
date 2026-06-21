// Shared CommonMark code-fence matching for Mermaid blocks. Both the extractor
// (extract.ts) and the auto-fixer (fix.ts) scan for fences line-by-line, so the
// regex construction lives here to keep them in lockstep.

/**
 * A code-fence marker style recognized for Mermaid blocks: `'backtick'` for
 * ```` ``` ```` fences or `'tilde'` for `~~~` fences.
 *
 * @public
 */
export type FenceMarker = 'backtick' | 'tilde';

/**
 * Every supported fence marker — the default set, matching CommonMark.
 *
 * @public
 */
export const ALL_FENCE_MARKERS: readonly FenceMarker[] = ['backtick', 'tilde'];

const FENCE_CHAR: Record<FenceMarker, string> = {
  backtick: '`',
  tilde: '~',
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Type guard: `true` when `value` is a recognized fence-marker name
 * (`'backtick'` or `'tilde'`).
 *
 * @public
 */
export function isFenceMarker(value: unknown): value is FenceMarker {
  return value === 'backtick' || value === 'tilde';
}

/**
 * Build the opening-fence regex for a `mermaid` block. A CommonMark fence is a
 * run of at least three backticks or tildes; the run's char and length matter
 * because the closing fence must use the same char and be at least as long.
 *
 * Capture groups: 1 = leading indent, 2 = the full fence run (e.g. `` ```` ``),
 * 3 = the optional info string after `mermaid`.
 *
 * Returns `null` when no markers are enabled (so callers skip fenced scanning
 * entirely rather than matching an empty alternation).
 *
 * @internal
 */
export function makeFenceOpenRe(fences: readonly FenceMarker[]): RegExp | null {
  const alts = fences.map((f) => `${escapeRe(FENCE_CHAR[f])}{3,}`);
  if (alts.length === 0) return null;
  return new RegExp(
    `^([ \\t]*)(${alts.join('|')})mermaid([ \\t][^\\n]*)?\\s*$`,
  );
}

/**
 * Build the closing-fence regex for an opener: same indent, same fence char,
 * and a run at least as long as the opener's run (CommonMark close rule). This
 * is what lets a 4-backtick fence wrap a body that itself contains ```` ``` ````.
 *
 * @internal
 */
export function makeFenceCloseRe(indent: string, marker: string): RegExp {
  const char = escapeRe(marker[0]);
  return new RegExp(`^${escapeRe(indent)}${char}{${marker.length},}\\s*$`);
}
