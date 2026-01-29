# Flywheel Crank - Auto-Wikilinks

Crank automatically links known entities as you write, creating a self-reinforcing knowledge graph without manual linking effort.

---

## Table of Contents

- [The Feedback Loop](#the-feedback-loop)
- [How Auto-Wikilinks Work](#how-auto-wikilinks-work)
- [Entity Inference Rules](#entity-inference-rules)
- [Excluded Folders](#excluded-folders)
- [Template Placeholder Handling](#template-placeholder-handling)
- [Controlling Wikilinks](#controlling-wikilinks)

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

**Input (via `vault_add_to_section`):**
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
vault_add_to_section({
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
vault_add_task({
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
vault_add_task({
  task: "Review Sam Chen's PR"
})
// Result: "- [ ] Review [[Sam Chen]]'s PR"

// Without auto-wikilinks
vault_add_task({
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
vault_add_to_section({
  content: "Talked to [[Sam Chen]] about [[Project Alpha]]",
  skipWikilinks: true
})
```

### Tools with Wikilink Support

| Tool | Auto-Wikilinks | Parameter |
|------|----------------|-----------|
| `vault_add_to_section` | Yes | `skipWikilinks: boolean` |
| `vault_replace_in_section` | Yes | `skipWikilinks: boolean` |
| `vault_add_task` | Yes | `skipWikilinks: boolean` |
| `vault_remove_from_section` | No | N/A |
| `vault_toggle_task` | No | N/A |
| `vault_update_frontmatter` | No | N/A |
| `vault_create_note` | No | N/A |
| `vault_delete_note` | No | N/A |

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

### 3. Let the Feedback Loop Work

1. Create a note
2. Mention it naturally in other notes
3. Query backlinks to discover connections
4. Connections reveal related topics
5. Create more notes
6. Repeat

### 4. Don't Over-Link

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
