/**
 * Content hash for change tracking
 */
export interface ContentHash {
  /** Hash of content before mutation */
  before: string;
  /** Hash of content after mutation */
  after: string;
}

export interface MutationResult {
  success: boolean;
  message: string;
  path: string;
  preview?: string;
  gitCommit?: string;
  /** Content hashes for change tracking (optional) */
  contentHash?: ContentHash;
  /** Whether a hint was written for Flywheel integration */
  hintWritten?: boolean;
  /** Estimated token count for this response (helps track API costs) */
  tokensEstimate?: number;
  /** Input validation warnings (when validate: true) */
  warnings?: ValidationWarning[];
  /** Output guardrail issues (when guardrails: 'warn') */
  outputIssues?: OutputIssue[];
  /** Normalization changes applied (when normalize: true) */
  normalizationChanges?: string[];
  /** True only if commit succeeded and undo is available */
  undoAvailable?: boolean;
  /** True if a stale lock (>30s old) was detected during retries */
  staleLockDetected?: boolean;
  /** Age of the lock file in milliseconds (if detected) */
  lockAgeMs?: number;
}

/** Warning from input validation */
export interface ValidationWarning {
  type: string;
  message: string;
  suggestion: string;
}

/** Issue detected by output guardrails */
export interface OutputIssue {
  type: string;
  severity: 'error' | 'warning';
  message: string;
  line?: number;
}

export interface SectionInfo {
  name: string;
  level: number;
  lineStart: number;
  lineEnd: number;
}

export type FormatType = 'task' | 'bullet' | 'numbered' | 'plain' | 'timestamp-bullet';
export type Position = 'append' | 'prepend';

export interface InsertionOptions {
  preserveListNesting?: boolean;
}

/**
 * Strictness mode for wikilink suggestions
 *
 * - 'conservative': High precision, fewer suggestions (default)
 *   Best for: Production use, avoiding false positives
 *
 * - 'balanced': Moderate precision, more suggestions
 *   Best for: Interactive exploration, v0.7 behavior
 *
 * - 'aggressive': Maximum recall, may include loose matches
 *   Best for: Discovery, finding potential connections
 */
export type StrictnessMode = 'conservative' | 'balanced' | 'aggressive';

/**
 * Note context type inferred from path
 *
 * Used for context-aware entity boosting:
 * - 'daily': Daily notes, journals, logs - prioritize people mentions
 * - 'project': Project notes, systems - prioritize project/tech entities
 * - 'tech': Technical docs, code notes - prioritize technologies/acronyms
 * - 'general': Other notes - no context-specific boost
 */
export type NoteContext = 'daily' | 'project' | 'tech' | 'general';

/**
 * Configuration for suggestion scoring algorithm
 */
export interface SuggestionConfig {
  /** Minimum word length for tokenization (default: 4 for balanced, 5 for conservative) */
  minWordLength: number;
  /** Minimum score required for suggestion (default: 8 for balanced, 15 for conservative) */
  minSuggestionScore: number;
  /** Minimum ratio of matched words for multi-word entities (default: 0.4 for balanced, 0.6 for conservative) */
  minMatchRatio: number;
  /** Require multiple word matches for single-word entities (default: false for balanced, true for conservative) */
  requireMultipleMatches: boolean;
  /** Bonus points for stem matches (default: 5 for balanced, 3 for conservative) */
  stemMatchBonus: number;
  /** Bonus points for exact matches (default: 10 for all modes) */
  exactMatchBonus: number;
}

export interface SuggestOptions {
  maxSuggestions?: number;    // default: 3
  excludeLinked?: boolean;    // exclude entities already in content (default: true)
  strictness?: StrictnessMode; // default: 'conservative'
  notePath?: string;          // path to note for context-aware boosting
}

export interface SuggestResult {
  suggestions: string[];      // entity names suggested
  suffix: string;             // formatted suffix: "→ [[X]] [[Y]]"
}
