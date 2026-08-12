import { describe, expect, it } from 'vitest';
import { block } from './helpers.js';
import { only } from './helpers.js';

describe('C4Context rules', () => {
  function c4Block(body: string): Block {
    return block(body, 'C4Context');
  }

  it('returns [] for a valid C4Context model', () => {
    const b = c4Block(
      'C4Context\n  Person(customer, "Customer")\n  System(banking, "Banking")\n  Rel(customer, banking, "Uses")\n  UpdateElementStyle(customer, $fontColor="green")\n  UpdateRelStyle(customer, banking, $textColor="green")',
    );
    expect(only(b, 'c4-duplicate-id')).toEqual([]);
    expect(only(b, 'c4-undefined-relationship-endpoint')).toEqual([]);
    expect(only(b, 'c4-undefined-element-style')).toEqual([]);
    expect(only(b, 'c4-undefined-relationship-style-endpoint')).toEqual([]);
  });

  it('flags duplicate element and boundary ids', () => {
    const b = c4Block(
      'C4Context\n  Person(customer, "Customer")\n  Enterprise_Boundary(customer, "Enterprise") {\n    System(banking, "Banking")\n  }',
    );
    const warnings = only(b, 'c4-duplicate-id');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('`customer`');
    expect(warnings[0].message).toContain('line 2');
    expect(warnings[0].line).toBe(3);
  });

  it('tracks nested boundary element ids', () => {
    const b = c4Block(
      'C4Context\n  Enterprise_Boundary(e, "Enterprise") {\n    System(app, "App")\n    System_Boundary(scope, "Scope") {\n      System(app, "Duplicate App")\n    }\n  }',
    );
    expect(only(b, 'c4-duplicate-id')).toHaveLength(1);
  });

  it('flags relationship endpoints that are not declared', () => {
    const b = c4Block(
      'C4Context\n  Person(customer, "Customer")\n  Rel(customer, banking, "Uses")\n  BiRel(visitor, customer, "Talks to")',
    );
    const warnings = only(b, 'c4-undefined-relationship-endpoint');
    expect(warnings).toHaveLength(2);
    expect(warnings[0].message).toContain('`banking`');
    expect(warnings[0].line).toBe(3);
    expect(warnings[1].message).toContain('`visitor`');
    expect(warnings[1].line).toBe(4);
  });

  it('flags UpdateElementStyle targets that are not declared', () => {
    const b = c4Block(
      'C4Context\n  Person(customer, "Customer")\n  UpdateElementStyle(banking, $fontColor="red")',
    );
    const warnings = only(b, 'c4-undefined-element-style');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('`banking`');
    expect(warnings[0].line).toBe(3);
  });

  it('flags UpdateRelStyle endpoints that are not declared', () => {
    const b = c4Block(
      'C4Context\n  Person(customer, "Customer")\n  System(banking, "Banking")\n  UpdateRelStyle(visitor, banking, $textColor="red")\n  UpdateRelStyle(customer, admin, $textColor="red")',
    );
    const warnings = only(b, 'c4-undefined-relationship-style-endpoint');
    expect(warnings).toHaveLength(2);
    expect(warnings[0].message).toContain('`visitor`');
    expect(warnings[0].line).toBe(4);
    expect(warnings[1].message).toContain('`admin`');
    expect(warnings[1].line).toBe(5);
  });

  it('is suppressed by a targeted Mermaid comment', () => {
    const b = c4Block(
      'C4Context\n  %% mermaid-lint-disable-diagram c4-undefined-relationship-endpoint: legacy suppression test\n  Person(customer, "Customer")\n  Rel(customer, banking, "Uses")',
    );
    expect(only(b, 'c4-undefined-relationship-endpoint')).toEqual([]);
  });
});
