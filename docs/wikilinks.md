# Flywheel Crank - Auto-Wikilinks

Crank automatically links known entities as you write, creating a self-reinforcing knowledge graph without manual linking effort.

---

## Table of Contents

- [The Feedback Loop](#the-feedback-loop)
- [How Auto-Wikilinks Work](#how-auto-wikilinks-work)
- [Entity Inference Rules](#entity-inference-rules)
- [Entity Aliases](#entity-aliases)
- [Excluded Folders](#excluded-folders)
- [Template Placeholder Handling](#template-placeholder-handling)
- [Controlling Wikilinks](#controlling-wikilinks)
- [Suggested Outgoing Links](#suggested-outgoing-links)

---

## The Feedback Loop

Auto-wikilinks create a virtuous cycle that makes your vault more connected over time:

```
┌─────────────────────────────────────────────────────────────────┐
│               WIKILINK FEEDBACK LOOP                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   1. CREATE NOTE                                                │
│      └─→ "Alex Rivera.md" created                               │
│          └─→ Entity index adds "Alex Rivera" as linkable        │
│                                                                 │
│   2. ADD CONTENT (via Crank)                                    │
│      └─→ "Met with Alex Rivera about Turbopump"                 │
│          └─→ Auto-wikilinks: "Met with [[Alex Rivera]]          │
│              about [[Turbopump]]"                               │
│          └─→ NEW BACKLINKS CREATED in graph                     │
│                                                                 │
│   3. QUERY GRAPH (via Flywheel)                                 │
│      └─→ "What links to Alex Rivera?"                        │
│          └─→ Backlink discovered! Content is now connected      │
│                                                                 │
│   4. DISCOVER MORE                                              │
│      └─→ Graph shows connections you didn't manually create     │
│          └─→ More context → better AI suggestions               │
│          └─→ Better suggestions → more notes created            │
│          └─→ GOTO 1                                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**The Key Insight:**
You don't manually link everything. You just write naturally and Crank links for you. Over time, your vault becomes MORE connected without extra effort.

---

## How Auto-Wikilinks Work

### The Process

1. **On Crank startup:** Entity index built from vault notes
2. **Index cached:** Stored in `.claude/wikilink-entities.json`
3. **On mutation:** Content scanned for known entities
4. **Matches linked:** First occurrence of each entity gets `[[wikilink]]`
5. **Cache refreshes:** Auto-refreshes if >1 hour old

### Example

**Input (via `mcp__flywheel-crank__vault_add_to_section`):**
```
Met with Alex Rivera about the Turbopump delay
```

**Output (auto-linked):**
```
Met with [[Alex Rivera]] about the [[Turbopump]] delay
```

### Matching Behavior

| Option | Default | Description |
|--------|---------|-------------|
| `firstOccurrenceOnly` | `true` | Only link first mention per content block |
| `caseInsensitive` | `true` | "alex rivera" matches "Alex Rivera" |

**Case Preservation:** Original case is preserved in output: `[[Alex Rivera]]` not `[[alex rivera]]`

---

## Entity Inference Rules

Crank infers entities from your vault structure:

### Categories

| Category | Source | Examples |
|----------|--------|----------|
| `people` | Notes in team/people folders, names with spaces | "Alex Rivera", "Jordan Lee" |
| `projects` | Notes in systems/projects folders | "Engine Design", "Turbopump" |
| `technologies` | Tech-related note titles | "LOX/RP-1", "GNC System" |
| `acronyms` | ALL CAPS or known acronyms | "CDR", "PDR", "TVC", "IMU" |
| `other` | Everything else that's a note | "Risk Register", "Roadmap" |

### Inference Logic

The entity scanner (from `@velvetmonkey/vault-core`):

1. **Scans vault** for all `.md` files (excluding periodic folders)
2. **Extracts title** from filename (strips `.md`, preserves spaces)
3. **Categorizes** based on folder path and title patterns
4. **Builds index** with lowercase variants for matching
5. **Caches index** in `.claude/wikilink-entities.json`

### Category Detection

**People detection:**
- Notes in folders containing: `team`, `people`, `contacts`, `staff`
- Titles with 2-3 capitalized words (e.g., "Jordan Lee")
- Titles matching common name patterns

**Project detection:**
- Notes in folders containing: `projects`, `systems`, `components`
- Titles referencing technical artifacts

**Technology detection:**
- Titles containing technical terms
- Notes in `tech`, `tools`, `stack` folders

**Acronym detection:**
- Titles that are ALL CAPS (3+ characters)
- Known acronym patterns (API, CLI, MCP, etc.)

---

## Entity Aliases

**New in v0.9.0:** Crank now reads aliases from note frontmatter, allowing alternative names to trigger wikilink suggestions.

### How Aliases Work

When Crank scans your vault, it reads the `aliases` field from each note's frontmatter and includes those as alternative match targets.

**Example:**
```yaml
---
aliases: [Production, Prod]
---
# PRD

Product Requirements Document...
```

With this configuration:
- Content mentioning "Production" will suggest `[[PRD]]`
- Content mentioning "Prod" will suggest `[[PRD]]`
- Content mentioning "PRD" will suggest `[[PRD]]` (primary name still works)

### Alias Filtering Rules

Aliases follow the same filtering rules as entity names:
- **Max 25 characters** - Long aliases are filtered out
- **Max 3 words** - Multi-word phrases beyond 3 words are filtered

**Filtered (not indexed):**
- `Product Requirements Document` (4 words)
- `A Very Long Alternative Name That Is Too Descriptive` (too long)

**Kept (indexed):**
- `Production` (1 word, ≤25 chars)
- `Prod` (1 word, ≤25 chars)
- `Product Reqs` (2 words, ≤25 chars)

### Alias Formats Supported

Crank supports standard YAML alias formats:

**Inline array:**
```yaml
aliases: [Alias1, Alias2, Alias3]
```

**List format:**
```yaml
aliases:
  - Alias1
  - Alias2
  - Alias3
```

**Single value:**
```yaml
aliases: SingleAlias
```

### Best Practices for Aliases

1. **Add short, common alternatives**
   ```yaml
   aliases: [JS, JavaScript]  # Both short variations
   ```

2. **Use acronym expansions**
   ```yaml
   # In API.md
   aliases: [Application Programming Interface]
   ```

3. **Add common misspellings or variations**
   ```yaml
   aliases: [TypeScript, Typescript, TS]
   ```

4. **Don't add generic phrases**
   ```yaml
   # Avoid:
   aliases: [The Thing, A Concept, Some Idea]
   ```

### Cache Considerations

- Aliases are cached with the entity index
- Cache version upgraded (v2) to support alias schema
- Old caches automatically rebuild on first access

---

## Excluded Folders

These folders are excluded from entity scanning (their notes won't become linkable entities):

| Folder | Reason |
|--------|--------|
| `daily-notes` | Daily notes are dates, not entities |
| `daily` | Alternative daily folder |
| `weekly` | Weekly reviews aren't entities |
| `monthly` | Monthly reviews |
| `quarterly` | Quarterly reviews |
| `periodic` | Generic periodic folder |
| `journal` | Journal entries |
| `inbox` | Unsorted captures |
| `templates` | Template files |

### Why Exclude Periodic Notes?

Daily notes contain references to people/projects but ARE NOT entities themselves.

**Without exclusion:**
- `2026-01-28.md` mentions "Alex Rivera" → link created
- `2026-01-28.md` itself becomes an entity → **Wrong!** It's a date, not an entity.

**With exclusion:**
- `2026-01-28.md` mentions "Alex Rivera" → link created
- `2026-01-28.md` is NOT indexed as an entity → **Correct!**

### Content IN Periodic Notes Still Gets Linked

**Important distinction:**
- The periodic NOTE ITSELF isn't scanned for entities
- But content you ADD via Crank gets wikilinked (if entities match)

```javascript
// This works - add to today's daily note
mcp__flywheel-crank__vault_add_to_section({
  path: "daily-notes/2026-01-28.md",
  section: "Log",
  content: "Met with Alex Rivera"
})
// Result: "Met with [[Alex Rivera]]"
//         ↑ Wikilinks applied (Alex Rivera is an entity)
//         ↑ But the daily note itself isn't an entity
```

---

## Template Placeholder Handling

Templates often have placeholder lines that Crank handles intelligently.

### The Problem

Templates like:
```markdown
## Tasks
- [ ]

## Log
1.
```

**Without smart handling:** Crank appends AFTER the placeholder
```markdown
## Log
1.
1. My new entry    ← Added after empty placeholder (ugly)
```

**With smart handling:** Crank REPLACES the placeholder
```markdown
## Log
1. My new entry    ← Replaced the empty "1." (clean)
```

### Detected Placeholder Patterns

| Pattern | Example | Description |
|---------|---------|-------------|
| `/^\d+\.\s*$/` | `1. ` | Empty numbered item |
| `/^-\s*$/` | `- ` | Empty bullet |
| `/^-\s*\[\s*\]\s*$/` | `- [ ] ` | Empty task |
| `/^-\s*\[x\]\s*$/i` | `- [x] ` | Empty completed task |
| `/^\*\s*$/` | `* ` | Empty asterisk bullet |

### Example with Templates

```javascript
// Template has: "## Tasks\n- [ ]"
mcp__flywheel-crank__vault_add_task({
  path: "daily-notes/2026-01-28.md",
  section: "Tasks",
  task: "Review PR"
})
// Result: "## Tasks\n- [ ] Review PR"
//         ↑ Empty "- [ ]" placeholder was REPLACED, not appended after
```

---

## Controlling Wikilinks

### Per-Call Control

Use `skipWikilinks: true` to disable auto-linking for a specific call:

```javascript
// With auto-wikilinks (default)
mcp__flywheel-crank__vault_add_task({
  task: "Review Sam Chen's PR"
})
// Result: "- [ ] Review [[Sam Chen]]'s PR"

// Without auto-wikilinks
mcp__flywheel-crank__vault_add_task({
  task: "Review Sam Chen's PR",
  skipWikilinks: true
})
// Result: "- [ ] Review Sam Chen's PR"
```

### When to Disable

**Disable when:**
- Content already has wikilinks (avoid double-linking)
- Adding raw text that shouldn't be linked
- Entity names are being used generically (not as references)

```javascript
// Content already has wikilinks - skip to avoid [[[[nested]]]]
mcp__flywheel-crank__vault_add_to_section({
  content: "Talked to [[Sam Chen]] about [[Project Alpha]]",
  skipWikilinks: true
})
```

### Tools with Wikilink Support

| Tool | Auto-Wikilinks | Parameter |
|------|----------------|-----------|
| `mcp__flywheel-crank__vault_add_to_section` | Yes | `skipWikilinks: boolean` |
| `mcp__flywheel-crank__vault_replace_in_section` | Yes | `skipWikilinks: boolean` |
| `mcp__flywheel-crank__vault_add_task` | Yes | `skipWikilinks: boolean` |
| `mcp__flywheel-crank__vault_remove_from_section` | No | N/A |
| `mcp__flywheel-crank__vault_toggle_task` | No | N/A |
| `mcp__flywheel-crank__vault_update_frontmatter` | No | N/A |
| `mcp__flywheel-crank__vault_create_note` | No | N/A |
| `mcp__flywheel-crank__vault_delete_note` | No | N/A |

---

## Suggested Outgoing Links

Mutation tools can automatically suggest contextual wikilinks based on the content you're adding. This helps capture implicit connections between your notes.

### How It Works

When you add content via `vault_add_to_section`, `vault_replace_in_section`, or `vault_add_task`, Crank analyzes the text and appends relevant entity suggestions in a suffix format:

```
Your content here → [[Related Entity]] [[Another Entity]]
```

### The Suggestion Algorithm

1. **Tokenization**: Content is split into significant words (4+ characters, excluding stopwords like "the", "and", "with")
2. **Entity Scoring**: Each entity in your vault is scored by word overlap with the content
3. **Exclusion**: Entities already linked in the content are excluded
4. **Selection**: Top 3 scoring entities are suggested (configurable)

### Example

**Input:**
```javascript
mcp__flywheel-crank__vault_add_to_section({
  path: "daily-notes/2026-01-28.md",
  section: "Log",
  content: "Discussed TypeScript migration with the team",
  format: "timestamp-bullet"
})
```

**Output:**
```markdown
## Log
- **14:32** Discussed TypeScript migration with the team → [[TypeScript]] [[Migration Plan]]
```

### Controlling Suggestions

**Disable per-call:**
```javascript
mcp__flywheel-crank__vault_add_to_section({
  content: "Plain content without suggestions",
  suggestOutgoingLinks: false  // No suffix added
})
```

**Default behavior:** `suggestOutgoingLinks: true` (suggestions enabled)

### Idempotency

Crank detects if content already has a suggestion suffix and won't duplicate:

```markdown
// First add:
Content here → [[Entity1]] [[Entity2]]

// Second add with same content:
// Won't add another → suffix (detects existing)
```

### Supported Tools

| Tool | Suggestions | Parameter |
|------|-------------|-----------|
| `mcp__flywheel-crank__vault_add_to_section` | Yes | `suggestOutgoingLinks: boolean` |
| `mcp__flywheel-crank__vault_replace_in_section` | Yes | `suggestOutgoingLinks: boolean` |
| `mcp__flywheel-crank__vault_add_task` | Yes | `suggestOutgoingLinks: boolean` |

### When to Disable

- **Already have wikilinks**: Content like "Working with [[Sam Chen]]" doesn't need more suggestions
- **Technical content**: Code snippets or logs where suggestions would be noise
- **Bulk operations**: When adding many items programmatically

---

## Cache Management

### Location

`{vault}/.claude/wikilink-entities.json`

### Refresh Behavior

- Auto-refreshes if >1 hour old
- Rebuilds on Crank MCP server restart
- Can be deleted to force full rebuild

### Manual Refresh

Delete the cache file and restart the Crank MCP server:

```bash
rm .claude/wikilink-entities.json
# Restart Claude Code or reload MCP servers
```

---

## Best Practices

### 1. Create Notes for Important Entities

The more notes you create, the more entities Crank can link:

```
Create "Alex Rivera.md" → "Alex Rivera" becomes linkable
Create "Project Alpha.md"  → "Project Alpha" becomes linkable
```

### 2. Use Consistent Naming

Entity matching is case-insensitive but consistent naming helps:

```
Good: "Alex Rivera.md" → matches "alex rivera", "Alex Rivera"
Avoid: "ARivera.md" → won't match "Alex Rivera"
```

### 3. Leverage Aliases for Variations

Add frontmatter aliases for common variations:

```yaml
---
aliases: [AI, Machine Learning, ML]
---
# Artificial Intelligence
```

This ensures content mentioning "AI", "Machine Learning", or "ML" suggests `[[Artificial Intelligence]]`.

### 4. Let the Feedback Loop Work

1. Create a note
2. Mention it naturally in other notes
3. Query backlinks to discover connections
4. Connections reveal related topics
5. Create more notes
6. Repeat

### 5. Don't Over-Link

First occurrence is usually enough:

```
"Met with [[Alex Rivera]] about the project. Alex said..."
↑ Linked first time                           ↑ Not linked again (correct)
```

---

## See Also

- [Configuration](./configuration.md) - Entity cache settings
- [Tools Reference](./tools-reference.md) - Wikilink parameters
- [Privacy](./privacy.md) - How entity data is handled
