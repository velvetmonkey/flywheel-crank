# Flywheel Crank

**Deterministic vault mutations for Obsidian via MCP - the write companion to Flywheel**

Flywheel Crank is an MCP server that provides surgical, predictable mutations for Obsidian vaults. While [Flywheel](https://github.com/velvetmonkey/flywheel) offers read-only graph intelligence, Crank enables safe write operations with auto-commit and undo support.

---

## The Eyes and Hands Architecture

Flywheel and Flywheel-Crank form a **complementary pair** for AI-assisted vault management:

```
┌─────────────────────────────────────────────────────────────┐
│                    Your Obsidian Vault                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Flywheel (Eyes)              Flywheel-Crank (Hands)       │
│   ════════════════             ══════════════════════       │
│   44 read-only tools           11 write tools               │
│                                                             │
│   • search_notes()             • vault_add_to_section()     │
│   • get_backlinks()            • vault_toggle_task()        │
│   • get_section_content()      • vault_update_frontmatter() │
│   • find_orphan_notes()        • vault_create_note()        │
│                                                             │
│   "See where to go"            "Touch what needs changing"  │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│   Claude Code Filesystem (Last Resort)                      │
│   ════════════════════════════════════                      │
│   Read/Edit/Write - direct file access when MCP can't help  │
└─────────────────────────────────────────────────────────────┘
```

**The Workflow:**
1. **Read** (Flywheel): Understand the current state
2. **Write** (Crank): Make surgical changes
3. **Verify** (Flywheel): Confirm the mutation

**Why This Layering?**
- MCP tools provide abstraction and safety between AI and filesystem
- Flywheel prevents reading entire 500-line files when 10 lines suffice
- Crank's section-scoped mutations prevent corruption
- Filesystem tools remain available for complex cases

---

## Your Vault as a Knowledge Graph

```
                        ┌─────────────────────────────────────────────────────┐
                        │              Your Vault (65 notes)                  │
                        │                        · · ·                        │
                        │    ·  Orphan  ·              ·  Orphan  ·           │
                        │         ↓                        ↓                  │
                        └─────────────────────────────────────────────────────┘
                                               │
                 ┌─────────────────────────────┼─────────────────────────────┐
                 │                             │                             │
                 ▼                             ▼                             ▼
    ┌────────────────────┐       ┌────────────────────┐       ┌────────────────────┐
    │   PDR Review       │──────▶│    Team Roster     │◀──────│  Year End Review   │
    │   ───────────      │       │    ───────────     │       │   ──────────────   │
    │   type: meeting    │       │   type: hub        │       │   type: meeting    │
    │   date: 2025-12-18 │       │   status: active   │       │   date: 2025-12-30 │
    │   attendees: [5]   │       │   owner: [[Sarah]] │       │   attendees: [8]   │
    └────────────────────┘       └────────────────────┘       └────────────────────┘
              │                     │    │    │    │                    │
              │          ┌──────────┘    │    │    └──────────┐        │
              │          ▼               ▼    ▼               ▼        │
              │   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐   │
              │   │ Sarah Chen   │ │ Marcus J.    │ │ Elena R.     │   │
              │   │ ──────────── │ │ ──────────── │ │ ──────────── │   │
              │   │ role: Lead   │ │ role: Prop.  │ │ role: Avion. │   │
              └──▶│ team: Core   │ │ team: Core   │ │ team: Core   │◀──┘
                  └──────────────┘ └──────────────┘ └──────────────┘
                         │                │                │
                         ▼                ▼                ▼
                  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
                  │ GNC System   │ │ Turbopump    │ │ Avionics     │
                  │ ──────────── │ │ ──────────── │ │ ──────────── │
                  │ status: test │ │ status: dev  │ │ status: done │
                  │ risk: medium │ │ risk: high   │ │ risk: low    │
                  └──────────────┘ └──────────────┘ └──────────────┘

Legend:  ─────▶ Wikilink (edge)     │ type: meeting │ Frontmatter (attributes)
         ◀───── Backlink            │ status: done  │ Queryable via Flywheel
```

**Notes are nodes. Wikilinks are edges. Frontmatter is queryable metadata.**

**Crank builds your graph as you write** — auto-linking entities, adding edges with every mutation.

---

## See It In Action

Real conversations with Claude using Flywheel-Crank:

### Auto-Wikilinks Building Your Graph

```
You: Log that I met with Sam Chen about Project Alpha

Claude: [uses vault_add_to_section]

Added to daily-notes/2026-01-29.md under ## Log:
  - 14:32 Met with [[Sam Chen]] about [[Project Alpha]]

Notice: Sam Chen and Project Alpha were auto-linked because they exist
as notes in your vault. Your graph now has new backlinks connecting
today's log to those entities.
```

### Predictable Task Formatting

```
You: Add a task to review the API docs

Claude: [uses vault_add_task]

Added to Projects/Turbopump.md under ## Tasks:
  - [ ] Review the API docs

Crank always uses Obsidian's task format (- [ ]) and places tasks
consistently. No reformatting surprises.
```

### Read-Write Separation

```
You: What tasks are on Project Alpha, and add one for the demo prep

Claude: [uses flywheel.get_section_content - READ]

Current tasks in ## Tasks:
- [ ] Finalize proposal
- [ ] Review contract terms

[uses crank.vault_add_task - WRITE]

Added:
- [ ] Prepare demo for [[Acme Corp]]

Flywheel reads the current state, Crank makes the surgical change.
Two MCP servers, clean separation.
```

### Git Integration and Undo

```
You: Log this decision but I want to be able to undo it

Claude: [uses vault_add_to_section with commit: true]

Added to decisions/2026-01-architecture.md under ## Decisions:
  - 14:45 Chose PostgreSQL over MongoDB for structured data needs

Committed: "crank: add to decisions/2026-01-architecture.md"

If you change your mind, use vault_undo_last_mutation to roll back.
```

### Section-Scoped Safety

```
You: Remove the line about the old deadline from my project notes

Claude: [uses vault_remove_from_section with pattern: "deadline"]

Removed from Projects/Turbopump.md under ## Timeline:
  - Original deadline: March 15 (removed)

Crank only touched the ## Timeline section. The rest of the file
(frontmatter, other sections) was untouched. Section-scoping prevents
accidental damage.
```

---

## Flywheel + Crank Together

Cross-tool workflows showing read + write coordination:

### Finding and Fixing Missing Frontmatter

```
You: Are any of my meeting notes missing required fields?

Claude: [uses flywheel.find_missing_frontmatter]

Found 3 meeting notes missing required fields:
- meetings/2026-01-15-kickoff.md - missing: attendees, decisions
- meetings/2026-01-22-sprint.md - missing: attendees
- meetings/2026-01-28-retro.md - missing: date

Want me to add the missing fields?

You: Yes, add empty attendees arrays to all of them

Claude: [uses crank.vault_add_frontmatter_field on each note]

Added to meetings/2026-01-15-kickoff.md:
  attendees: []

Added to meetings/2026-01-22-sprint.md:
  attendees: []

All meeting notes now have the attendees field. Fill them in when ready.
```

### Graph-Aware Content Updates

```
You: What notes link to the old API docs, and update them to point to v2

Claude: [uses flywheel.get_backlinks for "API Documentation"]

Found 8 notes linking to [[API Documentation]]:
- Projects/Turbopump.md
- onboarding/new-dev-setup.md
- ... (6 more)

[uses crank.vault_replace_in_section for each]

Updated 8 notes. All references now point to [[API Documentation v2]].
The old note's backlink count dropped from 8 to 0.
```

---

## Why Flywheel-Crank?

| Feature | What it means | Why it matters |
|---------|---------------|----------------|
| **Deterministic** | Same input → same output, always | No AI "creativity" corrupting your notes |
| **Auto-wikilinks** | Entities auto-linked on write | Edges in your graph build automatically |
| **Format consistency** | Obsidian conventions enforced | No reformatting surprises |
| **Read/write separation** | Flywheel reads, Crank writes | Clear mental model, safer operations |
| **Section-scoped** | Changes confined to target section | Rest of file untouched |
| **Git-integrated** | Optional commit per mutation | Full audit trail, easy undo |

---

## Guiding Claude to Use Git Integration

Crank supports git commits for every mutation, but Claude needs guidance on when to use them.

### Always Commit (add to your vault's CLAUDE.md)

```markdown
When using flywheel-crank tools, always pass `commit: true` to create
an undo point. This gives me a safety net for all vault mutations.
```

### Request Undo in Conversation

Say any of these and Claude will use `vault_undo_last_mutation`:

- "Undo that last change"
- "Roll back what you just did"
- "That was wrong, revert it"

### Per-Mutation Control

- "Add this task **with a commit**" → triggers `commit: true`
- "Just add it, **no commit needed**" → `commit: false` (default)

---

## Vault Setup for Auto-Wikilinks

Crank auto-links entities that exist as notes in your vault. Structure your vault to maximize linkability:

### Folder Conventions

| Folder pattern | Detected as | Examples |
|----------------|-------------|----------|
| `team/`, `people/` | People | Alex Rivera, Jordan Lee |
| `projects/`, `systems/` | Projects | Turbopump, Engine Design |
| `decisions/`, `adr/` | Decisions | ADR-001 |

### Note Naming

- **Use spaces**: `Sam Chen.md` not `sam-chen.md`
- **Be consistent**: "Project Alpha" everywhere, not "Project Alpha" and "Alpha Project"

### Graph-First vs Schema-First

- **Graph-first**: Focus on wikilinks, let connections emerge organically
- **Schema-first**: Focus on frontmatter, use for structured queries
- **Best approach**: Use both — wikilinks for connections, frontmatter for attributes

---

## Features

- **Surgical Mutations**: Add, remove, or replace content in specific sections
- **Task Management**: Toggle task checkboxes, add tasks with due dates
- **Frontmatter Operations**: Update YAML frontmatter fields atomically
- **Git Integration**: Auto-commit mutations with descriptive messages, undo support
- **Format Consistency**: Match Obsidian conventions (tasks, bullets, timestamps)
- **Path Safety**: Sandboxed operations prevent path traversal

---

## Why Section-Scoped Mutations?

Crank doesn't have a general "edit file" tool. This is **intentional**:

| General Edit | Section-Scoped |
|--------------|----------------|
| Unpredictable | Deterministic |
| Hard to undo | Auto-commit + undo |
| Risk of corruption | Safe boundaries |
| Requires full file read | Surgical precision |

**For arbitrary edits**, fall back to filesystem tools (`Read`/`Edit`/`Write`). Crank stays safe and reversible.

---

## Quick Start: The Read-Write-Verify Pattern

```javascript
// 1. READ: Understand current state (Flywheel)
const current = await flywheel.get_section_content({
  path: "daily-notes/2026-01-28.md",
  heading: "Log"
});

// 2. WRITE: Make surgical change (Crank)
const result = await crank.vault_add_to_section({
  path: "daily-notes/2026-01-28.md",
  section: "Log",
  content: "Completed the quarterly report",
  format: "timestamp-bullet"
});

// 3. VERIFY: Confirm mutation (Flywheel)
const updated = await flywheel.get_section_content({
  path: "daily-notes/2026-01-28.md",
  heading: "Log"
});
```

---

## Permission Model: Read-Broad, Write-Narrow

Flywheel and Flywheel-Crank implement a **security-conscious permission model** in Claude Code:

### How It Works

| Layer | Tool Count | Permission | Rationale |
|-------|------------|------------|-----------|
| **Flywheel** (read) | 44 tools | Pre-approved broadly | Read-only, cannot modify vault |
| **Flywheel-Crank** (write) | 11 tools | Approved per-tool | Mutations require conscious consent |

### Gradual Trust Model

Users approve Crank tools incrementally as they build trust:

**Example `.claude/settings.local.json`:**
```json
{
  "permissions": {
    "allow": [
      // Start conservative
      "mcp__flywheel-crank__vault_add_task",

      // Expand as you trust
      "mcp__flywheel-crank__vault_add_to_section",
      "mcp__flywheel-crank__vault_toggle_task"
    ]
  }
}
```

**Benefits:**
- **Safety**: Write operations require explicit approval
- **Discoverability**: Permission prompts teach available tools
- **Control**: Approve only the operations you need
- **Auditability**: Clear record of approved mutations
- **Git Safety**: Optional `commit: true` + `vault_undo_last_mutation` for rollback

---

## Installation

### NPM Package

```bash
npx @velvetmonkey/flywheel-crank
```

### Local Development

```bash
git clone https://github.com/velvetmonkey/flywheel-crank.git
cd flywheel-crank
npm install
npm run build
```

---

## Configuration

Add to your `.mcp.json` or Claude Code settings:

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

> **Windows Note:** Native Windows (non-WSL) requires the `cmd /c` wrapper:
> ```json
> "command": "cmd",
> "args": ["/c", "npx", "-y", "@velvetmonkey/flywheel-crank"]
> ```

### Configuration Options

#### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PROJECT_PATH` | Auto-detect | Path to Obsidian vault |

#### Tool Parameters

| Parameter | Tools | Default | Description |
|-----------|-------|---------|-------------|
| `commit` | All mutations | `false` | Git commit after mutation (creates undo point) |
| `skipWikilinks` | `vault_add_to_section`, `vault_replace_in_section`, `vault_add_task` | `false` | Disable auto-wikilinks for this call |

### Auto-Wikilinks (Enabled by Default)

Crank automatically links known entities in your content:

- **Entity index** built at startup from vault notes
- **Cached** in `.claude/wikilink-entities.json` (auto-refreshes if >1 hour old)
- **Auto-links** known entities (people, projects, technologies, acronyms)
- **Excludes** periodic folders: `daily-notes`, `weekly`, `templates`, `inbox`, etc.

**Example:**
```javascript
// Input: "Sam Chen needs help with Project Alpha"
// Output: "[[Sam Chen]] needs help with [[Project Alpha]]"
```

To disable for a specific call, use `skipWikilinks: true`

---

## Security: Deny Direct Writes

**Recommended:** Configure Claude Code to deny Write/Edit tools.

This forces ALL vault mutations through Flywheel-Crank, ensuring:
- ✓ Path validation (no traversal attacks)
- ✓ Frontmatter preservation
- ✓ Obsidian format compliance
- ✓ Git commit audit trail
- ✓ Undo support

```json
{
  "permissions": {
    "deny": ["Write(**)", "Edit(**)"],
    "allow": ["mcp__flywheel-crank__*"]
  }
}
```

See [docs/configuration.md](./docs/configuration.md) for complete settings examples.

---

## Tools

### Content Mutations
- `vault_add_to_section` - Add content to a specific section
- `vault_remove_from_section` - Remove content from a section
- `vault_replace_in_section` - Replace content in a section

### Task Management
- `vault_toggle_task` - Toggle task checkbox state
- `vault_add_task` - Add task with optional due date

### Frontmatter
- `vault_update_frontmatter` - Update YAML frontmatter fields
- `vault_add_frontmatter_field` - Add new frontmatter field

### Note Operations
- `vault_create_note` - Create new note with template
- `vault_delete_note` - Delete note with confirmation

### System
- `vault_list_sections` - List all sections in a note
- `vault_undo_last_mutation` - Undo last Crank operation

---

## Design Principles

1. **Deterministic**: Predictable, surgical operations (no AI heuristics)
2. **Safe**: Atomic writes, auto-commit, undo support
3. **Consistent**: Match Obsidian formatting conventions
4. **Focused**: Write operations only (read via Flywheel)

---

## Testing

**242 automated tests** across 10 test files covering all mutation operations.

```bash
# Run tests
npm run test

# Watch mode
npm run test:watch
```

**Comprehensive manual MCP testing documentation** covers:
- End-to-end tool validation
- Git commit behavior and safety
- Known issues and fixes

See [docs/testing.md](./docs/testing.md) for detailed test results.

---

## Development Status

✅ **Feature Complete** - All 11 mutation tools shipped with 242 tests

See [CLAUDE.md](./CLAUDE.md) for development guidelines.

---

## Documentation

- **[Configuration Guide](./docs/configuration.md)** - Environment variables, tool parameters, permission model
- **[Auto-Wikilinks](./docs/wikilinks.md)** - Entity inference, feedback loop, excluded folders
- **[Privacy Architecture](./docs/privacy.md)** - Data handling, token efficiency, Claude API caveat
- **[Tools Reference](./docs/tools-reference.md)** - Complete tool documentation with examples
- **[Testing](./docs/testing.md)** - Manual MCP testing procedures

---

## Related Projects

- [Flywheel](https://github.com/velvetmonkey/flywheel) - **The companion read-only MCP server** - 44 graph intelligence tools for navigating and analyzing your vault
- [Model Context Protocol](https://modelcontextprotocol.io/) - Open protocol for LLM tool integration

---

## License

AGPL-3.0 - See [LICENSE](./LICENSE) for details
