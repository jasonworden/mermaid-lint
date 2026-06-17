import type { Block } from './extract.js';
import { validateWithMerman } from './merman.js';
import { type SemanticWarning, checkSemantics } from './semantic.js';

export type { SemanticWarning };

export interface ValidationError {
  message: string;
  line?: number;
  col?: number;
}

export type ValidationResult =
  | { ok: true; warnings: SemanticWarning[] }
  | { ok: false; error: ValidationError; warnings: SemanticWarning[] };

// Mermaid v11 calls DOMPurify.sanitize during parse for some diagram types.
// DOMPurify requires a DOM window at module-evaluation time, so we bootstrap
// jsdom lazily before the first mermaid import via a dynamic import chain.
let _mermaidPromise: Promise<unknown> | null = null;

async function loadMermaid(): Promise<unknown> {
  if (!globalThis.window) {
    const { JSDOM } = await import('jsdom');
    const { window } = new JSDOM('');
    Object.defineProperty(globalThis, 'window', {
      value: window,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'document', {
      value: window.document,
      writable: true,
      configurable: true,
    });
    // sequenceDiagram `box` parser references bare `Option` (HTMLOptionElement),
    // which jsdom attaches to window but not globalThis.
    Object.defineProperty(globalThis, 'Option', {
      value: (window as unknown as Window & typeof globalThis).Option,
      writable: true,
      configurable: true,
    });
  }
  const { default: mermaid } = await import('mermaid');
  mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
  return mermaid;
}

function getMermaid(): Promise<unknown> {
  if (!_mermaidPromise) _mermaidPromise = loadMermaid();
  return _mermaidPromise;
}

async function runMermaidValidation(
  body: string,
): Promise<{ ok: true } | { ok: false; error: ValidationError }> {
  try {
    const mermaid = await getMermaid();
    await (
      mermaid as { parse(text: string, opts: object): Promise<unknown> }
    ).parse(body, { suppressErrors: false });
    return { ok: true as const };
  } catch (err: unknown) {
    const e = err as Record<string, unknown>;
    const message = typeof e?.message === 'string' ? e.message : String(err);
    const hash = e?.hash as Record<string, unknown> | undefined;
    const line = typeof hash?.line === 'number' ? hash.line : undefined;
    const loc = hash?.loc as Record<string, unknown> | undefined;
    const col =
      typeof loc?.first_column === 'number' ? loc.first_column + 1 : undefined;
    return { ok: false as const, error: { message, line, col } };
  }
}

export async function validateBlock(block: Block): Promise<ValidationResult> {
  const { body } = block;

  if (body === '__UNCLOSED_FENCE__') {
    return {
      ok: false,
      error: { message: 'unclosed ```mermaid fence (no closing ``` found)' },
      warnings: [],
    };
  }
  if (!body.trim()) {
    return {
      ok: false,
      error: { message: 'empty mermaid block' },
      warnings: [],
    };
  }

  const warnings = checkSemantics(block);

  const mermanResult = await validateWithMerman(body);

  if (mermanResult.valid) {
    // Fast path: merman confirmed valid — skip mermaid.js entirely
    return { ok: true, warnings };
  }

  // Any non-valid result (parse error, unsupported type, panic) —
  // fall back to mermaid.js which is authoritative for error location and final verdict.
  // If mermaid.js accepts it, trust mermaid.js (merman may be stricter on edge cases).
  const mermaidResult = await runMermaidValidation(body);
  if (!mermaidResult.ok) {
    return { ok: false, error: mermaidResult.error, warnings };
  }
  return { ok: true, warnings };
}
