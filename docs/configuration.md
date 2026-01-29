# Flywheel Crank - Configuration Reference

Complete configuration documentation for Flywheel and Flywheel-Crank MCP servers.

---

## Table of Contents

- [MCP Server Configuration](#mcp-server-configuration)
- [Environment Variables](#environment-variables)
- [Tool Parameters](#tool-parameters)
- [Git Commit Prefixes](#git-commit-prefixes)
- [Permission Model](#permission-model)
- [Recommended Settings](#recommended-settings)

---

## MCP Server Configuration

### Flywheel-Crank (`.mcp.json`)

**Minimal config (recommended):**
```json
{
  "mcpServers": {
    "flywheel-crank": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-crank"]
    }
  }
}
```

> Vault auto-detected from `.obsidian` or `.claude` folder. Add `PROJECT_PATH` env var only if vault is in a different location.

**With custom vault path:**
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

**Windows (native):**
```json
{
  "mcpServers": {
    "flywheel-crank": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@velvetmonkey/flywheel-crank"]
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

### Flywheel (`.mcp.json`)

**NPM package:**
```json
{
  "mcpServers": {
    "flywheel": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-mcp"],
      "env": {
        "FLYWHEEL_WATCH": "true",
        "FLYWHEEL_DEBOUNCE_MS": "60000"
      }
    }
  }
}
```

---

## Environment Variables

### Flywheel

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `PROJECT_PATH` | string | cwd | Override vault location |
| `FLYWHEEL_WATCH` | `"true"` / `"false"` | `"false"` | Auto-rebuild index on file changes |
| `FLYWHEEL_DEBOUNCE_MS` | string (number) | `"60000"` | Debounce delay for file watching (ms) |

**File Watch Details:**

When `FLYWHEEL_WATCH=true`:
- Starts chokidar file watcher on vault directory
- Ignores dotfiles (`.obsidian`, `.git`, `.trash`, etc.)
- Only triggers on `.md` file changes
- Debounces rapid changes (default 60000ms / 1 minute)
- Rebuilds full index on change
- Uses `awaitWriteFinish` to prevent indexing partial writes

**When to use:** Enable file watching if you're editing notes while an agent is actively working in your vault. Without watching, the agent sees a snapshot from when the MCP server started.

### Flywheel-Crank

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `PROJECT_PATH` | string | cwd | Override vault location |

---

## Tool Parameters

### Common Parameters (All Mutation Tools)

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `commit` | boolean | `false` | Git commit after mutation (creates undo point) |

### Content Mutation Parameters

| Parameter | Type | Default | Tools | Description |
|-----------|------|---------|-------|-------------|
| `skipWikilinks` | boolean | `false` | add/replace/task | Disable auto-wikilinks for this call |
| `position` | `"append"` / `"prepend"` | `"append"` | add tools | Where to insert content |
| `format` | FormatType | `"plain"` | `mcp__flywheel-crank__vault_add_to_section` | Output format |
| `mode` | `"first"` / `"last"` / `"all"` | `"first"` | remove/replace | Match mode |
| `useRegex` | boolean | `false` | remove/replace | Treat pattern as regex |

### Format Types

| Format | Output Example | Description |
|--------|----------------|-------------|
| `plain` | `Content` | No formatting |
| `bullet` | `- Content` | Bullet point |
| `task` | `- [ ] Content` | Unchecked task |
| `numbered` | `1. Content` | Numbered list |
| `timestamp-bullet` | `- **14:32** Content` | Timestamped bullet |

### Safety Parameters

| Parameter | Type | Default | Tools | Description |
|-----------|------|---------|-------|-------------|
| `confirm` | boolean | **required** | `mcp__flywheel-crank__vault_delete_note` | Must be `true` to confirm deletion |

---

## Git Commit Prefixes

All Crank mutations use consistent git commit prefixes for audit trails:

| Prefix | Tools | Description |
|--------|-------|-------------|
| `[Crank:Add]` | `mcp__flywheel-crank__vault_add_to_section` | Content added to section |
| `[Crank:Remove]` | `mcp__flywheel-crank__vault_remove_from_section` | Content removed from section |
| `[Crank:Replace]` | `mcp__flywheel-crank__vault_replace_in_section` | Content replaced in section |
| `[Crank:Task]` | `mcp__flywheel-crank__vault_toggle_task`, `mcp__flywheel-crank__vault_add_task` | Task operations |
| `[Crank:FM]` | `mcp__flywheel-crank__vault_update_frontmatter`, `mcp__flywheel-crank__vault_add_frontmatter_field` | Frontmatter changes |
| `[Crank:Create]` | `mcp__flywheel-crank__vault_create_note` | Note created |
| `[Crank:Delete]` | `mcp__flywheel-crank__vault_delete_note` | Note deleted |

**Example commit message:**
```
[Crank:Add] daily-notes/2026-01-28.md
```

---

## Permission Model

### The Core Security Pattern

Flywheel and Flywheel-Crank implement a **read-broad, write-narrow** permission model:

```
┌─────────────────────────────────────────────────────────────────┐
│                    PERMISSION MODEL                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Flywheel (read):    Pre-approved broadly                       │
│                      → 44 read-only tools                       │
│                      → Cannot modify vault                      │
│                                                                 │
│  Flywheel-Crank (write):  Approved per-tool                     │
│                           → 11 mutation tools                   │
│                           → Requires conscious consent          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Why Deny Direct Writes?

**The key insight:** Configure Claude Code to **DENY** direct filesystem writes, forcing ALL mutations through Flywheel-Crank MCP tools.

| Without Deny | With Deny |
|--------------|-----------|
| Claude can write files directly | ALL mutations forced through Crank |
| Bypasses validation | Every mutation follows same path |
| Inconsistent formatting | Consistent Obsidian format |
| No audit trail | Git commit on every mutation |
| Risk of corruption | Safe, reversible operations |

### Permission Escalation Path

Start conservative, expand as needed:

```
Day 1:  Only allow read tools (Flywheel)
        → Learn what Claude can see

Day 7:  Allow mcp__flywheel-crank__vault_add_task, mcp__flywheel-crank__vault_toggle_task
        → Low-risk mutations, test the pattern

Day 14: Allow mcp__flywheel-crank__vault_add_to_section
        → Content additions with auto-wikilinks

Day 30: Allow mcp__flywheel-crank__vault_replace_in_section, mcp__flywheel-crank__vault_update_frontmatter
        → Full mutation capabilities

Never:  Allow Write(**) or Edit(**)
        → Always force through Crank for safety
```

---

## Recommended Settings

### `.claude/settings.json` (Vault Projects)

Place this in your vault's `.claude/` folder to configure Claude Code permissions:

```json
{
  "permissions": {
    "allow": [
      "Read(**/*.md)",
      "Glob",
      "Grep",
      "Bash(git:*)",
      "mcp__flywheel__*",
      "mcp__flywheel-crank__vault_add_to_section",
      "mcp__flywheel-crank__vault_add_task",
      "mcp__flywheel-crank__vault_toggle_task"
    ],
    "deny": [
      "Write(**)",
      "Edit(**)",
      "Read(.obsidian/**)",
      "Write(.obsidian/**)",
      "Edit(.obsidian/**)",
      "Read(.git/**)",
      "Write(.git/**)",
      "Edit(.git/**)"
    ]
  }
}
```

### Explanation

**Allow:**
- `Read(**/*.md)` - Read markdown files
- `Glob`, `Grep` - Search capabilities
- `Bash(git:*)` - Git operations
- `mcp__flywheel__*` - All Flywheel read tools
- `mcp__flywheel-crank__vault_*` - Specific Crank tools

**Deny:**
- `Write(**)`, `Edit(**)` - No direct file modification
- `.obsidian/**` - Protect Obsidian config
- `.git/**` - Protect git internals

### Conservative Starter Config

For users just getting started:

```json
{
  "permissions": {
    "allow": [
      "Read(**/*.md)",
      "Glob",
      "Grep",
      "mcp__flywheel__*",
      "mcp__flywheel-crank__vault_add_task",
      "mcp__flywheel-crank__vault_toggle_task"
    ],
    "deny": [
      "Write(**)",
      "Edit(**)"
    ]
  }
}
```

### Full Trust Config

For users comfortable with all Crank operations:

```json
{
  "permissions": {
    "allow": [
      "Read(**/*.md)",
      "Glob",
      "Grep",
      "Bash(git:*)",
      "mcp__flywheel__*",
      "mcp__flywheel-crank__*"
    ],
    "deny": [
      "Write(**)",
      "Edit(**)",
      "Read(.obsidian/**)",
      "Write(.obsidian/**)",
      "Edit(.obsidian/**)"
    ]
  }
}
```

---

## Vault Config (Flywheel Only)

### `.claude/.flywheel.json`

**Created by:** Flywheel (auto-inferred on startup)
**Read by:** Flywheel only

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `vault_name` | string | folder name | Display name for vault |
| `paths.daily_notes` | string | auto-detect | Daily notes folder |
| `paths.weekly_notes` | string | auto-detect | Weekly notes folder |
| `paths.monthly_notes` | string | auto-detect | Monthly notes folder |
| `paths.quarterly_notes` | string | auto-detect | Quarterly notes folder |
| `paths.yearly_notes` | string | auto-detect | Yearly notes folder |
| `paths.templates` | string | auto-detect | Templates folder |
| `exclude_task_tags` | string[] | `[]` | Tags to exclude from task queries |

**Example:**
```json
{
  "vault_name": "My Knowledge Base",
  "paths": {
    "daily_notes": "journal/daily",
    "weekly_notes": "journal/weekly",
    "templates": "templates"
  },
  "exclude_task_tags": ["#someday", "#maybe"]
}
```

---

## Wikilink Entity Cache

### `.claude/wikilink-entities.json`

**Created by:** Flywheel-Crank (auto-generated on startup)
**Purpose:** Cache of known entities for auto-wikilinks

- Auto-refreshes if >1 hour old
- Contains all entities from vault (people, projects, technologies, acronyms)
- Used by `mcp__flywheel-crank__vault_add_to_section`, `mcp__flywheel-crank__vault_replace_in_section`, `mcp__flywheel-crank__vault_add_task`

**Example:**
```json
{
  "people": ["Alex Rivera", "Jordan Lee"],
  "projects": ["Project Alpha", "API Server"],
  "technologies": ["TypeScript", "React"],
  "acronyms": ["API", "MCP", "CLI"],
  "other": ["Risk Register", "Roadmap"]
}
```

See [wikilinks.md](./wikilinks.md) for entity inference rules.

---

## See Also

- [Tools Reference](./tools-reference.md) - Complete tool documentation
- [Wikilinks](./wikilinks.md) - Auto-wikilink behavior
- [Privacy](./privacy.md) - Privacy architecture
- [Testing](./testing.md) - Test procedures
