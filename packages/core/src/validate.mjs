// Mermaid v11 calls DOMPurify.sanitize during parse for some diagram types.
// DOMPurify requires a DOM window at module-evaluation time, so we bootstrap
// jsdom lazily before the first mermaid import via a dynamic import chain.
let _mermaidPromise = null;

async function loadMermaid() {
  if (!globalThis.window) {
    const { JSDOM } = await import('jsdom');
    const { window } = new JSDOM('');
    Object.defineProperty(globalThis, 'window', { value: window, writable: true, configurable: true });
    Object.defineProperty(globalThis, 'document', { value: window.document, writable: true, configurable: true });
    // sequenceDiagram `box` parser references bare `Option` (HTMLOptionElement),
    // which jsdom attaches to window but not globalThis.
    Object.defineProperty(globalThis, 'Option', { value: window.Option, writable: true, configurable: true });
  }
  const { default: mermaid } = await import('mermaid');
  mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
  return mermaid;
}

function getMermaid() {
  if (!_mermaidPromise) _mermaidPromise = loadMermaid();
  return _mermaidPromise;
}

export async function validateBlock(body) {
  if (body === '__UNCLOSED_FENCE__') {
    return { ok: false, error: { message: 'unclosed ```mermaid fence (no closing ``` found)' } };
  }
  if (!body || !body.trim()) {
    return { ok: false, error: { message: 'empty mermaid block' } };
  }
  try {
    const mermaid = await getMermaid();
    await mermaid.parse(body, { suppressErrors: false });
    return { ok: true };
  } catch (err) {
    const message = err?.message ?? String(err);
    const line = typeof err?.hash?.line === 'number' ? err.hash.line : undefined;
    const col = typeof err?.hash?.loc?.first_column === 'number' ? err.hash.loc.first_column + 1 : undefined;
    return { ok: false, error: { message, line, col } };
  }
}
