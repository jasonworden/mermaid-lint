import { describe, expect, it } from 'vitest';
import { RULE_DEFAULTS } from '../../src/rules.js';
import type { ResolvedRules } from '../../src/rules.js';
import { block } from './helpers.js';
import { only } from './helpers.js';

describe('no-duplicate-methods rule', () => {
  function classBlock(body: string): Block {
    return block(body, 'classDiagram');
  }

  it('returns [] when no duplicate methods exist', () => {
    const b = classBlock(
      'classDiagram\n  class Foo {\n    +bar() int\n    +baz() string\n  }',
    );
    expect(only(b, 'no-duplicate-methods')).toEqual([]);
  });

  it('fires when a method is declared twice in a class block (warn)', () => {
    const b = classBlock(
      'classDiagram\n  class Foo {\n    +bar() int\n    +bar() int\n  }',
    );
    const warnings = only(b, 'no-duplicate-methods');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('`bar()`');
    expect(warnings[0].message).toContain('`Foo`');
    expect(warnings[0].message).toContain('first on line 3');
  });

  it('fires when a method is declared twice via inline syntax', () => {
    const b = classBlock('classDiagram\n  Foo : +bar()\n  Foo : +bar()');
    const warnings = only(b, 'no-duplicate-methods');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('`bar()`');
    expect(warnings[0].message).toContain('`Foo`');
  });

  it('returns [] for distinct overloads (different param signatures)', () => {
    const b = classBlock(
      'classDiagram\n  class Foo {\n    +bar(int x) string\n    +bar(String s) string\n  }',
    );
    expect(only(b, 'no-duplicate-methods')).toEqual([]);
  });

  it('returns [] when same method name appears on two different classes', () => {
    const b = classBlock(
      'classDiagram\n  class Foo {\n    +bar()\n  }\n  class Baz {\n    +bar()\n  }',
    );
    expect(only(b, 'no-duplicate-methods')).toEqual([]);
  });

  it('returns [] for repeated attribute (no parens) — not a method', () => {
    const b = classBlock(
      'classDiagram\n  class Foo {\n    +int count\n    +int count\n  }',
    );
    expect(only(b, 'no-duplicate-methods')).toEqual([]);
  });

  it('is suppressed by %% mermaid-lint-disable-diagram no-duplicate-methods', () => {
    const b = classBlock(
      'classDiagram\n  %% mermaid-lint-disable-diagram no-duplicate-methods: legacy suppression test\n  class Foo {\n    +bar()\n    +bar()\n  }',
    );
    expect(only(b, 'no-duplicate-methods')).toEqual([]);
  });

  it('returns [] when configured off', () => {
    const b = classBlock(
      'classDiagram\n  class Foo {\n    +bar()\n    +bar()\n  }',
    );
    const rules: ResolvedRules = {
      ...RULE_DEFAULTS,
      'no-duplicate-methods': 'off',
    };
    expect(only(b, 'no-duplicate-methods', rules)).toEqual([]);
  });

  it('severity defaults to warn', () => {
    const b = classBlock(
      'classDiagram\n  class Foo {\n    +bar()\n    +bar()\n  }',
    );
    const warnings = only(b, 'no-duplicate-methods');
    expect(warnings[0].severity).toBe('warn');
  });
});

describe('class-duplicate-class rule', () => {
  function classBlock(body: string): Block {
    return block(body, 'classDiagram');
  }

  it('returns [] when class declarations are unique', () => {
    const b = classBlock('classDiagram\n  class User\n  class Account');
    expect(only(b, 'class-duplicate-class')).toEqual([]);
  });

  it('flags duplicate class declarations', () => {
    const b = classBlock('classDiagram\n  class User\n  class User');
    const warnings = only(b, 'class-duplicate-class');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].message).toContain('`User`');
    expect(warnings[0].message).toContain('line 2');
    expect(warnings[0].line).toBe(3);
  });

  it('does not treat classDef as a class declaration', () => {
    const b = classBlock(
      'classDiagram\n  class User\n  classDef active fill:#fff',
    );
    expect(only(b, 'class-duplicate-class')).toEqual([]);
  });
});
