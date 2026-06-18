import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('returns empty object when no config file present', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-cfg-'));
    const config = await loadConfig(tmp);
    expect(config).toEqual({});
  });

  it('reads .mermaidlintrc.json', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-cfg-'));
    writeFileSync(
      join(tmp, '.mermaidlintrc.json'),
      JSON.stringify({ strict: true, format: 'json' }),
    );
    const config = await loadConfig(tmp);
    expect(config.strict).toBe(true);
    expect(config.format).toBe('json');
  });

  it('reads mermaid-lint.config.js (ESM default export)', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-cfg-'));
    writeFileSync(
      join(tmp, 'mermaid-lint.config.js'),
      'export default { semantic: false, ignore: ["dist"] };\n',
    );
    const config = await loadConfig(tmp);
    expect(config.semantic).toBe(false);
    expect(config.ignore).toEqual(['dist']);
  });

  it('reads package.json mermaidLint field', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-cfg-'));
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify({
        name: 'test',
        mermaidLint: { files: ['docs/**/*.md'] },
      }),
    );
    const config = await loadConfig(tmp);
    expect(config.files).toEqual(['docs/**/*.md']);
  });

  it('returns empty object for a config file with no recognized keys', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-cfg-'));
    writeFileSync(
      join(tmp, '.mermaidlintrc.json'),
      JSON.stringify({ unknown: 'value' }),
    );
    const config = await loadConfig(tmp);
    expect(config).toMatchObject({});
  });
});
