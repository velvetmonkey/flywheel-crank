/**
 * Complex Policy Tests
 *
 * Validates execution of multi-step workflows that combine
 * various tools, conditions, and variables.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { executePolicy, previewPolicy } from '../../../src/core/policy/executor.js';
import type { PolicyDefinition } from '../../../src/core/policy/types.js';

let tempVault: string;

async function createTempVault(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-complex-test-'));
  await fs.mkdir(path.join(dir, '.claude', 'policies'), { recursive: true });
  return dir;
}

async function cleanupTempVault(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

async function createTestNote(vaultPath: string, notePath: string, content: string): Promise<void> {
  const fullPath = path.join(vaultPath, notePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf-8');
}

async function readTestNote(vaultPath: string, notePath: string): Promise<string> {
  const fullPath = path.join(vaultPath, notePath);
  return fs.readFile(fullPath, 'utf-8');
}

async function noteExists(vaultPath: string, notePath: string): Promise<boolean> {
  try {
    await fs.access(path.join(vaultPath, notePath));
    return true;
  } catch {
    return false;
  }
}

describe('Daily Standup Workflow', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should execute 10-step daily standup policy', async () => {
    // Setup: Create project and person notes
    await createTestNote(tempVault, 'projects/MCP Server.md', `---
type: project
status: active
---
# MCP Server

## Updates

## Blockers
`);

    await createTestNote(tempVault, 'people/Jordan.md', `---
type: person
role: engineer
---
# Jordan

## Activity

`);

    await createTestNote(tempVault, 'daily-notes/2026-02-02.md', `---
date: 2026-02-02
type: daily
---
# 2026-02-02

## Standup

## Tasks

## Log

`);

    const standupPolicy: PolicyDefinition = {
      version: '1.0',
      name: 'daily-standup',
      description: '10-step daily standup workflow',
      variables: {
        date: { type: 'string', default: '{{today}}' },
        person: { type: 'string', default: 'Jordan' },
        project: { type: 'string', default: 'MCP Server' },
        yesterday: { type: 'string', required: true },
        today_plan: { type: 'string', required: true },
        blockers: { type: 'string', default: 'None' },
      },
      conditions: [
        { id: 'daily_exists', check: 'file_exists', path: 'daily-notes/2026-02-02.md' },
        { id: 'project_exists', check: 'file_exists', path: 'projects/{{project}}.md' },
        { id: 'has_blockers', check: 'frontmatter_not_exists', path: 'daily-notes/2026-02-02.md', field: 'no_blockers' },
      ],
      steps: [
        // Step 1: Add standup summary to daily note
        {
          id: 'standup-summary',
          tool: 'vault_add_to_section',
          params: {
            path: 'daily-notes/2026-02-02.md',
            section: 'Standup',
            content: '**Yesterday:** {{yesterday}}\n**Today:** {{today_plan}}\n**Blockers:** {{blockers}}',
          },
        },
        // Step 2: Add task for today's plan
        {
          id: 'add-main-task',
          tool: 'vault_add_task',
          params: {
            path: 'daily-notes/2026-02-02.md',
            section: 'Tasks',
            task: '{{today_plan}}',
          },
        },
        // Step 3: Log activity
        {
          id: 'log-standup',
          tool: 'vault_add_to_section',
          params: {
            path: 'daily-notes/2026-02-02.md',
            section: 'Log',
            content: 'Completed standup',
            format: 'timestamp-bullet',
          },
        },
        // Step 4: Update person's activity
        {
          id: 'person-activity',
          tool: 'vault_add_to_section',
          params: {
            path: 'people/{{person}}.md',
            section: 'Activity',
            content: '2026-02-02: {{today_plan}}',
            format: 'bullet',
          },
        },
        // Step 5: Update project updates (conditional)
        {
          id: 'project-update',
          tool: 'vault_add_to_section',
          when: '{{conditions.project_exists}}',
          params: {
            path: 'projects/{{project}}.md',
            section: 'Updates',
            content: '**2026-02-02**: {{today_plan}} ({{person}})',
            format: 'bullet',
          },
        },
        // Step 6: Add blockers to project (conditional)
        {
          id: 'project-blockers',
          tool: 'vault_add_to_section',
          when: '{{conditions.has_blockers}}',
          params: {
            path: 'projects/{{project}}.md',
            section: 'Blockers',
            content: '{{blockers}} (reported by {{person}})',
            format: 'bullet',
          },
        },
        // Step 7: Update frontmatter with standup status
        {
          id: 'mark-standup-done',
          tool: 'vault_update_frontmatter',
          params: {
            path: 'daily-notes/2026-02-02.md',
            frontmatter: { standup_completed: true },
          },
        },
        // Step 8: Add follow-up task if blockers
        {
          id: 'blocker-followup',
          tool: 'vault_add_task',
          when: '{{conditions.has_blockers}}',
          params: {
            path: 'daily-notes/2026-02-02.md',
            section: 'Tasks',
            task: 'Address blockers: {{blockers}}',
          },
        },
        // Step 9: Add review task
        {
          id: 'review-task',
          tool: 'vault_add_task',
          params: {
            path: 'daily-notes/2026-02-02.md',
            section: 'Tasks',
            task: 'Review progress on {{project}}',
          },
        },
        // Step 10: Final log entry
        {
          id: 'final-log',
          tool: 'vault_add_to_section',
          params: {
            path: 'daily-notes/2026-02-02.md',
            section: 'Log',
            content: 'Standup workflow completed',
            format: 'timestamp-bullet',
          },
        },
      ],
    };

    const result = await executePolicy(standupPolicy, tempVault, {
      yesterday: 'Completed API integration',
      today_plan: 'Write unit tests for the API',
      blockers: 'Waiting for design review',
    });

    expect(result.success).toBe(true);
    expect(result.stepResults.length).toBe(10);

    // Verify daily note
    const dailyNote = await readTestNote(tempVault, 'daily-notes/2026-02-02.md');
    expect(dailyNote).toContain('Yesterday:');
    expect(dailyNote).toContain('Completed API integration');
    expect(dailyNote).toContain('Write unit tests for the API');
    expect(dailyNote).toContain('standup_completed: true');

    // Verify person note
    const personNote = await readTestNote(tempVault, 'people/Jordan.md');
    expect(personNote).toContain('Write unit tests for the API');

    // Verify project note
    const projectNote = await readTestNote(tempVault, 'projects/MCP Server.md');
    expect(projectNote).toContain('Write unit tests for the API');
    expect(projectNote).toContain('Waiting for design review');
  });
});

describe('Meeting Notes Workflow', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should create meeting note and link attendees', async () => {
    // Setup: Create attendee notes
    await createTestNote(tempVault, 'people/Alice.md', '---\ntype: person\n---\n# Alice\n\n## Meetings\n');
    await createTestNote(tempVault, 'people/Bob.md', '---\ntype: person\n---\n# Bob\n\n## Meetings\n');

    const meetingPolicy: PolicyDefinition = {
      version: '1.0',
      name: 'create-meeting',
      description: 'Create meeting note and update attendees',
      variables: {
        title: { type: 'string', required: true },
        date: { type: 'string', required: true },
        attendees: { type: 'array', default: [] },
        agenda: { type: 'string', default: 'TBD' },
      },
      steps: [
        // Create meeting note
        {
          id: 'create-meeting-note',
          tool: 'vault_create_note',
          params: {
            path: 'meetings/{{title | slug}}.md',
            content: `# {{title}}

## Details
- **Date:** {{date}}
- **Attendees:** Alice, Bob

## Agenda
{{agenda}}

## Notes

## Action Items
`,
            frontmatter: {
              type: 'meeting',
              date: '{{date}}',
            },
          },
        },
        // Update Alice's meetings
        {
          id: 'update-alice',
          tool: 'vault_add_to_section',
          params: {
            path: 'people/Alice.md',
            section: 'Meetings',
            content: '[[{{title | slug}}]] - {{date}}',
            format: 'bullet',
          },
        },
        // Update Bob's meetings
        {
          id: 'update-bob',
          tool: 'vault_add_to_section',
          params: {
            path: 'people/Bob.md',
            section: 'Meetings',
            content: '[[{{title | slug}}]] - {{date}}',
            format: 'bullet',
          },
        },
      ],
    };

    const result = await executePolicy(meetingPolicy, tempVault, {
      title: 'Sprint Planning',
      date: '2026-02-03',
      agenda: 'Review backlog and assign tasks',
    });

    expect(result.success).toBe(true);

    // Verify meeting note created
    expect(await noteExists(tempVault, 'meetings/sprint-planning.md')).toBe(true);

    const meetingNote = await readTestNote(tempVault, 'meetings/sprint-planning.md');
    expect(meetingNote).toContain('# Sprint Planning');
    expect(meetingNote).toContain('Review backlog and assign tasks');

    // Verify attendee links
    const aliceNote = await readTestNote(tempVault, 'people/Alice.md');
    expect(aliceNote).toContain('sprint-planning');

    const bobNote = await readTestNote(tempVault, 'people/Bob.md');
    expect(bobNote).toContain('sprint-planning');
  });
});

describe('Decision Record Workflow', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should create ADR with project link', async () => {
    await createTestNote(tempVault, 'projects/Platform.md', `---
type: project
---
# Platform

## Decisions
`);

    const adrPolicy: PolicyDefinition = {
      version: '1.0',
      name: 'create-adr',
      description: 'Create architectural decision record',
      variables: {
        title: { type: 'string', required: true },
        context: { type: 'string', required: true },
        decision: { type: 'string', required: true },
        consequences: { type: 'string', required: true },
        project: { type: 'string', default: 'Platform' },
      },
      conditions: [
        { id: 'project_exists', check: 'file_exists', path: 'projects/{{project}}.md' },
      ],
      steps: [
        {
          id: 'create-adr',
          tool: 'vault_create_note',
          params: {
            path: 'decisions/{{title | slug}}.md',
            content: `# {{title}}

## Status
Proposed

## Context
{{context}}

## Decision
{{decision}}

## Consequences
{{consequences}}

## Related
- Project: [[{{project}}]]
`,
            frontmatter: {
              type: 'decision',
              status: 'proposed',
              date: '{{today}}',
            },
          },
        },
        {
          id: 'link-to-project',
          tool: 'vault_add_to_section',
          when: '{{conditions.project_exists}}',
          params: {
            path: 'projects/{{project}}.md',
            section: 'Decisions',
            content: '[[{{title | slug}}]] - {{today}}',
            format: 'bullet',
          },
        },
      ],
    };

    const result = await executePolicy(adrPolicy, tempVault, {
      title: 'Use PostgreSQL for persistence',
      context: 'Need a reliable database for user data',
      decision: 'We will use PostgreSQL',
      consequences: 'Team needs PostgreSQL knowledge',
    });

    expect(result.success).toBe(true);

    const adrNote = await readTestNote(tempVault, 'decisions/use-postgresql-for-persistence.md');
    expect(adrNote).toContain('# Use PostgreSQL for persistence');
    expect(adrNote).toContain('Need a reliable database');
    expect(adrNote).toContain('[[Platform]]');

    const projectNote = await readTestNote(tempVault, 'projects/Platform.md');
    expect(projectNote).toContain('use-postgresql-for-persistence');
  });
});

describe('Policy Preview', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should preview complex policy without executing', async () => {
    await createTestNote(tempVault, 'test.md', '# Log\n');

    const policy: PolicyDefinition = {
      version: '1.0',
      name: 'preview-test',
      description: 'Test preview',
      variables: {
        message: { type: 'string', default: 'Hello' },
        count: { type: 'number', default: 5 },
      },
      conditions: [
        { id: 'file_check', check: 'file_exists', path: 'test.md' },
        { id: 'missing_check', check: 'file_exists', path: 'missing.md' },
      ],
      steps: [
        {
          id: 'step1',
          tool: 'vault_add_to_section',
          params: { path: 'test.md', section: 'Log', content: '{{message}}' },
        },
        {
          id: 'step2',
          tool: 'vault_add_to_section',
          when: '{{conditions.missing_check}}',
          params: { path: 'missing.md', section: 'X', content: 'skip' },
        },
      ],
    };

    const preview = await previewPolicy(policy, tempVault, { message: 'Custom message' });

    expect(preview.policyName).toBe('preview-test');
    expect(preview.resolvedVariables.message).toBe('Custom message');
    expect(preview.resolvedVariables.count).toBe(5);
    expect(preview.conditionResults.file_check).toBe(true);
    expect(preview.conditionResults.missing_check).toBe(false);
    expect(preview.stepsToExecute[0].skipped).toBe(false);
    expect(preview.stepsToExecute[1].skipped).toBe(true);
    expect(preview.filesAffected).toContain('test.md');

    // Verify no changes made
    const content = await readTestNote(tempVault, 'test.md');
    expect(content).not.toContain('Custom message');
  });
});

describe('Error Recovery Patterns', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should provide detailed step-by-step results', async () => {
    await createTestNote(tempVault, 'a.md', '# Log\n');
    await createTestNote(tempVault, 'b.md', '# Log\n');

    const policy: PolicyDefinition = {
      version: '1.0',
      name: 'detailed-results',
      description: 'Test detailed results',
      steps: [
        { id: 'success1', tool: 'vault_add_to_section', params: { path: 'a.md', section: 'Log', content: 'A' } },
        { id: 'success2', tool: 'vault_add_to_section', params: { path: 'b.md', section: 'Log', content: 'B' } },
        { id: 'fail', tool: 'vault_add_to_section', params: { path: 'missing.md', section: 'X', content: 'F' } },
      ],
    };

    const result = await executePolicy(policy, tempVault, {});

    expect(result.stepResults[0].stepId).toBe('success1');
    expect(result.stepResults[0].success).toBe(true);
    expect(result.stepResults[0].path).toBe('a.md');

    expect(result.stepResults[1].stepId).toBe('success2');
    expect(result.stepResults[1].success).toBe(true);

    expect(result.stepResults[2].stepId).toBe('fail');
    expect(result.stepResults[2].success).toBe(false);
    expect(result.stepResults[2].message).toBeDefined();
  });
});
