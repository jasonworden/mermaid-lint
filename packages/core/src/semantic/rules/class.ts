import type { Rule, RuleFinding } from '../types.js';

const CLASS_OPEN_RE = /^\s*class\s+([A-Za-z_]\w*)\s*\{/;
const CLASS_CLOSE_RE = /^\s*\}/;
const CLASS_INLINE_RE = /^\s*([A-Za-z_]\w*)\s*:/;
const CLASS_DECL_RE = /^\s*class\s+([A-Za-z_]\w*)\b/;
const METHOD_RE = /([A-Za-z_]\w*)\s*\(([^)]*)\)/;

export const classDuplicateClass: Rule = {
  id: 'class-duplicate-class',
  appliesTo: (block) => block.type === 'classDiagram',
  evaluate: ({ lines, fileLine }) => {
    const seen = new Map<string, number>();
    const findings: RuleFinding[] = [];

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (raw.trimStart().startsWith('%%')) continue;
      const decl = CLASS_DECL_RE.exec(raw);
      if (decl === null) continue;
      const name = decl[1];
      const first = seen.get(name);
      if (first === undefined) {
        seen.set(name, i + 1);
      } else {
        findings.push({
          message: `class \`${name}\` is declared more than once (first on line ${fileLine(first)}); Mermaid merges class declarations, which is usually a copy-paste mistake.`,
          line: i + 1,
        });
      }
    }

    return findings;
  },
};

export const noDuplicateMethods: Rule = {
  id: 'no-duplicate-methods',
  appliesTo: (block) => block.type === 'classDiagram',
  evaluate: ({ lines, fileLine }) => {
    // methods[className][signature] = first bodyLine
    const methods = new Map<string, Map<string, number>>();
    const findings: RuleFinding[] = [];
    let currentClass: string | null = null;

    const getClassMap = (cls: string): Map<string, number> => {
      let m = methods.get(cls);
      if (m === undefined) {
        m = new Map();
        methods.set(cls, m);
      }
      return m;
    };

    const checkMember = (cls: string, memberLine: string, bodyLine: number) => {
      const mMethod = METHOD_RE.exec(memberLine);
      if (mMethod === null) return; // attribute, not a method
      const name = mMethod[1];
      const params = mMethod[2].trim().replace(/\s+/g, ' ');
      const key = `${name}(${params})`;
      const classMap = getClassMap(cls);
      const firstLine = classMap.get(key);
      if (firstLine === undefined) {
        classMap.set(key, bodyLine);
      } else {
        findings.push({
          message: `method \`${key}\` is declared more than once on class \`${cls}\` (first on line ${fileLine(firstLine)}).`,
          line: bodyLine,
        });
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const bodyLine = i + 1;
      if (raw.trimStart().startsWith('%%')) continue;

      if (currentClass !== null) {
        // Inside a class block
        if (CLASS_CLOSE_RE.test(raw)) {
          currentClass = null;
        } else {
          checkMember(currentClass, raw.trim(), bodyLine);
        }
        continue;
      }

      // Check for block opening
      const open = CLASS_OPEN_RE.exec(raw);
      if (open !== null) {
        currentClass = open[1];
        continue;
      }

      // Check for inline member: `Foo : member`
      const inline = CLASS_INLINE_RE.exec(raw);
      if (inline !== null) {
        const cls = inline[1];
        // Member is everything after the first `:`
        const colonIdx = raw.indexOf(':');
        if (colonIdx !== -1) {
          const member = raw.slice(colonIdx + 1).trim();
          checkMember(cls, member, bodyLine);
        }
      }
    }

    return findings;
  },
};
