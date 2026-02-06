# Flywheel vs Alternatives: A Comparison Guide

This document helps you understand when to use Flywheel-Crank vs other tools for Obsidian vault management. We're honest about trade-offs because the right tool depends on your use case.

---

## Table of Contents

1. [Quick Decision Matrix](#quick-decision-matrix)
2. [Flywheel vs Dataview](#flywheel-vs-dataview)
3. [Crank vs Edit Tool](#crank-vs-edit-tool)
4. [Crank vs Other Obsidian MCP Servers](#crank-vs-other-obsidian-mcp-servers)
5. [Token Cost Comparison](#token-cost-comparison)
6. [When to Use What](#when-to-use-what)
7. [Migration Decision Tree](#migration-decision-tree)

---

## Quick Decision Matrix

| I want to... | Best Tool | Runner-Up |
|--------------|-----------|-----------|
| Query vault with AI assistant | **Flywheel** | Dataview (manual queries) |
| Add log entries with formatting | **Crank** | Edit tool |
| Toggle tasks by partial match | **Crank** | Edit tool |
| Bulk find/replace across files | Edit tool + Bash | Crank (single file only) |
| Complex multi-section edits | Edit tool | Crank (section-scoped only) |
| Get backlinks for a note | **Flywheel** | Obsidian API |
| Auto-link entities as you write | **Crank** | Manual wikilinks |
| Audit trail of all changes | **Crank** (git commits) | Git + Edit tool |
| Query Dataview metadata | Dataview | Flywheel (reads frontmatter) |
| Real-time live queries | Dataview | Flywheel (1hr cache) |

---

## Flywheel vs Dataview

### What They Are

**Flywheel MCP:** 51 read-only tools for querying Obsidian vaults via AI assistants. Returns structured data optimized for LLM consumption.

**Dataview:** Obsidian plugin for querying vault data using SQL-like syntax. Results render in the Obsidian UI.

### Feature Comparison

| Feature | Flywheel MCP | Dataview |
|---------|--------------|----------|
| Query language | Natural language (via AI) | DQL/DataviewJS |
| Learning curve | Low (just ask) | Medium (learn syntax) |
| Backlink queries | Built-in (51 tools) | Manual joins |
| Graph intelligence | Entity index, relationships | No graph awareness |
| Real-time updates | 1-hour cache | Instant |
| Works outside Obsidian | Yes (MCP protocol) | No (plugin only) |
| Token efficiency | ~50-500 tokens/query | N/A (rendered in UI) |
| Complex aggregations | Limited | Full SQL-like power |
| Custom views | Returns JSON | Renders tables, lists, tasks |

### Token Cost Example

**Scenario:** "Find all notes tagged #project with incomplete tasks"

**With Dataview (via Edit tool reading):**
```
1. Read entire note with Dataview query block (~2,000 tokens)
2. Parse Dataview results from rendered markdown
3. Total: ~2,000-5,000 tokens depending on note size
```

**With Flywheel:**
```javascript
flywheel.query_backlinks({ tag: "project" })
// Returns: structured JSON, ~200 tokens
// Plus: get_tasks({ status: "incomplete" })
// Returns: task list, ~150 tokens
// Total: ~350 tokens
```

**Savings: 85-93%**

### When to Use Each

**Use Flywheel when:**
- Querying via AI assistant (Claude Code, etc.)
- Need backlink/graph intelligence
- Want token-efficient responses
- Working outside Obsidian
- Building automations via MCP

**Use Dataview when:**
- Need real-time query results
- Complex SQL-like aggregations
- Rendering live dashboards in Obsidian
- DataviewJS custom rendering
- No AI assistant involved

### Can They Work Together?

Yes! Flywheel reads frontmatter that Dataview queries. Your vault can use both:
- Dataview for in-Obsidian dashboards
- Flywheel for AI-assisted queries and automations

---

## Crank vs Edit Tool

### What They Are

**Flywheel-Crank:** 11 deterministic mutation tools for surgical vault edits. Section-scoped operations with git integration.

**Edit Tool:** Claude Code's built-in file editing. Find/replace with full file access.

### Feature Comparison

| Feature | Flywheel-Crank | Edit Tool |
|---------|----------------|-----------|
| Operation scope | Section-scoped | Full file |
| Formatting | Auto-formats (bullets, timestamps, tasks) | Manual |
| Wikilinks | Auto-links known entities | Manual |
| Git integration | Auto-commit per mutation | Manual commits |
| Undo | `vault_undo_last_mutation` | Manual git revert |
| Multi-file | One file per call | One file per call |
| Task toggle | By partial match | Exact string match |
| Frontmatter | Safe YAML merge | Manual editing |
| Audit trail | Built-in commit messages | Manual |
| Cross-section edit | No (use Edit tool) | Yes |
| Prose rewriting | No (deterministic only) | Yes |

### Example: Adding a Log Entry

**With Edit Tool:**
```
1. Read file to find "## Log" section
2. Determine correct insertion point
3. Format content with timestamp and bullet
4. Handle existing content formatting
5. Write file (may corrupt frontmatter if not careful)
6. Manually commit if audit trail needed
```

**With Crank:**
```javascript
vault_add_to_section({
  path: "daily-notes/2026-01-30.md",
  section: "Log",
  content: "Completed API review",
  format: "timestamp-bullet",
  commit: true
})
// Result: "- 14:30 Completed API review → [[API]] [[Code Review]]"
// Git commit created automatically
```

### Example: Toggling a Task

**With Edit Tool:**
```
1. Search for exact task text
2. Replace "- [ ]" with "- [x]"
3. Hope no other tasks have similar text
```

**With Crank:**
```javascript
vault_toggle_task({
  path: "daily-notes/2026-01-30.md",
  task: "groceries"  // Partial match!
})
// Finds "- [ ] Buy groceries" and toggles it
```

### When to Use Each

**Use Crank when:**
- Adding content to specific sections
- Toggling/adding tasks
- Updating frontmatter safely
- Need audit trail (git commits)
- Want auto-wikilinks
- Consistent formatting matters

**Use Edit Tool when:**
- Cross-section edits
- Prose rewriting
- Complex regex replacements
- File structure changes
- Multi-paragraph edits

---

## Crank vs Other Obsidian MCP Servers

### Competitor Landscape (Jan 2026)

| Server | Strengths | Weaknesses |
|--------|-----------|------------|
| [cyanheads/obsidian-mcp-server](https://github.com/cyanheads/obsidian-mcp-server) | Full CRUD, REST API | Requires Obsidian plugin running |
| [bitbonsai/mcp-obsidian](https://github.com/bitbonsai/mcp-obsidian) | Universal AI bridge | Read-only, no mutations |
| [jacksteamdev/obsidian-mcp-tools](https://github.com/jacksteamdev/obsidian-mcp-tools) | Semantic search, templates | Requires Obsidian plugin |
| [smithery-ai/mcp-obsidian](https://github.com/smithery-ai/mcp-obsidian) | Claude Desktop connector | Basic read, no graph intelligence |

### Flywheel-Crank Differentiation

| Feature | Flywheel-Crank | Most Competitors |
|---------|----------------|------------------|
| Tools count | 51 read + 11 write | 5-15 total |
| Standalone | Yes (no plugin needed) | Often requires plugin |
| Graph intelligence | Entity index, backlinks | Basic file access |
| Auto-wikilinks | Yes (on mutations) | No |
| Deterministic | Yes (predictable outputs) | Varies |
| Git integration | Built-in commits, undo | Rare |
| Test coverage | 1465 tests | Often minimal |
| Token efficiency | Optimized JSON responses | Often full documents |

### Why Choose Flywheel-Crank

1. **Standalone:** Works without Obsidian running
2. **Graph-aware:** Entity index builds relationships
3. **Token-efficient:** Returns snippets, not documents
4. **Auditable:** Git commits on every mutation
5. **Production-tested:** 523 automated tests

---

## Token Cost Comparison

### Real-World Scenarios

**Scenario 1: Daily Note Logging**

| Approach | Tokens Used | Notes |
|----------|-------------|-------|
| Read full note + Edit | 1,500-3,000 | Depends on note size |
| Flywheel read + Crank write | 150-300 | Section-scoped |
| **Savings** | **80-90%** | |

**Scenario 2: Finding Related Notes**

| Approach | Tokens Used | Notes |
|----------|-------------|-------|
| Read multiple files, grep | 5,000-20,000 | Scales with vault size |
| Flywheel backlink query | 200-500 | Fixed response size |
| **Savings** | **95-99%** | |

**Scenario 3: Task Management**

| Approach | Tokens Used | Notes |
|----------|-------------|-------|
| Read file, find task, edit | 1,000-2,000 | Full file roundtrip |
| Crank toggle_task | 100-200 | Direct operation |
| **Savings** | **80-90%** | |

### Monthly Cost Estimate

**Active daily note user (20 ops/day, 30 days):**

| Approach | Tokens/Op | Monthly Tokens | Cost (Claude) |
|----------|-----------|----------------|---------------|
| Edit tool approach | ~2,000 | 1.2M | ~$4-8 |
| Flywheel-Crank | ~200 | 120K | ~$0.40-0.80 |
| **Savings** | | | **~$3-7/month** |

### The 200K Token Threshold

Claude's pricing doubles above 200K tokens per conversation. Flywheel-Crank's efficiency helps stay under this threshold:

- **Without Flywheel:** 100 file operations = ~200K tokens (hits threshold)
- **With Flywheel:** 100 operations = ~20K tokens (safely under)

---

## When to Use What

### Decision Guide

```
Need to READ vault data?
├── Query via AI assistant? → Flywheel
├── Real-time dashboard in Obsidian? → Dataview
├── Simple file read? → Read tool
└── Graph relationships? → Flywheel

Need to WRITE vault data?
├── Section-scoped addition? → Crank
├── Task toggle/add? → Crank
├── Frontmatter update? → Crank
├── Cross-section edit? → Edit tool
├── Prose rewriting? → Edit tool
├── File rename/move? → Filesystem
└── Bulk multi-file changes? → Bash scripts

Need AUDIT TRAIL?
├── Yes → Crank (git commits)
└── No → Any tool

Need AUTO-WIKILINKS?
├── Yes → Crank
└── No → Edit tool
```

### The Hybrid Approach

Most workflows combine tools:

```
1. Flywheel: Query for notes matching criteria
2. Crank: Add content to matching notes
3. Flywheel: Verify changes
4. Edit tool: Manual prose fixes if needed
```

---

## Migration Decision Tree

### Should I Migrate to Flywheel-Crank?

```
Are you using an AI assistant with your vault?
├── No → Stick with Obsidian + Dataview
└── Yes ↓

Do you make frequent section-scoped additions?
├── No → Edit tool might be simpler
└── Yes ↓

Do you want auto-wikilinks and formatting?
├── No → Edit tool works fine
└── Yes ↓

Do you need audit trail (git commits)?
├── No → Either tool works
└── Yes → ★ Flywheel-Crank recommended

Is token cost a concern?
├── No → Either tool works
└── Yes → ★ Flywheel-Crank recommended (90% savings)
```

### Migration Path

If you decide to migrate, see [MIGRATION.md](MIGRATION.md) for:
- Gradual adoption strategies
- Permission configuration
- Common migration patterns
- Rollback procedures

---

## Honest Trade-offs

### What Flywheel-Crank Does Well
- Token-efficient vault queries
- Consistent formatting on mutations
- Auto-wikilinks based on entity index
- Git audit trail
- Section-scoped safety

### What Flywheel-Crank Doesn't Do
- Real-time updates (1-hour cache)
- Semantic search (symbolic only, no embeddings)
- Cross-section edits
- Multi-file batch operations
- Prose generation (deterministic only)
- Canvas/Kanban/Excalidraw support

### The Bottom Line

**Use Flywheel-Crank if:**
- You use AI assistants with your vault
- You want consistent, auditable mutations
- Token costs matter
- You value the self-building knowledge graph

**Stick with alternatives if:**
- You don't use AI assistants
- You need real-time Dataview dashboards
- Your edits are primarily cross-section prose
- Your vault uses Kanban/Canvas extensively

---

## See Also

- [LIMITATIONS.md](LIMITATIONS.md) - Full list of what Crank cannot do
- [MIGRATION.md](MIGRATION.md) - How to transition from Edit tool
- [tools-reference.md](tools-reference.md) - Complete tool documentation
- [PERFORMANCE.md](PERFORMANCE.md) - Benchmarks and optimization
