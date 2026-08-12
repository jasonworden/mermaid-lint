import type { Block } from '../../extract.js';
import type { Rule, RuleFinding } from '../types.js';

const C4_DECL_RE =
  /^\s*(?:Person|Person_Ext|System|System_Ext|SystemDb|SystemDb_Ext|Container|Container_Ext|ContainerDb|ContainerDb_Ext|ContainerQueue|ContainerQueue_Ext|Component|Component_Ext|ComponentDb|ComponentDb_Ext|ComponentQueue|ComponentQueue_Ext|Boundary|Enterprise_Boundary|System_Boundary|Container_Boundary)\s*\(\s*([A-Za-z0-9_][\w-]*)\s*,/;
const C4_REL_RE =
  /^\s*(?:Bi)?Rel(?:_[A-Za-z0-9]+)?\s*\(\s*([A-Za-z0-9_][\w-]*)\s*,\s*([A-Za-z0-9_][\w-]*)\s*,/;
const C4_UPDATE_ELEMENT_STYLE_RE =
  /^\s*UpdateElementStyle\s*\(\s*([A-Za-z0-9_][\w-]*)\s*,/;
const C4_UPDATE_REL_STYLE_RE =
  /^\s*UpdateRelStyle\s*\(\s*([A-Za-z0-9_][\w-]*)\s*,\s*([A-Za-z0-9_][\w-]*)\s*,/;

interface C4Declaration {
  id: string;
  line: number;
}

interface C4EndpointReference {
  source: string;
  target: string;
  line: number;
}

function isC4Context(block: Block): boolean {
  return block.type === 'C4Context';
}

function collectC4Declarations(lines: string[]): C4Declaration[] {
  const declarations: C4Declaration[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trimStart().startsWith('%%')) continue;
    const decl = C4_DECL_RE.exec(raw);
    if (decl === null) continue;
    declarations.push({ id: decl[1], line: i + 1 });
  }
  return declarations;
}

function collectC4Ids(lines: string[]): Set<string> {
  return new Set(collectC4Declarations(lines).map((decl) => decl.id));
}

function collectC4RelationshipEndpoints(
  lines: string[],
): C4EndpointReference[] {
  const references: C4EndpointReference[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trimStart().startsWith('%%')) continue;
    const rel = C4_REL_RE.exec(raw);
    if (rel === null) continue;
    references.push({ source: rel[1], target: rel[2], line: i + 1 });
  }
  return references;
}

function collectC4RelationshipStyleEndpoints(
  lines: string[],
): C4EndpointReference[] {
  const references: C4EndpointReference[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trimStart().startsWith('%%')) continue;
    const rel = C4_UPDATE_REL_STYLE_RE.exec(raw);
    if (rel === null) continue;
    references.push({ source: rel[1], target: rel[2], line: i + 1 });
  }
  return references;
}

export const c4DuplicateId: Rule = {
  id: 'c4-duplicate-id',
  appliesTo: isC4Context,
  evaluate: ({ lines, fileLine }) => {
    const seen = new Map<string, number>();
    const findings: RuleFinding[] = [];

    for (const decl of collectC4Declarations(lines)) {
      const first = seen.get(decl.id);
      if (first === undefined) {
        seen.set(decl.id, decl.line);
      } else {
        findings.push({
          message: `C4 element or boundary id \`${decl.id}\` is declared more than once (first on line ${fileLine(first)}); C4 ids share one namespace, so duplicate declarations are ambiguous.`,
          line: decl.line,
        });
      }
    }

    return findings;
  },
};

export const c4UndefinedRelationshipEndpoint: Rule = {
  id: 'c4-undefined-relationship-endpoint',
  appliesTo: isC4Context,
  evaluate: ({ lines }) => {
    const ids = collectC4Ids(lines);
    const findings: RuleFinding[] = [];

    for (const ref of collectC4RelationshipEndpoints(lines)) {
      if (!ids.has(ref.source)) {
        findings.push({
          message: `C4 relationship references undefined source id \`${ref.source}\`; declare the element before relating it.`,
          line: ref.line,
        });
      }
      if (!ids.has(ref.target)) {
        findings.push({
          message: `C4 relationship references undefined target id \`${ref.target}\`; declare the element before relating it.`,
          line: ref.line,
        });
      }
    }

    return findings;
  },
};

export const c4UndefinedElementStyle: Rule = {
  id: 'c4-undefined-element-style',
  appliesTo: isC4Context,
  evaluate: ({ lines }) => {
    const ids = collectC4Ids(lines);
    const findings: RuleFinding[] = [];

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (raw.trimStart().startsWith('%%')) continue;
      const style = C4_UPDATE_ELEMENT_STYLE_RE.exec(raw);
      if (style === null) continue;
      const id = style[1];
      if (ids.has(id)) continue;
      findings.push({
        message: `C4 UpdateElementStyle references undefined id \`${id}\`; declare the element or boundary before styling it.`,
        line: i + 1,
      });
    }

    return findings;
  },
};

export const c4UndefinedRelationshipStyleEndpoint: Rule = {
  id: 'c4-undefined-relationship-style-endpoint',
  appliesTo: isC4Context,
  evaluate: ({ lines }) => {
    const ids = collectC4Ids(lines);
    const findings: RuleFinding[] = [];

    for (const ref of collectC4RelationshipStyleEndpoints(lines)) {
      if (!ids.has(ref.source)) {
        findings.push({
          message: `C4 UpdateRelStyle references undefined source id \`${ref.source}\`; declare the element before styling its relationship.`,
          line: ref.line,
        });
      }
      if (!ids.has(ref.target)) {
        findings.push({
          message: `C4 UpdateRelStyle references undefined target id \`${ref.target}\`; declare the element before styling its relationship.`,
          line: ref.line,
        });
      }
    }

    return findings;
  },
};
