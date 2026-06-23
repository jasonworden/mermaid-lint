export { extractMermaidBlocks } from './src/extract.js';
export type { Block, ExtractOptions } from './src/extract.js';
export { ALL_FENCE_MARKERS, isFenceMarker } from './src/fences.js';
export type { FenceMarker } from './src/fences.js';
export { validateBlock, validateWithMermaidJS } from './src/validate.js';
export type {
  ValidationResult,
  ValidationError,
  SemanticWarning,
} from './src/validate.js';
export { checkSemantics } from './src/semantic.js';
export {
  ALL_RULE_IDS,
  RULE_DEFAULTS,
  isRuleSeverity,
  resolveRules,
} from './src/rules.js';
export type {
  EmittedSeverity,
  ResolvedRules,
  RuleId,
  RuleSeverity,
  RulesConfig,
} from './src/rules.js';
export {
  blockToDiagnostics,
  lintMarkdown,
} from './src/markdown-adapter.js';
export type { Diagnostic, Severity } from './src/markdown-adapter.js';
export { discoverFiles } from './src/discover.js';
export type { DiscoverOptions } from './src/discover.js';
export {
  collectMermaidBlocks,
  lintMermaidFiles,
  selectFailures,
} from './src/lint-files.js';
export type {
  LintFilesOptions,
  MermaidBlockResult,
} from './src/lint-files.js';
export { detectDiagramType } from './src/type-detect.js';
export { loadConfig } from './src/config.js';
export type { MermaidLintConfig } from './src/config.js';
export { fixText } from './src/fix.js';
export type { FixOptions } from './src/fix.js';
