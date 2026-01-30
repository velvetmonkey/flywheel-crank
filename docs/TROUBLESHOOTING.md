# Flywheel-Crank Troubleshooting Guide

Common mutation issues, rollback procedures, and recovery strategies.

---

## Table of Contents

- [Quick Diagnostics](#quick-diagnostics)
- [Mutation Failures](#mutation-failures)
- [Git Integration Issues](#git-integration-issues)
- [Wikilink Problems](#wikilink-problems)
- [Section Mutations](#section-mutations)
- [Undo & Rollback](#undo--rollback)
- [File Locking & Concurrency](#file-locking--concurrency)
- [Platform-Specific Issues](#platform-specific-issues)

---

## Quick Diagnostics

### Is Crank Running?

```bash
claude mcp list
```

Expected output:
```
flywheel-crank ✓
```

### Test Basic Mutation

Create a test note and verify Crank can write:

```
Ask Claude: "Use vault_create_note to create test.md with content 'Hello'"
```

Expected: Note created successfully.

If failed: Check [Mutation Failures](#mutation-failures).

---

## Mutation Failures

### "Permission denied" / Read-only vault

**Error:**
```
Error: EACCES: permission denied, open '/vault/note.md'
```

**Causes:**

1. **File permissions:**
   ```bash
   ls -la /path/to/vault/note.md
   # Should be writable by current user
   ```

2. **Vault on read-only filesystem:**
   - Network share mounted read-only
   - Cloud sync folder in read-only state

**Fix:**
```bash
chmod u+w /path/to/vault/note.md  # Single file
chmod -R u+w /path/to/vault/      # Whole vault
```

---

### "File locked" / In use by another process

**Error:**
```
Error: EBUSY: resource busy or locked
```

**Causes:**

1. **Obsidian has file open:**
   - Close note in Obsidian
   - Or use Crank while file is not actively being edited

2. **Cloud sync in progress:**
   - Dropbox, OneDrive, iCloud locking file
   - Wait for sync to complete

3. **Another AI agent editing:**
   - Multiple Claude Code sessions
   - Race condition

**Solutions:**

- **Close Obsidian:** Mutations work better when Obsidian is closed
- **Wait and retry:** Let sync complete
- **Use git worktree:** Separate working directory for AI mutations
- See [Concurrency](#file-locking--concurrency) for safe patterns

---

### "Note not found" / File doesn't exist

**Error:**
```
Error: Note 'meeting-notes.md' not found
```

**Cause:** File doesn't exist, or path incorrect.

**Solutions:**

1. **Use Flywheel to verify:**
   ```
   Ask Claude: "Does note 'meeting-notes.md' exist?"
   Tool: search_notes("meeting-notes")
   ```

2. **Check exact path:**
   - Case-sensitive: `Meeting.md` ≠ `meeting.md`
   - Full path: `2026/meeting-notes.md` not `meeting-notes.md`

3. **Create note first:**
   ```
   vault_create_note(path: "meeting-notes.md", content: "# Meeting Notes")
   ```

---

### Mutation succeeded but content wrong

**Symptom:** No error, but file content isn't what you expected.

**Common causes:**

1. **Section target wrong:**
   ```
   vault_add_to_section(
     note: "daily.md",
     section: "## Tasks",  // ← Section doesn't exist
     content: "- [ ] Task"
   )
   ```
   **Result:** Content added to end of file, not under section.
   
   **Fix:** Verify section exists first, or create it.

2. **Frontmatter overwrite:**
   ```
   vault_update_frontmatter(
     note: "note.md",
     updates: {status: "done"}
   )
   ```
   **Risk:** If frontmatter malformed, may corrupt file.
   
   **Fix:** Use `merge: true` mode (default) to preserve existing fields.

3. **Wikilink auto-linking unexpected entities:**
   - "met with sam" → `[[Sam]]` if note "Sam.md" exists
   - May link wrong entity if multiple matches
   
   **Fix:** Check wikilink cache, use explicit links if needed.

---

## Git Integration Issues

### "Git not initialized" / No .git directory

**Error:**
```
Error: Git repository not found in vault
```

**Cause:** Vault is not a git repository.

**Fix:**
```bash
cd /path/to/vault
git init
git add .
git commit -m "Initial commit"
```

**Now Crank can commit mutations:**
```
vault_add_to_section(..., commit: true)
```

---

### Auto-commit failed

**Error:**
```
Warning: Mutation succeeded but git commit failed
```

**Cause:** Git command errored (no user config, detached HEAD, etc.).

**Debug:**
```bash
cd /path/to/vault
git status
git config user.name
git config user.email
```

**Fix:**
```bash
git config user.name "Your Name"
git config user.email "you@example.com"
```

---

### "Dirty working tree" / Uncommitted changes

**Error:**
```
Error: Cannot commit - working tree has uncommitted changes
```

**Cause:** Crank tries to commit, but you have unrelated uncommitted files.

**Solutions:**

1. **Commit manually first:**
   ```bash
   git add -A
   git commit -m "Manual changes"
   ```

2. **Don't use `commit: true`:**
   - Let mutations happen without auto-commit
   - Commit manually later

3. **Use `.gitignore`:**
   - Ignore temp files that cause dirty state

---

### Undo failed / "No last mutation"

**Error:**
```
Error: vault_undo_last_mutation: No mutation to undo
```

**Causes:**

1. **Server restarted:**
   - Mutation history is in-memory only
   - Restarting server clears history

2. **Mutation wasn't committed:**
   - `commit: false` mutations can't be undone via git
   - Use manual git revert

**Fix:**

- Always use `commit: true` if you want undo capability
- Or manually revert:
  ```bash
  git log --oneline  # Find commit hash
  git revert <hash>
  ```

---

## Wikilink Problems

### Entity cache outdated

**Symptom:** `[[Link]]` doesn't auto-link to newly created notes.

**Cause:** Crank uses cached entity list from Flywheel. If Flywheel index is stale, Crank won't know about new notes.

**Fix:**

1. **Rebuild Flywheel index:**
   ```
   Ask Claude (connected to Flywheel): "Rebuild index"
   ```

2. **Restart Crank server:**
   - Exit Claude Code
   - Restart
   - Crank will fetch fresh entity list

**Prevention:** Use Flywheel + Crank together. Crank will auto-invalidate Flywheel index after mutations.

---

### False positive wikilinks

**Symptom:** Casual text gets auto-linked unexpectedly.

**Example:**
```
Input: "I think we should begin the project"
Output: "I think we should [[begin]] the project"
(Because "Begin.md" exists in vault)
```

**Workaround:**

1. **Disable auto-wikilinking:**
   ```json
   {
     "env": {
       "CRANK_AUTO_WIKILINK": "false"
     }
   }
   ```

2. **Use explicit links:**
   - Tell Claude: "Add this text but don't create wikilinks"

3. **Refine entity names:**
   - Rename "Begin.md" → "Project Begin.md"
   - Use multi-word note titles to reduce false matches

See [Wikilinks Guide](./wikilinks.md) for full details.

---

### Wikilink to wrong note

**Symptom:** `[[John]]` links to "John Doe.md" but you wanted "John Smith.md"

**Cause:** Multiple entities match "John" (titles or aliases).

**Fix:**

1. **Use full name:**
   - "met with [[John Smith]]" instead of "[[John]]"

2. **Check entity cache:**
   ```bash
   cat /vault/.claude/wikilink-entities.json | grep -i john
   ```

3. **Remove ambiguous aliases:**
   - If "John Smith.md" has `aliases: ["John"]`, remove it

---

## Section Mutations

### Section not found

**Error:**
```
Error: Section '## Tasks' not found in note.md
```

**Cause:** Section heading doesn't exist, or heading syntax wrong.

**Solutions:**

1. **Verify section exists:**
   ```
   Ask Claude (Flywheel): "Get section headings from note.md"
   ```

2. **Check heading syntax:**
   - Must include `##`: `"## Tasks"` not `"Tasks"`
   - Case-sensitive: `"## tasks"` ≠ `"## Tasks"`
   - Heading level matters: `"## Tasks"` ≠ `"### Tasks"`

3. **Create section first:**
   ```
   vault_add_to_section(
     note: "note.md",
     section: "## Tasks",
     content: "",
     create_if_missing: true  // ← Creates section if absent
   )
   ```

---

### Content added to wrong section

**Symptom:** Mutation succeeded, but content is under different section.

**Cause:** Multiple sections with same name, or regex match ambiguous.

**Example:**
```markdown
## Log
(content)

## Meeting Log
(content)
```

Mutation targeting "## Log" might match "## Meeting Log" too.

**Fix:**

- Use full, unique section names
- Check section structure with Flywheel before mutating
- Specify section path if needed: `"## 2026-01-29 > ## Log"`

---

### List item formatting broken

**Symptom:** After mutation, list indentation or nesting is wrong.

**Cause:** Crank preserves existing formatting but may not handle complex nested lists perfectly.

**Example:**
```markdown
Before:
- Parent
  - Child

After vault_add_to_section:
- Parent
  - Child
- New item  ← Wrong indentation
```

**Workaround:**

- Use simple, flat lists for AI mutations
- Manually fix complex formatting after mutation
- TODO: Improve list handling in Crank

---

## Undo & Rollback

### Undo last mutation

**Command:**
```
vault_undo_last_mutation()
```

**Behavior:**
1. Finds last commit with message starting `"crank:"`
2. Reverts that commit (creates new commit)
3. Returns success

**Limitations:**

- Only undoes last Crank mutation
- Doesn't undo manual edits between mutations
- Requires `commit: true` on original mutation

---

### Undo specific mutation

**Not supported directly.** Workaround:

```bash
cd /vault
git log --oneline --grep="crank:"  # Find commit
git revert <commit-hash>
```

---

### Full vault rollback

**Scenario:** Batch mutations went wrong, need to reset vault.

**Recovery:**

1. **If using git:**
   ```bash
   git log  # Find good commit
   git reset --hard <good-commit-hash>
   ```

2. **If using backups:**
   - Restore from Time Machine / cloud backup
   - Copy from vault snapshot

3. **If no git/backups:**
   - ⚠️ **Data loss likely**
   - Manually undo changes
   - This is why git integration is critical!

**Prevention:**

- Always use `commit: true` for important mutations
- Periodically snapshot vault: `tar -czf vault-backup.tar.gz /vault`
- Use Obsidian Sync or other backup solution

---

## File Locking & Concurrency

### Can I use Obsidian while Crank runs?

**Short answer:** Yes, but with care.

**Safe patterns:**

✅ **Crank edits different notes than you:**
- You edit "Journal.md"
- Crank mutates "Tasks.md"
- No conflict

✅ **Read-only operations:**
- Obsidian open for reading
- Crank makes mutations
- Obsidian will refresh (may take a few seconds)

❌ **Both edit same note:**
- You edit "Daily.md" in Obsidian
- Crank mutates "Daily.md"
- **Risk:** Last write wins, changes may be lost

---

### Using Crank with cloud sync

**Dropbox, OneDrive, iCloud, etc.:**

**Risks:**
- File locks during sync
- Sync conflicts if Crank and cloud edit simultaneously
- Delayed propagation to other devices

**Recommendations:**

1. **Pause sync during batch mutations:**
   - Stop Dropbox/OneDrive sync
   - Run mutations
   - Resume sync

2. **Wait for sync before mutations:**
   - Let cloud sync settle
   - Then run Crank

3. **Use git instead:**
   - Safer than cloud sync for concurrent edits
   - Explicit conflict resolution

---

### Using Crank with Obsidian Sync

**Generally safe,** but:

- Obsidian Sync has conflict resolution
- If Crank and mobile device edit same note → sync conflict
- Resolve manually in Obsidian

**Best practice:**
- Commit before mutations: `git add -A && git commit`
- Mutate
- Sync
- Check for conflicts

---

### Multiple AI agents editing vault

**Scenario:** Two Claude Code sessions running Crank on same vault.

**Risk:** Race conditions, overwrites, corruption.

**Solutions:**

1. **Don't do this.** Use one agent at a time.

2. **If unavoidable:**
   - Use git worktrees (separate working dirs)
   - Assign different folders to each agent
   - Merge carefully

---

## Platform-Specific Issues

### Windows: Path issues

**Use forward slashes:**
```
✅ vault_create_note(path: "folder/note.md")
❌ vault_create_note(path: "folder\note.md")
```

**WSL users:**
- Use native Linux paths (`/home/user/vault`)
- Avoid `/mnt/c/` paths (slow file watching)

---

### macOS: Obsidian file locking

**Symptom:** Mutations fail when Obsidian is open.

**Cause:** macOS file locking more aggressive than Linux.

**Workaround:**
- Close Obsidian during batch mutations
- Or quit and reopen after mutations

---

### Linux: inotify limits

If Flywheel (file watching) also running, may hit inotify limit.

**Fix:** See [Flywheel Troubleshooting](https://github.com/velvetmonkey/flywheel/docs/TROUBLESHOOTING.md#file-watcher-crashes)

---

## Common Patterns

### Safe Mutation Workflow

```
1. Read current state (Flywheel)
   ↓
2. Plan mutation
   ↓
3. Execute mutation (Crank with commit: true)
   ↓
4. Verify result (Flywheel or manual check)
   ↓
5. If wrong: vault_undo_last_mutation()
```

### Batch Mutations

```
For each item:
  1. Mutate with commit: false
  
After all mutations:
  2. Manual commit:
     git add -A
     git commit -m "Batch update: description"
```

**Why:** Avoids 100 commits for 100 mutations.

---

## Debug Mode

Enable logging:

```json
{
  "env": {
    "DEBUG": "crank:*"
  }
}
```

**Useful output:**
```
crank:mutation vault_add_to_section called
crank:mutation Note: daily.md, Section: ## Log
crank:wikilink Found 3 entities to link
crank:wikilink Linked: [[Sam Chen]]
crank:git Committing mutation...
crank:git Commit successful: abc123
```

---

## Getting Help

### Before reporting issues:

1. **Minimal reproduction:**
   - Create test vault
   - Single mutation that fails
   - Share vault structure (not sensitive content)

2. **Include:**
   - Platform (OS, Node.js version)
   - Crank version: `npx @velvetmonkey/flywheel-crank --version`
   - Error message (full stack trace)
   - Debug logs

3. **Check existing issues:**
   - GitHub Issues: https://github.com/velvetmonkey/flywheel-crank/issues

---

## See Also

- [Compatibility](./COMPATIBILITY.md) - Obsidian sync, plugins, concurrent usage
- [Wikilinks Guide](./wikilinks.md) - Entity matching behavior
- [Migration Guide](./MIGRATION.md) - Safe adoption strategies
- [Limitations](./LIMITATIONS.md) - Known edge cases
