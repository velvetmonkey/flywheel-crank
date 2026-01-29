# Flywheel & Flywheel-Crank - Privacy Architecture

Understanding how your data is handled when using Flywheel and Flywheel-Crank with Claude Code.

---

## Table of Contents

- [Privacy Summary](#privacy-summary)
- [Architectural Guarantees](#architectural-guarantees)
- [What Gets Indexed](#what-gets-indexed)
- [Data Flow](#data-flow)
- [The Claude API Caveat](#the-claude-api-caveat)
- [Token Efficiency = Privacy Efficiency](#token-efficiency--privacy-efficiency)
- [Best Practices](#best-practices)

---

## Privacy Summary

**In plain terms:**

1. **Flywheel and Crank run on YOUR machine** - no cloud servers
2. **Your vault files stay on your disk** - never uploaded
3. **Index contains structure, not content** - titles, links, tags (not prose)
4. **Data sent to Claude is minimized** - targeted results, not bulk files

**Important caveat:** Tool responses ARE sent to Claude's API. Flywheel minimizes what gets sent, but doesn't prevent data from reaching Claude.

---

## Architectural Guarantees

```
┌─────────────────────────────────────────────────────────────┐
│                    PRIVACY BY ARCHITECTURE                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. LOCAL EXECUTION                                         │
│     • Flywheel/Crank run on YOUR machine                    │
│     • No cloud servers, no external APIs                    │
│     • Your vault files never leave your disk                │
│                                                             │
│  2. INDEX vs CONTENT                                        │
│     • Index contains: titles, links, tags, frontmatter      │
│     • Index does NOT contain: file content, prose, notes    │
│     • Claude only sees content when explicitly requested    │
│                                                             │
│  3. MINIMAL DATA TRANSFER                                   │
│     • Graph queries return metadata, not content            │
│     • Section queries return targeted excerpts              │
│     • No bulk file transfers for simple questions           │
│                                                             │
│  4. NO TELEMETRY                                            │
│     • No usage tracking                                     │
│     • No analytics                                          │
│     • No phone-home                                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## What Gets Indexed

### Indexed (Used for Queries)

| Data | Example | Used For |
|------|---------|----------|
| File paths | `notes/project-alpha.md` | Navigation, organization |
| Titles | "Project Alpha" | Search, entity matching |
| Aliases | `aliases: [PA, Alpha]` | Alternative name matching |
| Wikilinks | `[[Related Note]]` | Graph queries, backlinks |
| Tags | `#project`, `#active` | Tag queries, filtering |
| Frontmatter keys | `status`, `priority` | Schema queries |
| Frontmatter values | `status: active` | Filtering, sorting |
| Headings | `## Tasks`, `## Notes` | Section navigation |
| Modification dates | `2026-01-28` | Temporal queries |

### NOT Indexed (Stays on Disk)

| Data | Reason |
|------|--------|
| File content/prose | Privacy - only loaded when requested |
| Code blocks | Privacy - may contain sensitive code |
| Images/attachments | Not relevant to graph queries |
| Embedded content | Only structure is indexed |

---

## Data Flow

### Query Flow (Flywheel)

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Claude Code │────▶│   Flywheel   │────▶│  Your Vault  │
│   (Query)    │     │   (Local)    │     │   (Local)    │
└──────────────┘     └──────────────┘     └──────────────┘
       │                    │                    │
       │                    ▼                    │
       │             ┌──────────────┐            │
       │             │    Index     │◀───────────┘
       │             │   (Memory)   │  Scans structure
       │             └──────────────┘  at startup
       │                    │
       │                    ▼
       │             ┌──────────────┐
       └─────────────│   Response   │
         Claude sees │  (Metadata)  │  ~50 tokens
         this only   └──────────────┘
```

### Mutation Flow (Crank)

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Claude Code │────▶│    Crank     │────▶│  Your Vault  │
│  (Mutation)  │     │   (Local)    │     │   (Local)    │
└──────────────┘     └──────────────┘     └──────────────┘
       │                    │                    │
       │                    │  Writes to         │
       │                    │  specific section  │
       │                    ▼                    │
       │             ┌──────────────┐            │
       │             │   Response   │            │
       └─────────────│   (Result)   │◀───────────┘
         Claude sees │  success/err │
         this only   └──────────────┘
```

---

## The Claude API Caveat

### What You Need to Know

When you use Claude Code with Flywheel/Crank:

1. **Tool responses ARE sent to Claude's API**
2. **Claude sees whatever Flywheel/Crank returns**
3. **Anthropic's privacy policy applies to that data**

### What This Means

```
┌─────────────────────────────────────────────────────────────┐
│                     DATA FLOW TO CLAUDE                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Query: "What links to [[Project Alpha]]?"                  │
│                                                             │
│  Flywheel returns:                                          │
│    ["Meeting Notes.md", "Tasks.md", "Q1 Review.md"]         │
│                                                             │
│  ↓ This data is sent to Claude's API ↓                     │
│                                                             │
│  Claude sees: The list of file names                        │
│  Claude does NOT see: Content of those files                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Flywheel's Privacy Benefit

Flywheel doesn't prevent data from reaching Claude. It **minimizes exposure** by:

1. **Returning metadata instead of content**
   - Backlinks query → returns file names (~50 tokens)
   - Without Flywheel → Claude reads files (~5,000 tokens)

2. **Targeted section retrieval**
   - `get_section_content("## Log")` → returns one section
   - Without Flywheel → Claude reads entire file

3. **Structural queries over content queries**
   - "Find orphan notes" → returns paths only
   - "Show hub notes" → returns metadata only

---

## Token Efficiency = Privacy Efficiency

The same architecture that saves tokens also minimizes data exposure.

### The Math

**Without Flywheel (Claude reads files directly):**

```
Query: "What links to [[Project Alpha]]?"

Claude must:
1. Read file 1 to search for [[Project Alpha]]    = ~300 tokens
2. Read file 2 to search...                       = ~250 tokens
3. Read file 3...                                 = ~400 tokens
...
20. Read file 20...                               = ~200 tokens

TOTAL: ~5,000 tokens (full file content sent to API)
```

**With Flywheel (Index query):**

```
Query: "What links to [[Project Alpha]]?"

Flywheel:
1. Tool call: get_backlinks({target: "Project Alpha"})  = ~15 tokens
2. Response: ["Meeting.md", "Tasks.md", "Notes.md"]     = ~35 tokens

TOTAL: ~50 tokens (only file names sent to API)
```

### Privacy Impact

```
┌─────────────────────────────────────────────────────────────┐
│  DATA EXPOSURE COMPARISON                                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  WITHOUT Flywheel:                                          │
│  ─────────────────                                          │
│  • 5,000 tokens of file content sent to Claude              │
│  • Includes all text, code, notes in those files            │
│  • Every search = more content exposed                      │
│                                                             │
│  WITH Flywheel:                                             │
│  ──────────────                                             │
│  • 50 tokens of metadata sent to Claude                     │
│  • Only file names, not content                             │
│  • Content only sent when explicitly requested              │
│                                                             │
│  REDUCTION: 100x less data sent to API                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Best Practices

### 1. Use Graph Queries First

Instead of asking Claude to search file contents:

```
❌ "Read all my meeting notes and find mentions of Project Alpha"
   → Claude reads all meeting files (high data exposure)

✅ "What links to Project Alpha?"
   → Flywheel returns backlinks only (minimal exposure)
```

### 2. Use Section Queries

Instead of reading entire files:

```
❌ "Read notes/daily.md"
   → Entire file content sent to Claude

✅ "Get the Log section from notes/daily.md"
   → Only that section sent to Claude
```

### 3. Understand What's Returned

| Query Type | Data Returned | Exposure Level |
|------------|---------------|----------------|
| Backlinks | File paths only | Low |
| Hub notes | Paths + connection counts | Low |
| Schema query | Frontmatter values | Medium |
| Section content | Section text | Medium |
| Full note read | Entire file | High |

### 4. Sensitive Information

For highly sensitive notes:

- Keep them outside the indexed vault
- Or exclude folders from Flywheel scanning
- Or use Flywheel's structural queries only (no content reads)

### 5. Review Tool Responses

You can see what Flywheel returns in Claude Code's tool output. This shows exactly what data is sent to Claude's API.

---

## Technical Details

### Where Data Lives

| Data | Location | Sent to Cloud? |
|------|----------|----------------|
| Vault files | Your disk | No |
| Flywheel index | Memory | No |
| Entity cache | `.claude/wikilink-entities.json` | No |
| Tool responses | Claude API | Yes |

### MCP Protocol

Flywheel communicates with Claude Code via the Model Context Protocol (MCP):

1. Claude Code calls a tool (e.g., `get_backlinks`)
2. Flywheel processes locally, returns JSON response
3. Response sent to Claude's API as context
4. Claude reasons about the response

The MCP layer is local—data only leaves your machine when included in Claude's context.

---

## Comparison: Direct File Access vs Flywheel

| Aspect | Direct File Access | With Flywheel |
|--------|-------------------|---------------|
| **Data exposed** | Full file contents | Metadata/excerpts |
| **Tokens used** | ~5,000/query | ~50/query |
| **Files read** | Many | None (index query) |
| **Control** | Low | High |
| **Audit** | Hard | Easy (tool responses) |

---

## Summary

**Flywheel's privacy approach:**

1. **Local-first** - Runs entirely on your machine
2. **Minimal exposure** - Returns metadata, not content
3. **User control** - You choose what to query
4. **Transparent** - Tool responses are visible

**The honest truth:**
- Data returned by tools IS sent to Claude's API
- Flywheel minimizes this by returning targeted results
- It's 100x less data than reading files directly
- But it's not zero - be aware of what you query

---

## Flywheel-Crank Specific Privacy Considerations

### Mutation Data in Tool Responses

**What goes to Claude API:**

When Crank mutates your vault:
```
Tool: vault_add_to_section
Input: {note: "daily.md", section: "## Log", content: "Met with client"}
Response: {success: true, mutation_id: "abc123"}
```

**Both input AND response sent to Claude API.**

**Privacy impact:**
- ⚠️ **Content you're adding is visible to Claude** (it's in the tool parameter)
- ⚠️ **Mutation details logged** (file path, section, operation)
- ✅ **Existing file content NOT sent** (unless explicitly read first)

---

### Sensitive Data in Mutations

**Scenario:** Adding API keys or passwords via Crank.

❌ **Dangerous:**
```
"Add my AWS key to notes.md"
→ vault_add_to_section(content: "AWS_KEY=sk-1234...")
→ API key sent to Claude API
→ Now in Claude's logs/training data (per Anthropic's policy)
```

**Safe alternatives:**
1. **Don't store secrets in vault** (use credential managers)
2. **If you must:** Add manually, not via AI mutations
3. **Encrypted notes:** Use Obsidian's encryption feature (not readable by Crank)

---

### Git Commit Messages and Privacy

**Auto-commit messages:**
```
crank: add to daily-notes/2026-01-29.md section ## Log
```

**Privacy impact:**
- ✅ Commit messages are local (in your git repo)
- ⚠️ If you push to GitHub/GitLab: Commit messages are public (if public repo)
- ⚠️ Commit message includes file path and section name

**Sensitive scenario:**
```
File: clients/acme-corp-confidential.md
Commit: "crank: add to clients/acme-corp-confidential.md"
→ Reveals client name in commit history
```

**Mitigations:**
- Use generic folder names (`clients/client-001.md` not `clients/acme-corp.md`)
- Use private git repos
- Or don't auto-commit sensitive mutations

---

### Encrypted Vault Support

**Obsidian's encryption feature:**

| Aspect | Compatibility |
|--------|--------------|
| **Whole-vault encryption** | ✅ Works (if vault decrypted when Crank runs) |
| **Per-note encryption** | ❌ Crank can't read/write encrypted notes |
| **Password prompts** | ❌ Not supported (Crank is headless) |

**Best practice:** 
- Keep vault decrypted while Crank runs
- Or keep sensitive notes outside vault
- Or use OS-level encryption (FileVault, VeraCrypt)

---

### Wikilink Entity Cache Privacy

**File:** `.claude/wikilink-entities.json`

**Contains:**
- All note titles
- All note aliases
- File paths

**Privacy impact:**
- ⚠️ Reveals vault structure (note names, organization)
- ⚠️ Written to disk unencrypted
- ✅ Doesn't contain file contents

**If vault is encrypted:** Entity cache inherits encryption.

**If paranoid:** Delete after use:
```bash
rm /vault/.claude/wikilink-entities.json
```
(Regenerated on next use)

---

### API Keys & Passwords in Frontmatter

**Bad practice:**
```yaml
---
api_key: sk-abc123
password: hunter2
---
```

**Why dangerous with Crank:**
1. `vault_update_frontmatter` reads frontmatter
2. Returns updated frontmatter in response
3. **API key sent to Claude API**

**Safe practice:**
- **Never store secrets in frontmatter**
- Use environment variables
- Use credential managers (1Password, etc.)

---

### Audit Trail via Git

**Git provides mutation audit:**

```bash
# See all AI mutations
git log --grep="crank:"

# See what changed
git show <commit-hash>

# Who did it
git log --author="Crank"
```

**Privacy benefit:** Full audit trail of what AI changed.

**Privacy risk:** If git repo pushed to cloud, history is exposed.

---

### Mutation Undo Privacy

**When you undo:**
```
vault_undo_last_mutation()
→ Git reverts last commit
→ Creates new commit: "Revert: crank: add to note.md"
```

**Privacy impact:**
- ✅ Original change is undone
- ⚠️ Undo commit reveals there WAS a change (commit history)
- ⚠️ Original commit still in git history (not deleted, just reverted)

**To fully erase:**
```bash
git reset --hard HEAD~2  # Remove last 2 commits (original + revert)
# WARNING: Destructive, can't undo
```

---

### Safe Mutation Patterns

**1. Two-step: Read, then write**
```
1. Flywheel reads current state (minimal data to Claude)
2. Plan mutation (Claude decides what to write)
3. Crank writes (only new content sent to Claude)
```

**2. Avoid echoing sensitive data**
```
❌ "Add the API key I just told you to notes.md"
   → API key in conversation history

✅ "Add placeholder for API key to notes.md"
   → Fill in manually later
```

**3. Review before push**
```
git diff  # See what Crank changed
# If sensitive data exposed: git reset --hard
```

---

## Privacy Best Practices (Crank)

### 1. Don't Mutate Sensitive Notes via AI

**Keep separate:**
- Passwords → credential manager
- API keys → environment variables
- Financial data → encrypted files outside vault
- Legal documents → secure storage

**AI mutations are for:**
- Tasks, logs, meeting notes
- Non-sensitive knowledge work
- Daily notes, journals (if not deeply personal)

---

### 2. Use Private Git Repos

If using git integration:
- ✅ GitHub private repo
- ✅ Self-hosted GitLab
- ❌ Public GitHub repo (commit history visible)

---

### 3. Review Mutations Before Commit

```
Crank: commit: false (mutations don't auto-commit)
You: git diff (review changes)
If sensitive: git reset --hard
If good: git add -A && git commit
```

---

### 4. Exclude Sensitive Folders

Even though Crank doesn't index, good practice:
```json
{
  "env": {
    "CRANK_EXCLUDE_PATTERNS": "_private/,secrets/,work-confidential/"
  }
}
```
(Not currently implemented - TODO feature request)

---

### 5. Use OS-Level Encryption

**Best protection:**
- FileVault (macOS)
- BitLocker (Windows)
- LUKS (Linux)

**Effect:** Entire vault encrypted at rest.

**Crank compatibility:** ✅ Works seamlessly (accesses decrypted files)

---

## Privacy Comparison

### Crank vs. Manual Editing

| Aspect | Manual Editing | With Crank |
|--------|---------------|------------|
| **Data to AI** | None (local only) | Mutation parameters + response |
| **Audit trail** | Manual git commits | Auto-commit with consistent messages |
| **Wikilinks** | Manual | Auto-detected (may expose more notes) |

**Manual editing is more private** (no data to AI).

**Crank is more convenient** (AI-driven mutations).

---

### Crank vs. Obsidian Plugins

| Aspect | Obsidian Plugins | Crank |
|--------|-----------------|-------|
| **Data to cloud** | Depends on plugin | Tool responses to Claude API |
| **Runs where** | Inside Obsidian | Standalone (MCP) |
| **Audit** | Varies | Git-based |

**Both expose data to some extent.** Choose based on trust model.

---

## Summary (Crank-Specific)

**Crank's privacy characteristics:**

1. ✅ **Local mutations** - No cloud servers, files stay on disk
2. ⚠️ **Mutation data sent to Claude** - Tool parameters include content
3. ✅ **Git audit trail** - Full history of what changed
4. ⚠️ **Wikilink entity cache** - Note titles written to disk
5. ✅ **No telemetry** - No analytics or tracking

**Key risks:**

1. ❌ **Secrets in mutations** - API keys, passwords sent to Claude
2. ⚠️ **Git history** - If pushed to public repos, exposes changes
3. ⚠️ **Entity cache** - Reveals vault structure

**Mitigation:**

- Don't store secrets in vault
- Use private git repos
- Use OS-level encryption
- Review changes before push
- Keep sensitive notes outside vault

**Bottom line:** Crank is reasonably private for everyday knowledge work, but NOT for highly sensitive data (secrets, financial, medical, legal). Use secure tools for that.

---

## See Also

- [Configuration](./configuration.md) - Permission settings
- [Tools Reference](./tools-reference.md) - What each tool returns
- [Wikilinks](./wikilinks.md) - Entity data handling
- [Troubleshooting](./TROUBLESHOOTING.md) - Encrypted vault issues
