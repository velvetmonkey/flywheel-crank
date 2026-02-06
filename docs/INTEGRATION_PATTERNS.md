# Flywheel - Integration Patterns

This document describes how Flywheel and Flywheel-Crank integrate with various systems and workflows.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Core Integration Pattern](#core-integration-pattern)
- [Integration Scenarios](#integration-scenarios)
- [Multi-Device Sync](#multi-device-sync)
- [CI/CD Integration](#cicd-integration)
- [Security Model](#security-model)

---

## Architecture Overview

### The Flywheel Ecosystem

```
┌─────────────────────────────────────────────────────────────────┐
│                    Your Application Layer                        │
│                                                                  │
│   Claude Code        Telegram Bot      Custom Agent              │
│   ║                  ║                 ║                         │
│   ╚═════════════════╩═════════════════╩═══════════════════════╗ │
│                                                                ║ │
│                        MCP Protocol                            ║ │
│                                                                ║ │
├────────────────────────────────────────────────────────────────╬─┤
│                                                                ║ │
│   ┌──────────────────────┐    ┌───────────────────────────┐   ║ │
│   │  Flywheel (Eyes)     │    │  Flywheel-Crank (Hands)   │   ║ │
│   │  ═══════════════════ │    │  ═════════════════════════ │   ║ │
│   │  51 read-only tools  │    │  22 write tools           │   ║ │
│   │  Graph intelligence  │    │  Deterministic writes     │   ║ │
│   │  Safe exploration    │    │  Git integration          │   ║ │
│   └──────────────────────┘    └───────────────────────────┘   ║ │
│            │                              │                    ║ │
│            └──────────────┬───────────────┘                    ║ │
│                           ▼                                    ║ │
│   ┌─────────────────────────────────────────────────────────┐ ║ │
│   │              vault-core (Shared Library)                 │ ║ │
│   │  ═══════════════════════════════════════════════════════ │ ║ │
│   │  Entity scanning   Protected zones   Wikilink application│ ║ │
│   └─────────────────────────────────────────────────────────┘ ║ │
│                           │                                    ║ │
│                           ▼                                    ║ │
│   ┌─────────────────────────────────────────────────────────┐ ║ │
│   │                 Your Obsidian Vault                      │◄╝ │
│   │  ═══════════════════════════════════════════════════════ │   │
│   │  .md files         .obsidian/          .claude/          │   │
│   └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Key Principles

1. **Read-Write Separation**: Flywheel (read) and Crank (write) are separate servers
2. **Deterministic Writes**: All mutations go through Crank for consistency
3. **MCP Protocol**: Standard protocol enables any MCP-compatible client
4. **Shared Core**: vault-core provides consistent entity scanning and wikilinks

---

## Core Integration Pattern

### Read-Before-Write

The fundamental pattern for vault operations:

```typescript
// 1. READ (Flywheel - safe exploration)
const context = await flywheel.get_section_content({
  path: 'daily-notes/2026-01-28.md',
  heading: 'Log'
});

// 2. DECIDE (your application logic)
const newEntry = processUserInput(userMessage);

// 3. WRITE (Crank - controlled mutation)
const result = await crank.vault_add_to_section({
  path: 'daily-notes/2026-01-28.md',
  section: 'Log',
  content: newEntry,
  format: 'timestamp-bullet',
  commit: true
});

// 4. VERIFY (Flywheel - confirm success)
const updated = await flywheel.get_section_content({
  path: 'daily-notes/2026-01-28.md',
  heading: 'Log'
});
```

### Why This Pattern?

| Step | Tool | Purpose |
|------|------|---------|
| Read | Flywheel | Understand current state |
| Decide | Your code | Apply business logic |
| Write | Crank | Make deterministic changes |
| Verify | Flywheel | Confirm mutation succeeded |

---

## Integration Scenarios

### Scenario 1: Voice Memo to Daily Log

**Flow**: Voice input → Transcription → Context enrichment → Daily note

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Voice App  │────▶│ Transcribe  │────▶│   Claude    │────▶│    Crank    │
│  (Telegram) │     │  (Whisper)  │     │  (Context)  │     │   (Write)   │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                                              │
                                              ▼
                                        ┌─────────────┐
                                        │  Flywheel   │
                                        │  (Backlinks)│
                                        └─────────────┘
```

**Example implementation**:
```javascript
// Telegram bot receives voice message
bot.on('voice', async (ctx) => {
  const audioFile = await ctx.getFile();
  const transcript = await whisper.transcribe(audioFile);

  // Add to daily note with auto-wikilinks
  await crank.vault_add_to_section({
    path: `daily-notes/${today}.md`,
    section: 'Log',
    content: transcript,
    format: 'timestamp-bullet'
  });

  ctx.reply('Logged! Connections: ' + result.wikilinkInfo);
});
```

### Scenario 2: Overnight Agent Briefing

**Flow**: Scheduled task → Graph analysis → Briefing generation

```javascript
// Runs at 6 AM daily
async function morningBriefing() {
  // 1. Get high-priority items from graph
  const urgent = await flywheel.search_notes({
    query: 'status:blocked OR status:at-risk',
    limit: 5
  });

  // 2. Get related context
  for (const item of urgent) {
    const context = await flywheel.get_related_notes({
      path: item.path,
      limit: 3
    });
    item.context = context;
  }

  // 3. Generate briefing
  const briefing = await claude.generate({
    prompt: 'Summarize these blocked items...',
    data: urgent
  });

  // 4. Add to daily note
  await crank.vault_add_to_section({
    path: `daily-notes/${today}.md`,
    section: 'Morning Briefing',
    content: briefing,
    format: 'plain'
  });
}
```

### Scenario 3: CRM from Markdown

**Flow**: Daily interactions → Auto-link contacts → Build relationship graph

```
Day 1:   Create contacts/Sarah Thompson.md
         └─▶ Entity index adds "Sarah Thompson"

Day 7:   Log "Call with Sarah about the proposal"
         └─▶ Auto-links: "Call with [[Sarah Thompson]] about the proposal"
         └─▶ Backlink created on Sarah's note

Day 30:  Query: "Show all interactions with Sarah"
         └─▶ Flywheel returns 12 backlinks from daily notes
         └─▶ Relationship history built automatically
```

---

## Multi-Device Sync

### Pattern: Git-Based Sync

Flywheel-Crank's git integration enables multi-device workflows:

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│   Device A  │◄───────▶│    Git      │◄───────▶│   Device B  │
│   (Laptop)  │  push   │   Remote    │  pull   │   (Phone)   │
│             │  pull   │             │  push   │             │
└─────────────┘         └─────────────┘         └─────────────┘
       │                                               │
       ▼                                               ▼
┌─────────────┐                               ┌─────────────┐
│ Crank MCP   │                               │ Obsidian    │
│ commit:true │                               │   Mobile    │
└─────────────┘                               └─────────────┘
```

**Workflow**:
1. Crank mutations with `commit: true` create git commits
2. Device A pushes to remote (GitHub, GitLab, etc.)
3. Device B pulls changes
4. Entity cache auto-rebuilds on Crank restart

### Conflict Prevention

Crank's section-scoped operations minimize conflicts:

| Operation | Conflict Risk | Why |
|-----------|---------------|-----|
| `vault_add_to_section` | Low | Appends, doesn't modify |
| `vault_replace_in_section` | Medium | Pattern-based, precise |
| `vault_update_frontmatter` | Low | Merges, doesn't overwrite |
| `vault_toggle_task` | Low | Single line change |

---

## CI/CD Integration

### GitHub Actions: Automated Vault Updates

```yaml
# .github/workflows/vault-update.yml
name: Daily Vault Update
on:
  schedule:
    - cron: '0 6 * * *'  # 6 AM daily

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install Flywheel
        run: npm install @velvetmonkey/flywheel-mcp @velvetmonkey/flywheel-crank

      - name: Run update script
        env:
          PROJECT_PATH: ${{ github.workspace }}
        run: node scripts/daily-update.js

      - name: Commit changes
        run: |
          git config user.name "Flywheel Bot"
          git config user.email "bot@example.com"
          git add -A
          git commit -m "chore: daily vault update" || exit 0
          git push
```

### Proof-of-Work Validation

Verify graph integrity in CI:

```typescript
// ci/validate-graph.ts
import { buildVaultIndex, getBacklinksForNote } from '@velvetmonkey/flywheel';

const index = await buildVaultIndex(process.env.VAULT_PATH);

// Validate backlinks are bidirectional
for (const [path, note] of index.notes) {
  for (const outlink of note.outlinks) {
    const backlinks = getBacklinksForNote(index, outlink.target);
    assert(backlinks.some(b => b.source === path),
      `Missing backlink: ${path} -> ${outlink.target}`);
  }
}

console.log('Graph validation passed');
```

---

## Security Model

### Permission Hierarchy

```
┌─────────────────────────────────────────────────────────────────┐
│                    SECURITY LAYERS                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Layer 1: MCP Tool Permissions                                   │
│  ══════════════════════════════                                  │
│  Claude Code settings.json controls which tools are allowed      │
│  Deny Write(**)/Edit(**) to force all writes through Crank       │
│                                                                  │
│  Layer 2: Flywheel-Crank Tool-Level Permissions                  │
│  ═════════════════════════════════════════════                   │
│  Each Crank tool requires separate approval                      │
│  Start with vault_add_task, expand gradually                     │
│                                                                  │
│  Layer 3: Git Safety Net                                         │
│  ═══════════════════════                                         │
│  commit: true creates undo points                                │
│  vault_undo_last_mutation for rollback                           │
│                                                                  │
│  Layer 4: Path Sandboxing                                        │
│  ════════════════════════                                        │
│  All paths validated (no ../ escapes)                            │
│  Operations confined to vault root                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Recommended `.claude/settings.json`

```json
{
  "permissions": {
    "allow": [
      "Read(**/*.md)",
      "Glob",
      "Grep",
      "mcp__flywheel__*",
      "mcp__flywheel-crank__vault_add_to_section",
      "mcp__flywheel-crank__vault_add_task",
      "mcp__flywheel-crank__vault_toggle_task"
    ],
    "deny": [
      "Write(**)",
      "Edit(**)",
      "Read(.obsidian/**)",
      "Read(.git/**)"
    ]
  }
}
```

**Result**: All vault mutations forced through Crank MCP tools.

---

## See Also

- [Configuration](./configuration.md) - MCP server setup
- [Tools Reference](./tools-reference.md) - Complete tool documentation
- [Privacy](./privacy.md) - Data handling and privacy
