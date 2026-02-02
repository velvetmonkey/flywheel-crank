> **Both Packages Required:** Flywheel-Crank (11 mutation tools) requires [Flywheel](https://github.com/velvetmonkey/flywheel) (51 read-only tools) for the complete experience. See the [Platform Installation Guide](docs/INSTALL.md) for your OS.

<div align="center">
  <img src="header.png" alt="Flywheel Crank" width="256"/>
</div>

# Flywheel Crank

### MCP server for deterministic vault mutations

[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-blueviolet.svg)](https://modelcontextprotocol.io/)
[![CI](https://github.com/velvetmonkey/flywheel-crank/actions/workflows/ci.yml/badge.svg)](https://github.com/velvetmonkey/flywheel-crank/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@velvetmonkey/flywheel-crank.svg)](https://www.npmjs.com/package/@velvetmonkey/flywheel-crank)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-blue.svg)](https://github.com/velvetmonkey/flywheel-crank)
[![Scale](https://img.shields.io/badge/scale-100k%20notes-brightgreen.svg)](./docs/BENCHMARK_RESULTS.md)
[![Mutations](https://img.shields.io/badge/mutations-10k%2B%20stable-brightgreen.svg)](./docs/SCALE_BENCHMARKS.md)

**Policies as code.** Give Claude surgical write access to your Obsidian vault with auto-wikilinks, atomic commits, and full undo.

> **Platform Architecture:** See [PLATFORM.md](./docs/PLATFORM.md) for the Eyes + Hands architecture and why deterministic agents matter.

## Verified Capabilities

✅ **100k Note Scale** - Vault operations tested at 100,000 notes
✅ **10k Mutation Stability** - 10,000 sequential mutations without corruption
✅ **Cross-Platform** - Tested on Ubuntu, Windows, macOS (Intel + ARM)
✅ **Security Hardened** - Path traversal, injection, permission bypass tested
✅ **Format Preservation** - CRLF, indentation, trailing newlines preserved

---

## See It In Action

### Carter Consultancy: Onboard a Project in One Prompt

---

#### The Policy (authored once, reused forever)

```yaml
# .crank/policies/onboard-project.yaml
name: onboard-project
description: Standard workflow for new client projects
actions:
  # 1. Create the project file with structured frontmatter
  - tool: vault_create_note
    target: projects/{project_name}.md      # Template variable → "Acme Website Redesign"
    frontmatter:
      type: project
      client: "[[{client}]]"                # Wikilink in frontmatter → queryable relationship
      budget: {budget}
      timeline: {timeline}
      lead: "[[{lead}]]"                    # Links to team member's note
      status: active

  # 2. Update the client's file with new engagement
  - tool: vault_add_to_section
    target: clients/{client}.md
    section: "## Active Engagement"
    content: "- [[{project_name}]] - ${budget}, {timeline}"

  # 3. Log to daily note with automatic timestamp
  - tool: vault_add_to_section
    target: daily-notes/{today}.md          # {today} → "2026-02-02"
    section: "## Log"
    content: "Onboarded [[{project_name}]] project"
    format: timestamp-bullet                # Adds "- 14:32 " prefix automatically

  # 4. Update team member's availability
  - tool: vault_update_frontmatter
    target: team/{lead}.md
    fields:
      current_project: "[[{project_name}]]"
      utilization: 80
```

**What makes this powerful:**

| Element | Example | Why It Matters |
|---------|---------|----------------|
| Template variables | `{project_name}` → `Acme Website Redesign` | One policy, infinite projects |
| Wikilinks in YAML | `client: "[[{client}]]"` | Frontmatter becomes queryable graph |
| Built-in variables | `{today}` → `2026-02-02` | No date math needed |
| Format options | `timestamp-bullet` | Consistent log formatting |

> **Authored once.** Reviewed. Committed to git. This is how Carter onboards every project.

---

#### The Prompt (runtime)

```
You: Onboard new project: Acme Corp website redesign,
     Q2 delivery, $45K budget, Stacy Thompson as lead
```

---

#### The Execution (deterministic)

Claude matches intent to `onboard-project`, fills parameters, executes:

```
Claude: Running onboard-project...
  ✓ vault_create_note → projects/Acme Website Redesign.md
  ✓ vault_add_to_section → clients/Acme Corp.md
  ✓ vault_add_to_section → daily-notes/2026-02-02.md
  ✓ vault_update_frontmatter → team/Stacy Thompson.md
```

---

#### The Output

`projects/Acme Website Redesign.md` *(created)*:
```markdown
---
type: project
client: "[[Acme Corp]]"
budget: 45000
timeline: Q2 2026
lead: "[[Stacy Thompson]]"
status: active
---
# Acme Website Redesign
```

`daily-notes/2026-02-02.md` *(updated)*:
```markdown
## Log
- 14:32 Onboarded [[Acme Website Redesign]] project
  → [[TechStart Inc]] [[Q2 Delivery]] [[Website Projects]]
```

**4 files. 1 commit. 1 undo.**

### Key Concepts

| Concept | What It Means |
|---------|---------------|
| **Auto-Wikilinks** | Exact entity matches → `[[Entity]]` inline |
| **Context Cloud** | Related entities → `→ [[...]]` suffix |
| **Atomic Commits** | 4 files, 1 git commit, 1 undo |
| **Deterministic** | Same input + same vault = same output |

### The Complete Picture

Flywheel-Crank gives you **hands**: 11 mutation tools for deterministic vault automation.

But writing isn't enough. Before Carter onboards that project, she needs to query client history, check team availability, and understand project context—that's **reading**.

For graph intelligence, see **[Flywheel](https://github.com/velvetmonkey/flywheel)**: 51 read-only tools for querying your knowledge graph.

**Hands + Eyes = Complete vault intelligence.**

---

## Quick Start

Configure **both** Flywheel (read) and Flywheel-Crank (write) for the complete experience.

Add to your Claude Code MCP config (`.mcp.json`):

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

> **Windows:** Use `"command": "cmd", "args": ["/c", "npx", "-y", "@velvetmonkey/flywheel-crank"]`

See [Configuration](./docs/configuration.md) for full options.

---

## How It Works

### The Policy

```yaml
# .crank/policies/daily-log.yaml
name: daily-log
trigger: "Log *"
description: Add timestamped entry to daily note with auto-wikilinks
actions:
  - tool: vault_add_to_section
    target: daily-notes/{today}.md
    section: "## Log"
    content: "- {time} {input}"
    format: timestamp-bullet
    wikilinks: auto
```

### Input → Policy → Output

**BEFORE** (vault state):
```markdown
# 2026-02-01

## Log
- 09:00 Morning standup with team
```

**AGENT EXECUTES:**
```
You: Log discussed turbopump testing with Marcus
Claude: [executes daily-log policy]
```

**AFTER** (vault state):
```markdown
# 2026-02-01

## Log
- 09:00 Morning standup with team
- 14:32 discussed [[Turbopump]] testing with [[Marcus Johnson]]
  → [[Propulsion System]] [[Test 4]]
```

### Why This Matters

| Property | What It Means |
|----------|---------------|
| **Repeatable** | Same input → Same output. Every time. |
| **Auditable** | Policy checked into git. Review before deploy. |
| **Deterministic** | No AI hallucination in the mutation logic. |
| **Marked up** | Auto-wikilinks + contextual suggestions. |

---

## The Determinism Story

### The Craft Loop (Human + Claude)

```
┌─────────────────────────────────────────────────────────────────┐
│                     CRAFT PHASE (one-time)                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Human: "I need a workflow for onboarding new projects.        │
│           Create the project file, update the client,           │
│           log it, and mark the lead as assigned."               │
│                          ↓                                      │
│   Claude: [generates policy YAML]                               │
│                          ↓                                      │
│   Human: "Add budget tracking. Use timestamp format for log."   │
│                          ↓                                      │
│   Claude: [refines policy]                                      │
│                          ↓                                      │
│   Human: "Looks good."                                          │
│                          ↓                                      │
│   git commit → .crank/policies/onboard-project.yaml             │
│                                                                 │
│   ════════════════════════════════════════════════════════════  │
│   Policy is now CODE. Versioned. Reviewable. Auditable.         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**The craft loop:** Describe → Generate → Review → Refine → Confirm → Commit.

Human stays in control. Claude accelerates authoring. The result is deterministic code.

---

```
┌─────────────────────────────────────────────────────────────────┐
│                     MINT PHASE (every use)                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Human: "Onboard Acme Corp website redesign, $45K, Q2"         │
│                          ↓                                      │
│   Claude: [matches intent → onboard-project policy]             │
│                          ↓                                      │
│   Crank: [executes deterministically with parameters]           │
│                          ↓                                      │
│   4 files updated. 1 commit. 1 undo.                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**The key insight:** AI creativity happens during *craft*. Execution is deterministic *forever*.

**Why not just let AI edit files directly?**

| AI Edits Directly | Flywheel-Crank |
|-------------------|----------------|
| Non-deterministic | Same input → Same output |
| Hard to audit | Git tracks everything |
| Risky at scale | Bounded by policy |
| No structure | Section-scoped edits |

---

## More Examples

### Simple: Task Toggle

**Policy:**
```yaml
name: complete-task
description: Toggle task in project file
actions:
  - tool: vault_toggle_task
    target: "{file}"
    task: "{task_text}"
    state: complete
```

**Before:**
```markdown
## Tasks
- [ ] Review PR
- [ ] Deploy staging
```

**After:**
```markdown
## Tasks
- [x] Review PR
- [ ] Deploy staging
```

### Complex: Decision Record (Multi-file Atomic)

**Policy:**
```yaml
name: capture-decision
description: Create ADR, log to daily note, update project status
actions:
  - id: create-adr
    tool: vault_create_note
    target: decisions/ADR-{next_id} {title}.md
    frontmatter:
      type: decision
      status: proposed
      owner: "[[{owner}]]"
    content: |
      # ADR-{next_id}: {title}

      ## Context
      {context}

      ## Decision
      {decision}

  - id: log-daily
    tool: vault_add_to_section
    target: daily-notes/{today}.md
    section: "## Activity Log"
    content: "- Created [[ADR-{next_id} {title}]]"

  - id: update-project
    tool: vault_update_frontmatter
    target: projects/{project}.md
    fields:
      last_decision: "[[ADR-{next_id} {title}]]"
```

**Output:**

`decisions/ADR-006 Turbopump Mitigation.md` *(created)*:
```markdown
---
type: decision
status: proposed
owner: "[[Sarah Chen]]"
---
# ADR-006: Turbopump Mitigation

## Context
Turbopump showing 15% efficiency loss...

## Decision
Switch to redundant pump configuration...
```

`daily-notes/2026-02-01.md` *(updated)*:
```markdown
## Activity Log
- Created [[ADR-006 Turbopump Mitigation]]
  → [[Propulsion System]] [[Test 4]]
```

**3 files. 1 commit. 1 undo.**

---

## Bounded Autonomy

AI agents need guardrails. Flywheel-Crank provides them:

| Principle | How Crank Implements It |
|-----------|-------------------------|
| **Checkpoints** | Every mutation returns success/failure with preview |
| **Audit trail** | Git commit on every operation (optional) |
| **Reversibility** | Single undo reverts entire policy |
| **Scope limits** | Section-scoped edits, path validation |
| **Human oversight** | Policies define allowed actions, humans approve |

**The philosophy:** AI operates within defined boundaries. Workflows are deterministic. Git tracks everything. Humans stay in control.

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
- `vault_move_note` - Move note with backlink updates
- `vault_rename_note` - Rename note with backlink updates

### Policies
- `policy_execute` - Run a policy with atomic commit
- `policy_preview` - Dry-run showing what would happen
- `policy_validate` - Validate policy YAML
- `policy_list` - List available policies
- `policy_author` - Generate policy from description

### System
- `vault_list_sections` - List all sections in a note
- `vault_undo_last_mutation` - Undo last operation (or entire policy)

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

---

## Documentation

- **[Installation Guide](./docs/INSTALL.md)** — Platform-specific setup (Windows, macOS, Linux, WSL)
- **[Examples](./docs/EXAMPLES.md)** — Quick start, all tools with copy-paste examples
- **[Configuration Guide](./docs/configuration.md)** — Environment variables, permissions, tool parameters
- **[Policy Authoring](./docs/POLICIES.md)** — Deep dive on writing policies
- **[Auto-Wikilinks](./docs/wikilinks.md)** — Entity inference, excluded folders
- **[Tools Reference](./docs/tools-reference.md)** — Complete tool documentation
- **[Performance](./docs/PERFORMANCE.md)** — Benchmarks and optimization
- **[Testing](./docs/TESTING.md)** — 930+ tests with methodology
- **[Troubleshooting](./docs/TROUBLESHOOTING.md)** — Common issues and fixes

---

## Performance at Scale

Battle-tested with comprehensive benchmarks:

| Scale | Notes | Index Build | Mutation P95 |
|-------|-------|-------------|--------------|
| Small | 1,000 | <1s | <50ms |
| Medium | 10,000 | <5s | <100ms |
| Large | 50,000 | <15s | <100ms |
| XL | 100,000 | <30s | <150ms |

See [SCALE_BENCHMARKS.md](./docs/SCALE_BENCHMARKS.md) for full methodology and reproducible results.

---

## Related Projects

- [Flywheel](https://github.com/velvetmonkey/flywheel) — The companion read-only MCP server with 51 graph intelligence tools
- [vault-core](https://github.com/velvetmonkey/vault-core) — Shared vault utilities (entity scanning, protected zones, wikilinks)

---

## Prove It Yourself

Don't trust marketing. Run the tests:

```bash
# Clone the ecosystem
git clone https://github.com/velvetmonkey/flywheel-mcp
git clone https://github.com/velvetmonkey/flywheel-crank

# Run flywheel-crank tests (1,326 tests - mutations, scale, security)
cd flywheel-crank && npm install && npm test

# Run flywheel tests (395 tests - read tools, demos)
cd ../flywheel-mcp && npm install && npm test
```

**Total: 1,721 tests** proving the ecosystem works.

| Repo | Tests | Proves |
|------|-------|--------|
| **flywheel-crank** | 1,326 | Mutations at scale, format preservation, security |
| **flywheel** | 395 | Graph queries, entity indexing, file watching |

### Try a Demo

Pick a persona and start asking questions:

```bash
cd flywheel-mcp/demos/carter-strategy
# Add .mcp.json with flywheel + flywheel-crank
claude
```

| Demo | You Are | First Question |
|------|---------|----------------|
| [Carter Strategy](https://github.com/velvetmonkey/flywheel-mcp/tree/main/demos/carter-strategy) | Solo consultant | "What's overdue?" |
| [Artemis Rocket](https://github.com/velvetmonkey/flywheel-mcp/tree/main/demos/artemis-rocket) | Chief Engineer | "What blocks propulsion?" |
| [Startup Ops](https://github.com/velvetmonkey/flywheel-mcp/tree/main/demos/startup-ops) | SaaS Co-founder | "Onboard a customer" |

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
