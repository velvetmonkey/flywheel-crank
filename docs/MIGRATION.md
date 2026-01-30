# Migration Guide: From Raw File Editing to Flywheel-Crank

This guide helps you transition from direct file editing (using Edit tool, sed, or manual edits) to using Flywheel-Crank for vault mutations.

---

## Table of Contents

1. [Why Migrate?](#why-migrate)
2. [Pre-Migration Checklist](#pre-migration-checklist)
3. [Migration Strategies](#migration-strategies)
4. [Gradual Adoption Timeline](#gradual-adoption-timeline)
5. [Handling Inconsistent Formatting](#handling-inconsistent-formatting)
6. [Permission Approval Workflow](#permission-approval-workflow)
7. [The Hybrid Approach](#the-hybrid-approach)
8. [Rollback Procedures](#rollback-procedures)
9. [Post-Migration Verification](#post-migration-verification)
10. [Common Migration Patterns](#common-migration-patterns)

---

## Why Migrate?

### Benefits Comparison

| Aspect | Raw File Editing | Flywheel-Crank |
|--------|-----------------|----------------|
| **Consistency** | Ad-hoc formatting | Consistent patterns |
| **Safety** | No validation | Path sandboxing, validation |
| **Audit Trail** | Manual git commits | Auto git commits per mutation |
| **Undo** | Manual git revert | `vault_undo_last_mutation` |
| **Wikilinks** | Manual linking | Auto entity recognition |
| **Section Scoping** | Find/replace risk | Section-boundary enforcement |
| **Format Preservation** | May corrupt frontmatter | Frontmatter-aware writes |

### When to Migrate

**Good candidates for migration:**
- Daily note logging (timestamps, bullets)
- Task management (toggle, add tasks)
- Frontmatter updates (status changes, tags)
- Section-scoped additions (meeting notes, logs)

**May not need migration:**
- Complex prose editing
- Multi-section refactoring
- Template generation
- Bulk file operations

---

## Pre-Migration Checklist

Before migrating, ensure your environment is ready:

### 1. Git Setup

```bash
# Verify vault is a git repository
cd /path/to/your/vault
git status

# If not a git repo, initialize one
git init
git add .
git commit -m "Initial commit before Flywheel-Crank migration"
```

**Why git?** Crank's `commit: true` and `vault_undo_last_mutation` features require git.

### 2. MCP Server Verification

```bash
# Test that Flywheel-Crank is responding
# In Claude Code, run:
mcp__flywheel-crank__vault_list_sections({ path: "any-note.md" })
```

If this fails, check your MCP configuration in `.claude/settings.json`.

### 3. Backup Your Vault

```bash
# Create a backup branch
git checkout -b pre-crank-backup
git checkout main

# Or copy to external location
cp -r /path/to/vault /path/to/backup
```

### 4. Review Vault Structure

Identify your vault's patterns:

- **Section headings:** Do you use `## Log` or `## Daily Log`?
- **Task format:** Is it `- [ ]` or `* [ ]`?
- **Timestamp format:** 24-hour or 12-hour?
- **Frontmatter:** YAML with quotes or without?

Document these patterns in your `.claude/CLAUDE.md`:

```markdown
## Vault Conventions

- Log sections: Use `## Log` for daily notes
- Tasks: Always use `- [ ]` format
- Timestamps: 24-hour format (14:30, not 2:30 PM)
```

---

## Migration Strategies

### Strategy 1: Cold Turkey

**Description:** Stop all direct file edits immediately; use only Crank.

**Best for:**
- New vaults or small vaults
- Users comfortable with MCP tools
- Vaults with consistent formatting

**Steps:**
1. Deny Edit/Write permissions in settings
2. Pre-approve Crank tools you'll use
3. Start using Crank for all mutations

```json
{
  "permissions": {
    "deny": ["Write(**)", "Edit(**)"],
    "allow": [
      "mcp__flywheel-crank__vault_add_to_section",
      "mcp__flywheel-crank__vault_toggle_task"
    ]
  }
}
```

### Strategy 2: Gradual Migration

**Description:** Migrate one operation type at a time.

**Best for:**
- Large existing vaults
- Complex workflows
- Users new to MCP tools

**Steps:**
1. Week 1: Migrate task toggles only
2. Week 2: Add log entries via Crank
3. Week 3: Migrate frontmatter updates
4. Week 4: Full migration

### Strategy 3: Folder-Based Migration

**Description:** Migrate specific folders first.

**Best for:**
- Vaults with distinct areas (work, personal, archive)
- Team vaults with ownership boundaries

**Steps:**
1. Start with `daily-notes/` folder
2. Expand to `projects/` folder
3. Finally migrate remaining areas

---

## Gradual Adoption Timeline

### Week 1: Task Operations

**Focus:** `vault_toggle_task` and `vault_add_task`

**Why start here:**
- High frequency, low risk
- Clear success/failure feedback
- Immediate muscle memory development

**Practice prompts:**
```
"Mark the groceries task done in today's note"
"Add a task to review the PR in the backlog"
```

### Week 2: Log Entries

**Focus:** `vault_add_to_section` with timestamp-bullet format

**Why this second:**
- Builds on section understanding
- Demonstrates formatting options
- Shows auto-wikilink value

**Practice prompts:**
```
"Add a log entry about the API integration"
"Log that I completed the design review"
```

### Week 3: Frontmatter

**Focus:** `vault_update_frontmatter` and `vault_add_frontmatter_field`

**Why this third:**
- More complex operation
- Requires understanding merge behavior
- Demonstrates field safety

**Practice prompts:**
```
"Update the status to 'complete' in the project note"
"Add a 'reviewed' date field with today's date"
```

### Week 4: Full Operations

**Focus:** Note creation, deletion, complex replacements

**Complete the migration:**
- Create notes with templates via Crank
- Remove/replace content in sections
- Use git commits consistently

---

## Handling Inconsistent Formatting

### Problem: Mixed Task Formats

Your vault has both `- [ ]` and `* [ ]` tasks.

**Solution:** Crank always uses `- [ ]`. Choose one:

1. **Accept Crank's format:** Let new tasks use `- [ ]`
2. **Normalize existing:** Run a one-time cleanup:

```bash
# Find files with * [ ] format
grep -r "\* \[ \]" --include="*.md"

# Replace (careful with regex)
sed -i 's/^\* \[ \]/- [ ]/g' *.md
git commit -am "Normalize task format to - [ ]"
```

### Problem: Inconsistent Heading Levels

Some notes use `## Log`, others use `### Log`.

**Solution:** Crank's section finding is level-agnostic but name-sensitive.

1. **Document your standard** in CLAUDE.md
2. **Update Claude's context** with your preference
3. **Gradually normalize** during edits

### Problem: Missing Sections

Some notes lack the target section.

**Solution:** Crank fails gracefully with "Section not found".

1. **Create missing sections** before migration
2. **Use templates** for new notes to ensure structure
3. **Accept failures** as prompts to fix structure

---

## Permission Approval Workflow

### How Permissions Work

Claude Code prompts for each new tool on first use:

```
Allow mcp__flywheel-crank__vault_add_to_section?
[Allow Once] [Allow Always] [Deny]
```

### Recommended Approval Order

1. **Read-only first:** `vault_list_sections`
2. **Safe writes:** `vault_toggle_task`, `vault_add_to_section`
3. **Frontmatter:** `vault_update_frontmatter`
4. **Create/delete:** `vault_create_note`, `vault_delete_note` (last)

### Pre-Approve in Settings

For faster workflow, pre-approve in `.claude/settings.local.json`:

```json
{
  "permissions": {
    "allow": [
      "mcp__flywheel-crank__vault_add_to_section",
      "mcp__flywheel-crank__vault_toggle_task",
      "mcp__flywheel-crank__vault_add_task",
      "mcp__flywheel-crank__vault_list_sections",
      "mcp__flywheel-crank__vault_update_frontmatter"
    ]
  }
}
```

---

## The Hybrid Approach

Not everything needs Crank. Here's when to use what:

### Use Crank For

| Operation | Tool | Why |
|-----------|------|-----|
| Add log entry | `vault_add_to_section` | Consistent formatting, auto-wikilinks |
| Toggle task | `vault_toggle_task` | Finds task by partial match |
| Add task | `vault_add_task` | Proper checkbox format |
| Update status | `vault_update_frontmatter` | Preserves other fields |
| New meeting note | `vault_create_note` | Template + frontmatter |

### Use Edit Tool For

| Operation | Why |
|-----------|-----|
| Rewrite paragraph | Prose editing needs human judgment |
| Move sections | Multi-section operations not supported |
| Fix typos | Single character changes faster with Edit |
| Complex regex | Crank's regex is section-scoped |

### Hybrid Example

```
# 1. READ with Flywheel
"Show me the Tasks section of today's note"

# 2. ANALYZE the tasks
"Which tasks are incomplete?"

# 3. EDIT prose with Edit tool (if needed)
"Reword the first task to be clearer"

# 4. TOGGLE with Crank
"Mark the second task complete"

# 5. ADD with Crank
"Add a new task about the deployment"
```

---

## Rollback Procedures

### Immediate Undo (Last Mutation)

```
"Undo the last change"
→ vault_undo_last_mutation
→ Performs git reset --soft HEAD~1
```

**Note:** Only works for Crank mutations (commits with `[Crank:*]` prefix).

### Rolling Back Multiple Changes

```bash
# View recent commits
git log --oneline -10

# Identify the commit before Crank changes
# e.g., abc1234 [Crank:Add] Update notes/daily.md
#       def5678 [Crank:Task] Update notes/daily.md
#       ghi9012 Manual edit before migration

# Reset to before Crank changes
git reset --soft ghi9012
```

### Recovering from Bad Migration

```bash
# If migration went wrong, restore from backup
git checkout pre-crank-backup
git checkout main

# Or restore specific files
git checkout pre-crank-backup -- daily-notes/
```

---

## Post-Migration Verification

### Checklist

- [ ] **Test task toggle:** Can you toggle a task?
- [ ] **Test log entry:** Can you add a log entry with timestamp?
- [ ] **Test frontmatter:** Can you update a status field?
- [ ] **Test undo:** Can you undo the last change?
- [ ] **Verify wikilinks:** Are entities being linked automatically?
- [ ] **Check git history:** Are commits appearing with `[Crank:*]` prefix?

### Verification Commands

```bash
# Check recent commits
git log --oneline -5

# Verify file integrity
git diff HEAD~5..HEAD --stat

# Look for Crank commits
git log --grep="Crank:" --oneline
```

### Common Issues Post-Migration

| Issue | Cause | Solution |
|-------|-------|----------|
| "Section not found" | Heading mismatch | Check exact heading text |
| No wikilinks added | Entity cache stale | Wait 1 hour or restart MCP |
| Git commit failed | Not a git repo | Initialize git in vault |
| Formatting wrong | Different conventions | Update CLAUDE.md with your style |

---

## Common Migration Patterns

### Pattern 1: Daily Note Logging

**Before (Edit tool):**
```
Edit daily-notes/2026-01-28.md:
Find: ## Log
Add after: - **14:30** Completed API review
```

**After (Crank):**
```
vault_add_to_section({
  path: "daily-notes/2026-01-28.md",
  section: "Log",
  content: "Completed API review",
  format: "timestamp-bullet",
  commit: true
})
```

### Pattern 2: Task Management

**Before:**
```
Edit: Find "[ ] Buy groceries" and replace with "[x] Buy groceries"
```

**After:**
```
vault_toggle_task({
  path: "daily-notes/2026-01-28.md",
  task: "groceries"
})
```

### Pattern 3: Project Status Updates

**Before:**
```
Edit frontmatter: status: active → status: complete
```

**After:**
```
vault_update_frontmatter({
  path: "projects/api-redesign.md",
  updates: { status: "complete", completed: "2026-01-28" }
})
```

### Pattern 4: Meeting Notes

**Before:**
```
Create new file with manual frontmatter and structure
```

**After:**
```
vault_create_note({
  path: "meetings/2026-01-28-standup.md",
  frontmatter: {
    type: "meeting",
    date: "2026-01-28",
    attendees: ["Alice", "Bob"]
  },
  content: "# Standup\n\n## Agenda\n\n## Notes\n\n## Action Items"
})
```

---

## See Also

- [LIMITATIONS.md](LIMITATIONS.md) - What Crank cannot do
- [tools-reference.md](tools-reference.md) - Complete tool documentation
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) - Common issues and solutions
- [configuration.md](configuration.md) - MCP setup and permissions
