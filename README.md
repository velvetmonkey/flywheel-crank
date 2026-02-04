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

> **How was this policy created?** See [The Determinism Story](#the-determinism-story) for Carter's iterative authoring session with Claude.

#### The Prompt

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

`clients/Acme Corp.md` *(updated)*:
```markdown
## Active Engagement
- [[Acme Website Redesign]] - $45000, Q2 2026
```

`daily-notes/2026-02-02.md` *(updated)*:
```markdown
## Log
- 14:32 Onboarded [[Acme Website Redesign]] project
  → [[Acme Corp]] [[Stacy Thompson]] [[Q2 Projects]]
```

`team/Stacy Thompson.md` *(updated)*:
```markdown
---
current_project: "[[Acme Website Redesign]]"
utilization: 80
---
```

**4 files. 1 commit. 1 undo.**

### Key Concepts

| Concept | What It Means |
|---------|---------------|
| **Auto-Wikilinks** | Entity matches (stemming, aliases, case-insensitive) → `[[Entity]]` inline |
| **Context Cloud** | Related entities → `→ [[...]]` suffix |
| **Atomic Commits** | 4 files, 1 git commit, 1 undo |
| **Deterministic** | Same input + same vault = same output |

### Beyond Policies: Direct Tool Usage

Policies are great for repeatable workflows. But Crank's tools work just as well ad-hoc:

| Use Case | Example | Tools |
|----------|---------|-------|
| **One-off edits** | "Add a note to my daily log" | `vault_add_to_section` |
| **Migrations** | "Add `status: active` to all project files" | `vault_update_frontmatter` |
| **Reorganization** | "Move all ADRs to decisions/ folder" | `vault_move_note` |
| **Batch cleanup** | "Toggle all completed tasks in Q1 notes" | `vault_toggle_task` |
| **Quick capture** | "Create a meeting note for tomorrow" | `vault_create_note` |

No policy required. Just ask Claude.

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

## The Determinism Story

### CRAFT: Authoring the Policy (one-time)

**Carter:**
> I need a standard workflow for onboarding new client projects.
> Create the project file, update the client record, log it to my daily note.

**Claude:** Here's a starting point:

```yaml
name: onboard-project
actions:
  - tool: vault_create_note
    target: projects/{project_name}.md
    frontmatter:
      type: project
      client: "{client}"
      status: active
  - tool: vault_add_to_section
    target: clients/{client}.md
    section: "## Projects"
    content: "- {project_name}"
  - tool: vault_add_to_section
    target: daily-notes/{today}.md
    section: "## Log"
    content: "Onboarded {project_name}"
```

**Carter:**
> Link the client and lead in frontmatter so I can query relationships.
> Add budget and timeline fields. Use timestamp format for the log.

**Claude:** Updated:

```yaml
name: onboard-project
description: Standard workflow for new client projects
actions:
  - tool: vault_create_note
    target: projects/{project_name}.md
    frontmatter:
      type: project
      client: "[[{client}]]"
      lead: "[[{lead}]]"
      budget: {budget}
      timeline: {timeline}
      status: active

  - tool: vault_add_to_section
    target: clients/{client}.md
    section: "## Active Projects"
    content: "- [[{project_name}]] - ${budget}"

  - tool: vault_add_to_section
    target: daily-notes/{today}.md
    section: "## Log"
    content: "Onboarded [[{project_name}]]"
    format: timestamp-bullet
```

**Carter:** That's what I need.

```bash
# Save to .crank/policies/onboard-project.yaml
git add .crank/policies/onboard-project.yaml
git commit -m "Add project onboarding policy"
```

**Policy is now code.** Versioned. Reviewed. Auditable.

---

### MINT: Executing the Policy (deterministic, forever)

**Execution 1:**

```
Carter: Onboard Acme Corp website redesign, $45K, Q2, Stacy leads
```

Claude matches intent → `onboard-project` policy → executes:

`projects/Acme Website Redesign.md` *(created)*:
```markdown
---
type: project
client: "[[Acme Corp]]"
lead: "[[Stacy Thompson]]"
budget: 45000
timeline: Q2 2026
status: active
---
# Acme Website Redesign
```

`clients/Acme Corp.md` *(updated)*:
```markdown
## Active Projects
- [[Acme Website Redesign]] - $45000
```

`daily-notes/2026-02-02.md` *(updated)*:
```markdown
## Log
- 14:32 Onboarded [[Acme Website Redesign]]
  → [[Acme Corp]] [[Stacy Thompson]] [[Q2 Delivery]]
```

**3 files. 1 commit. 1 undo.**

---

**Execution 2:**

```
Carter: New project for TechStart - mobile app, $28K, March delivery, Marcus
```

`projects/TechStart Mobile App.md` *(created)*:
```markdown
---
type: project
client: "[[TechStart Inc]]"
lead: "[[Marcus Johnson]]"
budget: 28000
timeline: March 2026
status: active
---
```

`clients/TechStart Inc.md` *(updated)*:
```markdown
## Active Projects
- [[TechStart Mobile App]] - $28000
```

`daily-notes/2026-02-02.md` *(updated)*:
```markdown
- 14:45 Onboarded [[TechStart Mobile App]]
  → [[TechStart Inc]] [[Marcus Johnson]] [[Mobile Projects]]
```

**3 files. 1 commit. 1 undo.**

---

**Execution 3:**

```
Carter: Onboard DataFlow analytics dashboard, $65K, Q3, Sarah
```

`projects/DataFlow Analytics Dashboard.md` *(created)*:
```markdown
---
type: project
client: "[[DataFlow Systems]]"
lead: "[[Sarah Chen]]"
budget: 65000
timeline: Q3 2026
status: active
---
```

`clients/DataFlow Systems.md` *(updated)*:
```markdown
## Active Projects
- [[DataFlow Analytics Dashboard]] - $65000
```

`daily-notes/2026-02-02.md` *(updated)*:
```markdown
- 15:10 Onboarded [[DataFlow Analytics Dashboard]]
  → [[DataFlow Systems]] [[Sarah Chen]] [[Analytics]]
```

**3 files. 1 commit. 1 undo.**

---

**The insight:** One craft session. Infinite deterministic mints.

**Why not just let AI edit files directly?**

| AI Edits Directly | Flywheel-Crank |
|-------------------|----------------|
| Non-deterministic | Same input → Same output |
| Hard to audit | Git tracks everything |
| Risky at scale | Bounded by policy |
| No structure | Section-scoped edits |

---

## More Examples

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

`projects/Artemis.md` *(updated)*:
```markdown
---
last_decision: "[[ADR-006 Turbopump Mitigation]]"
---
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

Mutations apply two types of linking: **syntactic** (exact matches) and **semantic** (graph-derived context).

**Syntactic vs Semantic Linking:**

| | Auto-Wikilinks (Syntactic) | Context Cloud (Semantic) |
|---|----------------------------|--------------------------|
| **Matching** | Exact text → entity name | Graph patterns → related concepts |
| **Input** | `"...with Marcus..."` | Your vault's link graph |
| **Output** | `[[Marcus Johnson]]` | `→ [[Propulsion System]] [[Test 4]]` |
| **Logic** | String found in text | Co-occurrence, shared neighbors, rare connections |

**Example:**
```
Input: "Discussed turbopump testing with Marcus"
Auto-wikilinks: [[Marcus Johnson]]
Context cloud: → [[Propulsion System]] [[Test 4]] [[Thermal Analysis]]
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `suggestOutgoingLinks` | `true` | Append contextual cloud (e.g., `→ [[Entity1]] [[Entity2]]`) |
| `maxSuggestions` | `3` | Number of suggestions (1-10) |

**Why this matters:** When you query later — "What was Marcus working on?" — the context cloud creates a **colocated network of meaning**. Related concepts cluster together even when not explicitly mentioned, making your vault's graph richer and more queryable over time.

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

### Test Scripts

| Script | Purpose |
|--------|---------|
| `npm test` | Run all tests |
| `npm run test:policy` | Policy execution and atomicity tests |
| `npm run test:coldstart` | Empty vault and cold start scenarios |
| `npm run test:concurrency` | Race condition and LWW semantics tests |
| `npm run test:undo` | Undo sequence and interference tests |

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

### The Tech Stack

| Technology | Purpose |
|------------|---------|
| **SQLite + FTS5** | Full-text search with instant prefix matching |
| **Porter Stemmer** | `testing` → `test`, matches across word forms |
| **Adamic-Adar** | Weights rare connections over common hubs |
| **Co-occurrence Matrix** | Learns link patterns from YOUR vault |

### The 9-Layer Scoring Pipeline

Every suggestion passes through 9 layers of scoring:

```
Input → Filter → Match → Boost → Rank → Suggest
         1-2       3-4    5-9
```

**Layers 1-2: Quality Filters**
- Skip entities >25 chars (article titles)
- Skip patterns like "Guide to", "How to", "Tutorial"

**Layers 3-4: Word Matching**

| Type | Points | Example |
|------|--------|---------|
| Exact match | +10 | `TypeScript` in text → +10 |
| Stem match | +3-6 | `testing` → `test` → +5 |
| Alias match | +8 bonus | `TS` matches `TypeScript` |

**Layers 5-9: Context Boosting**

| Layer | Boost | Logic |
|-------|-------|-------|
| **Type** | +5 | People score higher than technologies |
| **Context** | +5 | Daily notes boost people, tech docs boost frameworks |
| **Recency** | +5 | Mentioned in last 24h? Boost it |
| **Cross-folder** | +3 | Entity from different folder = richer graph |
| **Hub score** | +3 | 5+ backlinks = well-connected concept |

**Example scored:**
```
Input: "Met with Marcus about the turbopump"
Note: daily-notes/2026-02-02.md

Entity "Marcus Johnson":
  Exact match:     +10
  Type (person):   +5
  Context (daily): +5
  Recency (today): +5
  Cross-folder:    +3
  Hub (8 links):   +3
  Total:           31 ← suggested first

Entity "Turbopump":
  Exact match:     +10
  Type (tech):     +0
  Context (daily): +0
  Total:           10 ← suggested second
```

See [WIKILINK_INFERENCE.md](./docs/WIKILINK_INFERENCE.md) for the full algorithm specification.

### The Flywheel Effect

The more you use it, the smarter it gets. Not through AI training, but through the graph itself accumulating relationship intelligence.

*Built on foundations from [Liben-Nowell & Kleinberg](https://www.cs.cornell.edu/home/kleinber/link-pred.pdf) (link prediction), [Stanford NLP](https://web.stanford.edu/class/cs520/2020/notes/How_To_Create_A_Knowledge_Graph_From_Text.html) (knowledge extraction), and [Wikipedia entity linking](https://en.wikipedia.org/wiki/Entity_linking) research.*

---

Apache-2.0 License · [GitHub](https://github.com/velvetmonkey/flywheel-crank) · [Issues](https://github.com/velvetmonkey/flywheel-crank/issues)
