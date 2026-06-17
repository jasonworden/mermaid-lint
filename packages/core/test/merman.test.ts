import { describe, expect, it } from 'vitest';
import { isMermanUnsupported, validateWithMerman } from '../src/merman.js';

describe('validateWithMerman', () => {
  it('accepts a valid flowchart', async () => {
    const r = await validateWithMerman('flowchart LR\n  A --> B');
    expect(r.valid).toBe(true);
    expect(r.code_name).toBe('MERMAN_OK');
    expect(r.error).toBeUndefined();
  });

  it('rejects an invalid flowchart', async () => {
    const r = await validateWithMerman('flowchart LR\n  A -->|broken label B');
    expect(r.valid).toBe(false);
    expect(r.code_name).toBe('MERMAN_PARSE_ERROR');
    expect(r.error).toBeTruthy();
  });

  it('signals unsupported for empty input', async () => {
    const r = await validateWithMerman('');
    expect(r.valid).toBe(false);
    expect(isMermanUnsupported(r)).toBe(true);
  });

  it('re-uses cached init on second call', async () => {
    const r1 = await validateWithMerman('flowchart LR\n  A --> B');
    const r2 = await validateWithMerman('flowchart LR\n  C --> D');
    expect(r1.valid).toBe(true);
    expect(r2.valid).toBe(true);
  });
});
