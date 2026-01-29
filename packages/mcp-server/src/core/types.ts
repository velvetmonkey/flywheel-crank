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

export interface SuggestOptions {
  maxSuggestions?: number;    // default: 3
  excludeLinked?: boolean;    // exclude entities already in content (default: true)
}

export interface SuggestResult {
  suggestions: string[];      // entity names suggested
  suffix: string;             // formatted suffix: "→ [[X]] [[Y]]"
}
