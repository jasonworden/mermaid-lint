import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { initMerman as _init, validate } from '@mermanjs/web';

const _require = createRequire(import.meta.url);

let _initPromise: Promise<void> | null = null;

function ensureInit(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const wasmPath = _require.resolve(
        '@mermanjs/web/pkg/merman_wasm_bg.wasm',
      );
      const wasmBytes = await readFile(wasmPath);
      await _init({ wasm: { module_or_path: wasmBytes } });
    })().catch((e) => {
      _initPromise = null;
      throw e;
    });
  }
  return _initPromise;
}

/** @internal */
export interface MermanResult {
  valid: boolean;
  code_name: string;
  error?: string;
}

/** @internal */
export function isMermanUnsupported(r: MermanResult): boolean {
  return (
    r.code_name === 'MERMAN_NO_DIAGRAM' ||
    r.code_name === 'MERMAN_UNSUPPORTED_FORMAT'
  );
}

/** @internal */
export async function validateWithMerman(body: string): Promise<MermanResult> {
  await ensureInit();
  try {
    const r = validate(body) as {
      valid: boolean;
      code_name: string;
      error?: string;
    };
    return {
      valid: r.valid,
      code_name: r.code_name,
      error: r.error || undefined,
    };
  } catch {
    return {
      valid: false,
      code_name: 'MERMAN_PANIC',
      error: 'merman panicked',
    };
  }
}
