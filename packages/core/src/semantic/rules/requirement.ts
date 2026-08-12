import type { Rule, RuleFinding } from '../types.js';

interface RequirementDefinition {
  kind: 'requirement' | 'element';
  line: number;
  name: string;
}

interface RequirementRelationship {
  endpoints: [string, string];
  line: number;
}

interface ParsedRequirementDiagram {
  definitions: RequirementDefinition[];
  ids: Array<{ line: number; value: string }>;
  relationships: RequirementRelationship[];
}

const REQUIREMENT_OPEN_RE = /^\s*(requirement|element)\s+(.+?)\s*\{\s*$/;
const REQUIREMENT_ID_RE = /^\s*id\s*:\s*(.+?)\s*$/;

function normalizeRequirementName(raw: string): string {
  const withoutClass = raw.replace(/\s*:::[A-Za-z0-9_-]+\s*$/, '').trim();
  if (
    withoutClass.startsWith('"') &&
    withoutClass.endsWith('"') &&
    withoutClass.length >= 2
  ) {
    return withoutClass.slice(1, -1).trim();
  }
  return withoutClass;
}

function parseRequirementRelationship(
  line: string,
): RequirementRelationship['endpoints'] | null {
  const trimmed = line.trim();

  const forwardArrow = trimmed.lastIndexOf('->');
  if (forwardArrow !== -1) {
    const left = trimmed.slice(0, forwardArrow).trim();
    const right = trimmed.slice(forwardArrow + 2).trim();
    const relationStart = left.lastIndexOf(' - ');
    if (relationStart === -1) return null;

    const source = normalizeRequirementName(left.slice(0, relationStart));
    const relation = left.slice(relationStart + 3).trim();
    const target = normalizeRequirementName(right);
    if (source !== '' && relation !== '' && target !== '') {
      return [source, target];
    }
    return null;
  }

  const reverseArrow = trimmed.indexOf('<-');
  if (reverseArrow !== -1) {
    const left = trimmed.slice(0, reverseArrow).trim();
    const right = trimmed.slice(reverseArrow + 2).trim();
    const relationEnd = right.indexOf(' - ');
    if (relationEnd === -1) return null;

    const source = normalizeRequirementName(left);
    const relation = right.slice(0, relationEnd).trim();
    const target = normalizeRequirementName(right.slice(relationEnd + 3));
    if (source !== '' && relation !== '' && target !== '') {
      return [source, target];
    }
  }

  return null;
}

function parseRequirementDiagram(lines: string[]): ParsedRequirementDiagram {
  const definitions: RequirementDefinition[] = [];
  const ids: ParsedRequirementDiagram['ids'] = [];
  const relationships: RequirementRelationship[] = [];
  let openBlock: RequirementDefinition['kind'] | null = null;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const bodyLine = lineIdx + 1;
    if (line.trimStart().startsWith('%%')) continue;

    const opening = REQUIREMENT_OPEN_RE.exec(line);
    if (opening !== null) {
      const kind = opening[1] as RequirementDefinition['kind'];
      const name = normalizeRequirementName(opening[2]);
      definitions.push({ kind, line: bodyLine, name });
      openBlock = kind;
      continue;
    }

    if (openBlock === 'requirement') {
      const id = REQUIREMENT_ID_RE.exec(line);
      if (id !== null) {
        ids.push({ line: bodyLine, value: id[1].trim() });
      }
    }

    if (line.trim() === '}') {
      openBlock = null;
      continue;
    }

    const relationship = parseRequirementRelationship(line);
    if (relationship !== null) {
      relationships.push({ endpoints: relationship, line: bodyLine });
    }
  }

  return { definitions, ids, relationships };
}

export const requirementDuplicateName: Rule = {
  id: 'requirement-duplicate-name',
  appliesTo: (block) => block.type === 'requirementDiagram',
  evaluate: ({ lines, fileLine }) => {
    const parsed = parseRequirementDiagram(lines);
    const seen = new Map<string, number>();
    const findings: RuleFinding[] = [];

    for (const definition of parsed.definitions) {
      const firstLine = seen.get(definition.name);
      if (firstLine === undefined) {
        seen.set(definition.name, definition.line);
        continue;
      }

      findings.push({
        message: `requirement/element name \`${definition.name}\` is declared more than once (first on line ${fileLine(firstLine)}); relationship and style targets become ambiguous.`,
        line: definition.line,
      });
    }

    return findings;
  },
};

export const requirementDuplicateId: Rule = {
  id: 'requirement-duplicate-id',
  appliesTo: (block) => block.type === 'requirementDiagram',
  evaluate: ({ lines, fileLine }) => {
    const parsed = parseRequirementDiagram(lines);
    const seen = new Map<string, number>();
    const findings: RuleFinding[] = [];

    for (const id of parsed.ids) {
      const firstLine = seen.get(id.value);
      if (firstLine === undefined) {
        seen.set(id.value, id.line);
        continue;
      }

      findings.push({
        message: `requirement id \`${id.value}\` is declared more than once (first on line ${fileLine(firstLine)}); duplicate ids make requirement references ambiguous.`,
        line: id.line,
      });
    }

    return findings;
  },
};

export const requirementUndefinedReference: Rule = {
  id: 'requirement-undefined-reference',
  appliesTo: (block) => block.type === 'requirementDiagram',
  evaluate: ({ lines }) => {
    const parsed = parseRequirementDiagram(lines);
    const definedNames = new Set(
      parsed.definitions.map((definition) => definition.name),
    );
    const findings: RuleFinding[] = [];

    for (const relationship of parsed.relationships) {
      for (const endpoint of relationship.endpoints) {
        if (!definedNames.has(endpoint)) {
          findings.push({
            message: `relationship endpoint \`${endpoint}\` does not match any defined requirement or element name.`,
            line: relationship.line,
          });
        }
      }
    }

    return findings;
  },
};
