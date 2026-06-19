import { fixText } from '@mermaid-lint/core';

/** Returns the auto-fixed text when it differs from the input, else null. */
export function computeFix(path: string, text: string): string | null {
  const fixed = fixText(text, { path });
  return fixed === text ? null : fixed;
}
