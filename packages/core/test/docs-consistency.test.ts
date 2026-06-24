import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, posix, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../../..');

type PackageJson = {
  name: string;
  version?: string;
  private?: boolean;
  packageManager?: string;
  engines?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

type PackageInfo = {
  dir: string;
  manifestPath: string;
  manifest: PackageJson;
};

type MarkdownRow = Record<string, string>;

function repoPath(path: string): string {
  return resolve(repoRoot, path);
}

function readRepoFile(path: string): string {
  return readFileSync(repoPath(path), 'utf8');
}

function readJson<T>(path: string): T {
  return JSON.parse(readRepoFile(path)) as T;
}

function discoverPackages(): PackageInfo[] {
  return readdirSync(repoPath('packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = `packages/${entry.name}`;
      const manifestPath = `${dir}/package.json`;
      return {
        dir,
        manifestPath,
        manifest: readJson<PackageJson>(manifestPath),
      };
    })
    .sort((a, b) => a.dir.localeCompare(b.dir));
}

function extractSection(markdown: string, heading: string): string {
  const start = markdown.indexOf(heading);
  expect(start, `Expected to find heading "${heading}"`).toBeGreaterThanOrEqual(
    0,
  );

  const afterHeading = markdown.slice(start + heading.length);
  const nextHeading = afterHeading.search(/\n#{1,2} /);
  return nextHeading === -1 ? afterHeading : afterHeading.slice(0, nextHeading);
}

function parseFirstTable(markdown: string, label: string): MarkdownRow[] {
  const lines = firstTableLines(markdown);

  expect(
    lines.length,
    `Expected ${label} to contain a Markdown table`,
  ).toBeGreaterThanOrEqual(2);

  const headers = splitTableRow(lines[0]);
  const separator = splitTableRow(lines[1]);
  expect(
    separator.every((cell) => /^:?-{3,}:?$/.test(cell)),
    `Expected ${label} table to have a separator row`,
  ).toBe(true);

  return lines.slice(2).map((line) => {
    const cells = splitTableRow(line);
    expect(
      cells.length,
      `Expected ${label} row to have ${headers.length} cells: ${line}`,
    ).toBe(headers.length);
    return Object.fromEntries(
      headers.map((header, index) => [header, cells[index]]),
    );
  });
}

function firstTableLines(markdown: string): string[] {
  const lines = markdown.split('\n').map((line) => line.trim());
  const start = lines.findIndex((line, index) => {
    const next = lines[index + 1];
    return (
      line.startsWith('|') &&
      next !== undefined &&
      next.startsWith('|') &&
      splitTableRow(next).every((cell) => /^:?-{3,}:?$/.test(cell))
    );
  });

  if (start === -1) return [];

  const table: string[] = [];
  for (const line of lines.slice(start)) {
    if (!line.startsWith('|')) break;
    table.push(line);
  }
  return table;
}

function splitTableRow(line: string): string[] {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function markdownFilesToCheck(): string[] {
  const docs = readdirSync(repoPath('docs'))
    .filter((entry) => entry.endsWith('.md'))
    .map((entry) => `docs/${entry}`);
  const packageReadmes = discoverPackages().map(
    (pkg) => `${pkg.dir}/README.md`,
  );

  return ['README.md', 'AGENTS.md', ...docs, ...packageReadmes].sort();
}

function extractMarkdownLinks(markdown: string): string[] {
  const linkableMarkdown = stripFencedCodeBlocks(markdown);
  return [
    ...extractInlineMarkdownLinks(linkableMarkdown),
    ...extractReferenceMarkdownLinks(linkableMarkdown),
  ];
}

function stripFencedCodeBlocks(markdown: string): string {
  const lines = markdown.split('\n');
  const keptLines: string[] = [];
  let fence: { marker: string; length: number } | undefined;

  for (const line of lines) {
    if (fence === undefined) {
      const opener = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
      if (opener === null) {
        keptLines.push(line);
        continue;
      }

      fence = { marker: opener[1][0], length: opener[1].length };
      continue;
    }

    const closer = new RegExp(
      `^[ \\t]{0,3}${escapeRegExp(fence.marker)}{${fence.length},}[ \\t]*$`,
    );
    if (closer.test(line)) {
      fence = undefined;
    }
  }

  return keptLines.join('\n');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractInlineMarkdownLinks(markdown: string): string[] {
  const links: string[] = [];
  const inlineLinkPattern = /!?\[[^\]\n]*(?:\][^\[\]\n]*)*\]\(([^)\n]+)\)/g;

  for (const match of markdown.matchAll(inlineLinkPattern)) {
    const destination = match[1].trim();
    links.push(stripOptionalTitle(destination));
  }

  return links;
}

function extractReferenceMarkdownLinks(markdown: string): string[] {
  const links: string[] = [];
  const referenceDefinitionPattern = /^\[[^\]\n]+]:\s*(\S+)/gm;

  for (const match of markdown.matchAll(referenceDefinitionPattern)) {
    links.push(match[1]);
  }

  return links;
}

function stripOptionalTitle(destination: string): string {
  const unwrapped = unwrapDestination(destination);
  const split = unwrapped.match(/^(\S+)\s+["'(]/);
  return split?.[1] ?? unwrapped;
}

function unwrapDestination(destination: string): string {
  if (destination.startsWith('<') && destination.includes('>')) {
    return destination.slice(1, destination.indexOf('>'));
  }

  return destination;
}

function normalizeLocalLink(destination: string): string | undefined {
  const trimmed = destination.trim();
  if (
    trimmed === '' ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('//') ||
    /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
  ) {
    return undefined;
  }

  const withoutAnchor = trimmed.replace(/[?#].*$/, '');
  if (withoutAnchor === '') {
    return undefined;
  }

  return decodeURI(withoutAnchor);
}

function packageTableLinks(): string[] {
  const readme = readRepoFile('README.md');
  const rows = parseFirstTable(
    extractSection(readme, '## Packages'),
    'README.md Packages',
  );

  return rows.flatMap((row) =>
    extractMarkdownLinks(row.Package)
      .map(normalizeLocalLink)
      .filter((link): link is string => link !== undefined),
  );
}

describe('docs consistency', () => {
  const packages = discoverPackages();
  const rootPackageJson = readJson<PackageJson>('package.json');

  it('has a README for every package', () => {
    for (const pkg of packages) {
      expect(
        existsSync(repoPath(`${pkg.dir}/README.md`)),
        `${pkg.dir} should have a README.md`,
      ).toBe(true);
    }
  });

  it('keeps the root README package table in sync with package directories', () => {
    const expected = packages.map((pkg) => pkg.dir).sort();
    const actual = packageTableLinks().sort();

    expect(actual).toEqual(expected);
  });

  it('keeps public @mermaid-lint package versions in lockstep', () => {
    const publicPackages = packages.filter(
      (pkg) =>
        pkg.manifest.name.startsWith('@mermaid-lint/') &&
        pkg.manifest.private !== true,
    );
    const versions = new Set(publicPackages.map((pkg) => pkg.manifest.version));

    expect(
      versions.size,
      publicPackages
        .map((pkg) => `${pkg.manifest.name}@${pkg.manifest.version}`)
        .join(', '),
    ).toBe(1);
  });

  it('uses workspace:* for internal @mermaid-lint dependencies', () => {
    const dependencyFields = [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ] as const;

    for (const pkg of packages) {
      for (const field of dependencyFields) {
        const dependencies = pkg.manifest[field] ?? {};
        for (const [name, version] of Object.entries(dependencies)) {
          if (name.startsWith('@mermaid-lint/')) {
            expect(version, `${pkg.manifestPath} ${field}.${name}`).toBe(
              'workspace:*',
            );
          }
        }
      }
    }
  });

  it('keeps CLI JSON version assertions in sync with the CLI package version', () => {
    const cliPackage = readJson<PackageJson>('packages/cli/package.json');
    const cliTest = readRepoFile('packages/cli/test/cli.test.ts');
    const versions = [
      ...cliTest.matchAll(/expect\(json\.version\)\.toBe\('([^']+)'\)/g),
    ].map((match) => match[1]);

    expect(
      versions.length,
      'Expected CLI tests to assert JSON output version at least once',
    ).toBeGreaterThan(0);
    expect(versions).toEqual(versions.map(() => cliPackage.version));
  });

  it('keeps docs/json-output.md example version in sync with the CLI package version', () => {
    const cliPackage = readJson<PackageJson>('packages/cli/package.json');
    const docs = readRepoFile('docs/json-output.md');
    const versions = [...docs.matchAll(/"version":\s*"([^"]+)"/g)].map(
      (match) => match[1],
    );

    expect(
      versions.length,
      'Expected docs/json-output.md to include a JSON version example',
    ).toBeGreaterThan(0);
    expect(versions).toEqual(versions.map(() => cliPackage.version));
  });

  it('documents the current JSON warning fields', () => {
    const docs = readRepoFile('docs/json-output.md');

    expect(docs).toContain('"severity":');
    expect(docs).toContain('{ rule, message, line, severity }');
  });

  it('documents the root packageManager and Node engine pins', () => {
    const docs = readRepoFile('docs/package-manager.md');
    const [packageManagerName, packageManagerVersion] =
      rootPackageJson.packageManager?.split('@') ?? [];
    const nodeEngine = rootPackageJson.engines?.node;

    expect(rootPackageJson.packageManager).toBeTruthy();
    expect(nodeEngine).toBeTruthy();
    expect(docs).toContain('packageManager');
    expect(docs).toContain(packageManagerName);
    expect(docs).toContain(packageManagerVersion);
    expect(docs).toContain('engines.node');
    expect(docs).toContain(nodeEngine);
  });

  it('keeps local Markdown links resolvable', () => {
    for (const file of markdownFilesToCheck()) {
      const markdown = readRepoFile(file);
      const baseDir = dirname(file);

      for (const destination of extractMarkdownLinks(markdown)) {
        const localLink = normalizeLocalLink(destination);
        if (localLink === undefined) continue;

        const target = localLink.startsWith('/')
          ? repoPath(localLink.slice(1))
          : repoPath(posix.normalize(posix.join(baseDir, localLink)));
        const displayTarget = relative(repoRoot, target);

        expect(
          existsSync(target) &&
            (statSync(target).isFile() || statSync(target).isDirectory()),
          `${file} links to missing local path "${destination}" (${displayTarget})`,
        ).toBe(true);
      }
    }
  });
});
