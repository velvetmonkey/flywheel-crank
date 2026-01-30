# Flywheel-Crank Limitations

This document describes what Flywheel-Crank cannot do and provides guidance on when to use alternative tools.

---

## Table of Contents

1. [Summary Matrix](#summary-matrix)
2. [Architectural Limitations](#architectural-limitations)
3. [Content Limitations](#content-limitations)
4. [Section and Heading Limitations](#section-and-heading-limitations)
5. [Wikilink Limitations](#wikilink-limitations)
6. [Git Integration Limitations](#git-integration-limitations)
7. [Performance Boundaries](#performance-boundaries)
8. [Platform-Specific Limitations](#platform-specific-limitations)
9. [Unsupported Vault Structures](#unsupported-vault-structures)
10. [When to Use Filesystem Tools Instead](#when-to-use-filesystem-tools-instead)
11. [Known Issues and Workarounds](#known-issues-and-workarounds)

---

## Summary Matrix

| Limitation | Impact | Workaround |
|------------|--------|------------|
| Section-scoped only | Cannot edit across sections | Use Edit tool for multi-section |
| Line-based operations | Cannot edit within a line | Use Edit tool for inline changes |
| No streaming parser | Large files loaded to memory | Keep files under 10MB |
| Deterministic only | No AI-driven content generation | Use LLM + Crank together |
| Git required for undo | No undo without git | Initialize git before use |
| Entity cache 1hr stale | New notes not immediately linkable | Wait for cache refresh |
| 25-char entity limit | Long note names not suggested | Keep entity names concise |
| Alias support (v0.9.0+) | Frontmatter aliases now match | Add aliases for variations |
| Section must exist | Cannot create sections | Create section first, then add |

---

## Architectural Limitations

### 1. Determinism Only

**Limitation:** Crank is purely deterministic. It does not:
- Generate content using AI
- Make decisions about what to write
- Infer missing information
- Expand abbreviations

**Why:** Crank is the "execution layer" - predictable, auditable, certifiable. AI creativity belongs in the LLM, not in the mutation engine.

**Correct pattern:**
```
1. LLM: "What should I add to the log?"
   → AI generates: "Completed API integration with auth module"

2. Crank: vault_add_to_section(content: "Completed API integration...")
   → Deterministic write
```

### 2. Section-Scoped Operations

**Limitation:** All mutations are scoped to a single section.

**Cannot do:**
- Edit content across multiple sections
- Move content between sections
- Merge sections
- Split sections

**Workaround:** Use Edit tool for cross-section operations, or make multiple Crank calls.

### 3. Single-File Operations

**Limitation:** Each tool call operates on one file.

**Cannot do:**
- Batch updates across multiple files
- Rename files (use filesystem tools)
- Move files between folders

**Workaround:** Script multiple Crank calls or use filesystem operations.

---

## Content Limitations

### 1. Line-Based Operations

**Limitation:** Crank operates on complete lines, not within lines.

**Cannot do:**
- Replace a word within a line (without replacing entire line)
- Insert text at a specific character position
- Edit inline formatting

**Example:**
```markdown
Original: "Meeting with Jordan about project"
Wanted:   "Meeting with Jordan about Project Alpha"

# Cannot do inline word replacement
# Must replace entire line:
vault_replace_in_section(
  search: "Meeting with Jordan about project",
  replacement: "Meeting with Jordan about Project Alpha"
)
```

### 2. No Content Generation

**Limitation:** Crank writes exactly what you provide.

**Cannot do:**
- Expand shorthand ("mtg" → "meeting")
- Fix spelling errors
- Format dates automatically
- Generate summaries

**Why:** Determinism. What you put in is what you get out.

### 3. Plain Text Focus

**Limitation:** Optimized for markdown text, not binary or complex formats.

**Cannot do:**
- Edit embedded images
- Modify Canvas files (`.canvas`)
- Edit Obsidian plugin data
- Handle binary attachments

---

## Section and Heading Limitations

### 1. Case-Insensitive but Exact Match

**Limitation:** Section matching is case-insensitive but requires exact text.

**Works:**
- `section: "Log"` matches `## Log` and `## log`
- `section: "## Log"` also works (hash prefix optional)

**Doesn't work:**
- `section: "Daily Log"` won't match `## Log` (different text)
- `section: "Log Entries"` won't match `## Log`

### 2. Duplicate Headings

**Limitation:** If a note has multiple sections with the same name, Crank uses the first one.

```markdown
## Notes
First notes section...

## Notes
Second notes section... ← NOT targeted by section: "Notes"
```

**Workaround:** Use unique section names, or accept first-match behavior.

### 3. Section Must Exist

**Limitation:** Cannot create sections dynamically.

```
vault_add_to_section(section: "New Section", ...)
→ Error: "Section not found: New Section"
```

**Workaround:** Create the section first (with Edit tool or template), then use Crank.

### 4. Heading Level Ignored

**Limitation:** Section search ignores heading level.

- `## Log` and `### Log` both match `section: "Log"`
- First match is used

---

## Wikilink Limitations

### 1. First Occurrence Only

**Limitation:** Auto-wikilinks only link the first occurrence of an entity.

```markdown
Input: "Jordan Smith mentioned Jordan Smith should review"
Output: "[[Jordan Smith]] mentioned Jordan Smith should review"
```

**Why:** Prevents over-linking. Obsidian convention is first-occurrence linking.

### 2. Entity Name Length Limit

**Limitation:** Entities longer than 25 characters are not suggested.

**Why:** Long names are typically article titles, not concepts:
- "Complete Guide To Fat Loss" (filtered - too long)
- "TypeScript" (suggested - appropriate length)

### 3. Entity Cache Staleness

**Limitation:** Entity cache refreshes after 1 hour.

**Impact:**
- Newly created notes won't be suggested immediately
- Deleted notes may still be suggested briefly

**Workaround:** Restart the MCP server to force cache rebuild.

### 4. Suggestion Algorithm Limitations

**Limitation:** Suggestions are based on word overlap, not semantic understanding.

**Works well with aliases (v0.9.0+):**
- Acronyms with expanded aliases: `prd.md` with `aliases: [Production]` will match content containing "Production"
- Alternative names: Add aliases in frontmatter for common variations

**Still limited:**
- Concepts with no word overlap (even with aliases)
- Domain-specific jargon without aliases
- Semantic synonyms (e.g., "happy" won't match entity "Joy" unless aliased)

**Alias Configuration:**
```yaml
---
aliases: [Production, Prod, Product Requirements]
---
# PRD
```

**Note:** Aliases are filtered using the same rules as entity names:
- Max 25 characters
- Max 3 words
- This prevents over-linking from generic phrases

### 5. Word Count Filter

**Limitation:** Entity names with >3 words are filtered as likely article titles.

**Filtered:**
- "Very Long Project Name Here" (4 words)
- "My Complete Guide To X" (5 words)

**Kept:**
- "Machine Learning" (2 words)
- "Natural Language Processing" (3 words)

---

## Git Integration Limitations

### 1. Git Required for Undo

**Limitation:** `vault_undo_last_mutation` only works with git.

**Without git:**
- No undo capability
- `commit: true` parameter is ignored
- No audit trail

### 2. Undo Scope

**Limitation:** Undo reverts entire commit, not individual changes.

```
1. vault_add_to_section(...) → Commit A
2. vault_add_task(...) → Commit B
3. vault_undo_last_mutation → Reverts only Commit B
```

### 3. Git Config Required

**Limitation:** Git must be configured with user.name and user.email.

```bash
# If not configured:
git config user.name "Your Name"
git config user.email "you@example.com"
```

### 4. Crank-Only Undo

**Limitation:** Undo only works for Crank commits (with `[Crank:*]` prefix).

Manual commits won't be undone by `vault_undo_last_mutation`.

---

## Performance Boundaries

### 1. File Size

| Metric | Limit | Impact |
|--------|-------|--------|
| File size | 10MB | Larger files may timeout |
| Lines per file | ~50,000 | Scanning becomes slow |
| Frontmatter size | ~100KB | YAML parsing overhead |

### 2. Entity Index

| Metric | Limit | Impact |
|--------|-------|--------|
| Total entities | ~50,000 | Memory usage increases |
| Entities per request | ~10,000 | Suggestion scoring time |
| Cache size | ~10MB | Disk space for cache |

### 3. Mutation Operations

| Operation | Expected Time | Notes |
|-----------|---------------|-------|
| Add to section | <100ms | 1000-line file |
| Toggle task | <50ms | Task search |
| Update frontmatter | <100ms | YAML parse + serialize |
| Wikilink processing | <200ms | 10k entities |

### 4. Concurrent Mutations

**Limitation:** Multiple concurrent mutations to the same file may conflict.

**Mitigation:** Crank uses atomic writes (tmp → rename), but rapid sequential calls are safer than parallel.

---

## Platform-Specific Limitations

### Windows (Native)

| Issue | Workaround |
|-------|------------|
| `npx` execution | Use `cmd /c npx` wrapper |
| Path separators | Crank handles `/` and `\` |
| Line endings | Crank preserves existing line endings |

### Windows (WSL)

| Issue | Workaround |
|-------|------------|
| Cross-filesystem access | Keep vault in WSL filesystem |
| Permission errors | Check WSL mount options |

### macOS

| Issue | Workaround |
|-------|------------|
| Case-insensitive filesystem | Watch for duplicate entity names with different casing |

### Linux

| Issue | Workaround |
|-------|------------|
| Permission denied | Check file ownership |

---

## Unsupported Vault Structures

### 1. Kanban Boards

**Limitation:** Crank doesn't understand Kanban plugin structure.

**Cannot:**
- Move cards between lanes
- Create new lanes
- Understand Kanban-specific metadata

### 2. Canvas Files

**Limitation:** `.canvas` files are JSON, not markdown.

**Cannot:**
- Edit Canvas content
- Add/remove canvas nodes
- Modify canvas connections

### 3. Dataview Queries

**Limitation:** Crank writes text, doesn't execute Dataview.

**Cannot:**
- Update Dataview inline queries
- Modify Dataview metadata for queries
- Understand query results

### 4. Encrypted Vaults

**Limitation:** Cannot read/write encrypted content.

**Cannot:**
- Access encrypted notes
- Write to encrypted sections

### 5. Excalidraw Drawings

**Limitation:** Excalidraw files are JSON/SVG.

**Cannot:**
- Edit drawing content
- Add/remove drawing elements

---

## When to Use Filesystem Tools Instead

### Decision Tree

```
Is the operation...
│
├─ Section-scoped text mutation? → Use Crank
│
├─ Cross-section edit? → Use Edit tool
│
├─ File rename/move? → Use filesystem (mv, git mv)
│
├─ Bulk file operation? → Use Bash scripting
│
├─ Non-markdown file? → Use appropriate tool
│
├─ Complex regex replacement? → Use sed/Edit tool
│
└─ Free-form prose editing? → Use Edit tool
```

### Specific Recommendations

| Task | Tool | Why |
|------|------|-----|
| Add log entry | Crank | Section-scoped, formatted |
| Toggle task | Crank | Finds by partial match |
| Rename note | Filesystem | Not supported by Crank |
| Bulk find/replace | Bash + sed | Multi-file, complex regex |
| Edit paragraph | Edit tool | Prose editing flexibility |
| Create folder | Filesystem | Not supported by Crank |
| Update .obsidian config | Edit tool | Not vault content |

---

## Known Issues and Workarounds

### Issue 1: Stopwords in Entity Names

**Problem:** Entities with common words may not match.

**Example:** Entity "Complete Guide" won't match content "Complete the setup" because "complete" is a stopword.

**Workaround:** Use more specific entity names, or disable suggestion for affected content.

### Issue 2: Nested List Indentation

**Problem:** Complex nested list structures may not perfectly preserve indentation.

**Workaround:** Set `preserveListNesting: true` (default) and verify results.

### Issue 3: Empty Sections

**Problem:** Appending to empty sections may add unexpected blank lines.

**Workaround:** Use `prepend` position for truly empty sections.

### Issue 4: Frontmatter Array Merging

**Problem:** Array fields are replaced, not merged.

```yaml
# Before
tags: [a, b]

# After vault_update_frontmatter({ updates: { tags: ["c"] } })
tags: [c]  # Replaced, not [a, b, c]
```

**Workaround:** Read current array, merge, then update.

### Issue 5: Special Characters in Patterns

**Problem:** Regex special characters need escaping.

**Example:** To match `[Task]`, use pattern `\[Task\]`

**Workaround:** Set `useRegex: false` for literal matching, or escape special chars.

---

## See Also

- [MIGRATION.md](MIGRATION.md) - Transitioning to Flywheel-Crank
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) - Common issues and fixes
- [PERFORMANCE.md](PERFORMANCE.md) - Performance optimization
- [tools-reference.md](tools-reference.md) - Complete tool documentation
