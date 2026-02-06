# Content Targeting Guide

How Flywheel-Crank determines where mutations place content in your vault.

---

## Overview

Every mutation tool needs to answer three questions:

1. **Which file?** - The `path` parameter
2. **Which section?** - The `section` parameter (for section-scoped tools)
3. **Where in the section?** - The `position` and `format` parameters

Understanding these targeting mechanisms helps you predict exactly where content will appear.

---

## Note Selection (Path Parameter)

### Path Format

All paths are **vault-relative** - they start from your vault root, not from `/` or `C:\`.

```javascript
// Correct - vault-relative paths
path: "daily-notes/2026-02-06.md"
path: "projects/alpha/status.md"
path: "inbox.md"

// Wrong - absolute paths (rejected)
path: "/home/user/vault/notes.md"    // Unix absolute
path: "C:\\Users\\vault\\notes.md"   // Windows absolute
```

### Path Resolution

Flywheel-Crank resolves paths as follows:

1. Takes your vault root (from `PROJECT_PATH` env or auto-detected)
2. Joins with the provided path
3. Validates the result stays within the vault (no `../` escapes)

```
Vault root: /home/user/my-vault/
Path param: daily-notes/2026-02-06.md
Resolved:   /home/user/my-vault/daily-notes/2026-02-06.md
```

### What Happens When File Doesn't Exist?

| Tool | Behavior |
|------|----------|
| `vault_add_to_section` | **Error** - file must exist |
| `vault_create_note` | **Creates** - that's its purpose |
| `vault_update_frontmatter` | **Error** - file must exist |

**Pattern:** Use `vault_create_note` first, then mutation tools.

```javascript
// Step 1: Create the note
vault_create_note({
  path: "meetings/2026-02-06-standup.md",
  title: "Daily Standup",
  frontmatter: { type: "meeting", date: "2026-02-06" }
});

// Step 2: Add content to it
vault_add_to_section({
  path: "meetings/2026-02-06-standup.md",
  section: "Attendees",
  content: "Alice, Bob, Carol"
});
```

### Folder Creation

Flywheel-Crank **automatically creates parent directories** when needed:

```javascript
// This works even if projects/new-client/ doesn't exist yet
vault_create_note({
  path: "projects/new-client/kickoff.md",
  title: "Client Kickoff"
});
// Creates: projects/ and projects/new-client/ automatically
```

---

## Section Targeting

### How Section Matching Works

The `section` parameter uses **case-insensitive exact matching** on heading text:

```javascript
section: "Log"      // Matches: ## Log, ### LOG, # log
section: "## Log"   // Also works - # prefix is stripped
section: "log"      // Same result - case-insensitive
```

**Matching algorithm:**
1. Strip any `#` prefix from your section parameter
2. Extract all headings from the file (ignoring code blocks)
3. Find first heading where `text.toLowerCase() === section.toLowerCase()`

### Section Boundaries

A section includes all content from its heading until:
- The next heading of **equal or higher level**, OR
- End of file

```markdown
## Log                    ← Section "Log" starts here
- Entry 1
- Entry 2
                          ← Section "Log" ends here
## Tasks                  ← New section (same level)
- Task 1

### Subtask               ← This is INSIDE "Tasks" (lower level)
- Detail
```

### What Happens When Section Doesn't Exist?

**Error with helpful message:**

```
Section 'Log' not found in daily-notes/2026-02-06.md
Available sections: Tasks, Notes, References
```

If the file has **no headings at all**:

```
Section 'Log' not found. This file has no headings.
Use vault_append_to_note for files without section structure.
```

**Pattern:** Use `vault_list_sections` to discover available sections:

```javascript
vault_list_sections({ path: "daily-notes/2026-02-06.md" })
// Returns: ["Log", "Tasks", "Notes", "References"]
```

### Duplicate Section Names

If your file has multiple sections with the same name, Flywheel-Crank targets the **first match**:

```markdown
## Notes           ← This one is targeted
- First notes section

## Tasks

## Notes           ← This one is NOT targeted
- Second notes section
```

**Recommendation:** Avoid duplicate section names, or use unique names like "Meeting Notes" vs "Personal Notes".

---

## Position and Placement

### Position Parameter

| Position | Behavior |
|----------|----------|
| `append` (default) | Add at **end** of section |
| `prepend` | Add at **beginning** of section |

```markdown
## Log
- Existing entry 1
- Existing entry 2
```

With `position: "append"`:
```markdown
## Log
- Existing entry 1
- Existing entry 2
- **14:30** New entry    ← Added at end
```

With `position: "prepend"`:
```markdown
## Log
- **14:30** New entry    ← Added at beginning
- Existing entry 1
- Existing entry 2
```

### List Nesting Preservation

By default, `preserveListNesting: true` respects existing indentation:

```markdown
## Tasks
- Project Alpha
  - Design review
  - Code review        ← Your content goes here (nested)
```

When adding to a section with nested lists, new content matches the surrounding indentation level.

### Empty Section Handling

When a section has no content (just the heading), content is added directly after the heading:

```markdown
## Log
                         ← Empty section
## Tasks
```

After `vault_add_to_section({ section: "Log", content: "First entry" })`:

```markdown
## Log
- First entry            ← Added here
## Tasks
```

---

## Format Types

### Available Formats

| Format | Input | Output |
|--------|-------|--------|
| `plain` | `Meeting notes` | `Meeting notes` |
| `bullet` | `Meeting notes` | `- Meeting notes` |
| `task` | `Review PR` | `- [ ] Review PR` |
| `numbered` | `First step` | `1. First step` |
| `timestamp-bullet` | `Started work` | `- **14:32** Started work` |

### Format Selection Guide

| Use Case | Recommended Format |
|----------|-------------------|
| Log entries, journal | `timestamp-bullet` |
| Todo items | `task` |
| Unordered lists | `bullet` |
| Ordered steps | `numbered` |
| Prose, paragraphs | `plain` |

### Timestamp Format

The `timestamp-bullet` format uses **24-hour time** in bold:

```markdown
- **09:15** Morning standup
- **14:32** Code review completed
- **17:45** Wrapped up for the day
```

The timestamp reflects the **mutation time** (when the tool runs).

---

## Frontmatter Targeting

### How Frontmatter Updates Work

`vault_update_frontmatter` merges fields into existing frontmatter:

```javascript
vault_update_frontmatter({
  path: "projects/alpha.md",
  updates: {
    status: "active",
    priority: "high"
  }
})
```

**Before:**
```yaml
---
title: Project Alpha
created: 2026-01-15
---
```

**After:**
```yaml
---
title: Project Alpha
created: 2026-01-15
status: active
priority: high
---
```

### Merge Behavior

| Scenario | Behavior |
|----------|----------|
| Field doesn't exist | **Added** |
| Field exists (scalar) | **Replaced** |
| Field exists (array) | **Replaced** (not merged) |

To **add** to an array, read first, then update:

```javascript
// Read current tags
const note = await flywheel.get_note_metadata({ path: "note.md" });
const currentTags = note.frontmatter.tags || [];

// Add new tag
vault_update_frontmatter({
  path: "note.md",
  updates: {
    tags: [...currentTags, "new-tag"]
  }
});
```

### Add vs Update

| Tool | Behavior |
|------|----------|
| `vault_update_frontmatter` | **Merges** - adds new fields, updates existing |
| `vault_add_frontmatter_field` | **Fails** if field already exists |

Use `vault_add_frontmatter_field` when you want to ensure you're not accidentally overwriting.

---

## Common Targeting Patterns

### Daily Note Log Entry

```javascript
vault_add_to_section({
  path: "daily-notes/2026-02-06.md",
  section: "Log",
  content: "Completed API integration",
  format: "timestamp-bullet",
  position: "append"
})
```

Result:
```markdown
## Log
- **09:15** Morning standup
- **14:32** Completed API integration    ← New entry
```

### Task Addition

```javascript
vault_add_task({
  path: "daily-notes/2026-02-06.md",
  section: "Tasks",
  task: "Review pull request #123",
  position: "prepend"  // New tasks at top
})
```

Result:
```markdown
## Tasks
- [ ] Review pull request #123    ← New task at top
- [ ] Existing task 1
- [x] Completed task
```

### Meeting Note Creation

```javascript
// Create the note with frontmatter
vault_create_note({
  path: "meetings/2026-02-06-standup.md",
  title: "Daily Standup - Feb 6",
  frontmatter: {
    type: "meeting",
    date: "2026-02-06",
    attendees: ["Alice", "Bob", "Carol"]
  },
  template: `## Attendees

## Discussion

## Action Items
`
});

// Add content to sections
vault_add_to_section({
  path: "meetings/2026-02-06-standup.md",
  section: "Discussion",
  content: "Reviewed sprint progress",
  format: "bullet"
});
```

### Project Status Update

```javascript
// Update frontmatter status
vault_update_frontmatter({
  path: "projects/alpha/README.md",
  updates: {
    status: "in-progress",
    updated: "2026-02-06"
  }
});

// Add to changelog section
vault_add_to_section({
  path: "projects/alpha/README.md",
  section: "Changelog",
  content: "v0.2.0 - Added authentication module",
  format: "bullet",
  position: "prepend"  // Newest changes at top
});
```

---

## Troubleshooting

### "Section not found"

**Causes:**
1. Typo in section name
2. Section doesn't exist in file
3. File has no headings

**Solutions:**
```javascript
// List available sections
vault_list_sections({ path: "your-file.md" })

// Check if file has headings at all
// If not, use vault_append_to_note instead
```

### Content in Wrong Location

**Cause:** Section name matched a different heading than expected.

**Solution:** Use the exact heading text, check for duplicate section names:

```javascript
// Be specific
section: "Meeting Notes"  // Not just "Notes"
```

### Nested List Formatting Issues

**Cause:** `preserveListNesting` interacting with existing structure.

**Solution:** For clean insertion, ensure consistent indentation in existing content, or use `preserveListNesting: false` for flat insertion.

### Path Not Found

**Causes:**
1. File doesn't exist (use `vault_create_note` first)
2. Wrong path format (should be vault-relative)
3. Typo in path

**Solution:**
```javascript
// Check if file exists via Flywheel first
const exists = await flywheel.get_note_metadata({ path: "your-path.md" });
```

---

## Decision Tree

```
I want to add content to my vault
│
├─ Does the file exist?
│   ├─ No  → vault_create_note first
│   └─ Yes → Continue
│
├─ Does the file have section structure (headings)?
│   ├─ No  → vault_append_to_note (plain text file)
│   └─ Yes → Continue
│
├─ What type of content?
│   ├─ Log entry     → vault_add_to_section (format: timestamp-bullet)
│   ├─ Task          → vault_add_task
│   ├─ List item     → vault_add_to_section (format: bullet)
│   ├─ Frontmatter   → vault_update_frontmatter
│   └─ Plain text    → vault_add_to_section (format: plain)
│
└─ Where in the section?
    ├─ Chronological (oldest first) → position: append
    └─ Reverse chrono (newest first) → position: prepend
```

---

## See Also

- [Tools Reference](./tools-reference.md) - Complete parameter documentation
- [Examples](./EXAMPLES.md) - Copy-paste examples for common workflows
- [Limitations](./LIMITATIONS.md) - What Flywheel-Crank can't do
