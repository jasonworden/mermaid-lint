import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import micromatch from 'micromatch';

/**
 * Options for {@link discoverFiles}.
 *
 * @public
 */
export interface DiscoverOptions {
  /** Directory to search from. Defaults to `'.'`. */
  root?: string;
  /** Include untracked files (walk the tree instead of `git ls-files`). */
  all?: boolean;
  /** Explicit file paths to lint; bypasses discovery and the extension filter. */
  paths?: string[];
  /** Glob patterns (micromatch) to exclude from the result. */
  ignore?: string[];
  /** Ignore `.gitignore` and walk the tree directly (implies `all`-style discovery). */
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

/**
 * Discover lintable files. By default returns git-tracked markdown-family files
 * (`.md`, `.mdx`, `.markdown`, `.mmd`) under `root`; `all`/`noGitignore` walk
 * the tree instead, explicit `paths` bypass discovery, and `ignore` globs prune
 * the result.
 *
 * @param opts - Discovery options (see {@link DiscoverOptions}).
 * @returns Matching file paths.
 * @public
 */
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
