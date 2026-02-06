# Multi-Agent Mutation Patterns

Safe concurrent mutation patterns for multi-agent AI workflows using Flywheel-Crank.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Strict Atomic Policies (Recommended for Agents)](#strict-atomic-policies-recommended-for-agents)
3. [Safe Concurrent Mutation Patterns](#safe-concurrent-mutation-patterns)
4. [Git Conflict Resolution](#git-conflict-resolution)
5. [Section-Level Locking Patterns](#section-level-locking-patterns)
6. [Demo Scenario: 3-Agent Workflow](#demo-scenario-3-agent-workflow)
7. [Best Practices](#best-practices)

---

## Introduction

### Why Multi-Agent Mutation Matters

Modern AI workflows increasingly involve multiple agents working concurrently:

- **Coordinator agents** orchestrating specialist agents
- **Parallel research agents** gathering information simultaneously
- **Pipeline workflows** where one agent's output feeds another
- **Human + AI collaboration** with multiple Claude Code sessions

**The core problem:** Multiple agents writing to shared knowledge bases creates race conditions, data corruption, and merge conflicts.

**The flywheel-crank solution:** Deterministic, section-scoped mutations with git-backed audit trails enable safe concurrent writes when patterns are followed correctly.

### What Crank Provides

| Capability | Safety Level | Notes |
|------------|--------------|-------|
| Parallel writes to different files | Safe | File-level isolation |
| Sequential writes to same file | Safe | No corruption |
| Parallel writes to same section | Safe (append) | Append semantics preserve both writes |
| Git lock contention | Graceful | Mutation succeeds, commit may fail |
| Rapid sequential mutations (100+) | Safe | Tested in stress suite |

### What Crank Does NOT Provide

| Scenario | Risk | Mitigation |
|----------|------|------------|
| Cross-file transactions | No atomicity | Design single-file workflows |
| Semantic conflicts | Logical collisions | Coordination notes |
| Read-modify-write races | Stale data overwrites | Append-only patterns |
| Distributed locking | None built-in | Section ownership conventions |

---

## Strict Atomic Policies (Recommended for Agents)

### The Agent Reliability Problem

Simple mutations (`vault_add_to_section`, etc.) use **best-effort** git semantics:
- File mutation **always succeeds**
- Git commit **may fail** (lock contention, etc.)
- Result: `{ success: true, staleLockDetected: true }` (no gitCommit field)

This works for interactive human use but creates problems for automated agents that need clear success/failure semantics.

### Solution: Use Policies for Atomic Workflows

Policies (`policy_execute`) use **strict atomic mode**:

1. **Pre-flight check:** If `.git/index.lock` exists, fail immediately (no mutations)
2. **Execute steps:** All file mutations
3. **Atomic commit:** All files committed together
4. **On failure:** Automatic rollback of all changes

```javascript
// Agent-safe atomic workflow
const result = await policy_execute({
  name: "research-log",
  variables: {
    project: "Turbopump Analysis",
    finding: "Discovered cavitation at high RPM"
  },
  commit: true  // Required for atomic semantics
});

if (!result.success && result.retryable) {
  // Lock contention - retry with backoff
  await sleep(result.retryAfterMs || 500);
  // Retry...
}
```

### New Response Fields for Agents

```typescript
interface PolicyExecutionResult {
  success: boolean;        // True = ALL changes committed
  policyName: string;
  message: string;
  filesModified: string[]; // Empty if rollback occurred

  // New fields for agent reliability:
  retryable?: boolean;     // True = safe to retry
  retryAfterMs?: number;   // Suggested wait time (ms)
  lockContention?: boolean; // Git lock detected
}
```

### Retry Strategy

```javascript
async function executeWithRetry(policyName, params, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const result = await policy_execute({
      name: policyName,
      variables: params,
      commit: true
    });

    if (result.success) return result;
    if (!result.retryable) throw new Error(result.message);

    // Exponential backoff with jitter
    const delay = result.retryAfterMs || (500 * Math.pow(2, attempt));
    const jitter = delay * 0.2 * Math.random();
    await sleep(delay + jitter);
  }
  throw new Error('Max retries exceeded');
}
```

### When Simple Mutations Are OK

| Scenario | Use Simple Mutation | Use Policy |
|----------|--------------------| -----------|
| Single file, human in loop | Yes | |
| Multi-file workflow | | Yes |
| Automated agent | | Yes |
| Needs guaranteed atomicity | | Yes |
| Retry safety matters | | Yes |

### Failure Scenarios

**Lock Contention (retryable):**
```json
{
  "success": false,
  "message": "Git lock contention: another process is committing. Retry in 500ms.",
  "retryable": true,
  "retryAfterMs": 500,
  "lockContention": true,
  "filesModified": []
}
```

**Step Failure (not retryable):**
```json
{
  "success": false,
  "message": "Policy failed at step 'log-to-project': Section '## Findings' not found",
  "retryable": false,
  "filesModified": []
}
```

---

## Safe Concurrent Mutation Patterns

### Pattern 1: File-Level Isolation

**Safest pattern.** Each agent writes to its own dedicated file.

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Research Agent │     │  Writing Agent  │     │  Review Agent   │
│                 │     │                 │     │                 │
│  Writes to:     │     │  Writes to:     │     │  Writes to:     │
│  research.md    │     │  draft.md       │     │  review.md      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                      │                      │
         └──────────────────────┼──────────────────────┘
                                ▼
                    ┌───────────────────────┐
                    │   No conflicts - each │
                    │   agent owns its file │
                    └───────────────────────┘
```

**Implementation:**

```javascript
// Research Agent writes to research.md
vault_add_to_section({
  path: "project/research.md",
  section: "Findings",
  content: "Found that React 19 supports server components",
  format: "timestamp-bullet",
  commit: true
})

// Writing Agent writes to draft.md
vault_add_to_section({
  path: "project/draft.md",
  section: "Content",
  content: "Server components enable zero-JS hydration...",
  format: "plain",
  commit: true
})

// Review Agent writes to review.md
vault_add_to_section({
  path: "project/review.md",
  section: "Notes",
  content: "Draft needs more examples in section 3",
  format: "task",
  commit: true
})
```

**When to use:**
- Agents have clearly distinct responsibilities
- No need for real-time collaboration on same document
- Maximum safety is required

---

### Pattern 2: Section-Level Isolation

**Each agent owns a dedicated section within a shared file.**

```markdown
# Daily Project Log

## Research (Agent: research-bot)
<!-- Only research-bot writes here -->

## Draft (Agent: writing-bot)
<!-- Only writing-bot writes here -->

## Review Notes (Agent: review-bot)
<!-- Only review-bot writes here -->
```

**Implementation:**

```javascript
// Each agent writes ONLY to its designated section

// Research agent
vault_add_to_section({
  path: "project/daily-log.md",
  section: "Research",  // Owned by this agent
  content: "API rate limits are 1000/hour",
  format: "bullet"
})

// Writing agent
vault_add_to_section({
  path: "project/daily-log.md",
  section: "Draft",  // Owned by this agent
  content: "Updated introduction paragraph",
  format: "bullet"
})

// Review agent
vault_add_to_section({
  path: "project/daily-log.md",
  section: "Review Notes",  // Owned by this agent
  content: "Grammar check passed",
  format: "bullet"
})
```

**When to use:**
- Agents need to see each other's work in same file
- Clear separation of concerns
- Coordination note pattern

---

### Pattern 3: Append-Only Patterns

**Safest for concurrent writes to the same section.** Never read-modify-write; only append new content.

```
┌─────────────────┐     ┌─────────────────┐
│    Agent A      │     │    Agent B      │
│    14:30:01     │     │    14:30:02     │
└────────┬────────┘     └────────┬────────┘
         │                       │
         │  append "Entry A"     │
         ├───────────────────────┤
         │                       │  append "Entry B"
         │                       ├────────────────────
         ▼                       ▼
    ┌─────────────────────────────────┐
    │  ## Log                         │
    │  - **14:30** Entry A            │
    │  - **14:30** Entry B            │
    │  Both entries preserved!        │
    └─────────────────────────────────┘
```

**Why this works:**
- Both agents read the section
- Both agents append to end
- File writes are atomic (tmp -> rename in `writeVaultFile`)
- Rapid sequential writes tested up to 100+ operations (see `concurrency.test.ts`)

**Implementation:**

```javascript
// SAFE: Both agents append, both entries preserved
// Agent A
vault_add_to_section({
  path: "shared/log.md",
  section: "Activity",
  content: "Agent A completed task X",
  position: "append",  // Key: always append
  format: "timestamp-bullet"
})

// Agent B (milliseconds later)
vault_add_to_section({
  path: "shared/log.md",
  section: "Activity",
  content: "Agent B completed task Y",
  position: "append",  // Key: always append
  format: "timestamp-bullet"
})
```

**Dangerous anti-pattern:**

```javascript
// UNSAFE: Read-modify-write can lose data
const current = await flywheel.get_section_content({
  path: "shared/log.md",
  heading: "Activity"
})

// Agent B writes here while Agent A is processing

vault_replace_in_section({
  path: "shared/log.md",
  section: "Activity",
  search: current,  // Stale! Agent B's write is lost
  replacement: current + "\n- New entry"
})
```

---

## Git Conflict Resolution

### How Flywheel-Crank Handles Git Operations

Crank implements a **best-effort commit** strategy defined in `/packages/mcp-server/src/core/git.ts`:

1. **File mutations always succeed** - Content changes are never blocked
2. **Git commits are optional** - Pass `commit: true` to enable
3. **Lock contention is handled gracefully** - Retry with exponential backoff

```typescript
// From git.ts - Retry configuration for lock contention
const DEFAULT_RETRY: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 100,
  maxDelayMs: 500,
  jitter: true,  // Prevents thundering herd
};

const STALE_LOCK_THRESHOLD_MS = 30_000; // 30 seconds
```

### Success/Failure Semantics

| Scenario | `success` | `gitCommit` | `staleLockDetected` |
|----------|-----------|-------------|---------------------|
| Mutation + commit succeed | `true` | `"abc123..."` | - |
| Mutation succeeds, git lock contention | `true` | - | `true` (if >30s old) |
| Mutation fails | `false` | - | - |

**Key principle:** `success: true` means the file was mutated. Git lock status is reported via `staleLockDetected` and `lockAgeMs` fields.

### Automatic Conflict Detection

When git commit fails due to lock contention:

```javascript
// Response when another process holds .git/index.lock
{
  success: true,           // File WAS mutated
  message: "Added entry to Log section",
  path: "daily-notes/2026-01-31.md",
  gitCommit: undefined,    // No commit created
  staleLockDetected: true, // Lock older than 30s (if applicable)
  lockAgeMs: 45000         // Lock age in milliseconds
}
```

### Lock Detection Logic

From `git.ts`:

```typescript
async function checkLockFile(vaultPath: string): Promise<{ stale: boolean; ageMs: number } | null> {
  const lockPath = path.join(vaultPath, '.git/index.lock');
  try {
    const stat = await fs.stat(lockPath);
    const ageMs = Date.now() - stat.mtimeMs;
    return { stale: ageMs > STALE_LOCK_THRESHOLD_MS, ageMs };
  } catch {
    return null; // No lock exists
  }
}
```

**Stale lock detection:** If a lock file is older than 30 seconds, it's likely orphaned from a crashed process. The `staleLockDetected` flag alerts you to this condition.

**Note:** Git commit errors are not explicitly returned in a `gitError` field. Instead, check for the absence of `gitCommit` combined with `staleLockDetected: true` to detect lock contention issues.

### Recovery Strategies

**Strategy 1: Check git status and retry**

```javascript
const result = await vault_add_to_section({
  path: "notes/log.md",
  section: "Activity",
  content: "New entry",
  commit: true
});

if (result.success && !result.gitCommit) {
  console.log("Git commit failed, content was saved");
  if (result.staleLockDetected) {
    console.log(`Stale lock detected (${result.lockAgeMs}ms old)`);
  }

  // Option A: Accept uncommitted change
  // Option B: Retry commit later
  // Option C: Manual git add && git commit
}
```

**Strategy 2: Batch commits**

Instead of committing each mutation:

```javascript
// Make multiple mutations without committing
await vault_add_to_section({ ..., commit: false });
await vault_add_to_section({ ..., commit: false });
await vault_add_to_section({ ..., commit: false });

// Single commit at end (reduces lock contention)
await vault_add_to_section({ ..., commit: true });
```

**Strategy 3: Accept eventual consistency**

For high-frequency logging where git audit trail is nice-to-have:

```javascript
// Don't commit individual log entries
await vault_add_to_section({
  path: "logs/activity.md",
  section: "Stream",
  content: "Event happened",
  commit: false  // Skip git for high-frequency writes
});

// Periodic checkpoint commits (e.g., every 10 minutes)
```

### Safe Undo Verification

Crank tracks the last successful commit to prevent undoing unrelated changes:

```typescript
// From git.ts
export interface LastCrankCommit {
  hash: string;
  message: string;
  timestamp: string;
}

// Stored in: {vault}/.claude/flywheel.db (SQLite StateDb)
```

When `vault_undo_last_mutation` is called:
1. Checks if HEAD matches the tracked commit hash
2. Warns if another process committed after your mutation
3. Prevents accidentally undoing external commits
4. Clears tracking after successful undo

---

## Section-Level Locking Patterns

Crank does not provide built-in distributed locking. Instead, use conventions to establish agent ownership.

### Pattern 1: Frontmatter Agent Claims

```yaml
---
type: shared-note
agents:
  research: research-bot-v1
  writing: writing-bot-v1
  review: review-bot-v1
section_owners:
  "## Research": research-bot-v1
  "## Draft": writing-bot-v1
  "## Review Notes": review-bot-v1
last_modified_by: research-bot-v1
last_modified_at: 2026-01-31T14:30:00Z
---
```

**Verification before write:**

```javascript
// Agent checks if it owns the section before writing
const metadata = await flywheel.get_note_metadata({
  path: "shared/collaboration.md"
});

const owners = metadata.frontmatter.section_owners;
const mySection = "## Research";

if (owners[mySection] !== "research-bot-v1") {
  throw new Error(`Section ${mySection} not owned by this agent`);
}

// Safe to write
await vault_add_to_section({
  path: "shared/collaboration.md",
  section: "Research",
  content: "New finding...",
  commit: true
});

// Update last_modified metadata
await vault_update_frontmatter({
  path: "shared/collaboration.md",
  updates: {
    last_modified_by: "research-bot-v1",
    last_modified_at: new Date().toISOString()
  }
});
```

### Pattern 2: Comment Markers for Agent Ownership

```markdown
# Collaboration Note

## Research
<!-- OWNER: research-bot | LOCKED: false -->

- Finding 1
- Finding 2

## Draft
<!-- OWNER: writing-bot | LOCKED: true | LOCK_TIME: 2026-01-31T14:30:00Z -->

Content being actively edited...

## Review Notes
<!-- OWNER: review-bot | LOCKED: false -->

- Review comment 1
```

**Lock acquisition (convention-based):**

```javascript
// Read section to check lock status
const section = await flywheel.get_section_content({
  path: "shared/note.md",
  heading: "Draft"
});

// Parse lock status from comment
const lockMatch = section.match(/<!-- OWNER: (\S+) \| LOCKED: (\S+)/);
const owner = lockMatch[1];
const isLocked = lockMatch[2] === "true";

if (isLocked && owner !== "writing-bot") {
  throw new Error("Section is locked by another agent");
}

// Acquire lock by updating comment
await vault_replace_in_section({
  path: "shared/note.md",
  section: "Draft",
  search: /<!-- OWNER: \S+ \| LOCKED: \S+/,
  replacement: "<!-- OWNER: writing-bot | LOCKED: true | LOCK_TIME: " + new Date().toISOString(),
  useRegex: true
});

// ... do work ...

// Release lock
await vault_replace_in_section({
  path: "shared/note.md",
  section: "Draft",
  search: /<!-- OWNER: writing-bot \| LOCKED: true.*/,
  replacement: "<!-- OWNER: writing-bot | LOCKED: false -->",
  useRegex: true
});
```

**Note:** This is a **convention-based** soft lock. It prevents well-behaved agents from colliding but does not provide hard guarantees against race conditions.

### Pattern 3: Timestamp-Based Conflict Detection

```javascript
// Read note metadata before operation
const before = await flywheel.get_note_metadata({
  path: "shared/note.md"
});

// ... perform analysis work ...

// Check for external changes before writing
const after = await flywheel.get_note_metadata({
  path: "shared/note.md"
});

if (after.modified !== before.modified) {
  // File was changed externally
  console.log("Conflict detected - file modified by another process");
  // Option A: Re-read and retry
  // Option B: Append with conflict marker
  // Option C: Alert human
}

// Safe to write if no conflict
await vault_add_to_section({
  path: "shared/note.md",
  section: "Updates",
  content: "Analysis complete",
  commit: true
});
```

---

## Demo Scenario: 3-Agent Workflow

A complete example of three agents collaborating on a shared daily note.

### Setup: Create Shared Daily Note

```javascript
// Coordinator creates the daily note structure
vault_create_note({
  path: "collaboration/2026-01-31-project.md",
  frontmatter: {
    type: "multi-agent-collaboration",
    project: "API Documentation",
    created: "2026-01-31",
    agents: {
      research: "research-agent",
      writing: "writing-agent",
      review: "review-agent"
    }
  },
  content: `# API Documentation Project

## Research
<!-- Agent: research-agent | Status: active -->

## Draft
<!-- Agent: writing-agent | Status: waiting -->

## Review Notes
<!-- Agent: review-agent | Status: waiting -->

## Coordination
- Project started at 14:00
`
});
```

### Agent 1: Research Agent

Logs findings to the `## Research` section.

```javascript
// Research Agent workflow

// 1. Check coordination section for any blockers
const coordination = await flywheel.get_section_content({
  path: "collaboration/2026-01-31-project.md",
  heading: "Coordination"
});

// 2. Log research finding
await vault_add_to_section({
  path: "collaboration/2026-01-31-project.md",
  section: "Research",
  content: "Found that REST API uses OAuth 2.0 with JWT tokens",
  format: "timestamp-bullet",
  commit: true
});
// Result: - **14:15** Found that [[REST API]] uses [[OAuth 2.0]] with JWT tokens

// 3. Log another finding
await vault_add_to_section({
  path: "collaboration/2026-01-31-project.md",
  section: "Research",
  content: "Rate limit is 1000 requests/hour per API key",
  format: "timestamp-bullet",
  commit: true
});

// 4. Signal completion in coordination section
await vault_add_to_section({
  path: "collaboration/2026-01-31-project.md",
  section: "Coordination",
  content: "Research phase complete - Writing agent can proceed",
  format: "timestamp-bullet",
  commit: true
});

// 5. Update section status
await vault_replace_in_section({
  path: "collaboration/2026-01-31-project.md",
  section: "Research",
  search: "<!-- Agent: research-agent | Status: active -->",
  replacement: "<!-- Agent: research-agent | Status: complete -->"
});
```

### Agent 2: Writing Agent

Drafts content in the `## Draft` section based on research.

```javascript
// Writing Agent workflow

// 1. Wait for research signal (poll or event-driven)
const coordination = await flywheel.get_section_content({
  path: "collaboration/2026-01-31-project.md",
  heading: "Coordination"
});

if (!coordination.includes("Research phase complete")) {
  console.log("Waiting for research to complete...");
  return;
}

// 2. Read research findings
const research = await flywheel.get_section_content({
  path: "collaboration/2026-01-31-project.md",
  heading: "Research"
});

// 3. Update section status to active
await vault_replace_in_section({
  path: "collaboration/2026-01-31-project.md",
  section: "Draft",
  search: "<!-- Agent: writing-agent | Status: waiting -->",
  replacement: "<!-- Agent: writing-agent | Status: active -->"
});

// 4. Write draft content
await vault_add_to_section({
  path: "collaboration/2026-01-31-project.md",
  section: "Draft",
  content: `### Authentication

The API uses OAuth 2.0 with JWT tokens for authentication.
All requests must include a valid Bearer token in the Authorization header.

### Rate Limits

Clients are limited to 1000 requests per hour per API key.
Exceeding this limit returns HTTP 429 (Too Many Requests).`,
  format: "plain",
  commit: true
});

// 5. Signal completion
await vault_add_to_section({
  path: "collaboration/2026-01-31-project.md",
  section: "Coordination",
  content: "Draft complete - Review agent can proceed",
  format: "timestamp-bullet",
  commit: true
});

// 6. Update section status
await vault_replace_in_section({
  path: "collaboration/2026-01-31-project.md",
  section: "Draft",
  search: "<!-- Agent: writing-agent | Status: active -->",
  replacement: "<!-- Agent: writing-agent | Status: complete -->"
});
```

### Agent 3: Review Agent

Annotates in the `## Review Notes` section.

```javascript
// Review Agent workflow

// 1. Wait for draft signal
const coordination = await flywheel.get_section_content({
  path: "collaboration/2026-01-31-project.md",
  heading: "Coordination"
});

if (!coordination.includes("Draft complete")) {
  console.log("Waiting for draft to complete...");
  return;
}

// 2. Read draft content
const draft = await flywheel.get_section_content({
  path: "collaboration/2026-01-31-project.md",
  heading: "Draft"
});

// 3. Update section status to active
await vault_replace_in_section({
  path: "collaboration/2026-01-31-project.md",
  section: "Review Notes",
  search: "<!-- Agent: review-agent | Status: waiting -->",
  replacement: "<!-- Agent: review-agent | Status: active -->"
});

// 4. Add review comments as tasks
await vault_add_task({
  path: "collaboration/2026-01-31-project.md",
  section: "Review Notes",
  task: "Add code examples for authentication flow"
});

await vault_add_task({
  path: "collaboration/2026-01-31-project.md",
  section: "Review Notes",
  task: "Include error response examples for rate limiting"
});

await vault_add_to_section({
  path: "collaboration/2026-01-31-project.md",
  section: "Review Notes",
  content: "Overall: Good structure. Needs concrete examples.",
  format: "bullet",
  commit: true
});

// 5. Signal completion
await vault_add_to_section({
  path: "collaboration/2026-01-31-project.md",
  section: "Coordination",
  content: "Review complete - Ready for revision",
  format: "timestamp-bullet",
  commit: true
});
```

### Final Result

```markdown
---
type: multi-agent-collaboration
project: API Documentation
created: 2026-01-31
agents:
  research: research-agent
  writing: writing-agent
  review: review-agent
---

# API Documentation Project

## Research
<!-- Agent: research-agent | Status: complete -->

- **14:15** Found that [[REST API]] uses [[OAuth 2.0]] with JWT tokens
- **14:18** Rate limit is 1000 requests/hour per API key

## Draft
<!-- Agent: writing-agent | Status: complete -->

### Authentication

The API uses OAuth 2.0 with JWT tokens for authentication.
All requests must include a valid Bearer token in the Authorization header.

### Rate Limits

Clients are limited to 1000 requests per hour per API key.
Exceeding this limit returns HTTP 429 (Too Many Requests).

## Review Notes
<!-- Agent: review-agent | Status: active -->

- [ ] Add code examples for authentication flow
- [ ] Include error response examples for rate limiting
- Overall: Good structure. Needs concrete examples.

## Coordination
- Project started at 14:00
- **14:20** Research phase complete - Writing agent can proceed
- **14:35** Draft complete - Review agent can proceed
- **14:42** Review complete - Ready for revision
```

---

## Best Practices

### Communication Patterns Between Agents

| Pattern | Description | Use Case |
|---------|-------------|----------|
| **Coordination section** | Shared section for status updates | Sequential handoffs |
| **Status comments** | `<!-- Status: active/waiting/complete -->` | Quick status checks |
| **Frontmatter flags** | `status: in-progress` | Queryable state |
| **Separate status file** | `project-status.md` | Complex multi-file workflows |

**Recommendation:** Use a dedicated `## Coordination` section for multi-agent workflows. It provides:
- Clear audit trail of agent handoffs
- Timestamp-based ordering
- Human-readable progress tracking

### Error Handling for Concurrent Writes

```javascript
async function safeWrite(path, section, content, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await vault_add_to_section({
        path,
        section,
        content,
        format: "timestamp-bullet",
        commit: true
      });

      if (!result.gitCommit && result.staleLockDetected) {
        console.log(`Write succeeded but git commit failed (lock age: ${result.lockAgeMs}ms)`);
        // Content is saved, just not committed
      }

      return result;
    } catch (error) {
      if (attempt === maxRetries - 1) {
        throw error;
      }
      // Exponential backoff
      await new Promise(r => setTimeout(r, 100 * Math.pow(2, attempt)));
    }
  }
}
```

### When to Use Which Pattern

| Scenario | Recommended Pattern | Why |
|----------|---------------------|-----|
| Agents never overlap | File-level isolation | Simplest, safest |
| Agents work on same document | Section-level isolation | Clear ownership |
| High-frequency logging | Append-only | No read-modify-write races |
| Complex workflows | Coordination notes + section ownership | Explicit handoffs |
| Human + AI collaboration | Append-only + git commits | Full audit trail |

### Performance Considerations

Based on stress tests in `concurrency.test.ts` and `benchmarks.test.ts`:

| Operation | Tested Scale | Performance |
|-----------|--------------|-------------|
| Parallel mutations (different files) | 100 files | All succeed |
| Sequential mutations (same file) | 100 operations | No corruption |
| Rapid mutations | 50 operations | Stable performance |
| Large file mutations | 500+ entries | Tested (no strict timing) |
| Sustained load | 100 operations in batches | No degradation |
| 1000-line file mutation | 1 operation | <100ms |
| 10000-line file mutation | 1 operation | <500ms |

**Recommendations:**
- For high-frequency writes, batch commits (commit every N operations)
- For large files, prefer section-scoped operations over full-file reads
- For parallel agents, prefer different files when possible

### Git Commit Strategy

| Approach | Pros | Cons |
|----------|------|------|
| Commit every mutation | Full audit trail | Lock contention risk |
| Batch commits | Lower contention | Partial audit trail |
| No commits | Maximum throughput | No git history |

**Recommendation:** For multi-agent workflows, commit at handoff points rather than every operation:

```javascript
// Agent completes a phase of work
await vault_add_to_section({
  path: "shared/log.md",
  section: "Activity",
  content: "Phase 1 complete",
  commit: true  // Commit at milestone
});
```

---

## Summary

Multi-agent mutation with Flywheel-Crank is safe when patterns are followed:

1. **File isolation** - Different agents write to different files (safest)
2. **Section isolation** - Each agent owns dedicated sections
3. **Append-only** - Never read-modify-write; always append
4. **Coordination notes** - Explicit handoff signals between agents
5. **Git awareness** - Handle commit failures gracefully

The system provides operational safety (no file corruption) but not transactional guarantees across files. Design workflows accordingly.

---

## See Also

- [AGENT-MEMORY.md](AGENT-MEMORY.md) - Using Flywheel as persistent agent memory
- [tools-reference.md](tools-reference.md) - Complete tool documentation
- [testing.md](testing.md) - Test suite including concurrency tests
