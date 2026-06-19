import { loadCore } from './core.js';

/** Returns the auto-fixed text when it differs from the input, else null. */
export async function computeFix(
  path: string,
  text: string,
): Promise<string | null> {
  const { fixText } = await loadCore();
  const fixed = fixText(text, { path });
  return fixed === text ? null : fixed;
}
