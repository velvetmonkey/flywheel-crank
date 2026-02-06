# Agent Mutation Patterns for Flywheel Crank

A comprehensive guide for autonomous agents performing safe, deterministic vault mutations. This document establishes proven patterns that minimize conflicts, enable recovery, and maintain audit trails.

---

## Table of Contents

1. [Introduction: Why Structured Mutation Patterns Matter](#introduction-why-structured-mutation-patterns-matter)
2. [Recommended Mutation Workflows](#recommended-mutation-workflows)
   - [Append-Only Logging (Safest)](#append-only-logging-safest)
   - [Section-Scoped Updates (Isolated)](#section-scoped-updates-isolated)
   - [Task Management (Toggle without Conflicts)](#task-management-toggle-without-conflicts)
   - [Frontmatter Updates (Metadata Only)](#frontmatter-updates-metadata-only)
3. [Error Handling Patterns](#error-handling-patterns)
4. [Git Best Practices](#git-best-practices)
5. [Example: Daily Logging Agent Workflow](#example-daily-logging-agent-workflow)
6. [Template Vault Structure](#template-vault-structure)

---

## Introduction: Why Structured Mutation Patterns Matter

Autonomous agents face unique challenges when modifying shared knowledge bases:

| Challenge | Impact | Solution |
|-----------|--------|----------|
| **Concurrent access** | Multiple agents or sessions may write simultaneously | Append-only patterns, section isolation |
| **Unpredictable failures** | Network issues, git locks, file system errors | Graceful degradation, retry strategies |
| **No human oversight** | Agents operate without real-time correction | Validation guardrails, deterministic operations |
| **Audit requirements** | Changes must be traceable and reversible | Git commits, structured commit messages |
| **State corruption** | Read-modify-write races can lose data | Atomic operations, append semantics |

### The Flywheel-Crank Advantage

Crank provides deterministic mutation primitives specifically designed for agent safety:

```
Traditional File Editing              Crank Mutations
─────────────────────                 ───────────────
read()                                vault_add_to_section()
  ↓                                     ↓
parse()                               (atomic operation)
  ↓                                     ↓
modify()                              Validation → Write → Commit
  ↓
write()

Risk: Race conditions,                Guarantee: Atomic, auditable,
      format corruption                         reversible
```

**Key principles:**
- **Deterministic:** Same inputs always produce same outputs
- **Section-scoped:** Mutations target specific sections, not entire files
- **Atomic:** Writes are tmp-file → rename, preventing partial writes
- **Auditable:** Git commits with `[Crank:*]` prefixes enable tracking
- **Reversible:** `vault_undo_last_mutation` provides safe rollback

---

## Recommended Mutation Workflows

### Append-Only Logging (Safest)

**Safety Level:** Highest - No conflicts possible with concurrent writers

**When to use:**
- Activity logs and session journals
- Research notes and observations
- Daily notes and standup entries
- Any chronological record keeping

**Pattern:** Always append, never modify existing content.

**Why it's safe:**
- Multiple agents can append to the same section simultaneously
- No read-modify-write race conditions
- Chronological order is naturally preserved
- No risk of overwriting another agent's data

#### Tool Call Pattern

```javascript
// Daily Logging Agent - Activity Entry
mcp__flywheel-crank__vault_add_to_section({
  path: "agent-logs/2026-02-01.md",
  section: "Activity Log",
  content: "Completed research on React 19 server components",
  format: "timestamp-bullet",  // Adds "- **14:32** " prefix
  position: "append",          // Always append, never prepend
  commit: true,                // Create undo point
  suggestOutgoingLinks: true   // Auto-link entities like [[React]]
})
```

**MutationResult:**

```json
{
  "success": true,
  "message": "Added content to section \"Activity Log\" in agent-logs/2026-02-01.md",
  "path": "agent-logs/2026-02-01.md",
  "preview": "- **14:32** Completed research on [[React]] 19 server components\n(Applied 1 wikilink; Suggested: [[Server Components]])",
  "gitCommit": "abc123f",
  "undoAvailable": true
}
```

#### Example: Daily Logging Agent

A complete logging workflow using append-only mutations:

```javascript
// 1. Ensure daily note exists
const today = new Date().toISOString().split('T')[0];
const dailyPath = `agent-logs/${today}.md`;

// Create note if it doesn't exist (idempotent with overwrite: false)
mcp__flywheel-crank__vault_create_note({
  path: dailyPath,
  frontmatter: {
    type: "agent-log",
    date: today,
    agent: "research-agent"
  },
  content: `# Agent Log - ${today}\n\n## Activity Log\n\n## Findings\n\n## Errors`,
  overwrite: false,  // Won't overwrite if already exists
  commit: true
})

// 2. Log activities throughout the day (append-only)
mcp__flywheel-crank__vault_add_to_section({
  path: dailyPath,
  section: "Activity Log",
  content: "Started research task: API design patterns",
  format: "timestamp-bullet",
  position: "append",
  commit: true
})

// 3. Log findings (separate section, still append-only)
mcp__flywheel-crank__vault_add_to_section({
  path: dailyPath,
  section: "Findings",
  content: "REST vs GraphQL: GraphQL better for nested data, REST better for caching",
  format: "bullet",
  position: "append",
  commit: true
})

// 4. Log any errors encountered
mcp__flywheel-crank__vault_add_to_section({
  path: dailyPath,
  section: "Errors",
  content: "Rate limit hit on GitHub API - implemented exponential backoff",
  format: "timestamp-bullet",
  position: "append",
  commit: true
})
```

---

### Section-Scoped Updates (Isolated)

**Safety Level:** High - Conflicts limited to same section

**When to use:**
- Structured documents with clear ownership boundaries
- Meeting notes with separate sections per topic
- Project notes where each agent owns a section
- Documents with human-editable and agent-editable regions

**Pattern:** Own one section, leave others alone.

**Why it's safe:**
- Section boundaries prevent cross-contamination
- Human edits in one section won't conflict with agent edits in another
- Clear ownership reduces coordination overhead

#### Multi-Agent Section Ownership

```markdown
# Project Alpha Status

## Human Notes
<!-- Human-owned section - agents should never modify -->
Meeting with stakeholders went well. Budget approved.

## Agent-Research
<!-- Research agent writes here -->
- **10:00** Found 3 competitor implementations
- **11:30** Analyzed performance characteristics

## Agent-Implementation
<!-- Implementation agent writes here -->
- **14:00** Created initial module structure
- **15:30** Added unit tests for core functions

## Agent-Review
<!-- Review agent writes here -->
- Code coverage: 87%
- No security vulnerabilities detected
```

#### Tool Call Pattern

```javascript
// Research Agent - writes only to Agent-Research section
mcp__flywheel-crank__vault_add_to_section({
  path: "projects/alpha.md",
  section: "Agent-Research",     // This agent's designated section
  content: "Found that Redis outperforms Memcached for our use case",
  format: "timestamp-bullet",
  position: "append",
  commit: true
})

// Implementation Agent - writes only to Agent-Implementation section
mcp__flywheel-crank__vault_add_to_section({
  path: "projects/alpha.md",
  section: "Agent-Implementation",  // Different agent's section
  content: "Implemented Redis connection pooling",
  format: "timestamp-bullet",
  position: "append",
  commit: true
})
```

#### Example: Meeting Notes with Separate Action Items

```javascript
// 1. Create structured meeting note
mcp__flywheel-crank__vault_create_note({
  path: "meetings/2026-02-01-standup.md",
  frontmatter: {
    type: "meeting",
    date: "2026-02-01",
    attendees: ["Alice", "Bob", "Agent-Notetaker"]
  },
  content: `# Standup 2026-02-01

## Discussion
<!-- Notetaker agent captures discussion -->

## Action Items
<!-- Action items section - can be toggled by task agents -->

## Decisions
<!-- Record key decisions made -->
`,
  commit: true
})

// 2. Notetaker agent adds to Discussion section
mcp__flywheel-crank__vault_add_to_section({
  path: "meetings/2026-02-01-standup.md",
  section: "Discussion",
  content: "Alice: API migration is 80% complete, expecting to finish by Friday",
  format: "bullet",
  position: "append",
  commit: true
})

// 3. Add action items as tasks
mcp__flywheel-crank__vault_add_task({
  path: "meetings/2026-02-01-standup.md",
  section: "Action Items",
  task: "Review API migration PR before Friday",
  position: "append",
  commit: true
})

// 4. Record decisions
mcp__flywheel-crank__vault_add_to_section({
  path: "meetings/2026-02-01-standup.md",
  section: "Decisions",
  content: "Decided to use GraphQL for new endpoints, REST for existing",
  format: "timestamp-bullet",
  commit: true
})
```

---

### Task Management (Toggle without Conflicts)

**Safety Level:** High - Atomic checkbox operations

**When to use:**
- Todo lists and checklists
- Project trackers with task completion
- Daily task management
- Sprint backlogs

**Pattern:** Toggle checkbox states atomically, never rewrite task text.

**Why it's safe:**
- `vault_toggle_task` finds and modifies a single line
- Atomic operation prevents partial updates
- Partial matching allows flexible task identification
- No risk of corrupting surrounding content

#### Tool Call Pattern

```javascript
// Toggle a task complete (partial match supported)
mcp__flywheel-crank__vault_toggle_task({
  path: "projects/alpha.md",
  task: "review PR",           // Partial match - finds "Review PR for MCP Server"
  section: "Tasks",            // Optional: limit search to section
  commit: true
})
```

**MutationResult:**

```json
{
  "success": true,
  "message": "Toggled task to completed in projects/alpha.md",
  "path": "projects/alpha.md",
  "preview": "[x] Review PR for [[MCP Server]]",
  "gitCommit": "def456a",
  "undoAvailable": true
}
```

#### Example: Project Tracker Updates

```javascript
// 1. Add new tasks to backlog
mcp__flywheel-crank__vault_add_task({
  path: "projects/alpha.md",
  section: "Backlog",
  task: "Implement caching layer with Redis",
  position: "append",
  commit: true
})

// 2. Move task to in-progress by toggling (if using checkbox to track)
// Or use replace to change status text
mcp__flywheel-crank__vault_replace_in_section({
  path: "projects/alpha.md",
  section: "Backlog",
  search: "- [ ] Implement caching layer",
  replacement: "- [>] Implement caching layer",  // > = in progress
  commit: true
})

// 3. Mark task complete
mcp__flywheel-crank__vault_toggle_task({
  path: "projects/alpha.md",
  task: "caching layer",
  section: "In Progress",
  commit: true
})

// 4. Archive completed tasks (batch operation)
mcp__flywheel-crank__vault_remove_from_section({
  path: "projects/alpha.md",
  section: "Done",
  pattern: "^- \\[x\\] .*2026-01.*$",  // Remove January 2026 completed tasks
  mode: "all",
  useRegex: true,
  commit: true
})
```

---

### Frontmatter Updates (Metadata Only)

**Safety Level:** Highest for metadata - Complete isolation from content

**When to use:**
- Status changes (draft/review/published)
- Timestamps (last_modified, reviewed_at)
- Tags and categories
- Workflow state machines
- Metadata that drives automation

**Pattern:** Modify YAML frontmatter only, never touch content body.

**Why it's safe:**
- Frontmatter is structurally separate from content
- YAML parsing handles the complexity
- Merge semantics preserve unmodified fields
- Perfect for state machine transitions

#### Tool Call Pattern

```javascript
// Update document status
mcp__flywheel-crank__vault_update_frontmatter({
  path: "docs/api-spec.md",
  frontmatter: {
    status: "in-review",
    last_modified: "2026-02-01T14:30:00Z",
    modified_by: "review-agent"
  },
  commit: true
})
```

**MutationResult:**

```json
{
  "success": true,
  "message": "Updated 3 frontmatter field(s) in docs/api-spec.md",
  "path": "docs/api-spec.md",
  "preview": "status: \"in-review\"\nlast_modified: \"2026-02-01T14:30:00Z\"\nmodified_by: \"review-agent\"",
  "gitCommit": "789abc0",
  "undoAvailable": true
}
```

#### Example: Document Status Tracker

```javascript
// Document lifecycle state machine:
// draft -> in-review -> approved -> published

// 1. Agent completes draft, moves to review
mcp__flywheel-crank__vault_update_frontmatter({
  path: "docs/api-spec.md",
  frontmatter: {
    status: "in-review",
    submitted_at: new Date().toISOString(),
    submitted_by: "writing-agent"
  },
  commit: true
})

// 2. Review agent approves
mcp__flywheel-crank__vault_update_frontmatter({
  path: "docs/api-spec.md",
  frontmatter: {
    status: "approved",
    approved_at: new Date().toISOString(),
    approved_by: "review-agent",
    review_notes: "LGTM, minor typos fixed"
  },
  commit: true
})

// 3. Publishing agent marks published
mcp__flywheel-crank__vault_update_frontmatter({
  path: "docs/api-spec.md",
  frontmatter: {
    status: "published",
    published_at: new Date().toISOString(),
    version: "1.0.0"
  },
  commit: true
})

// 4. Add a new field (fails if exists - use for initialization)
mcp__flywheel-crank__vault_add_frontmatter_field({
  path: "docs/new-doc.md",
  key: "workflow_state",
  value: "initialized",
  commit: true
})
```

---

## Error Handling Patterns

### Understanding MutationResult

Every Crank tool returns a structured `MutationResult`:

```typescript
interface MutationResult {
  success: boolean;          // Did the mutation complete?
  message: string;           // Human-readable status
  path: string;              // File that was modified
  preview?: string;          // What was changed
  gitCommit?: string;        // Commit hash if committed
  undoAvailable?: boolean;   // Can this be undone?
  staleLockDetected?: boolean; // Git lock older than 30s detected?
  lockAgeMs?: number;        // Age of lock file in milliseconds
  tokensEstimate?: number;   // Estimated tokens in response
  warnings?: ValidationWarning[];      // Input validation issues
  outputIssues?: OutputIssue[];        // Output guardrail issues
  normalizationChanges?: string[];     // Auto-corrections applied
}
```

### Error Categories and Handling

#### 1. File Not Found

```javascript
const result = mcp__flywheel-crank__vault_add_to_section({
  path: "nonexistent/file.md",
  section: "Log",
  content: "Entry"
})

// Result:
// {
//   "success": false,
//   "message": "File not found: nonexistent/file.md"
// }

// Agent response: Create the file first or verify path
if (!result.success && result.message.includes("File not found")) {
  // Option 1: Create the note
  mcp__flywheel-crank__vault_create_note({
    path: "nonexistent/file.md",
    content: "# New File\n\n## Log",
    commit: true
  })
  // Then retry the original operation
}
```

#### 2. Section Not Found

```javascript
const result = mcp__flywheel-crank__vault_add_to_section({
  path: "daily.md",
  section: "Nonexistent Section",
  content: "Entry"
})

// Result:
// {
//   "success": false,
//   "message": "Section 'Nonexistent Section' not found. Available sections: Log, Tasks, Notes"
// }

// Agent response: Use available section or add the section
if (!result.success && result.message.includes("not found")) {
  // The error message lists available sections - pick one or ask user
}
```

#### 3. Git Lock Contention

When multiple processes compete for the git lock:

```javascript
const result = mcp__flywheel-crank__vault_add_to_section({
  path: "daily.md",
  section: "Log",
  content: "Entry",
  commit: true
})

// Result (file written successfully, git commit failed):
// {
//   "success": true,        // File WAS modified
//   "message": "Added content to section...",
//   "gitCommit": undefined, // No commit created
//   "staleLockDetected": true,  // Lock was stale (>30s old)
//   "lockAgeMs": 45000      // Lock age in milliseconds
// }

// Agent response: File is saved, commit failed - can retry commit later
if (result.success && !result.gitCommit) {
  // Log the issue, file is still saved
  if (result.staleLockDetected) {
    console.log(`Mutation succeeded but git commit failed (stale lock: ${result.lockAgeMs}ms)`);
  }
  // Could retry commit in next operation
}
```

#### 4. Validation Failures

When `guardrails: "strict"` blocks invalid output:

```javascript
const result = mcp__flywheel-crank__vault_add_to_section({
  path: "daily.md",
  section: "Log",
  content: "```\nunclosed code block",  // Orphaned fence
  guardrails: "strict"
})

// Result:
// {
//   "success": false,
//   "message": "Output validation failed",
//   "outputIssues": [
//     { "type": "orphaned-fence", "severity": "error", "message": "Odd number of code fence markers" }
//   ]
// }

// Agent response: Fix the content and retry
```

### Retry Strategies

#### Exponential Backoff for Transient Failures

```javascript
async function mutateWithRetry(operation, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const result = await operation();

    if (result.success) {
      return result;
    }

    // Don't retry on permanent failures
    if (result.message.includes("File not found") ||
        result.message.includes("Section") && result.message.includes("not found")) {
      return result;  // Permanent failure, don't retry
    }

    // Retry on transient failures (git lock, etc.)
    if (result.gitError || result.message.includes("lock")) {
      const delay = Math.pow(2, attempt) * 100;  // 100ms, 200ms, 400ms
      await sleep(delay);
      continue;
    }

    return result;  // Unknown failure, don't retry
  }
}
```

#### Graceful Degradation

```javascript
async function safeLog(path, section, content) {
  // Try primary logging location
  let result = await mcp__flywheel-crank__vault_add_to_section({
    path: path,
    section: section,
    content: content,
    commit: true
  });

  if (result.success) return result;

  // Fallback 1: Try without git commit
  if (!result.gitCommit && result.staleLockDetected) {
    result = await mcp__flywheel-crank__vault_add_to_section({
      path: path,
      section: section,
      content: content,
      commit: false  // Skip git
    });
    if (result.success) {
      console.log("Logged without git commit");
      return result;
    }
  }

  // Fallback 2: Try a different section
  if (result.message.includes("not found")) {
    result = await mcp__flywheel-crank__vault_add_to_section({
      path: path,
      section: "Fallback",  // Generic fallback section
      content: `[${section}] ${content}`,  // Include original section in content
      commit: false
    });
  }

  // Fallback 3: Log to stderr and continue
  if (!result.success) {
    console.error(`Failed to log: ${content}`);
  }

  return result;
}
```

---

## Git Best Practices

### Commit Message Conventions

Crank uses prefixes to identify commit types:

| Prefix | Tool | Description |
|--------|------|-------------|
| `[Crank:Add]` | `vault_add_to_section` | Content added to section |
| `[Crank:Remove]` | `vault_remove_from_section` | Content removed from section |
| `[Crank:Replace]` | `vault_replace_in_section` | Content replaced in section |
| `[Crank:Task]` | `vault_toggle_task`, `vault_add_task` | Task operations |
| `[Crank:FM]` | `vault_update_frontmatter`, `vault_add_frontmatter_field` | Frontmatter changes |
| `[Crank:Create]` | `vault_create_note` | New note created |
| `[Crank:Delete]` | `vault_delete_note` | Note deleted |

These prefixes enable:
- Filtering commits by type: `git log --grep="Crank:Add"`
- Identifying agent activity vs human commits
- Rollback targeting specific operation types

### When to Commit vs Batch Changes

**Commit each operation when:**
- Operations are independent and should be individually reversible
- You need an audit trail of each action
- Multiple agents may be writing concurrently
- The operation is significant (status change, decision logged)

```javascript
// Commit each - important audit trail
mcp__flywheel-crank__vault_update_frontmatter({
  path: "docs/spec.md",
  frontmatter: { status: "approved" },
  commit: true  // Commit this important change
})
```

**Batch changes when:**
- Multiple operations are logically one unit
- You want to reduce git noise
- Performance is critical (many rapid mutations)
- You'll manually commit the batch later

```javascript
// Batch multiple related changes
mcp__flywheel-crank__vault_add_to_section({
  path: "daily.md", section: "Log", content: "Task 1", commit: false
})
mcp__flywheel-crank__vault_add_to_section({
  path: "daily.md", section: "Log", content: "Task 2", commit: false
})
mcp__flywheel-crank__vault_add_to_section({
  path: "daily.md", section: "Log", content: "Task 3", commit: true  // Final commit includes all
})
```

### Rollback Strategies

#### Undo Single Mutation

```javascript
// First, check what would be undone
const preview = await mcp__flywheel-crank__vault_undo_last_mutation({
  confirm: false  // Preview mode
})
// Result shows: "Would undo: [Crank:Add] Update daily-notes/2026-02-01.md"

// If correct, confirm undo
const undoResult = await mcp__flywheel-crank__vault_undo_last_mutation({
  confirm: true
})
```

#### Safe Undo with Hash Verification

```javascript
// Store the commit hash when making important changes
const mutation = await mcp__flywheel-crank__vault_add_to_section({
  path: "critical.md",
  section: "Data",
  content: "Important entry",
  commit: true
})

const commitHash = mutation.gitCommit;  // "abc123f"

// Later, verify before undoing
const undoResult = await mcp__flywheel-crank__vault_undo_last_mutation({
  confirm: true,
  hash: commitHash  // Only undo if HEAD matches this hash
})

// If another process committed, undo is blocked:
// {
//   "success": false,
//   "message": "HEAD mismatch - refusing to undo wrong commit"
// }
```

#### Multiple Rollback (Manual)

For rolling back multiple commits, use git directly:

```bash
# View recent Crank commits
git log --grep="Crank:" --oneline -10

# Reset to specific point (preserves changes as unstaged)
git reset --soft HEAD~3

# Or reset to specific commit
git reset --soft abc123
```

---

## Example: Daily Logging Agent Workflow

A complete, production-ready workflow for a daily logging agent with full error handling:

```javascript
/**
 * Daily Logging Agent
 *
 * Responsibilities:
 * - Create daily note if needed
 * - Log activities throughout the day
 * - Handle errors gracefully
 * - Maintain audit trail
 */

async function dailyLoggingAgent() {
  const today = new Date().toISOString().split('T')[0];  // "2026-02-01"
  const dailyPath = `agent-logs/${today}.md`;

  // ============================================
  // Step 1: Ensure daily note exists
  // ============================================
  const createResult = await mcp__flywheel-crank__vault_create_note({
    path: dailyPath,
    frontmatter: {
      type: "agent-log",
      date: today,
      agent: "daily-logger",
      status: "active"
    },
    content: `# Agent Log - ${today}

## Session Log
<!-- Append-only activity log -->

## Findings
<!-- Research findings and observations -->

## Decisions
<!-- Important decisions made -->

## Errors
<!-- Errors encountered and resolutions -->
`,
    overwrite: false,  // Don't overwrite existing
    commit: true
  });

  if (!createResult.success && !createResult.message.includes("already exists")) {
    // Unexpected error - log and continue with fallback
    console.error(`Failed to create daily note: ${createResult.message}`);
    // Could try alternative path or alert human
    return;
  }

  // ============================================
  // Step 2: Log session start
  // ============================================
  const startResult = await mcp__flywheel-crank__vault_add_to_section({
    path: dailyPath,
    section: "Session Log",
    content: "Session started - initializing research tasks",
    format: "timestamp-bullet",
    position: "append",
    commit: true,
    suggestOutgoingLinks: true
  });

  if (!startResult.success) {
    console.error(`Failed to log session start: ${startResult.message}`);
    // Continue anyway - logging failure shouldn't block work
  }

  // ============================================
  // Step 3: Perform work and log activities
  // ============================================

  // Simulate research task
  const researchTopic = "React 19 server components";

  // Log starting research
  await mcp__flywheel-crank__vault_add_to_section({
    path: dailyPath,
    section: "Session Log",
    content: `Starting research: ${researchTopic}`,
    format: "timestamp-bullet",
    position: "append",
    commit: true
  });

  // ... perform actual research ...

  // Log findings
  const findingsResult = await mcp__flywheel-crank__vault_add_to_section({
    path: dailyPath,
    section: "Findings",
    content: "Server components reduce client bundle size by 30-50% for data-heavy pages",
    format: "bullet",
    position: "append",
    commit: true,
    suggestOutgoingLinks: true  // Will suggest [[React]], [[Server Components]], etc.
  });

  // ============================================
  // Step 4: Handle any errors encountered
  // ============================================

  // Example: API rate limit hit
  const error = {
    type: "rate_limit",
    api: "GitHub",
    resolution: "Implemented exponential backoff"
  };

  await mcp__flywheel-crank__vault_add_to_section({
    path: dailyPath,
    section: "Errors",
    content: `${error.api} API: ${error.type} - ${error.resolution}`,
    format: "timestamp-bullet",
    position: "append",
    commit: true
  });

  // ============================================
  // Step 5: Log session end and update status
  // ============================================

  // Log session end
  await mcp__flywheel-crank__vault_add_to_section({
    path: dailyPath,
    section: "Session Log",
    content: "Session completed - 3 research tasks finished",
    format: "timestamp-bullet",
    position: "append",
    commit: true
  });

  // Update frontmatter with session summary
  await mcp__flywheel-crank__vault_update_frontmatter({
    path: dailyPath,
    frontmatter: {
      status: "completed",
      completed_at: new Date().toISOString(),
      tasks_completed: 3,
      errors_encountered: 1
    },
    commit: true
  });

  console.log(`Daily logging complete: ${dailyPath}`);
}

// Run the agent
dailyLoggingAgent().catch(console.error);
```

### Expected Daily Note Output

After running the agent:

```markdown
---
type: agent-log
date: 2026-02-01
agent: daily-logger
status: completed
completed_at: 2026-02-01T18:30:00.000Z
tasks_completed: 3
errors_encountered: 1
---

# Agent Log - 2026-02-01

## Session Log
<!-- Append-only activity log -->

- **09:00** Session started - initializing research tasks
- **09:01** Starting research: [[React]] 19 server components
- **18:30** Session completed - 3 research tasks finished

## Findings
<!-- Research findings and observations -->

- Server components reduce client bundle size by 30-50% for data-heavy pages -> [[React]] [[Server Components]] [[Performance]]

## Decisions
<!-- Important decisions made -->

## Errors
<!-- Errors encountered and resolutions -->

- **14:23** [[GitHub]] API: rate_limit - Implemented exponential backoff
```

---

## Template Vault Structure

Recommended folder layout for agent-managed vaults:

```
vault/
├── .obsidian/                    # Obsidian config (excluded from agent access)
├── .claude/
│   ├── settings.local.json       # Agent permissions
│   └── flywheel.db               # SQLite StateDb (entities, commit tracking)
│
├── agent-logs/                   # Append-only logging (Pattern: Append-Only)
│   ├── 2026-02-01.md
│   ├── 2026-02-02.md
│   └── ...
│
├── projects/                     # Section-scoped updates (Pattern: Section-Scoped)
│   ├── alpha/
│   │   ├── status.md             # Frontmatter-driven status
│   │   ├── tasks.md              # Task management
│   │   └── notes.md              # Multi-agent sections
│   └── beta/
│       └── ...
│
├── meetings/                     # Structured meeting notes
│   ├── 2026-02-01-standup.md
│   └── templates/
│       └── meeting-template.md
│
├── knowledge/                    # Agent research outputs
│   ├── topics/
│   │   ├── react.md
│   │   └── graphql.md
│   └── decisions/
│       └── adr-001-api-style.md
│
├── tasks/                        # Centralized task tracking (Pattern: Task Management)
│   ├── backlog.md
│   ├── in-progress.md
│   └── archive/
│       └── 2026-01.md
│
├── workflows/                    # Workflow state documents (Pattern: Frontmatter)
│   ├── document-review.md
│   └── release-checklist.md
│
└── _templates/                   # Note templates (excluded from entity scanning)
    ├── daily-log.md
    ├── meeting-note.md
    └── project-status.md
```

### Pattern-to-Folder Mapping

| Folder | Recommended Pattern | Rationale |
|--------|---------------------|-----------|
| `agent-logs/` | Append-Only Logging | Chronological, no conflicts |
| `projects/*/notes.md` | Section-Scoped Updates | Multi-agent collaboration |
| `tasks/` | Task Management | Checkbox toggling |
| `workflows/` | Frontmatter Updates | State machine transitions |
| `knowledge/` | Append-Only + Section-Scoped | Research accumulation |

### Permissions Configuration

Recommended `.claude/settings.local.json`:

```json
{
  "permissions": {
    "allow": [
      "mcp__flywheel__*",
      "mcp__flywheel-crank__vault_add_to_section",
      "mcp__flywheel-crank__vault_add_task",
      "mcp__flywheel-crank__vault_toggle_task",
      "mcp__flywheel-crank__vault_update_frontmatter",
      "mcp__flywheel-crank__vault_create_note",
      "mcp__flywheel-crank__vault_list_sections"
    ],
    "deny": [
      "Write(**)",
      "Edit(**)",
      "mcp__flywheel-crank__vault_delete_note"
    ]
  }
}
```

**Why this configuration:**
- Allows all read operations (Flywheel)
- Allows safe mutation operations (add, toggle, update)
- Allows note creation (for daily logs, etc.)
- Denies raw Write/Edit (forces all writes through Crank)
- Denies note deletion (destructive operation requires human approval)

---

## See Also

- [AGENT-MEMORY.md](AGENT-MEMORY.md) - Using Flywheel as persistent agent memory
- [tools-reference.md](tools-reference.md) - Complete tool documentation
- [COMPARISON.md](COMPARISON.md) - Flywheel-Crank vs alternatives
- [MIGRATION.md](MIGRATION.md) - Migrating from raw file editing
- [LIMITATIONS.md](LIMITATIONS.md) - Understanding Crank's boundaries
