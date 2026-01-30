# Flywheel-Crank Compatibility Guide

Using Crank with Obsidian plugins, sync tools, and concurrent editing scenarios.

---

## Table of Contents

- [Obsidian Plugins](#obsidian-plugins)
- [Sync Tools](#sync-tools)
- [Concurrent Editing](#concurrent-editing)
- [File Watching Interactions](#file-watching-interactions)
- [Git Workflows](#git-workflows)
- [Known Conflicts](#known-conflicts)
- [Safe Usage Patterns](#safe-usage-patterns)

---

## Obsidian Plugins

### Dataview

**Status:** ✅ **Compatible**

| Aspect | Behavior |
|--------|----------|
| **Frontmatter updates** | Dataview reads new values after Crank mutation |
| **Inline fields** | Crank doesn't understand Dataview syntax (e.g., `field:: value`) |
| **Queries** | Unaffected by Crank mutations |
| **Performance** | Both can run simultaneously |

**Recommendations:**
- Use standard YAML frontmatter, not inline fields
- Obsidian will refresh Dataview queries after file changes (may take 1-2s)
- Crank mutations don't trigger instant Dataview updates (Obsidian must detect file change)

**Example - Works:**
```yaml
---
status: active  ← Crank can update this
priority: high  ← Dataview can query this
---
```

**Example - Doesn't Work:**
```markdown
status:: active  ← Inline field (Dataview-specific)
```
Crank treats this as regular text, not frontmatter.

---

### Templater

**Status:** ⚠️ **Mostly Compatible** (with caveats)

| Aspect | Behavior |
|--------|----------|
| **Template files** | Crank can mutate, but Templater syntax preserved |
| **Auto-templates** | May conflict if both try to write on file creation |
| **Dynamic fields** | Crank writes static content, doesn't evaluate templates |

**Known issue:** If Templater auto-applies template on new file creation, and Crank creates same file simultaneously → race condition.

**Workaround:**
1. **Create with Crank:** `vault_create_note(path: "note.md", content: "...")`
2. **Wait for Templater:** Let Obsidian apply template
3. **Then mutate:** `vault_add_to_section(...)` to add dynamic content

**Or disable Templater auto-apply for AI-generated notes.**

---

### QuickAdd

**Status:** ⚠️ **Partial Compatibility**

| Aspect | Behavior |
|--------|----------|
| **Manual captures** | Unaffected by Crank |
| **Auto-captures** | May conflict if both write to same note |
| **Macros** | Run independently |

**Conflict scenario:**
- You trigger QuickAdd macro to log to daily note
- Simultaneously, Crank adds to daily note
- **Last write wins** (one may overwrite the other)

**Safe usage:**
- Don't run QuickAdd and Crank on same note simultaneously
- Or use Crank exclusively for AI-driven captures

---

### Tasks Plugin

**Status:** ✅ **Compatible**

| Aspect | Behavior |
|--------|----------|
| **Task creation** | Crank creates standard Markdown tasks |
| **Task queries** | Tasks plugin reads Crank-created tasks |
| **Task completion** | Both can toggle tasks (last write wins if simultaneous) |

**Recommendations:**
- Use `vault_toggle_task` for AI-driven task completion
- Use Tasks plugin UI for manual task management
- Both produce compatible Markdown syntax

**Example:**
```markdown
- [ ] Task created by Crank
- [x] Task completed by Tasks plugin
- [ ] Task created by Tasks plugin
```
All compatible.

---

### Kanban Plugin

**Status:** ⚠️ **Limited Compatibility**

| Aspect | Behavior |
|--------|----------|
| **Reading Kanban boards** | Crank can read Markdown structure |
| **Mutating boards** | Risky - Kanban uses special syntax |
| **Card creation** | May break board layout |

**Recommendation:** **Don't use Crank to mutate Kanban boards.** Let Kanban plugin manage its own files.

**Why:** Kanban boards have specific formatting that Crank doesn't understand.

---

### Calendar Plugin

**Status:** ✅ **Compatible**

| Aspect | Behavior |
|--------|----------|
| **Daily notes** | Crank can mutate, Calendar displays them |
| **Date navigation** | Unaffected |
| **Frontmatter dates** | Calendar reads Crank-updated dates |

**Works well together.** Use Crank to populate daily notes, Calendar to visualize.

---

## Sync Tools

### Obsidian Sync (Official)

**Status:** ✅ **Compatible** (with precautions)

| Aspect | Behavior |
|--------|----------|
| **Sync conflicts** | Possible if Crank and mobile device edit same note |
| **File versioning** | Obsidian Sync preserves both versions |
| **Sync speed** | Fast (usually detects Crank changes within seconds) |

**Safe usage:**
1. **Let sync settle before mutations:**
   - Wait for "Synced" indicator in Obsidian
   - Then run Crank mutations

2. **Pause mobile edits during batch operations:**
   - If running 100 mutations, don't edit on mobile simultaneously

3. **Resolve conflicts manually:**
   - Obsidian Sync will show conflict files
   - Choose which version to keep

**Conflict example:**
```
You edit note.md on mobile → saves to Obsidian Sync
Crank edits note.md on desktop → saves locally
Sync detects conflict → creates note-conflict-<timestamp>.md
```

---

### Dropbox

**Status:** ⚠️ **Compatible** (slower, conflicts possible)

| Aspect | Behavior |
|--------|----------|
| **File locking** | May block Crank writes temporarily |
| **Sync conflicts** | Dropbox creates "conflicted copy" files |
| **Sync speed** | Slower than Obsidian Sync (5-30s delay) |

**Recommendations:**
1. **Pause Dropbox during batch mutations:**
   ```bash
   dropbox stop
   # Run Crank mutations
   dropbox start
   ```

2. **Check for conflicted copies:**
   ```bash
   find /vault -name "*conflicted copy*"
   ```

3. **Use selective sync:**
   - Don't sync `.claude/` folder (entity cache)
   - Reduces sync overhead

**Known issue:** Dropbox may hold file locks, causing Crank mutations to fail with "EBUSY" error.

---

### Git (Manual)

**Status:** ✅ **Excellent Compatibility**

| Aspect | Behavior |
|--------|----------|
| **Auto-commit** | Crank can auto-commit each mutation |
| **Manual commit** | Works seamlessly |
| **Merge conflicts** | Standard git conflict resolution |
| **Undo** | `vault_undo_last_mutation` uses git revert |

**Recommended workflow:**
```bash
# Before mutations
git pull

# Run Crank mutations (with commit: true)

# After mutations
git push
```

**Best practices:**
- Use `commit: true` for important mutations
- Commit message format: `"crank: <operation> <file>"`
- Easy to grep: `git log --grep="crank:"`

---

### iCloud Drive

**Status:** ⚠️ **Not Recommended**

| Aspect | Behavior |
|--------|----------|
| **File locking** | Aggressive locking can block Crank |
| **Sync conflicts** | Poor conflict resolution |
| **Sync speed** | Slow and unpredictable |

**Issues:**
- iCloud may download files "on demand" → Crank can't read them
- File locks during sync cause "EBUSY" errors
- Conflicts are hard to resolve

**Alternative:** Use Obsidian Sync or git instead.

---

### OneDrive

**Status:** ⚠️ **Compatible** (with precautions)

| Aspect | Behavior |
|--------|----------|
| **File locking** | Less aggressive than iCloud |
| **Sync conflicts** | Creates duplicate files |
| **Sync speed** | Moderate (5-15s delay) |

**Similar to Dropbox:** Pause during batch mutations, check for duplicate files after.

---

## Concurrent Editing

### Crank + Manual Editing (Same Note)

**Scenario:** You edit "note.md" in text editor, Crank mutates it simultaneously.

**Risk:** **High** - Last write wins, changes may be lost.

**Safe pattern:**
1. **Close note in editor**
2. **Run Crank mutation**
3. **Reopen note** (editor will reload)

**Why it's risky:**
- Both hold file in memory
- Both write to disk
- One overwrites the other

---

### Crank + Obsidian (Same Note)

**Scenario:** Note is open in Obsidian, Crank mutates it.

**Risk:** **Medium** - Obsidian usually detects changes and reloads.

**Behavior:**
- Obsidian detects file change
- Shows "File modified externally" prompt
- Reloads after confirmation (or auto-reloads if configured)

**Settings to adjust:**
```
Obsidian → Settings → Files & Links
→ "Automatically reload files when they are changed" (enable)
```

**Best practice:**
- **Close note in Obsidian before mutating** (safest)
- Or accept that Obsidian will reload (may lose unsaved changes)

---

### Multiple Crank Instances

**Scenario:** Two Claude Code sessions running Crank on same vault.

**Risk:** **Very High** - Race conditions, overwrites, corruption.

**Don't do this.** Use one Crank instance at a time.

**If unavoidable:**
- Use git worktrees (separate working directories)
- Assign different folders to each instance
- Merge manually with care

---

### Crank + Flywheel

**Scenario:** Flywheel (read) and Crank (write) both running.

**Status:** ✅ **Designed to work together**

**Behavior:**
1. Crank mutates note
2. Crank invalidates Flywheel index (if both running in same session)
3. Flywheel rebuilds index on next query
4. Queries reflect new state

**Recommended workflow:**
```
1. Query (Flywheel) → "What tasks are due today?"
2. Plan mutation → "Add task: Review PR"
3. Mutate (Crank) → vault_add_to_section(...)
4. Verify (Flywheel) → "Show tasks in note.md"
```

**Seamless integration:** This is the intended use case.

---

## File Watching Interactions

### Crank + Flywheel File Watchers

Both tools watch vault for changes:

| Tool | Watches For | Behavior |
|------|-------------|----------|
| **Flywheel** | All `.md` files | Re-indexes changed files |
| **Crank** | None (Crank doesn't watch) | N/A |

**No conflict:** Crank mutates, Flywheel detects change, re-indexes. Works as expected.

---

### Obsidian File Watcher

Obsidian watches vault for external changes:

**Behavior:**
1. Crank mutates file
2. Obsidian detects change (within 1-2s)
3. Obsidian reloads file (if open)

**Settings:**
```
Settings → Files & Links
→ "Detect all file changes" (enable for Crank compatibility)
```

---

## Git Workflows

### Solo Workflow

**Pattern:**
```
1. Work in vault
2. Run Crank mutations (commit: true)
3. Periodically: git push
```

**Pros:** Simple, every mutation is committed.

**Cons:** Git history cluttered with many small commits.

---

### Team Workflow

**Pattern:**
```
1. Pull latest: git pull
2. Run Crank mutations (commit: false)
3. Review changes: git diff
4. Commit batch: git add -A && git commit -m "AI updates"
5. Push: git push
```

**Pros:** Clean git history, manual review before push.

**Cons:** Can't undo individual mutations (only batch).

---

### Branch-per-Agent Workflow

**Pattern:**
```
1. Create branch: git checkout -b ai-mutations
2. Run Crank mutations
3. Review changes: git log
4. Merge: git checkout main && git merge ai-mutations
```

**Pros:** Isolates AI changes, easy to discard if wrong.

**Cons:** More complex, requires git knowledge.

---

## Known Conflicts

### ⚠️ Crank + Templater + Auto-apply

**Issue:** Both try to write on new file creation → race condition.

**Solution:** Disable Templater auto-apply, or create files manually before Crank mutates.

---

### ⚠️ Crank + Kanban Plugin

**Issue:** Crank doesn't understand Kanban syntax → may break board layout.

**Solution:** Don't use Crank on Kanban board files.

---

### ⚠️ Crank + Cloud Sync (iCloud)

**Issue:** iCloud file locking blocks Crank writes.

**Solution:** Use Obsidian Sync or git instead.

---

### ⚠️ Crank + Multiple Editors (Same Note)

**Issue:** Last write wins, changes lost.

**Solution:** Close note before Crank mutates.

---

## Safe Usage Patterns

### ✅ Pattern 1: Closed Vault Mutations

```
1. Close Obsidian
2. Run Crank batch mutations
3. Reopen Obsidian
```

**Safest approach.** No conflicts possible.

---

### ✅ Pattern 2: Read (Flywheel) → Write (Crank) → Verify

```
1. Query with Flywheel: "What's in section X?"
2. Mutate with Crank: vault_add_to_section(...)
3. Verify with Flywheel: "Show section X again"
```

**AI-native workflow.** Uses both tools together.

---

### ✅ Pattern 3: Separate Folders

```
Crank mutates: daily-notes/
You edit manually: projects/
```

**No overlap = no conflicts.**

---

### ✅ Pattern 4: Git Protection

```
1. Commit current state: git add -A && git commit
2. Run Crank mutations
3. Review: git diff
4. If wrong: git reset --hard HEAD
5. If good: git push
```

**Git as safety net.** Easy rollback.

---

### ❌ Anti-pattern: Simultaneous Editing

```
❌ You edit note.md in Obsidian
❌ Crank mutates note.md
❌ Result: One overwrites the other
```

**Don't do this.**

---

## Compatibility Matrix

| Tool/Plugin | Compatibility | Notes |
|-------------|--------------|-------|
| **Dataview** | ✅ Compatible | Use YAML frontmatter, not inline fields |
| **Templater** | ⚠️ Mostly | Disable auto-apply to avoid conflicts |
| **QuickAdd** | ⚠️ Partial | Don't run on same note simultaneously |
| **Tasks** | ✅ Compatible | Standard Markdown tasks |
| **Kanban** | ❌ Incompatible | Don't mutate Kanban board files |
| **Calendar** | ✅ Compatible | Works well together |
| **Obsidian Sync** | ✅ Compatible | Let sync settle before mutations |
| **Dropbox** | ⚠️ Slower | Pause during batch ops |
| **Git** | ✅ Excellent | Recommended workflow |
| **iCloud** | ❌ Not recommended | File locking issues |
| **OneDrive** | ⚠️ OK | Pause during batch ops |
| **Flywheel** | ✅ Designed for it | Read→Write→Verify workflow |

---

## Summary

**Crank is most compatible with:**
- Git workflows (built-in integration)
- Flywheel (designed together)
- Standard Markdown plugins (Dataview, Tasks, Calendar)

**Crank has conflicts with:**
- Multiple concurrent editors (same note)
- Specialty plugins with custom syntax (Kanban)
- iCloud file locking

**Best practices:**
1. **Use git** for safety and undo
2. **Close Obsidian** during batch mutations (safest)
3. **Let sync settle** before mutations
4. **Don't edit same note** in multiple tools simultaneously
5. **Pair with Flywheel** for Read→Write→Verify workflow

---

## See Also

- [Troubleshooting](./TROUBLESHOOTING.md) - Conflict resolution
- [Migration Guide](./MIGRATION.md) - Adopting Crank safely
- [Performance](./PERFORMANCE.md) - Sync overhead
- [Limitations](./LIMITATIONS.md) - Known constraints
