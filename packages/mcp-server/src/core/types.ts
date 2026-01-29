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
