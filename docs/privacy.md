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

## See Also

- [Configuration](./configuration.md) - Permission settings
- [Tools Reference](./tools-reference.md) - What each tool returns
- [Wikilinks](./wikilinks.md) - Entity data handling
