# Using Flywheel as Agent Memory

This guide explains how to use Flywheel + Crank as a persistent memory layer for AI coding assistants like Claude Code. Instead of losing context between sessions, your vault becomes the agent's long-term memory.

---

## Table of Contents

1. [The Problem: Session Amnesia](#the-problem-session-amnesia)
2. [The Solution: Vault as Memory](#the-solution-vault-as-memory)
3. [Setup Guide](#setup-guide)
4. [Memory Patterns](#memory-patterns)
5. [CLAUDE.md Integration](#claudemd-integration)
6. [Token Efficiency](#token-efficiency)
7. [Advanced: Multi-Agent Memory](#advanced-multi-agent-memory)

---

## The Problem: Session Amnesia

Every AI coding assistant shares a frustrating limitation: **they forget everything between sessions**.

**Common pain points:**
- "I explained this architecture yesterday..."
- "We already decided to use PostgreSQL..."
- "What were those edge cases we discussed?"
- Re-explaining context wastes tokens and time

**Why this happens:**
- Context windows are session-scoped
- Conversation history doesn't persist
- Even with long context (200K tokens), there's no prioritization
- Important decisions get buried in conversation noise

---

## The Solution: Vault as Memory

Flywheel transforms your Obsidian vault into **persistent, structured agent memory**:

```
┌────────────────────────────────────────────────────────────┐
│                    Session 1                               │
│  You: "Let's use PostgreSQL for this project"              │
│  Agent: Writes to vault via Crank                          │
│         → project-notes/decisions.md                       │
│         → "## Decisions" section                           │
│         → "Database: PostgreSQL (chosen for JSON support)" │
└────────────────────────────────────────────────────────────┘
                          ↓
                   [Session ends]
                          ↓
┌────────────────────────────────────────────────────────────┐
│                    Session 2                               │
│  You: "Add the user table"                                 │
│  Agent: Queries vault via Flywheel                         │
│         → Sees PostgreSQL decision                         │
│         → Generates PostgreSQL-specific migration          │
└────────────────────────────────────────────────────────────┘
```

**Key benefits:**
- Decisions persist across sessions
- Context is structured and queryable
- No token overhead for re-explaining
- Audit trail via git commits
- Self-building knowledge graph

---

## Setup Guide

### Step 1: Configure MCP Servers

Add both Flywheel (read) and Flywheel-Crank (write) to your Claude Code config:

**~/.claude/settings.json:**
```json
{
  "mcpServers": {
    "flywheel": {
      "command": "npx",
      "args": ["-y", "@anthropic-community/flywheel"],
      "env": {
        "PROJECT_PATH": "/path/to/your/vault"
      }
    },
    "flywheel-crank": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-crank"],
      "env": {
        "PROJECT_PATH": "/path/to/your/vault"
      }
    }
  }
}
```

### Step 2: Create Memory Structure

Create a project memory note in your vault:

**project-notes/project-memory.md:**
```markdown
---
type: project-memory
project: my-app
created: 2026-01-30
---

# My App - Project Memory

## Architecture Decisions

## Tech Stack

## Key Learnings

## Open Questions

## Session Log
```

### Step 3: Pre-Approve Memory Tools

For seamless operation, pre-approve the memory tools:

**.claude/settings.local.json:**
```json
{
  "permissions": {
    "allow": [
      "mcp__flywheel__*",
      "mcp__flywheel-crank__vault_add_to_section",
      "mcp__flywheel-crank__vault_update_frontmatter"
    ]
  }
}
```

---

## Memory Patterns

### Pattern 1: Decision Logging

When making architectural decisions, log them to your memory note:

**User:**
> "Let's use Redis for caching"

**Agent action:**
```javascript
vault_add_to_section({
  path: "project-notes/project-memory.md",
  section: "Architecture Decisions",
  content: "Caching: Redis - chosen for pub/sub support and atomic operations",
  format: "timestamp-bullet",
  commit: true
})
```

**Result in vault:**
```markdown
## Architecture Decisions

- 14:30 Caching: [[Redis]] - chosen for pub/sub support and atomic operations → [[Caching]] [[Architecture]]
```

### Pattern 2: Context Retrieval

At the start of a new session, query for relevant context:

**Agent internal action:**
```javascript
// Get project decisions
flywheel.get_section_content({
  path: "project-notes/project-memory.md",
  heading: "Architecture Decisions"
})

// Get related notes via backlinks
flywheel.query_backlinks({
  note: "project-notes/project-memory.md"
})
```

**Agent now has:**
- All past decisions
- Related notes and context
- Entity relationships

### Pattern 3: Learning Capture

When you discover something important, capture it:

**User:**
> "Oh, that's why the tests were flaky - the database wasn't being reset"

**Agent action:**
```javascript
vault_add_to_section({
  path: "project-notes/project-memory.md",
  section: "Key Learnings",
  content: "Test flakiness: Always reset database state in beforeEach, not afterEach",
  format: "bullet",
  commit: true
})
```

### Pattern 4: Question Tracking

Track open questions for future sessions:

**User:**
> "I'm not sure if we need GraphQL or REST"

**Agent action:**
```javascript
vault_add_to_section({
  path: "project-notes/project-memory.md",
  section: "Open Questions",
  content: "API style: GraphQL vs REST - need to evaluate team familiarity",
  format: "task",
  commit: true
})
```

**Result:**
```markdown
## Open Questions

- [ ] API style: [[GraphQL]] vs [[REST]] - need to evaluate team familiarity
```

---

## CLAUDE.md Integration

Enhance your project's CLAUDE.md to auto-load context:

**CLAUDE.md:**
```markdown
# Project: My App

## Memory Integration

This project uses Flywheel for persistent memory. At the start of each session:

1. Read project memory: `project-notes/project-memory.md`
2. Note architecture decisions before suggesting changes
3. Check "Open Questions" for unresolved decisions
4. Log significant decisions to the memory note

## Current Architecture

- **Database:** PostgreSQL (see Architecture Decisions)
- **Cache:** Redis (see Architecture Decisions)
- **API:** TBD (see Open Questions)

## Memory Commands

When I say "remember this", add to Key Learnings section.
When I say "we decided", add to Architecture Decisions section.
When I say "question", add to Open Questions section.
```

This primes the agent to:
- Check the memory note at session start
- Respect past decisions
- Log new decisions appropriately

---

## Token Efficiency

### The Memory Tax Problem

**Without Flywheel:**
- Session 1: Explain context (5,000 tokens)
- Session 2: Re-explain context (5,000 tokens)
- Session 3: Re-explain context (5,000 tokens)
- Total: 15,000+ tokens on repeated context

**With Flywheel:**
- Session 1: Explain once, write to vault (1,000 tokens)
- Session 2: Query vault (200 tokens)
- Session 3: Query vault (200 tokens)
- Total: 1,400 tokens

**Savings: 90%+**

### Why Vault Memory is Efficient

| Approach | Tokens | Problem |
|----------|--------|---------|
| Re-explaining every session | 5,000+/session | Wasteful, inconsistent |
| Pasting previous transcript | 10,000+ | Token explosion |
| Context file in project | 2,000+ | Full file loaded |
| Flywheel query | 200-500 | Returns only relevant data |

### The 200K Threshold

Claude's pricing doubles above 200K tokens. Memory-efficient sessions stay under:

- 50 operations with full-file approach: ~200K tokens (hits threshold)
- 50 operations with Flywheel: ~20K tokens (safely under)

---

## Advanced: Multi-Agent Memory

When multiple agents work on the same project, the vault becomes shared memory:

### Pattern: Agent Handoff

```
┌────────────────────────────────────────────────────────────┐
│  Agent 1 (Research)                                        │
│  Writes: "Found that React 19 supports server components"  │
│  → vault: project-notes/research.md                        │
└────────────────────────────────────────────────────────────┘
                          ↓
┌────────────────────────────────────────────────────────────┐
│  Agent 2 (Implementation)                                  │
│  Reads: project-notes/research.md                          │
│  → Implements based on research findings                   │
└────────────────────────────────────────────────────────────┘
```

### Pattern: Agent Coordination Notes

Create a coordination note for multi-agent workflows:

**project-notes/agent-coordination.md:**
```markdown
---
type: agent-coordination
---

# Agent Coordination

## In Progress

## Completed Today

## Blocked

## Notes for Other Agents
```

Agents can:
- Check "In Progress" before starting work
- Mark tasks complete in "Completed Today"
- Flag blockers for human attention
- Leave notes for subsequent agents

---

## Multi-Agent Safety & Collision Handling

When multiple agents (or multiple Claude Code sessions) access the same vault concurrently, collisions can occur. This section explains what Crank handles and what it doesn't.

### The Collision Problem

```
┌─────────────────┐     ┌─────────────────┐
│   Agent A       │     │   Agent B       │
│   (Session 1)   │     │   (Session 2)   │
└────────┬────────┘     └────────┬────────┘
         │                       │
         │  read daily-note.md   │
         ├───────────────────────┤
         │                       │  read daily-note.md
         │                       ├───────────────────
         │  write Log entry 1    │
         ├───────────────────────┤
         │                       │  write Log entry 2
         │                       ├────────────────────
         ▼                       ▼
    ┌─────────────────────────────────┐
    │  daily-note.md                  │
    │  Which write wins? Both? One?   │
    └─────────────────────────────────┘
```

### What Crank DOES Handle

| Scenario | Crank's Behavior | Safety Level |
|----------|------------------|--------------|
| **Concurrent writes to different sections** | Both succeed | Safe |
| **Concurrent writes to same section** | Both succeed (append semantics) | Safe |
| **Git lock contention** | Mutation succeeds, git commit fails gracefully | Safe (file written) |
| **Rapid sequential writes** | All succeed, no file corruption | Safe |

**Best-effort commits:** If git is locked by another process, the file mutation still succeeds. The `gitError` field in the response indicates the commit failed.

```javascript
// Response when git lock is held
{
  success: true,        // File was mutated
  message: "Added to Log section",
  gitCommit: undefined, // No commit created
  gitError: "Could not obtain lock on .git/index.lock"
}
```

**Commit tracking for safe undo:** Crank tracks the last commit it created in `.claude/last-crank-commit.json`. When you call `vault_undo_last_mutation`:
- It checks if HEAD matches the expected commit
- Warns if another process committed after your mutation
- Prevents accidentally undoing external commits

### What Crank Does NOT Handle

| Scenario | What Happens | Mitigation |
|----------|--------------|------------|
| **Cross-file transactions** | No atomicity across files | Design workflows to be single-file when possible |
| **Merge conflicts** | Can occur if both agents modify same lines | Use different sections per agent |
| **Semantic conflicts** | Agent A archives what Agent B expects to read | Coordination notes (see above) |
| **Read-modify-write races** | Agent A reads, Agent B writes, Agent A writes stale data | Use append-only patterns |

### Recommended Patterns

| Pattern | Description | Use Case |
|---------|-------------|----------|
| **Section-per-agent** | Each agent writes to its own dedicated section | Parallel work on same file |
| **Append-only** | Never read-modify-write; only add new content | Logs, journals, queues |
| **Sequential handoffs** | Agent A completes, Agent B starts | Complex workflows |
| **Coordination notes** | Explicit "In Progress" tracking | Avoiding duplicate work |

**Section-per-agent example:**
```markdown
## Agent-Research
<!-- Research agent writes here -->

## Agent-Implementation
<!-- Implementation agent writes here -->

## Agent-Review
<!-- Review agent writes here -->
```

**Append-only pattern:**
```javascript
// Safe: always appends, never reads first
vault_add_to_section({
  path: "daily-notes/2026-01-31.md",
  section: "Log",
  content: "Agent A: Completed task X",
  position: "end"  // Append semantics
})
```

### Detecting External Changes

To detect if another process modified a file between your read and write:

```javascript
// 1. Read content with metadata
const before = await flywheel.get_note_metadata({ path: "note.md" });

// 2. Do your work...

// 3. Check before writing
const after = await flywheel.get_note_metadata({ path: "note.md" });
if (after.modified !== before.modified) {
  // File was changed externally - handle appropriately
}
```

### Summary

Crank provides **operational safety** (mutations don't corrupt files, git failures don't block work) but not **transactional safety** (no ACID guarantees across files or between read and write). Design your multi-agent workflows accordingly:

1. Prefer append-only operations
2. Use dedicated sections per agent
3. Use coordination notes for complex workflows
4. Check for external changes when order matters

---

## Troubleshooting

### "Agent doesn't check memory"

Add explicit instruction to CLAUDE.md:
```markdown
IMPORTANT: Before making architecture decisions, query the project memory:
`flywheel.get_section_content({ path: "project-notes/project-memory.md", heading: "Architecture Decisions" })`
```

### "Memory note getting too long"

Archive old entries:
```javascript
vault_replace_in_section({
  path: "project-notes/project-memory.md",
  section: "Session Log",
  search: ".*January 2026.*",
  replacement: "",
  useRegex: true
})
```

Or create monthly archive notes.

### "Want more automatic memory"

Consider creating a custom MCP skill that:
1. Auto-queries memory at session start
2. Auto-logs decisions when certain keywords are used
3. Summarizes session into memory at end

---

## Best Practices

1. **Structure your memory note** - Use clear sections (Decisions, Learnings, Questions)
2. **Use wikilinks** - Let Crank auto-link entities for graph connectivity
3. **Commit changes** - Use `commit: true` for audit trail
4. **Query before suggesting** - Check past decisions before proposing new ones
5. **Archive periodically** - Keep active memory note focused
6. **Trust the vault** - Memory is versioned, you can always roll back

---

## See Also

- [COMPARISON.md](COMPARISON.md) - Flywheel vs alternatives
- [tools-reference.md](tools-reference.md) - Complete tool documentation
- [wikilinks.md](wikilinks.md) - Auto-linking explained
- [MIGRATION.md](MIGRATION.md) - Transitioning from Edit tool
