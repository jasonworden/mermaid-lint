import { describe, expect, it } from 'vitest';
import { RULE_DEFAULTS } from '../../src/rules.js';
import type { ResolvedRules } from '../../src/rules.js';
import { block } from './helpers.js';
import { only } from './helpers.js';

describe('requirement diagram rules', () => {
  function requirementBlock(body: string): Block {
    return block(body, 'requirementDiagram');
  }

  it('keeps a valid requirement diagram clean, including quoted names, class suffixes, and forward references', () => {
    const b = requirementBlock(
      'requirementDiagram\n  "API Gateway" - contains -> login_req\n  requirement login_req:::product {\n    id: REQ-1\n    text: user logs in\n    risk: medium\n    verifymethod: test\n  }\n  element "API Gateway" {\n    type: system\n  }',
    );

    expect(only(b, 'requirement-duplicate-name')).toEqual([]);
    expect(only(b, 'requirement-duplicate-id')).toEqual([]);
    expect(only(b, 'requirement-undefined-reference')).toEqual([]);
  });

  it('flags duplicate requirement and element names, including cross-kind duplicates', () => {
    const b = requirementBlock(
      'requirementDiagram\n  requirement shared_name {\n    id: REQ-1\n    text: first\n    risk: medium\n    verifymethod: test\n  }\n  element shared_name {\n    type: system\n  }\n  requirement "Quoted Name" {\n    id: REQ-2\n    text: second\n    risk: low\n    verifymethod: inspection\n  }\n  element "Quoted Name":::external {\n    type: system\n  }',
    );

    const warnings = only(b, 'requirement-duplicate-name');
    expect(warnings).toHaveLength(2);
    expect(warnings.map((warning) => warning.severity)).toEqual([
      'warn',
      'warn',
    ]);
    expect(warnings[0].message).toContain('shared_name');
    expect(warnings[0].message).toContain('line 2');
    expect(warnings[0].line).toBe(8);
    expect(warnings[1].message).toContain('Quoted Name');
    expect(warnings[1].message).toContain('line 11');
    expect(warnings[1].line).toBe(17);
  });

  it('flags duplicate requirement ids with the first definition line', () => {
    const b = requirementBlock(
      'requirementDiagram\n  requirement first_req {\n    id: REQ-42\n    text: first\n    risk: medium\n    verifymethod: test\n  }\n  requirement second_req {\n    id: REQ-42\n    text: second\n    risk: low\n    verifymethod: inspection\n  }',
    );

    const warnings = only(b, 'requirement-duplicate-id');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('REQ-42');
    expect(warnings[0].message).toContain('line 3');
    expect(warnings[0].line).toBe(9);
  });

  it('flags undefined relationship endpoints after collecting all names first', () => {
    const b = requirementBlock(
      'requirementDiagram\n  known_element - traces -> missing_requirement\n  missing_source <- satisfies - known_requirement\n  requirement known_requirement {\n    id: REQ-1\n    text: first\n    risk: medium\n    verifymethod: test\n  }\n  element known_element {\n    type: system\n  }',
    );

    const warnings = only(b, 'requirement-undefined-reference');
    expect(warnings).toHaveLength(2);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('missing_requirement');
    expect(warnings[0].line).toBe(2);
    expect(warnings[1].message).toContain('missing_source');
    expect(warnings[1].line).toBe(3);
  });

  it('respects suppression directives and rule-off configuration', () => {
    const suppressed = requirementBlock(
      'requirementDiagram\n  %% mermaid-lint-disable-diagram requirement-duplicate-name: legacy suppression test\n  requirement duplicate_name {\n    id: REQ-1\n    text: first\n    risk: medium\n    verifymethod: test\n  }\n  element duplicate_name {\n    type: system\n  }',
    );
    expect(only(suppressed, 'requirement-duplicate-name')).toEqual([]);

    const b = requirementBlock(
      'requirementDiagram\n  missing_source - traces -> missing_target',
    );
    const rules: ResolvedRules = {
      ...RULE_DEFAULTS,
      'requirement-undefined-reference': 'off',
    };
    expect(only(b, 'requirement-undefined-reference', rules)).toEqual([]);
  });
});
