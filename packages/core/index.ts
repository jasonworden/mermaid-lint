export { extractMermaidBlocks } from './src/extract.js';
export type { Block } from './src/extract.js';
export { validateBlock, validateWithMermaidJS } from './src/validate.js';
export type {
  ValidationResult,
  ValidationError,
  SemanticWarning,
} from './src/validate.js';
export { checkSemantics } from './src/semantic.js';
export { discoverFiles } from './src/discover.js';
export type { DiscoverOptions } from './src/discover.js';
export { detectDiagramType } from './src/type-detect.js';
