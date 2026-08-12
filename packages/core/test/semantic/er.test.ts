import { describe, expect, it } from 'vitest';
import { RULE_DEFAULTS } from '../../src/rules.js';
import type { ResolvedRules } from '../../src/rules.js';
import { block } from './helpers.js';
import { only } from './helpers.js';

describe('er-duplicate-attribute rule', () => {
  function erBlock(body: string): Block {
    return block(body, 'erDiagram');
  }

  it('returns [] when every attribute name is unique', () => {
    const b = erBlock(
      'erDiagram\n  CUSTOMER {\n    string name\n    string email\n  }',
    );
    expect(only(b, 'er-duplicate-attribute')).toEqual([]);
  });

  it('fires when an attribute name repeats in one entity (warn)', () => {
    const b = erBlock(
      'erDiagram\n  CUSTOMER {\n    string name\n    int name\n  }',
    );
    const warnings = only(b, 'er-duplicate-attribute');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('`name`');
    expect(warnings[0].message).toContain('`CUSTOMER`');
    expect(warnings[0].message).toContain('first on line 3');
    expect(warnings[0].line).toBe(4);
  });

  it('does not flag the same attribute name across different entities', () => {
    const b = erBlock(
      'erDiagram\n  CUSTOMER {\n    string id\n  }\n  ORDER {\n    string id\n  }',
    );
    expect(only(b, 'er-duplicate-attribute')).toEqual([]);
  });

  it('handles attributes carrying keys and comments', () => {
    const b = erBlock(
      'erDiagram\n  CUSTOMER {\n    string id PK\n    string id FK "dup"\n  }',
    );
    expect(only(b, 'er-duplicate-attribute')).toHaveLength(1);
  });

  it('does not collide distinct hyphenated attribute names', () => {
    const b = erBlock(
      'erDiagram\n  CUSTOMER {\n    string first-name\n    string first-address\n  }',
    );
    expect(only(b, 'er-duplicate-attribute')).toEqual([]);
  });

  it('reports the full hyphenated name on a real duplicate', () => {
    const b = erBlock(
      'erDiagram\n  CUSTOMER {\n    string first-name\n    int first-name\n  }',
    );
    const warnings = only(b, 'er-duplicate-attribute');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('`first-name`');
  });

  it('returns [] for non-ER diagrams', () => {
    const b = block('flowchart LR\n  A --> B');
    expect(only(b, 'er-duplicate-attribute')).toEqual([]);
  });

  it('is suppressed by %% mermaid-lint-disable-diagram er-duplicate-attribute', () => {
    const b = erBlock(
      'erDiagram\n  %% mermaid-lint-disable-diagram er-duplicate-attribute: legacy suppression test\n  CUSTOMER {\n    string name\n    int name\n  }',
    );
    expect(only(b, 'er-duplicate-attribute')).toEqual([]);
  });
});

describe('er-duplicate-entity rule', () => {
  function erBlock(body: string): Block {
    return block(body, 'erDiagram');
  }

  it('returns [] when each entity block is defined once', () => {
    const b = erBlock(
      'erDiagram\n  CUSTOMER {\n    string name\n  }\n  ORDER {\n    int id\n  }',
    );
    expect(only(b, 'er-duplicate-entity')).toEqual([]);
  });

  it('fires when an entity block is defined twice (warn)', () => {
    const b = erBlock(
      'erDiagram\n  CUSTOMER {\n    string name\n  }\n  CUSTOMER {\n    string email\n  }',
    );
    const warnings = only(b, 'er-duplicate-entity');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('`CUSTOMER`');
    expect(warnings[0].message).toContain('first on line 2');
    expect(warnings[0].line).toBe(5);
  });

  it('does not flag an entity merely reused across relationships', () => {
    const b = erBlock(
      'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  CUSTOMER ||--o{ INVOICE : receives',
    );
    expect(only(b, 'er-duplicate-entity')).toEqual([]);
  });

  it('returns [] when configured off', () => {
    const b = erBlock(
      'erDiagram\n  CUSTOMER {\n    string name\n  }\n  CUSTOMER {\n    string email\n  }',
    );
    const rules: ResolvedRules = {
      ...RULE_DEFAULTS,
      'er-duplicate-entity': 'off',
    };
    expect(only(b, 'er-duplicate-entity', rules)).toEqual([]);
  });
});

describe('er-standalone-entity rule', () => {
  function erBlock(body: string): Block {
    return block(body, 'erDiagram');
  }

  const enabled: ResolvedRules = {
    ...RULE_DEFAULTS,
    'er-standalone-entity': 'warn',
  };

  it('is off by default', () => {
    const b = erBlock('erDiagram\n  CUSTOMER {\n    string name\n  }');
    expect(only(b, 'er-standalone-entity')).toEqual([]);
  });

  it('fires for a blocked entity with no relationship when enabled', () => {
    const b = erBlock(
      'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  AUDIT {\n    string event\n  }',
    );
    const warnings = only(b, 'er-standalone-entity', enabled);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('`AUDIT`');
    expect(warnings[0].line).toBe(3);
  });

  it('does not fire when the blocked entity is in a relationship', () => {
    const b = erBlock(
      'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  CUSTOMER {\n    string name\n  }',
    );
    expect(only(b, 'er-standalone-entity', enabled)).toEqual([]);
  });

  it('matches relationship entities through hyphens and cardinalities', () => {
    const b = erBlock(
      'erDiagram\n  ORDER ||--|{ LINE-ITEM : contains\n  LINE-ITEM {\n    int qty\n  }',
    );
    expect(only(b, 'er-standalone-entity', enabled)).toEqual([]);
  });

  it('recognizes the prose-cardinality relationship form', () => {
    const b = erBlock(
      'erDiagram\n  CUSTOMER one to zero or more ORDER : places\n  CUSTOMER {\n    string name\n  }\n  ORDER {\n    int id\n  }',
    );
    expect(only(b, 'er-standalone-entity', enabled)).toEqual([]);
  });
});
