import { lilconfig } from 'lilconfig';

export interface MermaidLintConfig {
  files?: string[];
  ignore?: string[];
  strict?: boolean;
  semantic?: boolean;
  format?: 'text' | 'json';
  /**
   * Extra file extensions to include in auto-discovery, beyond the built-in
   * markdown family (`.md`, `.mdx`, `.markdown`, `.mmd`). E.g. `["crv"]` to
   * lint Mermaid fences in Carve files. Merges with the `--ext` CLI flag.
   */
  extensions?: string[];
}

export async function loadConfig(cwd?: string): Promise<MermaidLintConfig> {
  const result = await lilconfig('mermaid-lint', {
    searchPlaces: [
      'package.json',
      '.mermaidlintrc',
      '.mermaidlintrc.json',
      '.mermaidlintrc.js',
      '.mermaidlintrc.cjs',
      '.mermaidlintrc.mjs',
      'mermaid-lint.config.js',
      'mermaid-lint.config.cjs',
      'mermaid-lint.config.mjs',
    ],
    packageProp: 'mermaidLint',
  }).search(cwd);
  return result?.config ?? {};
}
