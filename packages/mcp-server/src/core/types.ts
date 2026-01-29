export interface MutationResult {
  success: boolean;
  message: string;
  path: string;
  preview?: string;
  gitCommit?: string;
  gitError?: string;
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
