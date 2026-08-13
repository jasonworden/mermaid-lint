/**
 * The diagram-type keywords mermaid recognizes at the top of a diagram
 * (`flowchart`, `sequenceDiagram`, ...), used to suggest a correction when
 * mermaid's parser rejects an unrecognized header keyword with
 * `No diagram type detected matching given configuration for text: ...`.
 *
 * Seeded from the `ReadmeDiagramKeyword` union in `../rules.ts` (kept
 * in sync by a source-scanning drift test in
 * `test/explain/diagram-types.test.ts`), plus the header aliases mermaid
 * also accepts that aren't part of that union: `stateDiagram` (mermaid
 * accepts the un-suffixed form as well as `stateDiagram-v2`). The other
 * aliases mermaid supports (`graph`, `gitGraph`, `classDiagram`,
 * `erDiagram`, `C4Context`) are already members of `ReadmeDiagramKeyword`.
 */
export const KNOWN_DIAGRAM_TYPES: readonly string[] = [
  'architecture-beta',
  'block-beta',
  'C4Context',
  'classDiagram',
  'erDiagram',
  'eventmodeling',
  'flowchart',
  'gantt',
  'gitGraph',
  'graph',
  'ishikawa-beta',
  'journey',
  'kanban',
  'mindmap',
  'packet-beta',
  'pie',
  'quadrantChart',
  'radar-beta',
  'requirementDiagram',
  'sankey-beta',
  'sequenceDiagram',
  'stateDiagram',
  'stateDiagram-v2',
  'timeline',
  'treemap-beta',
  'treeView-beta',
  'venn-beta',
  'wardley-beta',
  'xychart-beta',
];

/**
 * Iterative two-row Levenshtein distance. Bails out early once every entry
 * in the current row already exceeds `maxDistance`, since the distance can
 * only grow from there.
 */
function levenshtein(a: string, b: string, maxDistance: number): number {
  if (Math.abs(a.length - b.length) > maxDistance) {
    return maxDistance + 1;
  }

  let previousRow = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const currentRow = [i];
    let rowMin = currentRow[0];

    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        previousRow[j] + 1, // deletion
        currentRow[j - 1] + 1, // insertion
        previousRow[j - 1] + cost, // substitution
      );
      currentRow.push(value);
      rowMin = Math.min(rowMin, value);
    }

    if (rowMin > maxDistance) {
      return maxDistance + 1;
    }

    previousRow = currentRow;
  }

  return previousRow[b.length];
}

/**
 * The closest known diagram type within edit distance 2, else undefined.
 *
 * A case-insensitive exact match (e.g. `sequencediagram` vs
 * `sequenceDiagram`) always wins outright, ahead of any edit-distance
 * comparison — this is the single most common real typo, and plain
 * Levenshtein distance would otherwise tie it with other candidates.
 * Otherwise, among known types within distance 2, ties break toward the
 * shorter candidate and then alphabetically, so the result is deterministic.
 */
export function nearestDiagramType(word: string): string | undefined {
  const lower = word.toLowerCase();
  const exact = KNOWN_DIAGRAM_TYPES.find(
    (type) => type.toLowerCase() === lower,
  );
  if (exact !== undefined) {
    return exact;
  }

  const maxDistance = 2;
  let best: string | undefined;
  let bestDistance = maxDistance + 1;

  for (const type of KNOWN_DIAGRAM_TYPES) {
    const distance = levenshtein(word, type, maxDistance);
    if (distance > maxDistance) {
      continue;
    }
    if (
      best === undefined ||
      distance < bestDistance ||
      (distance === bestDistance &&
        (type.length < best.length ||
          (type.length === best.length && type < best)))
    ) {
      best = type;
      bestDistance = distance;
    }
  }

  return best;
}
