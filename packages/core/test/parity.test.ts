import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isMermanUnsupported, validateWithMerman } from '../src/merman.js';
import { validateWithMermaidJS } from '../src/validate.js';

const FIXTURES_DIR = join(
  fileURLToPath(import.meta.url),
  '..',
  'fixtures',
  'parity',
);

async function loadFixtures(subdir: string): Promise<[string, string][]> {
  const dir = join(FIXTURES_DIR, subdir);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.mmd'));
  return Promise.all(
    files.map(async (file) => {
      const body = await readFile(join(dir, file), 'utf8');
      return [file, body.trim()] as [string, string];
    }),
  );
}

describe('parity: valid fixtures — merman and mermaid.js must both accept', () => {
  it('loads at least 20 valid fixtures', async () => {
    const fixtures = await loadFixtures('valid');
    expect(fixtures.length).toBeGreaterThanOrEqual(20);
  });

  it('no false positives (merman OK ⇒ mermaid.js OK)', async () => {
    const fixtures = await loadFixtures('valid');
    const falsePositives: string[] = [];

    for (const [file, body] of fixtures) {
      const mermanResult = await validateWithMerman(body);
      const mermaidResult = await validateWithMermaidJS(body);

      if (mermanResult.valid && !mermaidResult.ok) {
        falsePositives.push(
          `${file}: merman=OK but mermaid.js=INVALID` +
            ` (${mermaidResult.error.message})`,
        );
      }
    }

    expect(
      falsePositives,
      `PARITY FAILURES — merman accepted but mermaid.js rejected:\n${falsePositives.join('\n')}`,
    ).toHaveLength(0);
  });

  it('mermaid.js accepts all valid fixtures', async () => {
    const fixtures = await loadFixtures('valid');
    const failures: string[] = [];

    for (const [file, body] of fixtures) {
      const result = await validateWithMermaidJS(body);
      if (!result.ok) {
        failures.push(`${file}: ${result.error.message}`);
      }
    }

    expect(
      failures,
      `Valid fixtures rejected by mermaid.js:\n${failures.join('\n')}`,
    ).toHaveLength(0);
  });

  it('merman accepts or marks unsupported for valid fixtures', async () => {
    const fixtures = await loadFixtures('valid');
    const unexpectedRejections: string[] = [];

    for (const [file, body] of fixtures) {
      const r = await validateWithMerman(body);
      if (!r.valid && !isMermanUnsupported(r)) {
        unexpectedRejections.push(`${file}: merman=${r.code_name}`);
      }
    }

    if (unexpectedRejections.length > 0) {
      console.warn(
        `[parity] merman rejected (not unsupported) but mermaid.js accepted:\n${unexpectedRejections.join('\n')}`,
      );
    }
    // Not a hard failure — mermaid.js is authoritative for acceptances.
    // This test is informational: it shows where merman is stricter.
  });
});

describe('parity: invalid fixtures — mermaid.js must reject all', () => {
  it('loads at least 8 invalid fixtures', async () => {
    const fixtures = await loadFixtures('invalid');
    expect(fixtures.length).toBeGreaterThanOrEqual(8);
  });

  it('mermaid.js rejects all invalid fixtures', async () => {
    const fixtures = await loadFixtures('invalid');
    const missed: string[] = [];

    for (const [file, body] of fixtures) {
      const result = await validateWithMermaidJS(body);
      if (result.ok) {
        missed.push(`${file}: mermaid.js incorrectly accepted this`);
      }
    }

    expect(
      missed,
      `Invalid fixtures accepted by mermaid.js (review these fixtures):\n${missed.join('\n')}`,
    ).toHaveLength(0);
  });
});
