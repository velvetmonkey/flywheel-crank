# Flywheel Crank - Claude Code Instructions

**Flywheel Crank** is the deterministic write companion to Flywheel MCP. While Flywheel provides read-only graph intelligence, Crank enables **surgical vault mutations** with optional git commits and undo.

---

## Vision: The Deterministic Layer

Flywheel-Crank is positioned to become the **deterministic execution layer** in the Flywheel ecosystem—the "Crank" that turns predictable, auditable, compliance-friendly workflows.

### The Strategic Insight

Modern agentic AI faces a fundamental tension:

| Stochastic Agents | Deterministic Systems |
|-------------------|----------------------|
| Creative, adaptive, handles uncertainty | Predictable, auditable, certifiable |
| Temperature > 0, exploration, multi-path reasoning | Greedy decoding, rule engines, state machines |
| **Great for:** Open-ended tasks, demos | **Required for:** Enterprise, compliance, safety-critical domains |
| **Problem:** Unreproducible, hard to debug, hallucination risk | **Problem:** Brittle, misses edge cases, gets stuck |

**The sweet spot:** Hybrid systems with **deterministic scaffolding + controlled LLM creativity at decision points**.

### Flywheel-Crank's Role

```
┌────────────────────────────────────────────────────────────────┐
│                    Enterprise Workflow Layer                   │
│                                                                │
│   Flywheel-Crank = Deterministic Workflow Engine               │
│   ═════════════════════════════════════════════                │
│   • Auditable state transitions                                │
│   • Predictable execution paths                                │
│   • SLA-able outcomes                                          │
│   • Compliance-friendly (reproducible, certifiable)            │
│                                                                │
├────────────────────────────────────────────────────────────────┤
│                    Intelligence Layer                          │
│                                                                │
│   Flywheel MCP = Smart Data Access                             │
│   ══════════════════════════════                               │
│   • Graph intelligence, semantic search                        │
│   • LLMs query/understand via MCP                              │
│   • Read-only, safe exploration                                │
│                                                                │
├────────────────────────────────────────────────────────────────┤
│                    Your Obsidian Vault                         │
└────────────────────────────────────────────────────────────────┘
```

**The architecture:**
- **Flywheel** = flexible graph intelligence (LLM-powered queries, understanding)
- **Flywheel-Crank** = deterministic workflow engine (predictable execution)
- **Together** = "80-90% of the magic with 10× more determinism"

---

## Current State

**Shipped:**
- 11 surgical mutation tools (add/remove/replace/toggle/create/delete)
- Git integration (auto-commit + undo)
- Section-scoped operations (safe, reversible)
- Permission model (read-broad, write-narrow)
- 242 automated tests
- Smart template handling (replace empty placeholders like `1. ` or `- `)
- Wikilink integration (auto-wikilinks on by default, opt-out via `skipWikilinks`)
- `@velvetmonkey/vault-core` shared package (entity scanning, protected zones, wikilink application)

**In Progress:**
- Phase 6: Production Readiness (optional hardening)
- Demo vault with examples
- Announcement (when ready)

---

## Behavioral Guidance for AI Contributors

### When Working on This Codebase

**ALWAYS:**
1. Read existing code before suggesting changes
2. Run tests before and after modifications (`npm test`)
3. Follow existing patterns (especially MutationResult return type)
4. Add tests for new functionality
5. Update CLAUDE.md when adding tools or changing architecture

**NEVER:**
- Add AI-driven heuristics (Crank is deterministic only)
- Duplicate Flywheel's graph intelligence (read from Flywheel, write with Crank)
- Skip type checking (`npm run lint`)
- Commit without running tests

### Common Development Workflows

#### Adding a New Tool

```
1. Read similar tool implementation (e.g., mutations.ts)
2. Add tool schema and handler to appropriate file
3. Write tests FIRST (TDD approach)
4. Implement tool logic
5. Run `npm test` to verify
6. Update Available Tools section in this file
7. Update docs/tools-reference.md
```

#### Debugging Tool Behavior

```
1. Read test file for the tool (e.g., mutations.test.ts)
2. Add failing test reproducing the issue
3. Fix implementation
4. Verify all tests pass
5. Document the fix if it changes behavior
```

#### Testing Integration with Flywheel

```
1. Use manual MCP testing (see docs/testing.md)
2. Create test vault with representative structure
3. Test read-before-write pattern:
   - Flywheel: get_section_content()
   - Crank: vault_add_to_section()
   - Flywheel: get_section_content() to verify
```

### Read-Before-Write Pattern (Development)

When modifying core utilities:

```
❌ WRONG:
  Edit writer.ts directly
  → Hope it doesn't break tests

✅ RIGHT:
  1. Read writer.test.ts
  2. Understand existing test coverage
  3. Add test for new behavior
  4. Modify writer.ts
  5. Run npm test
  6. All green? Commit
```

---

## Tool Permissions & Security Model

### Permission Philosophy

Flywheel-Crank implements a **permission-per-tool** security model in Claude Code:

**Read vs Write Separation:**
```
Flywheel (read):     Pre-approved broadly (57 tools)
                     ↓
                     Safe - cannot modify vault

Flywheel-Crank (write):  Each tool requires explicit approval
                         ↓
                         Conscious consent for mutations
```

### Gradual Permission Model

Users approve Crank tools one at a time as they trust them:

**Example `.claude/settings.local.json`:**
```json
{
  "permissions": {
    "allow": [
      // Start with just task addition
      "mcp__flywheel-crank__vault_add_task",

      // Later, add section mutations
      "mcp__flywheel-crank__vault_add_to_section",
      "mcp__flywheel-crank__vault_toggle_task",

      // Eventually, approve note operations
      "mcp__flywheel-crank__vault_create_note",
      "mcp__flywheel-crank__vault_update_frontmatter"
    ]
  }
}
```

### Why Per-Tool Approval?

**Safety:**
- Write operations modify vault state
- User maintains conscious control
- Can approve conservative subset initially
- Expand permissions as trust builds

**Discoverability:**
- User learns tools incrementally
- Permission prompts educate about capabilities
- Clear audit trail of approved operations

**Git Safety Net:**
- All mutations can use `commit: true`
- `vault_undo_last_mutation` provides rollback
- Permissioned tools + git = safe experimentation

### Integration with Flywheel

**The Read-Before-Write Pattern:**
```javascript
// 1. READ (Flywheel - pre-approved)
const metadata = await flywheel.get_note_metadata({ path });
const current = await flywheel.get_section_content({ path, heading: "Log" });

// 2. WRITE (Crank - requires approval prompt on first use)
const result = await crank.vault_add_to_section({
  path,
  section: "Log",
  content: "New entry",
  format: "timestamp-bullet"
});

// 3. VERIFY (Flywheel - pre-approved)
const updated = await flywheel.get_section_content({ path, heading: "Log" });
```

**Benefits:**
- Flywheel provides safe exploration
- Crank enables controlled mutations
- Permission model matches risk profile
- Users approve writes consciously

---

## Architecture

### Monorepo Structure

```
flywheel-crank/
├── package.json                 # Monorepo root (workspaces)
├── packages/
│   └── mcp-server/
│       ├── package.json         # @velvetmonkey/flywheel-crank
│       ├── tsconfig.json
│       ├── src/
│       │   ├── index.ts         # Entry point
│       │   ├── core/
│       │   │   ├── types.ts     # Type definitions
│       │   │   ├── constants.ts # Shared constants
│       │   │   ├── vaultRoot.ts # Auto-detect vault (from Flywheel)
│       │   │   ├── writer.ts    # File read/write, section operations
│       │   │   └── git.ts       # Git commit, undo, status
│       │   └── tools/
│       │       ├── mutations.ts # add/remove/replace in sections
│       │       ├── tasks.ts     # toggle/add tasks
│       │       ├── frontmatter.ts # update/add frontmatter
│       │       ├── notes.ts     # create/delete notes
│       │       └── system.ts    # list sections, undo
│       ├── test/
│       └── dist/                # Build output
└── docs/
```

---

## Tool Registration Pattern

Each tool module exports a `register*Tools()` function:

```typescript
export function registerMutationTools(
  server: McpServer,
  vaultPath: string
): void {
  server.tool('vault_add_to_section', schema, async (args) => {
    // 1. Validate path (security)
    // 2. Read file with frontmatter
    // 3. Find section
    // 4. Format and insert content
    // 5. Write file (preserving frontmatter)
    // 6. Return MutationResult
  });
}
```

**Key conventions:**
- Tool names: `vault_*` (consistent with Flywheel)
- All mutations return `MutationResult`
- Git commits are opt-in per call via `commit: true` parameter
- Paths are vault-relative (e.g., `daily-notes/2026-01-28.md`)

---

## Core Utilities

### `writer.ts` ✅

- `readVaultFile(vaultPath, notePath)` - Read file with frontmatter parsing
- `writeVaultFile(vaultPath, notePath, content, frontmatter)` - Write with frontmatter
- `validatePath(vaultPath, notePath)` - Prevent path traversal attacks
- `extractHeadings(content)` - Get all headings from markdown
- `findSection(content, heading)` - Find section boundaries (case-insensitive)
- `formatContent(text, format)` - Apply formatting (task, bullet, timestamp, etc.)
- `insertInSection(content, section, text, position)` - Add content to section
- `removeFromSection(content, section, pattern, mode, useRegex)` - Remove matching lines
- `replaceInSection(content, section, search, replacement, mode, useRegex)` - Replace content

### `git.ts` ✅

- `isGitRepo(vaultPath)` - Check if directory is a git repo
- `commitChange(vaultPath, filePath, messagePrefix)` - Commit a file change
- `getLastCommit(vaultPath)` - Get last commit info (hash, message, date, author)
- `undoLastCommit(vaultPath)` - Soft reset to HEAD~1
- `hasUncommittedChanges(vaultPath)` - Check for uncommitted changes

---

## Testing

### Test Structure

```
test/
├── helpers/
│   └── testUtils.ts         # Temp vault creation, fixtures
├── core/
│   ├── writer.test.ts       # 63 tests - file operations, section parsing
│   ├── git.test.ts          # 10 tests - git operations
│   └── vaultRoot.test.ts    # 8 tests - vault detection
└── tools/
    ├── mutations.test.ts    # 29 tests - add/remove/replace
    ├── tasks.test.ts        # 19 tests - toggle/add tasks
    ├── frontmatter.test.ts  # 14 tests - frontmatter ops
    ├── notes.test.ts        # 14 tests - create/delete notes
    └── system.test.ts       # 13 tests - list sections, undo
```

**Total: 242 tests**

**See [docs/testing.md](./docs/testing.md) for:**
- Manual MCP testing procedures
- Git commit behavior and safety
- Known issues and fixes

### Testing Patterns

**1. Temporary vault pattern:**
```typescript
const vault = await createTestVault({
  'daily-notes/2026-01-28.md': dailyNoteFixture,
});

const result = await tool('vault_add_to_section', {
  path: 'daily-notes/2026-01-28.md',
  section: '## Log',
  content: 'Test entry',
});

expect(result.success).toBe(true);
vault.cleanup();
```

**2. Section detection tests:**
- Exact match: `## Log` → `## Log`
- Case-insensitive: `## log` → `## Log`
- Fuzzy: `## Food Log` → `## Food`
- Markdown tolerance: `##Log` (missing space)

**3. Format tests:**
- Task: `- [ ] Do thing`
- Bullet: `- Item`
- Numbered: `1. Item`
- Timestamp-bullet: `- 13:45 Item`
- Plain: `Item`

---

## Build & Development

```bash
# Build
npm run build

# Watch mode
npm run dev

# Type check
npm run lint

# Test
npm run test
npm run test:watch
```

---

## MCP Configuration

**Local development:**
```json
{
  "mcpServers": {
    "flywheel-crank": {
      "command": "node",
      "args": ["/path/to/flywheel-crank/packages/mcp-server/dist/index.js"],
      "env": {
        "PROJECT_PATH": "/path/to/vault"
      }
    }
  }
}
```

**NPM package:**
```json
{
  "mcpServers": {
    "flywheel-crank": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-crank"],
      "env": {
        "PROJECT_PATH": "/path/to/vault"
      }
    }
  }
}
```

> **Note**: Windows native requires `"command": "cmd", "args": ["/c", "npx", "-y", "@velvetmonkey/flywheel-crank"]`

---

## Available Tools

### Mutation Tools (`mutations.ts`)
| Tool | Description |
|------|-------------|
| `vault_add_to_section` | Add content to a section with formatting options |
| `vault_remove_from_section` | Remove matching lines from a section |
| `vault_replace_in_section` | Replace content in a section |

### Task Tools (`tasks.ts`)
| Tool | Description |
|------|-------------|
| `vault_toggle_task` | Toggle task checkbox (checked/unchecked) |
| `vault_add_task` | Add a new task to a section |

### Frontmatter Tools (`frontmatter.ts`)
| Tool | Description |
|------|-------------|
| `vault_update_frontmatter` | Update/merge frontmatter fields |
| `vault_add_frontmatter_field` | Add new field (fails if exists) |

### Note Tools (`notes.ts`)
| Tool | Description |
|------|-------------|
| `vault_create_note` | Create a new note with frontmatter |
| `vault_delete_note` | Delete a note (requires confirmation) |

### System Tools (`system.ts`)
| Tool | Description |
|------|-------------|
| `vault_list_sections` | List all headings in a note |
| `vault_undo_last_mutation` | Undo last git commit (soft reset) |

---

## Design Principles

### 1. Determinism First
- Predictable execution paths, reproducible outcomes
- Surgical, atomic operations with clear success/failure
- NO: AI-driven edits, heuristic content generation, unpredictable reformatting

### 2. Auditability Always
- Full trace of all state transitions
- Git commit on every mutation (opt-in)
- Execution logs (stderr, not visible to LLM)

### 3. Graph + Crank Separation
- **Flywheel (read):** Graph queries, backlinks, search
- **Crank (write):** Content mutations, task toggles, frontmatter
- **Never mix responsibilities.** Crank tools should NOT re-implement Flywheel's graph intelligence.

### 4. Fail Safely
- Atomic writes (tmp → rename)
- Undo support via `vault_undo_last_mutation`
- Path sandboxing (no `../` escapes)
- Rollback support, validation gates, human escalation

### 5. Strategic LLM Use
- Use AI for understanding/decision points, not execution
- LLMs understand intent, suggest paths, validate outcomes
- Execution happens via deterministic engine (no prompt-driven mutations)

### 6. Format Consistency
Match Obsidian conventions:
- Tasks: `- [ ]` not `* [ ]`
- Headings: Space after `#` required
- Wikilinks: `[[Note]]` not `[Note](note.md)`

### 7. Blueprint-Driven
- Workflows as code/config, not prompt-driven chaos
- Declarative config (JSON/YAML) with code escape hatches
- Config is more auditable/versioned, code provides power when needed

---

## Security Best Practice: Deny Direct Writes

**IMPORTANT:** Explicitly deny Write/Edit permissions in `.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "Read(**/*.md)",
      "Glob",
      "Grep",
      "Bash(git:*)"
    ],
    "deny": [
      "Write(**)",
      "Edit(**)",
      "Read(.obsidian/**)",
      "Edit(.obsidian/**)",
      "Write(.obsidian/**)",
      "Read(.git/**)",
      "Edit(.git/**)",
      "Write(.git/**)"
    ]
  }
}
```

**Why this matters:**

| Without Deny | With Deny |
|--------------|-----------|
| Claude Code can write files directly | ALL mutations forced through flywheel-crank MCP |
| Bypasses validation, git integration, safety | Every mutation follows same validation path |
| Inconsistent formatting | Consistent formatting and structure |
| No audit trail | Git commit on every mutation |
| Ad-hoc changes possible | Deterministic, predictable writes |

**Result:** Only flywheel-crank can mutate vault → predictable, safe, auditable.

---

## Roadmap

### Phase 1: Core Mutations ✅
- ✅ Project scaffold
- ✅ `vault_add_to_section` - Add content to a section (plain, bullet, task, numbered, timestamp)
- ✅ `vault_remove_from_section` - Remove matching lines (first/last/all, regex support)
- ✅ `vault_replace_in_section` - Replace content (first/last/all, regex support)

### Phase 2: Tasks & Frontmatter ✅
- ✅ `vault_toggle_task` - Toggle checkbox between [ ] and [x]
- ✅ `vault_add_task` - Add new task to section (append/prepend, completed option)
- ✅ `vault_update_frontmatter` - Merge updates into existing frontmatter
- ✅ `vault_add_frontmatter_field` - Add new field (fails if exists)

### Phase 3: Notes & System ✅
- ✅ `vault_create_note` - Create note with frontmatter and content
- ✅ `vault_delete_note` - Delete note (requires confirmation)
- ✅ `vault_list_sections` - List headings with level filtering
- ✅ `vault_undo_last_mutation` - Soft reset last git commit

### Phase 4: Git Integration ✅
- ✅ Git utilities implemented (commit, undo, status checks)
- ✅ Per-call `commit` parameter (opt-in, replaces AUTO_COMMIT env var)
- ⏳ Commit message templating

### Phase 5: Auto-Wikilinks ✅
**Feature:** Auto-enhance content with wikilinks during mutations

**Implementation:**
- Entity index built at startup from `@velvetmonkey/vault-core`
- Cached in `.claude/wikilink-entities.json` (auto-refreshes if >1 hour old)
- Auto-links known entities (people, projects, technologies, acronyms)
- Excludes periodic folders: `daily-notes`, `weekly`, `templates`, `inbox`, etc.
- Enabled by default on mutation tools
- Disable per-call with `skipWikilinks: true` parameter

**Tools with wikilink support:**
- `vault_add_to_section` - applies to content
- `vault_replace_in_section` - applies to replacement text
- `vault_add_task` - applies to task text

**Example:**
```javascript
vault_add_to_section({
  section: "Log",
  content: "Sam Chen needs help with Project Alpha"
})
// Becomes: "- 14:12 [[Sam Chen]] needs help with [[Project Alpha]]"

vault_add_task({
  section: "Tasks",
  task: "Review MCP Server changes",
  skipWikilinks: true  // Disable for this call
})
// Becomes: "- [ ] Review MCP Server changes" (no auto-linking)
```

**Architecture:** Shared `@velvetmonkey/vaultcheck-core` library provides entity scanning used by both Flywheel and Crank

### Phase 6: Production Readiness (Optional)
**Goal:** Harden for production use. Core functionality is complete - these are nice-to-have improvements.

**Testing:**
- [x] 242 tests passing
- [x] Wikilink tests added
- [ ] Edge case tests (empty content, special chars)
- [ ] Performance benchmarks

**Configuration:**
- [x] Document all env vars (`docs/configuration.md`)
- [ ] `.flywheelrc` config file support (if needed)

**Documentation:**
- [x] Complete tools reference with wikilink params
- [x] Configuration guide (`docs/configuration.md`)
- [x] Wikilinks guide (`docs/wikilinks.md`)
- [x] Privacy guide (`docs/privacy.md`)
- [x] Sanitize personal information from docs
- [ ] Example workflows
- [ ] Architecture decision records

### Phase 7: Publishing ✅
- [x] npm package (`@velvetmonkey/flywheel-crank`) - v0.3.0 published
- [x] Documentation (`docs/tools-reference.md`)
- [x] Integration examples (in README)
- [ ] Create demo vault with examples
- [ ] Announce in GitHub README, MCP Discord, r/ObsidianMD

### Phase 8: MCP Tool Consolidation (Q4 2026)
**Goal:** Optimize MCP tool design for token efficiency and reduced cognitive load.

**The Problem:**
Flywheel MCP exposes 44+ granular tools that consume 15-20% of the context window before any actual work begins. This creates token waste, decision paralysis, and cognitive overhead.

**The Solution: Workflow-Based Tool Design**
Instead of exposing every internal function as a separate tool, consolidate around **user workflows** with rich parameter schemas.

**Immediate Implementation Approaches:**
1. **Config-Based Filtering** - Add `tools.enabled` array to selectively expose tools
2. **Environment Variable Control** - `FLYWHEEL_TOOLS=tasks,search,health`
3. **Tool Categorization** - Core, Graph, Health, Advanced categories
4. **Workflow Consolidation** - Merge granular tools (e.g., 5 task tools → 1 `manage_tasks` tool)

**Implementation Strategy:**
- Phase 8a: Audit all tools, group by workflow, identify consolidation opportunities
- Phase 8b: Prototype 3-5 consolidated workflow tools, A/B test with Claude Code
- Phase 8c: Deprecation strategy, backward compatibility, documentation update

**Success Metrics:**
- Token efficiency: <5% context consumed by tool definitions (down from 15-20%)
- Decision quality: Equivalent or better task success rate vs granular tools
- User satisfaction: Positive feedback on workflow ergonomics

### Backlog: Hybrid Orchestration (Future)
**Goal:** Balance deterministic scaffolding with strategic LLM creativity.

**Multi-Agent Convergence:**
- Agent debate → deterministic vote (explore stochastically, decide deterministically)
- Confidence thresholds (require N agents to agree before executing)
- Tie-breaking strategies (deterministic fallback rules)

**Dynamic Workflow Generation:**
- LLM-suggested workflows (generate blueprint, validate, execute)
- Template learning (extract patterns from successful executions)
- Risk assessment (flag high-risk steps for human review)

**Workflow Primitives (Future):**
- State tracking tools (read/write workflow state)
- Atomic state transitions (CAS-style updates)
- Conditional branching, sequential execution, rollback support
- Post-mutation verification, external truth sources

---

## Contributing

**Before implementing new tools:**

1. Check if Flywheel already provides read-only access
2. Verify tool fits Crank's mutation-only scope
3. Add tests BEFORE implementation
4. Follow `MutationResult` return type
5. Document in `docs/tools-reference.md`

**Code style:**
- TypeScript strict mode
- ESM modules only
- No default exports
- Explicit error handling

---

## License

AGPL-3.0 (same as Flywheel)
