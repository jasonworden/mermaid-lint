import { describe, it, expect } from 'vitest';
import { validateBlock } from '../src/validate.mjs';

describe('validateBlock', () => {
  it('accepts a valid flowchart', async () => {
    const result = await validateBlock('flowchart LR\n  A --> B');
    expect(result.ok).toBe(true);
  });

  it('accepts a valid sequenceDiagram', async () => {
    const result = await validateBlock('sequenceDiagram\n  Alice->>Bob: Hello');
    expect(result.ok).toBe(true);
  });

  it('rejects an empty block', async () => {
    const result = await validateBlock('');
    expect(result.ok).toBe(false);
    expect(result.error.message).toContain('empty');
  });

  it('rejects the unclosed fence sentinel', async () => {
    const result = await validateBlock('__UNCLOSED_FENCE__');
    expect(result.ok).toBe(false);
    expect(result.error.message).toContain('unclosed');
  });

  it('rejects invalid mermaid syntax', async () => {
    const result = await validateBlock('flowchart LR\n  A -->|broken label B');
    expect(result.ok).toBe(false);
    expect(result).toHaveProperty('error.message');
  });
});
