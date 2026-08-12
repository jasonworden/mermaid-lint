import type { Block } from '../extract.js';
import type { RuleId } from '../rules.js';

export interface RuleContext {
  block: Block;
  lines: string[];
  /** 1-indexed body line of the diagram header (see `locateHeader`). */
  headerLine: number;
  /** Trimmed text of that header line, or `''` when there is none. */
  headerText: string;
  /**
   * Turn a body line into the file line to *name in a message*. Every rule
   * that writes "on line N" must route through this: a raw body line is a
   * different coordinate space from the `file:line` prefix the message is
   * printed behind, and inside a Markdown fence the two disagree (#137).
   *
   * `RuleFinding.line` deliberately stays body-relative — suppression indexes
   * body lines, and the adapter maps positions itself.
   */
  fileLine(bodyLine: number): number;
}

export interface RuleFinding {
  message: string;
  line?: number;
}

export interface Rule {
  id: RuleId;
  appliesTo(block: Block): boolean;
  evaluate(ctx: RuleContext): RuleFinding[];
}
