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
  gitError?: string;
  /** Content hashes for change tracking (optional) */
  contentHash?: ContentHash;
  /** Whether a hint was written for Flywheel integration */
  hintWritten?: boolean;
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
}

export interface SuggestResult {
  suggestions: string[];      // entity names suggested
  suffix: string;             // formatted suffix: "→ [[X]] [[Y]]"
}
