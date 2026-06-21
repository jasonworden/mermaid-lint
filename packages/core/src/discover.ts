import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import micromatch from 'micromatch';

export interface DiscoverOptions {
  root?: string;
  all?: boolean;
  paths?: string[];
  ignore?: string[];
  noGitignore?: boolean;
  /**
   * Extra file extensions to include in auto-discovery, in addition to the
   * built-in markdown family. Accepts `crv`, `.crv`, or `.CRV`; normalized to a
   * lowercase dotted form. Has no effect on explicit `paths`, which are always
   * kept regardless of extension.
   */
  extensions?: string[];
}

const MARKDOWN_EXTS = ['.md', '.mdx', '.markdown', '.mmd'];

/** Trim, lowercase, ensure a leading dot, and drop empty entries. */
function normalizeExtensions(exts: string[]): string[] {
  const out: string[] = [];
  for (const raw of exts) {
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) continue;
    out.push(trimmed.startsWith('.') ? trimmed : `.${trimmed}`);
  }
  return out;
}

function hasExt(name: string, allowed: Set<string>): boolean {
  const dot = name.lastIndexOf('.');
  return dot >= 0 && allowed.has(name.slice(dot));
}

export function discoverFiles(opts: DiscoverOptions = {}): string[] {
  const {
    root = '.',
    all = false,
    paths,
    ignore = [],
    noGitignore = false,
    extensions = [],
  } = opts;

  const extraExts = normalizeExtensions(extensions);
  const allowed = new Set([...MARKDOWN_EXTS, ...extraExts]);

  let files: string[];
  if (paths && paths.length > 0) {
    // Explicit paths are always linted regardless of extension — the whitelist
    // only gates auto-discovery, never files the user named directly.
    files = paths.filter((p) => {
      if (!existsSync(p)) return false;
      try {
        return statSync(p).isFile();
      } catch {
        return false;
      }
    });
  } else {
    files =
      all || noGitignore
        ? discoverAll(root, allowed)
        : discoverTracked(root, allowed);
  }

  if (ignore.length === 0) return files;
  return files.filter((p) => {
    const rel = isAbsolute(p) ? relative(root, p) : p;
    return !micromatch.isMatch(rel, ignore) && !micromatch.isMatch(p, ignore);
  });
}

function discoverTracked(root: string, allowed: Set<string>): string[] {
  const pathspecs = [...allowed].map((ext) => `*${ext}`);
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--', ...pathspecs], {
      cwd: root,
      encoding: 'utf8',
    });
    return out.split('\0').filter(Boolean);
  } catch {
    return [];
  }
}

function discoverAll(root: string, allowed: Set<string>): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && hasExt(e.name, allowed))
    .map((e) => join(e.parentPath ?? e.path, e.name))
    .filter((p) => {
      const parts = p.split('/');
      return !parts.includes('node_modules') && !parts.includes('.git');
    });
}
