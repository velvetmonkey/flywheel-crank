> **Part of the Flywheel Suite:** This is the mutation server for safe vault writes. See [Flywheel](https://github.com/velvetmonkey/flywheel) for read-only graph intelligence and queries.

<div align="center">
  <img src="header.png" alt="Flywheel Crank" width="256"/>
</div>

# Flywheel Crank

### Safe, surgical mutations for agentic markdown vaults.

[![npm version](https://img.shields.io/npm/v/@velvetmonkey/flywheel-crank.svg)](https://www.npmjs.com/package/@velvetmonkey/flywheel-crank)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-blue.svg)](https://github.com/velvetmonkey/flywheel-crank)

---

## Quick Start

**Package:** [`@velvetmonkey/flywheel-crank`](https://www.npmjs.com/package/@velvetmonkey/flywheel-crank)

Add to your Claude Code MCP config (`.mcp.json`):

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

> **Windows:** Use `"command": "cmd", "args": ["/c", "npx", "-y", "@velvetmonkey/flywheel-crank"]`

See [Configuration](./docs/configuration.md) for full options.

---

## The Eyes and Hands Architecture

Flywheel and Flywheel-Crank form a complementary pair:

```
┌─────────────────────────────────────────────────────────────┐
│                  Your Markdown Vault                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Flywheel (Eyes)              Flywheel-Crank (Hands)       │
│   ════════════════             ══════════════════════       │
│   51 read-only tools           11 write tools               │
│                                                             │
│   • search_notes()             • vault_add_to_section()     │
│   • get_backlinks()            • vault_toggle_task()        │
│   • get_section_content()      • vault_update_frontmatter() │
│   • find_orphan_notes()        • vault_create_note()        │
│                                                             │
│   "See where to go"            "Touch what needs changing"  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Workflow:** Read (Flywheel) → Write (Crank) → Verify (Flywheel)

---

## See It In Action

### Auto-Wikilinks + Contextual Cloud

```
You: Log that I discussed turbopump testing with Marcus

Claude: [uses vault_add_to_section]

Added to daily-notes/2026-01-29.md under ## Log:
  - 14:32 Discussed [[Turbopump]] testing with [[Marcus Johnson]]
    → [[Propulsion System]] [[Test 4]] [[Engine Design]]

Two linking behaviors:
- **Auto-wikilinks:** [[Turbopump]], [[Marcus Johnson]] — exact text matches
- **Contextual cloud:** → [[...]] — semantically related entities you might
  want to connect (suggested based on graph patterns, not mentioned in text)
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

Crank only touched the ## Timeline section. The rest of the file was untouched.
```

---

## Why Flywheel-Crank?

| Feature | What it means |
|---------|---------------|
| **Deterministic** | Same input + same vault state → same output |
| **Auto-wikilinks** | Entities auto-linked on write |
| **Format consistency** | Obsidian conventions enforced |
| **Section-scoped** | Changes confined to target section |
| **Git-integrated** | Optional commit per mutation, easy undo |
| **Block-aware** | Code blocks, tables, blockquotes preserved |
| **Input validation** | Detects common issues before writing |
| **Output guardrails** | Prevents corrupted markdown |

---

## Who Uses Flywheel-Crank?

Same folks who use [Flywheel](https://github.com/velvetmonkey/flywheel#who-uses-flywheel) — but now they want to **write**, not just read:

| Persona | Your Problem | Crank Gives You |
|---------|--------------|-----------------|
| 🧠 **PKM Practitioner** | Manual linking is tedious | Auto-wikilinks on every write |
| 🤖 **Agent Builder** | Agents can't safely mutate vaults | Deterministic, section-scoped writes |
| 📓 **Daily Noters** | Logging breaks flow | One-liner adds with timestamp formatting |
| 📊 **Knowledge Worker** | Frontmatter updates are manual | Structured field mutations |
| 🔄 **Workflow Automators** | Scripts corrupt formatting | Block-aware, format-preserving edits |

**The pattern:** Flywheel sees → Crank touches → Flywheel verifies.

See [Flywheel's audience section](https://github.com/velvetmonkey/flywheel#who-uses-flywheel) for the full persona breakdown and inspiration from builders in public.

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

## Vault Setup for Auto-Wikilinks

Crank auto-links entities that exist as notes in your vault:

| Folder pattern | Detected as |
|----------------|-------------|
| `team/`, `people/` | People |
| `projects/`, `systems/` | Projects |
| `decisions/`, `adr/` | Decisions |

**Naming tips:**
- Use spaces: `Sam Chen.md` not `sam-chen.md`
- Be consistent: "Project Alpha" everywhere

---

## Configuration

Add to your `.mcp.json`:

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

### Key Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `commit` | `false` | Git commit after mutation (creates undo point) |
| `skipWikilinks` | `false` | Disable auto-wikilinks for this call |
| `validate` | `true` | Check input for common issues (double timestamps, etc.) |
| `normalize` | `true` | Auto-fix issues like `•` → `-` bullets |
| `guardrails` | `warn` | Output validation: `warn`, `strict`, or `off` |

See [Configuration Guide](./docs/configuration.md) for complete options.

### Contextual Cloud (Suggested Links)

Beyond auto-wikilinks, mutations suggest semantically related entities — the **contextual cloud**:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `suggestOutgoingLinks` | `true` | Append contextual cloud (e.g., `→ [[Entity1]] [[Entity2]]`) |
| `maxSuggestions` | `3` | Number of suggestions (1-10) |

**Why "contextual cloud"?** These suggestions aren't mentioned in your text — they're related concepts surfaced by graph patterns (co-occurrence, shared neighbors, hub connections). They capture implicit context you might forget to link.

Disable for a single call: `suggestOutgoingLinks: false`

---

## Documentation

- **[Examples](./docs/EXAMPLES.md)** — Quick start, all 11 tools with copy-paste examples, workflow scenarios
- **[Configuration Guide](./docs/configuration.md)** — Environment variables, permissions, tool parameters
- **[Auto-Wikilinks](./docs/wikilinks.md)** — Entity inference, excluded folders
- **[Tools Reference](./docs/tools-reference.md)** — Complete tool documentation
- **[Performance](./docs/PERFORMANCE.md)** — Benchmarks and optimization
- **[Troubleshooting](./docs/TROUBLESHOOTING.md)** — Common issues and fixes
- **[Testing](./docs/testing.md)** — Manual MCP testing procedures

---

## Related Projects

- [Flywheel](https://github.com/velvetmonkey/flywheel) — The companion read-only MCP server with 51 graph intelligence tools
- [vault-core](https://github.com/velvetmonkey/vault-core) — Shared vault utilities (entity scanning, protected zones, wikilinks)

---

## Under the Hood

<div align="center">

**The self-building knowledge graph.** No AI. No cloud. Just graph intelligence.

| | | | |
|:---:|:---:|:---:|:---:|
| **Porter Stemmer** | **Adamic-Adar Index** | **Co-occurrence Mining** | **Transitive Inference** |
| Matches plurals, tenses | Rare connections matter more | Learns from YOUR vault | A→B→C suggests A→C |

</div>

**How it works:**
- **Entity Index** — Scans your vault, derives aliases, categorizes by structure
- **Graph Algorithms** — Common neighbors, path counting, co-occurrence patterns
- **Zero-Shot Learning** — No training data needed, learns from your graph
- **Offline-First** — Everything runs locally, your data never leaves your machine

The more you use it, the smarter it gets. Not through AI training, but through the graph itself accumulating relationship intelligence.

*Built on foundations from [Liben-Nowell & Kleinberg](https://www.cs.cornell.edu/home/kleinber/link-pred.pdf) (link prediction), [Stanford NLP](https://web.stanford.edu/class/cs520/2020/notes/How_To_Create_A_Knowledge_Graph_From_Text.html) (knowledge extraction), and [Wikipedia entity linking](https://en.wikipedia.org/wiki/Entity_linking) research.*

---

Apache-2.0 License · [GitHub](https://github.com/velvetmonkey/flywheel-crank) · [Issues](https://github.com/velvetmonkey/flywheel-crank/issues)
