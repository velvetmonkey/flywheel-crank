# Flywheel Crank MCP Server

Deterministic vault mutations for [Obsidian](https://obsidian.md/) via MCP. The write companion to [Flywheel](https://github.com/velvetmonkey/flywheel).

[![npm](https://img.shields.io/npm/v/@velvetmonkey/flywheel-crank)](https://www.npmjs.com/package/@velvetmonkey/flywheel-crank)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL_3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![MCP](https://img.shields.io/badge/MCP-Compatible-blue)](https://modelcontextprotocol.io/)

## What is Flywheel Crank?

While **Flywheel** provides read-only graph intelligence (backlinks, queries, structure analysis), **Crank** enables **surgical vault mutations**:

- Add/remove/replace content in sections
- Toggle and create tasks
- Update frontmatter
- Create and delete notes
- Optional git commits with undo support

## Requirements

- **Node.js 18-22** (LTS recommended)
  - Node 22 LTS has prebuilt binaries and works out of the box
  - Node 23+ may require native compilation of `better-sqlite3` (slower install)

## Installation

### Via `.mcp.json`

Add to your project's `.mcp.json` (in your vault root). **Zero-config** if `.mcp.json` is in your vault:

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

> **Note**: Windows native requires `"command": "cmd", "args": ["/c", "npx", "-y", "@velvetmonkey/flywheel-crank"]`

<details>
<summary><strong>Advanced: Pointing to a different vault</strong></summary>

If `.mcp.json` is NOT in your vault, set `PROJECT_PATH`:

**Linux / macOS / WSL:**

```json
{
  "mcpServers": {
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

**Windows (native):**

```json
{
  "mcpServers": {
    "flywheel-crank": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@velvetmonkey/flywheel-crank"],
      "env": {
        "PROJECT_PATH": "C:/Users/yourname/path/to/vault"
      }
    }
  }
}
```

</details>

### Via CLI

```bash
# Zero-config (run from vault directory)
claude mcp add flywheel-crank -- npx -y @velvetmonkey/flywheel-crank

# With explicit vault path
claude mcp add flywheel-crank -e PROJECT_PATH=/path/to/vault -- npx -y @velvetmonkey/flywheel-crank
```

### Verify

```bash
claude mcp list  # Should show: flywheel-crank
```

## Tools

| Category | Tools |
|----------|-------|
| Mutations | `vault_add_to_section`, `vault_remove_from_section`, `vault_replace_in_section` |
| Tasks | `vault_toggle_task`, `vault_add_task` |
| Frontmatter | `vault_update_frontmatter`, `vault_add_frontmatter_field` |
| Notes | `vault_create_note`, `vault_delete_note` |
| System | `vault_list_sections`, `vault_undo_last_mutation` |

## The `commit` Parameter (Undo Support)

Every mutation tool has an optional `commit` parameter. Here's what it does and why you'd use it:

### What is a commit?

If your vault is tracked with **git** (a version control system), setting `commit: true` creates a **save point** after each change. Think of it like a checkpoint in a video game - you can always go back to it.

### Why use it?

| `commit: false` (default) | `commit: true` |
|---------------------------|----------------|
| Changes saved to file immediately | Changes saved AND recorded in git history |
| No undo available | Can undo with `vault_undo_last_mutation` |
| Faster (no git overhead) | Slightly slower |
| Good for: bulk edits, testing | Good for: important changes you might want to reverse |

### Example

```javascript
// Without commit - change is made, no undo available
vault_add_to_section({
  path: "daily/2026-01-28.md",
  section: "Log",
  content: "Meeting with team"
})

// With commit - change is made AND you can undo it later
vault_add_to_section({
  path: "daily/2026-01-28.md",
  section: "Log",
  content: "Meeting with team",
  commit: true  // Creates undo point
})
```

### Undoing a change

If you used `commit: true`, you can undo with:

```javascript
vault_undo_last_mutation({ confirm: true })
```

This reverts your vault to the state before the last committed change.

> **Note**: Undo only works if your vault is a git repository. Most Obsidian users who sync via git already have this set up. If you're unsure, the tool will tell you if undo isn't available.

## Configuration

| Environment Variable | Required | Default | Description |
|---------------------|:--------:|---------|-------------|
| `PROJECT_PATH` | No | `cwd()` | Path to markdown vault directory |

## Design Principles

- **Deterministic**: No AI-driven edits, predictable output
- **Atomic**: Each mutation is a single, reversible operation
- **Safe**: Path sandboxing, explicit commit opt-in, undo support
- **Obsidian-compatible**: Follows Obsidian conventions (task format, wikilinks, etc.)

## Flywheel + Crank

Use both together for full vault intelligence:

```json
{
  "mcpServers": {
    "flywheel": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-mcp"]
    },
    "flywheel-crank": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-crank"]
    }
  }
}
```

- **Flywheel**: Query, search, analyze (read-only)
- **Crank**: Mutate, create, update (write)

## License

AGPL-3.0 — [velvetmonkey](https://github.com/velvetmonkey)

## Links

- [Flywheel](https://github.com/velvetmonkey/flywheel) — Read-only graph intelligence
- [Flywheel Crank](https://github.com/velvetmonkey/flywheel-crank) — This project
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Claude Code](https://claude.ai/code)
