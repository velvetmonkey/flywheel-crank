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

## Terminology Glossary

| Term | Definition |
|------|------------|
| **Auto-wikilinks** | Exact text matches wrapped as `[[Entity]]` inline on write |
| **Contextual cloud** | Semantic suggestions appended as `→ [[...]]` suffix |
| **Policy** | YAML workflow definition stored in `.policies/` folder |
| **Mutation tool** | Low-level primitive (vault_add_to_section, etc.) |
| **Operational determinism** | Same input + same vault state → same output |
| **Flywheel loop** | Write → auto-wikilinks → reindex → smarter suggestions → repeat |

---

## Strategic Documents

**[RESEARCH/STRATEGIC_ANALYSIS_FLYWHEEL_CRANK.md](./RESEARCH/STRATEGIC_ANALYSIS_FLYWHEEL_CRANK.md)** - Comprehensive strategic analysis covering:
- Current product state and gaps
- Roadmap evaluation and priorities
- Competitive landscape and market opportunities
- 30/60/90 day execution plan
- GTM strategy and blind spots

Read this for deep context on product direction, market timing, and strategic priorities.

---

## Current State

**Shipped:**
- 22 MCP tools total:
  - 11 core mutation tools (add/remove/replace/toggle/create/delete)
  - 2 move/rename tools (with backlink updates)
  - 9 policy tools (workflow orchestration)
- Git integration (auto-commit + undo)
- Section-scoped operations (safe, reversible)
- Permission model (read-broad, write-narrow)
- 1465 automated tests (production hardened with edge cases, benchmarks, stress tests)
- Smart template handling (replace empty placeholders like `1. ` or `- `)
- Wikilink integration (auto-wikilinks on by default, opt-out via `skipWikilinks`)
- `@velvetmonkey/vault-core` shared package (entity scanning, protected zones, wikilink application)
- Performance benchmarks (1000-line file mutation <100ms, 10k entities <500ms)

**In Progress:**
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
Flywheel (read):     Pre-approved broadly (51 tools)
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
- `insertInSection(content, section, text, position, options?)` - Add content to section (supports `preserveListNesting`)
- `detectListIndentation(lines, insertIndex, sectionStart)` - Detect surrounding list indentation level
- `removeFromSection(content, section, pattern, mode, useRegex)` - Remove matching lines
- `replaceInSection(content, section, search, replacement, mode, useRegex)` - Replace content

### `git.ts` ✅

- `isGitRepo(vaultPath)` - Check if directory is a git repo
- `commitChange(vaultPath, filePath, messagePrefix)` - Commit a file change (tracks for safe undo)
- `getLastCommit(vaultPath)` - Get last commit info (hash, message, date, author)
- `undoLastCommit(vaultPath)` - Soft reset to HEAD~1
- `hasUncommittedChanges(vaultPath)` - Check for uncommitted changes
- `saveLastCrankCommit(vaultPath, hash, message)` - Track last Crank commit for safe undo
- `getLastCrankCommit(vaultPath)` - Get tracked Crank commit info
- `clearLastCrankCommit(vaultPath)` - Clear tracking after successful undo

---

## Git Strategy: Best-Effort Commits

### Design Philosophy
Crank treats git commits as **best-effort** - file mutations always succeed, even if git operations fail.

### Success/Failure Semantics

| Scenario | `success` | `gitCommit` | `gitError` |
|----------|-----------|-------------|------------|
| Mutation + commit succeed | `true` | `"abc123"` | - |
| Mutation succeeds, git fails | `true` | - | `"lock error..."` |
| Mutation fails | `false` | - | - |

**Key principle:** `success: true` means the file was mutated. Git status is separate.

### Lock Contention Handling
When multiple processes compete for `.git/index.lock`:
1. File mutation proceeds normally
2. Git commit fails with lock error
3. `gitError` field captures the failure
4. `success` remains `true` (file was changed)

### Undo Safety
`vault_undo_last_mutation` tracks the last successful Crank commit:
- Stores tracking in SQLite StateDb (`.claude/flywheel.db`)
- Only allows undo if HEAD matches the expected commit
- Prevents accidental undo of unrelated commits
- Warns if another process committed after your mutation
- Clears tracking after successful undo

### Why This Design?
- **Prioritizes data integrity** - your content changes are never blocked
- **Handles concurrent access** - multiple Claude instances can work safely
- **Graceful degradation** - git is optional, not required
- **Safe undo** - prevents undoing commits from other processes

---

## Testing

### Test Structure

```
test/
├── helpers/
│   └── testUtils.ts         # Temp vault creation, fixtures
├── core/
│   ├── wikilinks.test.ts    # 108 tests - wikilink processing, entity index, suggestions, quality filters
│   ├── writer.test.ts       # 88 tests - file operations, section parsing, edge cases
│   ├── stemmer.test.ts      # 33 tests - Porter stemmer implementation
│   ├── git.test.ts          # 10 tests - git operations
│   └── vaultRoot.test.ts    # 8 tests - vault detection
├── tools/
│   ├── mutations.test.ts    # 64 tests - add/remove/replace with error handling, battle-hardening
│   ├── tasks.test.ts        # 31 tests - toggle/add tasks with suggestions
│   ├── frontmatter.test.ts  # 14 tests - frontmatter ops
│   ├── notes.test.ts        # 14 tests - create/delete notes
│   ├── system.test.ts       # 13 tests - list sections, undo
│   └── git-integration.test.ts # 21 tests - git commit integration
├── golden/
│   └── goldenTests.test.ts  # 37 tests - format preservation, battle-hardening edge cases
├── performance/
│   └── benchmarks.test.ts   # 8 tests - performance baselines
├── stress/
│   └── concurrency.test.ts  # 8 tests - concurrent mutation safety
└── workflows/
    └── workflows.test.ts    # 15 tests - end-to-end workflow scenarios
```

**Total: 1465 tests**

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
| `vault_add_to_section` | Add content to a section with formatting options. `preserveListNesting=true` (default) respects existing list indentation. `suggestOutgoingLinks=true` (default) appends contextual wikilink suggestions. Now includes input validation (`validate`, `normalize`) and output guardrails (`guardrails`). Block-aware: preserves code blocks, tables, blockquotes without corrupting indentation. |
| `vault_remove_from_section` | Remove matching lines from a section |
| `vault_replace_in_section` | Replace content in a section. `suggestOutgoingLinks=true` (default) appends contextual wikilink suggestions. Includes validation and guardrails options. |

### Task Tools (`tasks.ts`)
| Tool | Description |
|------|-------------|
| `vault_toggle_task` | Toggle task checkbox (checked/unchecked) |
| `vault_add_task` | Add a new task to a section. `suggestOutgoingLinks=true` (default) appends contextual wikilink suggestions. Includes validation and guardrails options. |

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

## Known Limitations

### Heading Format
Only ATX-style headings (`# Title`) are supported. Setext-style headings (`Title\n===` or `Title\n---`) are not recognized for section operations.

### Files Without Headings
`vault_add_to_section`, `vault_remove_from_section`, and `vault_replace_in_section` require markdown headings to identify sections. For plain text files without section structure, use `vault_append_to_note` instead.

When attempting to use section tools on files without headings, you'll receive a helpful error:
```
Section 'Log' not found. This file has no headings. Use vault_append_to_note for files without section structure.
```

---

## Design Principles

### 1. Operational Determinism
- Same input + same vault state → same output
- Predictable execution paths, reproducible outcomes
- Surgical, atomic operations with clear success/failure
- NO: AI-driven edits, heuristic content generation, unpredictable reformatting
- **Note:** Vault changes (new notes, renamed entities) affect wikilink suggestions

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

### ✅ v1.27.28: Launch Readiness (COMPLETED)

**Security Testing Suite:**
- ✅ Injection attack tests (YAML, markdown, shell, template)
- ✅ Permission bypass tests (symlinks, TOCTOU, nested sensitive files)
- ✅ Boundary enforcement tests (Unicode, case sensitivity, deep nesting)
- ✅ Platform-specific tests (Windows long paths, WSL, UNC)
- ✅ Expanded SENSITIVE_PATH_PATTERNS (cloud credentials, package manager auth)

**Cross-Product Unified Logging:**
- ✅ Integrated vault-core OperationLogger into flywheel-crank
- ✅ Integrated vault-core OperationLogger into flywheel
- ✅ Session correlation across packages

**Benchmark Results Publication:**
- ✅ CI workflow generates markdown reports
- ✅ BENCHMARK_RESULTS.md auto-updated
- ✅ Benchmark badge in README

**Homepage Restructure:**
- ✅ PLATFORM.md (Eyes + Hands architecture)
- ✅ README updated with platform link and benchmark badge
- ✅ Cross-references between flywheel and flywheel-crank docs

### ✅ v1.27.31: Comprehensive Test Coverage (COMPLETED)

**Cross-Product Integration Tests (vault-core):**
- ✅ Full flywheel loop: scan → index → wikilinks → verify graph
- ✅ Legacy JSON to SQLite StateDb migration tests

**Demo Documentation Tests (flywheel):**
- ✅ MCP tool verification against demo vaults (artemis-rocket, carter-strategy)
- ✅ Demo vault structure and content validation

**Policy Execution Tests (flywheel-crank):**
- ✅ Fail-fast behavior, step order preservation
- ✅ Git commit atomicity, file consistency
- ✅ Multi-step workflow tests (10-step daily standup)

**Undo Sequence Tests (flywheel-crank):**
- ✅ Sequential undos, external commit detection
- ✅ Dirty working tree handling

**Cold Start Tests (flywheel-crank):**
- ✅ Empty vault, first note creation
- ✅ Auto-creation of .claude/.flywheel directories
- ✅ Non-git vault handling, permission errors

**Concurrent Mutation Tests (flywheel-crank):**
- ✅ Same-file race condition safety
- ✅ Last-write-wins semantics documentation

**Performance Tests (vault-core/bench):**
- ✅ 1k/5k vault benchmarks with time thresholds
- ✅ Memory scaling and leak detection tests

**CI Integration:**
- ✅ New npm scripts: test:e2e, test:demos, test:policy, test:undo, test:coldstart, test:concurrency
- ✅ CI workflows updated in all 3 repositories

### Current: Production Readiness
- `.flywheelrc` config file support (if needed)
- Architecture decision records

### Near-Term: Intelligent Linking

**✅ IMPLEMENTED: Suggested Outgoing Links (`suggestOutgoingLinks: boolean`):**

Mutation tools now support automatic wikilink suggestions:
- `suggestOutgoingLinks=true` (default) - appends contextual wikilinks
- Set `suggestOutgoingLinks=false` to disable
- Format: `→ [[Entity1]] [[Entity2]] [[Entity3]]`

**Implementation details:**
- Tokenizes content into significant words (4+ chars, excluding stopwords)
- Scores entities by word overlap with content
- Excludes entities already linked in content
- Default max 3 suggestions
- Idempotent (won't duplicate if suffix already present)

**Supported tools:**
- `vault_add_to_section` (logs, journal entries, reflections)
- `vault_replace_in_section` (content updates)
- `vault_add_task` (tasks with context links)
- Captures implicit context humans might forget
- Opt-in, doesn't change existing behavior
- Leverages existing vault intelligence

### Future: Aggregation Helper Tools (Investigation)

**Context:** Weekly rollup workflows require complex aggregation that current policy tools don't handle well. Need to investigate whether to add aggregation primitives or rely on hybrid agent approach.

**Potential Tools to Investigate:**
- `aggregate_section` - Combine same-named sections across multiple files
- `extract_pattern` - Regex extraction with statistics (e.g., weight tracking)
- `group_by_category` - Parse and categorize wikilink entries
- `extract_incomplete_tasks` - Pull uncompleted tasks from date range

**Questions to Answer:**
- Should these live in Flywheel (read) or Flywheel-Crank (write)?
- Can we keep them deterministic, or do they require LLM interpretation?
- Is the hybrid approach (policy orchestrates, agent aggregates) better?

**See Also:** Weekly rollup skill design discussion (Feb 2026)

### Future: Hybrid Orchestration

**Multi-Agent Convergence:**
- Agent debate → deterministic vote
- Confidence thresholds
- Tie-breaking strategies

**Dynamic Workflow Generation:**
- LLM-suggested workflows
- Template learning
- Risk assessment

**Workflow Primitives:**
- State tracking tools
- Atomic state transitions
- Conditional branching, rollback support

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

Apache-2.0
