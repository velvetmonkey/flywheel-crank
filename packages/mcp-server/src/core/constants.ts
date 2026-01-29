/**
 * Shared constants for Flywheel Crank
 */

export const DEFAULT_AUTO_COMMIT = false;
export const DEFAULT_COMMIT_MESSAGE_PREFIX = '[Flywheel Crank]';

/**
 * Valid markdown heading markers
 */
export const HEADING_REGEX = /^(#{1,6})\s+(.+)$/;

/**
 * Task checkbox patterns
 */
export const TASK_CHECKBOX_REGEX = /^(\s*)-\s+\[([ xX-])\]\s+(.*)$/;
