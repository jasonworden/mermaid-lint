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
}

const MARKDOWN_EXTS = new Set(['.md', '.mdx', '.markdown', '.mmd']);

function hasMarkdownExt(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot >= 0 && MARKDOWN_EXTS.has(name.slice(dot));
}

export function discoverFiles(opts: DiscoverOptions = {}): string[] {
  const {
    root = '.',
    all = false,
    paths,
    ignore = [],
    noGitignore = false,
  } = opts;

  let files: string[];
  if (paths && paths.length > 0) {
    files = paths.filter((p) => {
      if (!existsSync(p)) return false;
      if (!hasMarkdownExt(p)) return false;
      try {
        return statSync(p).isFile();
      } catch {
        return false;
      }
    });
  } else {
    files = all || noGitignore ? discoverAll(root) : discoverTracked(root);
  }

  if (ignore.length === 0) return files;
  return files.filter((p) => {
    const rel = isAbsolute(p) ? relative(root, p) : p;
    return !micromatch.isMatch(rel, ignore) && !micromatch.isMatch(p, ignore);
  });
}

function discoverTracked(root: string): string[] {
  try {
    const out = execFileSync(
      'git',
      ['ls-files', '-z', '--', '*.md', '*.mdx', '*.markdown', '*.mmd'],
      { cwd: root, encoding: 'utf8' },
    );
    return out.split('\0').filter(Boolean);
  } catch {
    return [];
  }
}

function discoverAll(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && hasMarkdownExt(e.name))
    .map((e) => join(e.parentPath ?? e.path, e.name))
    .filter((p) => {
      const parts = p.split('/');
      return !parts.includes('node_modules') && !parts.includes('.git');
    });
}
