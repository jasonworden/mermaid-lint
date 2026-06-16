import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface DiscoverOptions {
  root?: string;
  all?: boolean;
  paths?: string[];
}

export function discoverFiles(opts: DiscoverOptions = {}): string[] {
  const { root = '.', all = false, paths } = opts;
  if (paths && paths.length > 0) {
    return paths.filter((p) => {
      if (!existsSync(p)) return false;
      try {
        return statSync(p).isFile();
      } catch {
        return false;
      }
    });
  }
  return all ? discoverAll(root) : discoverTracked(root);
}

function discoverTracked(root: string): string[] {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--', '*.md'], {
      cwd: root,
      encoding: 'utf8',
    });
    return out.split('\0').filter(Boolean);
  } catch {
    return [];
  }
}

function discoverAll(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => join(e.parentPath ?? e.path, e.name))
    .filter((p) => !p.includes('/node_modules/') && !p.includes('/.git/'));
}
