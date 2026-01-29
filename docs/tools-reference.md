# Flywheel Crank - Tools Reference

Complete reference for all Flywheel Crank MCP tools with visual examples, decision guides, and configuration documentation.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Read-Write-Verify Pattern                    │
├─────────────────────────────────────────────────────────────────┤
│  1. READ (Flywheel)                │  2. WRITE (Crank)                    │  3. VERIFY    │
│  mcp__flywheel__get_section_content()  │  mcp__flywheel-crank__vault_add_to_section() │  re-read      │
│  ~50 tokens                        │  atomic mutation                     │  confirm      │
└─────────────────────────────────────────────────────────────────┘

Why this pattern?
• Flywheel provides context (graph intelligence, backlinks, search)
• Crank executes deterministic writes (no AI-driven edits)
• Re-read confirms mutation succeeded
```

---

## Tool Categories

| Category | Tools | Purpose |
|----------|-------|---------|
| **Mutations** | add/remove/replace | Section-scoped content changes |
| **Tasks** | toggle/add | Checkbox operations |
| **Frontmatter** | update/add | YAML field mutations |
| **Notes** | create/delete | File operations |
| **System** | list/undo | Discovery and rollback |

---

## Decision Tree: When to Use Crank

```
Should I use Flywheel-Crank or Edit tool?
│
├─ Adding to a section? ──────────────────────► mcp__flywheel-crank__vault_add_to_section
│   "Add a log entry"                            (timestamp-bullet format)
│
├─ Toggling a task checkbox? ─────────────────► mcp__flywheel-crank__vault_toggle_task
│   "Mark the groceries task done"               (finds by partial match)
│
├─ Adding a new task? ────────────────────────► mcp__flywheel-crank__vault_add_task
│   "Add a task to review the PR"                (auto-formats checkbox)
│
├─ Updating frontmatter? ─────────────────────► mcp__flywheel-crank__vault_update_frontmatter
│   "Set status to complete"                     (preserves other fields)
│
├─ Removing specific lines? ──────────────────► mcp__flywheel-crank__vault_remove_from_section
│   "Remove all TODO items"                      (regex support)
│
├─ Replacing content? ────────────────────────► mcp__flywheel-crank__vault_replace_in_section
│   "Change PENDING to DONE"                     (first/last/all modes)
│
├─ Creating a new note? ──────────────────────► mcp__flywheel-crank__vault_create_note
│   "Create a meeting note"                      (with frontmatter template)
│
├─ Free-form prose edit? ─────────────────────► Consider Edit tool
│   Paragraph rewriting, complex formatting      (escape hatch)
│
└─ Need to undo last change? ─────────────────► mcp__flywheel-crank__vault_undo_last_mutation
    "Undo that last change"                      (git soft reset)
```

---

## Mutation Tools

### mcp__flywheel-crank__vault_add_to_section

Add content to a markdown section with automatic formatting.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | Vault-relative path (e.g., `daily-notes/2026-01-28.md`) |
| `section` | string | Yes | Section heading (case-insensitive) |
| `content` | string | Yes | Content to add |
| `position` | `append` \| `prepend` | No | Where to insert (default: `append`) |
| `format` | FormatType | No | Formatting style (default: `plain`) |
| `commit` | boolean | No | Git commit after mutation |
| `skipWikilinks` | boolean | No | Disable auto-wikilinks (default: `false`) |
| `suggestOutgoingLinks` | boolean | No | Append entity suggestions (default: `true`) |

**Format Types:**
| Format | Output Example |
|--------|----------------|
| `plain` | `Content as-is` |
| `bullet` | `- Content` |
| `task` | `- [ ] Content` |
| `numbered` | `1. Content` |
| `timestamp-bullet` | `- **14:32** Content` |

**Example:**

```
┌─ MUTATION: mcp__flywheel-crank__vault_add_to_section ─────────────────┐
│ Path:     notes/project-alpha.md                 │
│ Section:  ## Progress                            │
│ Content:  "Completed API integration"            │
│ Format:   timestamp-bullet                       │
├──────────────────────────────────────────────────┤
│ Result:   - **15:42** Completed API integration  │
│ Git:      [Crank:Add] Update notes/project-...   │
└──────────────────────────────────────────────────┘
```

**Before/After:**

```markdown
## Progress                          ## Progress
                            ──►      - **15:42** Completed API integration
```

---

### mcp__flywheel-crank__vault_remove_from_section

Remove lines matching a pattern from a section.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | Vault-relative path |
| `section` | string | Yes | Section heading |
| `pattern` | string | Yes | Text or regex to match |
| `mode` | `first` \| `last` \| `all` | No | Which matches to remove (default: `first`) |
| `useRegex` | boolean | No | Treat pattern as regex (default: `false`) |
| `commit` | boolean | No | Git commit after mutation |

**Example:**

```
┌─ MUTATION: mcp__flywheel-crank__vault_remove_from_section ────────────┐
│ Path:     tasks/backlog.md                       │
│ Section:  ## Done                                │
│ Pattern:  ^- \[x\] .*2025.*$                     │
│ Mode:     all                                    │
│ Regex:    true                                   │
├──────────────────────────────────────────────────┤
│ Removed:  3 lines matching pattern               │
└──────────────────────────────────────────────────┘
```

---

### mcp__flywheel-crank__vault_replace_in_section

Replace content in a section (supports regex capture groups).

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | Vault-relative path |
| `section` | string | Yes | Section heading |
| `search` | string | Yes | Text or regex to find |
| `replacement` | string | Yes | Replacement text (supports `$1`, `$2` for captures) |
| `mode` | `first` \| `last` \| `all` | No | Which matches to replace (default: `first`) |
| `useRegex` | boolean | No | Treat search as regex (default: `false`) |
| `commit` | boolean | No | Git commit after mutation |
| `skipWikilinks` | boolean | No | Disable auto-wikilinks on replacement |
| `suggestOutgoingLinks` | boolean | No | Append entity suggestions (default: `true`) |

**Example with Regex Capture:**

```
┌─ MUTATION: mcp__flywheel-crank__vault_replace_in_section ─────────────┐
│ Path:     notes/tasks.md                         │
│ Section:  ## Backlog                             │
│ Search:   ^- Task: (.+)$                         │
│ Replace:  - [ ] $1                               │
│ Mode:     all                                    │
│ Regex:    true                                   │
├──────────────────────────────────────────────────┤
│ Before:   - Task: Buy groceries                  │
│ After:    - [ ] Buy groceries                    │
└──────────────────────────────────────────────────┘
```

---

## Task Tools

### mcp__flywheel-crank__vault_toggle_task

Toggle a task checkbox between checked and unchecked.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | Vault-relative path |
| `task` | string | Yes | Partial task text to match (case-insensitive) |
| `section` | string | No | Limit search to section |
| `commit` | boolean | No | Git commit after mutation |

**Matching Behavior:**
- Case-insensitive partial match
- Finds first matching task
- Section boundary respected if specified

**Example:**

```
┌─ MUTATION: mcp__flywheel-crank__vault_toggle_task ────────────────────┐
│ Path:     daily-notes/2026-01-28.md              │
│ Task:     "groceries"                            │
│ Section:  ## Tasks                               │
├──────────────────────────────────────────────────┤
│ Found:    - [ ] Buy groceries from store         │
│ Toggled:  - [x] Buy groceries from store         │
│ State:    completed                              │
└──────────────────────────────────────────────────┘
```

---

### mcp__flywheel-crank__vault_add_task

Add a new task to a section.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | Vault-relative path |
| `section` | string | Yes | Section heading |
| `task` | string | Yes | Task description |
| `position` | `append` \| `prepend` | No | Where to insert (default: `append`) |
| `completed` | boolean | No | Start as completed (default: `false`) |
| `commit` | boolean | No | Git commit after mutation |
| `skipWikilinks` | boolean | No | Disable auto-wikilinks |
| `suggestOutgoingLinks` | boolean | No | Append entity suggestions (default: `true`) |

**Example:**

```
┌─ MUTATION: mcp__flywheel-crank__vault_add_task ───────────────────────┐
│ Path:     daily-notes/2026-01-28.md              │
│ Section:  ## Tasks                               │
│ Task:     "Review PR for MCP Server"             │
│ Position: prepend                                │
├──────────────────────────────────────────────────┤
│ Added:    - [ ] Review PR for [[MCP Server]]     │
│ Wikilinks: Applied 1 (MCP Server)               │
└──────────────────────────────────────────────────┘
```

---

## Frontmatter Tools

### mcp__flywheel-crank__vault_update_frontmatter

Update or merge fields in note frontmatter.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | Vault-relative path |
| `updates` | object | Yes | Key-value pairs to update/add |
| `commit` | boolean | No | Git commit after mutation |

**Merge Behavior:**
- Existing fields are updated
- New fields are added
- Other fields preserved
- Nested objects merged recursively

**Example:**

```yaml
# Before                          # After
---                               ---
type: project                     type: project
status: active                    status: complete    # Updated
tags:                             tags:
  - work                            - work
---                                 - shipped         # Added
                                  completed: 2026-01-28  # New field
                                  ---
```

---

### mcp__flywheel-crank__vault_add_frontmatter_field

Add a new field to frontmatter (fails if field exists).

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | Vault-relative path |
| `field` | string | Yes | Field name |
| `value` | any | Yes | Field value |
| `commit` | boolean | No | Git commit after mutation |

**Safety:** Fails if field already exists to prevent accidental overwrites.

---

## Note Tools

### mcp__flywheel-crank__vault_create_note

Create a new note with frontmatter and content.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | Vault-relative path for new note |
| `frontmatter` | object | No | Initial frontmatter fields |
| `content` | string | No | Initial note content |
| `commit` | boolean | No | Git commit after creation |

**Example:**

```
┌─ MUTATION: mcp__flywheel-crank__vault_create_note ────────────────────┐
│ Path:     meetings/2026-01-28-standup.md         │
│ Frontmatter:                                     │
│   type: meeting                                  │
│   date: 2026-01-28                               │
│   attendees: [Alice, Bob]                        │
│ Content:  "# Standup\n\n## Agenda\n\n## Notes"   │
├──────────────────────────────────────────────────┤
│ Created:  meetings/2026-01-28-standup.md         │
└──────────────────────────────────────────────────┘
```

---

### mcp__flywheel-crank__vault_delete_note

Delete a note from the vault.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | Vault-relative path |
| `confirm` | boolean | Yes | Must be `true` to confirm deletion |
| `commit` | boolean | No | Git commit after deletion |

**Safety:** Requires explicit `confirm: true` to prevent accidental deletions.

---

## System Tools

### mcp__flywheel-crank__vault_list_sections

List all headings in a note with levels.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | Vault-relative path |
| `maxLevel` | number | No | Maximum heading level (1-6) |

**Example Output:**

```json
{
  "sections": [
    { "name": "Daily Note", "level": 1 },
    { "name": "Habits", "level": 2 },
    { "name": "Log", "level": 2 },
    { "name": "Tasks", "level": 2 },
    { "name": "Morning", "level": 3 },
    { "name": "Afternoon", "level": 3 }
  ]
}
```

---

### mcp__flywheel-crank__vault_undo_last_mutation

Undo the last git commit (soft reset to HEAD~1).

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| (none) | - | - | No parameters required |

**Behavior:**
- Performs `git reset --soft HEAD~1`
- Changes remain staged
- Returns undone commit info

**Safety:** Only works if last commit was a Crank mutation (checks `[Crank:*]` prefix).

---

## Wikilink Support

Crank automatically applies wikilinks to content containing known entities.

### Wikilink Support Matrix

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
| `mcp__flywheel-crank__vault_list_sections` | No | N/A |
| `mcp__flywheel-crank__vault_undo_last_mutation` | No | N/A |

### Wikilink Behavior

```
┌─ Entity Recognition ─────────────────────────────┐
│ Categories:                                      │
│   • People: [[Alex Rivera]], [[Jordan Lee]]      │
│   • Projects: [[MCP Server]], [[Flywheel]]       │
│   • Technologies: [[TypeScript]], [[React]]      │
│   • Acronyms: [[API]], [[MCP]], [[CLI]]          │
│   • Other: Custom entities from your vault       │
├──────────────────────────────────────────────────┤
│ Options:                                         │
│   • firstOccurrenceOnly: true (default)          │
│   • caseInsensitive: true (default)              │
│   • skipWikilinks: false (default)               │
└──────────────────────────────────────────────────┘
```

### Example with Wikilinks

**Input:**
```json
{
  "section": "## Log",
  "content": "Sam Chen needs help with Project Alpha",
  "format": "timestamp-bullet"
}
```

**Output (wikilinks enabled):**
```markdown
## Log
- **14:12** [[Sam Chen]] needs help with [[Project Alpha]]
```

**Output (skipWikilinks: true):**
```markdown
## Log
- **14:12** Sam Chen needs help with Project Alpha
```

---

## Configuration

### Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `PROJECT_PATH` | Vault root path | Auto-detect via `.obsidian` |

### Wikilink Entity Cache

Location: `{vault}/.claude/wikilink-entities.json`

- Auto-generated at MCP server startup
- Refreshes automatically if >1 hour old
- Contains all known entities from vault

### Excluded Folders (Wikilink Scanning)

These folders are excluded from entity scanning:

| Folder | Reason |
|--------|--------|
| `daily-notes` | Periodic notes, not entities |
| `daily` | Alternative daily folder |
| `weekly` | Weekly notes |
| `monthly` | Monthly notes |
| `quarterly` | Quarterly reviews |
| `periodic` | Generic periodic folder |
| `journal` | Journal entries |
| `inbox` | Unsorted captures |
| `templates` | Template files |

### Hardcoded Values (Future Config)

| Setting | Current Value | Location |
|---------|---------------|----------|
| Commit prefix | `[Crank:*]` | git.ts |
| Cache refresh | 60 minutes | wikilinks.ts |
| Timestamp format | 24-hour `HH:MM` | writer.ts |

---

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `Section not found` | Heading doesn't exist | Check exact heading text |
| `File not found` | Note doesn't exist at path | Verify path is correct |
| `Invalid path` | Path traversal attempt | Use vault-relative paths only |
| `No task found` | Task text not matched | Try shorter partial match |
| `Field already exists` | Using `add_frontmatter_field` on existing field | Use `update_frontmatter` instead |

### MutationResult Structure

All tools return:

```typescript
interface MutationResult {
  success: boolean;
  message: string;
  path: string;
  preview?: string;      // Content preview if applicable
  gitCommit?: string;    // Commit hash if committed
  gitError?: string;     // Git error if commit failed
}
```

---

## Best Practices

### 1. Use Section-Scoped Operations

```
✅ mcp__flywheel-crank__vault_add_to_section(section: "## Log")
   → Safe, reversible, predictable

❌ Edit tool for adding log entries
   → Free-form, harder to audit
```

### 2. Enable Git Commits

```
✅ mcp__flywheel-crank__vault_add_to_section(..., commit: true)
   → Full audit trail, easy undo

❌ mcp__flywheel-crank__vault_add_to_section(..., commit: false)
   → Changes not tracked
```

### 3. Use skipWikilinks Deliberately

```
// When content already has wikilinks
mcp__flywheel-crank__vault_add_task({
  task: "Review [[Sam Chen]]'s PR",
  skipWikilinks: true  // Don't double-link
})

// When content should be auto-linked
mcp__flywheel-crank__vault_add_task({
  task: "Review Sam Chen's PR",
  skipWikilinks: false  // Auto-link Sam Chen
})
```

### 4. Read Before Write

```
// 1. Read current state (Flywheel)
const current = await mcp__flywheel__get_section_content({
  path: "daily.md",
  heading: "Log"
});

// 2. Write mutation (Crank)
await mcp__flywheel-crank__vault_add_to_section({
  path: "daily.md",
  section: "Log",
  content: "New entry",
  commit: true
});

// 3. Verify (Flywheel)
const updated = await mcp__flywheel__get_section_content({
  path: "daily.md",
  heading: "Log"
});
```

---

## Glossary

| Term | Definition |
|------|------------|
| **Mutation** | Any write operation that modifies vault content |
| **Section** | A markdown heading and its content until the next heading |
| **Frontmatter** | YAML metadata at the start of a note |
| **Wikilink** | `[[Note Name]]` format link in Obsidian |
| **Entity** | A recognized person, project, technology, or acronym |
| **MCP** | Model Context Protocol - the server interface |
| **Crank** | This tool - the deterministic write layer |
| **Flywheel** | The read-only graph intelligence layer |
