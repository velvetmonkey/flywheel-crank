# Flywheel Crank - Usage Examples

This guide demonstrates all 11 Flywheel Crank tools using real examples from the [Flywheel demo vaults](https://github.com/velvetmonkey/flywheel).

---

## Setup

Point Flywheel Crank at one of the demo vaults:

```bash
# Clone the flywheel repo (includes demo vaults)
git clone https://github.com/velvetmonkey/flywheel.git

# Configure MCP to use artemis-rocket demo vault
export PROJECT_PATH=/path/to/flywheel/demos/artemis-rocket
```

**MCP Configuration** (`~/.claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "flywheel-crank": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-crank"],
      "env": {
        "PROJECT_PATH": "/path/to/flywheel/demos/artemis-rocket"
      }
    }
  }
}
```

> **Windows Note**: Use `"command": "cmd", "args": ["/c", "npx", "-y", "@velvetmonkey/flywheel-crank"]`

---

## Quick Start

Try these 3 commands to see Flywheel Crank in action:

### 1. Add a timestamped log entry

```javascript
vault_add_to_section({
  path: "daily-notes/2026-01-02.md",
  section: "Notes",
  content: "Reviewed Test 3 thermal data with Marcus - margins look excellent",
  format: "timestamp-bullet"
})
```

**Result**: Adds `- 14:30 Reviewed Test 3 thermal data with Marcus - margins look excellent` to the Notes section with wikilink suggestions.

### 2. Toggle a completed task

```javascript
vault_toggle_task({
  path: "meetings/2026-01-02 Sprint Planning.md",
  taskText: "Complete Test 3 analysis report"
})
```

**Result**: Toggles `- [ ] David Kim: Complete Test 3 analysis report` to `- [x] ...`

### 3. List sections in a note

```javascript
vault_list_sections({
  path: "daily-notes/2026-01-02.md"
})
```

**Result**: Returns all headings: `["Attendance", "Key Updates", "Action Items", "Risks & Issues", "Schedule Status", "Budget Status", "Decisions Made", "Notes", "Links"]`

---

## Demo Scenarios

### Scenario: Artemis Rocket (Agent Builder Workflow)

**Use case**: Overnight agent prepares morning briefing from vault context.

```javascript
// Agent queries context cloud for propulsion status, then logs briefing
vault_add_to_section({
  path: "daily-notes/2026-01-03.md",
  section: "Morning Briefing",
  content: "Overnight analysis identified propulsion Test 4 at risk due to Turbopump delivery delay. Marcus Johnson tracking with Acme Aerospace.",
  format: "timestamp-bullet"
})
```

**Result**:
```markdown
## Morning Briefing
- **02:30** Overnight analysis identified propulsion [[Test 4]] at risk due to [[Turbopump]]
  delivery delay. [[Marcus Johnson]] tracking with [[Acme Aerospace]].
  → [[Propulsion System]] [[Elena Rodriguez]] [[ADR-002 Engine Selection]]
```

**Two linking behaviors in action:**
- **Auto-wikilinks:** [[Test 4]], [[Turbopump]], [[Marcus Johnson]], [[Acme Aerospace]] — exact text matches
- **Contextual cloud:** → [[Propulsion System]] [[Elena Rodriguez]] [[ADR-002 Engine Selection]] — related context
  (Elena suggested because avionics depends on propulsion timeline)

---

### Scenario: Carter Strategy (Voice/PKM Workflow)

**Use case**: Voice memo transcription becomes context-rich daily log entry.

```javascript
// Voice transcription: "Just wrapped up call with Sarah at Acme about
// the data migration. Validation showing 85% complete. Mentioned they
// might have another project for Q2."

vault_add_to_section({
  path: "daily-notes/2026-01-03.md",
  section: "Log",
  content: "Call with Sarah Thompson at Acme Corp about Acme Data Migration. Validation 85% complete. Potential Q2 project mentioned.",
  format: "timestamp-bullet"
})
```

**Result**:
```markdown
## Log
- **14:30** Call with [[Sarah Thompson]] at [[Acme Corp]] about [[Acme Data Migration]].
  Validation 85% complete. Potential Q2 project mentioned.
  → [[TechStart Inc]] [[GlobalBank]] [[INV-2025-047]]
```

**Why these suggestions?**
- **"TechStart Inc"** — Co-occurrence pattern: consultant often works TechStart after Acme calls
- **"INV-2025-047"** — Acme work = billable hours, invoice context captured automatically

---

### Scenario: Note Creation (Two-Step Pattern)

**Why two steps?** `vault_create_note` handles structure (frontmatter), while `vault_add_to_section` handles content with wikilink intelligence.

```javascript
// Step 1: Create structure with vault_create_note
vault_create_note({
  path: "decisions/ADR-006 Turbopump Schedule Mitigation.md",
  frontmatter: {
    type: "decision",
    status: "proposed",
    date: "2026-01-03",
    owner: "[[Sarah Chen]]"
  },
  content: "# ADR-006: Turbopump Schedule Mitigation\n\n## Context\n\n## Decision\n\n## Consequences"
})

// Step 2: Add content with vault_add_to_section (gets wikilink suggestions)
vault_add_to_section({
  path: "decisions/ADR-006 Turbopump Schedule Mitigation.md",
  section: "Context",
  content: "Turbopump delivery delayed from Jan 5 to Jan 20 due to vendor supply chain issues. This impacts the Test 4 campaign scheduled for Jan 15.",
  format: "plain"
})
```

**Result after Step 2**:
```markdown
## Context
Turbopump delivery delayed from Jan 5 to Jan 20 due to vendor supply chain issues.
This impacts the [[Test 4]] campaign scheduled for Jan 15.
→ [[Marcus Johnson]] [[Propulsion System]] [[Acme Aerospace]]
```

**Pattern benefits:**
- `vault_create_note` = structure (frontmatter not processed through wikilink algorithm)
- `vault_add_to_section` = content with full wikilink intelligence

---

## All 11 Tools

### Mutation Tools

#### `vault_add_to_section`

Add content to a section with formatting options.

```javascript
// Add a bullet point to a section
vault_add_to_section({
  path: "project/Project Roadmap.md",
  section: "Active Risks",
  content: "R-025: Supply chain delays for composite materials",
  format: "bullet"
})
```

**Formats available**: `task`, `bullet`, `numbered`, `timestamp-bullet`, `plain`

**With wikilink suggestions** (enabled by default):

```javascript
vault_add_to_section({
  path: "daily-notes/2026-01-02.md",
  section: "Notes",
  content: "Discussed landing algorithm optimization with Elena during standup"
})
```

**Result**:
```markdown
## Notes
- 14:30 Discussed landing algorithm optimization with Elena during standup
  → [[Elena Rodriguez]] [[Landing Algorithm]] [[GNC System]]
```

**Disable wikilink suggestions**:

```javascript
vault_add_to_section({
  path: "daily-notes/2026-01-02.md",
  section: "Notes",
  content: "Quick note without suggestions",
  skipWikilinks: true
})
```

#### `vault_remove_from_section`

Remove lines matching a pattern.

```javascript
// Remove a completed risk from the active list
vault_remove_from_section({
  path: "project/Risk Register.md",
  section: "Active Risks",
  pattern: "R-024",
  mode: "first"
})
```

**Modes**: `first` (remove first match), `all` (remove all matches)

**With regex**:

```javascript
vault_remove_from_section({
  path: "project/Project Roadmap.md",
  section: "Recent Decisions",
  pattern: "^- .*2025-08.*$",
  useRegex: true,
  mode: "all"
})
```

#### `vault_replace_in_section`

Replace content within a section.

```javascript
// Update system status
vault_replace_in_section({
  path: "project/Project Roadmap.md",
  section: "System Status",
  search: "🟡 At Risk",
  replacement: "🟢 On Track",
  mode: "first"
})
```

**With wikilink suggestions** (enabled by default):

```javascript
vault_replace_in_section({
  path: "project/Project Roadmap.md",
  section: "Current Phase",
  search: "Month 8 of 18",
  replacement: "Month 9 of 18 - Propulsion testing complete, moving to integration"
})
```

**Result** includes wikilink suggestions for contextual entities.

---

### Task Tools

#### `vault_toggle_task`

Toggle a task checkbox (checked/unchecked).

```javascript
// Mark action item complete
vault_toggle_task({
  path: "meetings/2026-01-02 Sprint Planning.md",
  taskText: "Review Test 3 data, approve Test 4 proceed decision"
})
```

**Before**: `- [ ] Marcus Johnson: Review Test 3 data, approve Test 4 proceed decision`
**After**: `- [x] Marcus Johnson: Review Test 3 data, approve Test 4 proceed decision`

#### `vault_add_task`

Add a new task to a section.

```javascript
vault_add_task({
  path: "meetings/2026-01-02 Sprint Planning.md",
  section: "Action Items Summary",
  task: "Schedule integration test with avionics team",
  position: "end"
})
```

**With wikilink suggestions** (enabled by default):

```javascript
vault_add_task({
  path: "daily-notes/2026-01-02.md",
  section: "Action Items",
  task: "Follow up with Marcus about turbopump delivery status"
})
```

**Result**:
```markdown
- [ ] Follow up with Marcus about turbopump delivery status
  → [[Marcus Johnson]] [[Turbopump]]
```

---

### Frontmatter Tools

#### `vault_update_frontmatter`

Update or merge frontmatter fields.

```javascript
// Update meeting attendees
vault_update_frontmatter({
  path: "meetings/2026-01-02 Sprint Planning.md",
  updates: {
    status: "complete",
    reviewed: true
  }
})
```

**Before**:
```yaml
---
type: meeting
date: 2026-01-02
attendees:
  - "[[Sarah Chen]]"
---
```

**After**:
```yaml
---
type: meeting
date: 2026-01-02
attendees:
  - "[[Sarah Chen]]"
status: complete
reviewed: true
---
```

#### `vault_add_frontmatter_field`

Add a new field (fails if field already exists).

```javascript
vault_add_frontmatter_field({
  path: "systems/propulsion/Engine Design.md",
  field: "last_review",
  value: "2026-01-02"
})
```

---

### Note Tools

#### `vault_create_note`

Create a new note with frontmatter.

```javascript
// Create a new meeting note
vault_create_note({
  path: "meetings/2026-01-15 Test 4 Review.md",
  content: "# Test 4 Review Meeting\n\n## Attendees\n\n## Agenda\n\n## Action Items\n",
  frontmatter: {
    type: "meeting",
    date: "2026-01-15",
    attendees: ["[[Sarah Chen]]", "[[Marcus Johnson]]", "[[David Kim]]"],
    tags: ["meeting", "propulsion", "testing"]
  }
})
```

**Result**:
```markdown
---
type: meeting
date: 2026-01-15
attendees:
  - "[[Sarah Chen]]"
  - "[[Marcus Johnson]]"
  - "[[David Kim]]"
tags:
  - meeting
  - propulsion
  - testing
---
# Test 4 Review Meeting

## Attendees

## Agenda

## Action Items
```

#### `vault_delete_note`

Delete a note (requires confirmation).

```javascript
vault_delete_note({
  path: "drafts/old-draft.md",
  confirm: true
})
```

---

### System Tools

#### `vault_list_sections`

List all headings in a note.

```javascript
vault_list_sections({
  path: "project/Project Roadmap.md"
})
```

**Result**:
```json
{
  "sections": [
    "Overview",
    "Current Phase",
    "Key Milestones",
    "System Status",
    "Active Risks",
    "Recent Decisions",
    "Requirements Traceability",
    "Budget Summary",
    "Team Organization",
    "Meeting Cadence",
    "Links & Resources"
  ]
}
```

#### `vault_undo_last_mutation`

Undo the last git commit (soft reset to HEAD~1).

```javascript
// Oops, made a mistake? Undo it!
vault_undo_last_mutation()
```

**Note**: Only works when mutations were committed with `commit: true`.

---

## Workflow Scenarios

### Scenario A: Daily Standup Workflow

A typical morning standup workflow combining Flywheel (read) and Crank (write):

```javascript
// 1. READ: Get current daily note structure (using Flywheel)
const sections = await flywheel.get_sections({ path: "daily-notes/2026-01-02.md" });

// 2. WRITE: Add standup notes
vault_add_to_section({
  path: "daily-notes/2026-01-02.md",
  section: "Notes",
  content: "Propulsion team confirmed Test 4 ready for Friday",
  format: "timestamp-bullet",
  commit: true,
  commitMessage: "Add standup notes"
});

// 3. WRITE: Toggle completed tasks
vault_toggle_task({
  path: "daily-notes/2026-01-02.md",
  taskText: "Schedule Test 4 contingency planning",
  commit: true
});

// 4. WRITE: Add new tasks discovered
vault_add_task({
  path: "daily-notes/2026-01-02.md",
  section: "Action Items",
  task: "Confirm LOX delivery for Jan 12",
  commit: true
});
```

### Scenario B: Meeting Notes Workflow

Creating and populating meeting notes:

```javascript
// 1. CREATE: New meeting note
vault_create_note({
  path: "meetings/2026-01-08 Propulsion Review.md",
  content: "# Propulsion Review\n\n## Attendees\n\n## Agenda\n\n## Discussion\n\n## Action Items\n\n## Next Steps\n",
  frontmatter: {
    type: "meeting",
    date: "2026-01-08",
    tags: ["meeting", "propulsion"]
  }
});

// 2. UPDATE: Add attendees to frontmatter
vault_update_frontmatter({
  path: "meetings/2026-01-08 Propulsion Review.md",
  updates: {
    attendees: [
      "[[Marcus Johnson]]",
      "[[David Kim]]",
      "[[Rachel Martinez]]"
    ]
  }
});

// 3. ADD: Discussion points
vault_add_to_section({
  path: "meetings/2026-01-08 Propulsion Review.md",
  section: "Discussion",
  content: "Test 4 restart sequence validated in simulation",
  format: "bullet"
});
// Wikilink suggestions: → [[Test 4]] [[Engine Design]]

// 4. ADD: Action items with auto-wikilinks
vault_add_task({
  path: "meetings/2026-01-08 Propulsion Review.md",
  section: "Action Items",
  task: "Marcus to finalize Test 4 procedure document by Jan 10"
});
// Wikilink suggestions: → [[Marcus Johnson]] [[Test 4]]
```

### Scenario C: Project Update Workflow

Updating project status and tracking:

```javascript
// 1. REPLACE: Update milestone status
vault_replace_in_section({
  path: "project/Project Roadmap.md",
  section: "Key Milestones",
  search: "| Engine Hot Fire #1 | 2026-01-08 | 🔄 In Progress |",
  replacement: "| Engine Hot Fire #1 | 2026-01-08 | ✅ Complete |"
});

// 2. ADD: Progress entry
vault_add_to_section({
  path: "project/Project Roadmap.md",
  section: "Recent Decisions",
  content: "ADR-006 Test 4 Configuration: Approved 2.4:1 mixture ratio adjustment",
  format: "bullet"
});

// 3. UPDATE: Frontmatter status
vault_update_frontmatter({
  path: "project/Project Roadmap.md",
  updates: {
    updated: "2026-01-08"
  }
});

// 4. REMOVE: Retired risk
vault_remove_from_section({
  path: "project/Project Roadmap.md",
  section: "Active Risks",
  pattern: "R-003: Turbopump Delivery Delay",
  mode: "first"
});
```

---

## Git Integration

All mutations can optionally commit changes:

```javascript
vault_add_to_section({
  path: "daily-notes/2026-01-02.md",
  section: "Notes",
  content: "Important update",
  commit: true,
  commitMessage: "Add important update to daily note"
});
```

**Undo mistakes**:

```javascript
// Revert the last committed mutation
vault_undo_last_mutation();
```

---

## Wikilink Suggestions (Contextual Cloud)

Flywheel Crank provides two linking behaviors:
1. **Auto-wikilinks** — Exact text matches wrapped inline as `[[Entity]]`
2. **Contextual cloud** — Semantically related suggestions appended as `→ [[...]]`

**How the contextual cloud works**:
1. Tokenizes your content into significant words
2. Scores vault entities using graph algorithms (co-occurrence, common neighbors, hub connections)
3. Suggests top 3 related entities (excluding those already linked)

**Example**:

```javascript
vault_add_to_section({
  path: "daily-notes/2026-01-02.md",
  section: "Notes",
  content: "Elena confirmed the landing algorithm is ready for HIL testing"
});
```

**Result**:
```markdown
- 14:30 [[Elena Rodriguez|Elena]] confirmed the [[Landing Algorithm|landing algorithm]] is ready for HIL testing
  → [[GNC System]] [[Avionics System]] [[Flight Computer]]
```

Notice:
- **Auto-wikilinks** applied inline: "Elena" → `[[Elena Rodriguez|Elena]]`, "landing algorithm" → `[[Landing Algorithm]]`
- **Contextual cloud** appended: → `[[GNC System]]` etc. (related systems not mentioned in text)

**Disable suggestions** when not needed:

```javascript
vault_add_to_section({
  path: "daily-notes/2026-01-02.md",
  section: "Notes",
  content: "Quick personal note",
  skipWikilinks: true
});
```

---

## Demo Vault Entities

The artemis-rocket demo vault includes rich entities for testing:

**People**:
- `[[Sarah Chen]]` - Chief Engineer
- `[[Marcus Johnson]]` - Propulsion Lead
- `[[Elena Rodriguez]]` - Avionics/GNC Lead
- `[[James Park]]` - Structures Lead
- `[[David Kim]]` - Senior Propulsion Engineer

**Systems**:
- `[[Propulsion System]]`, `[[Avionics System]]`, `[[GNC System]]`, `[[Structures System]]`
- `[[Engine Design]]`, `[[Turbopump]]`, `[[Flight Computer]]`, `[[Landing Algorithm]]`

**Documents**:
- `[[Project Roadmap]]`, `[[Risk Register]]`, `[[Test Campaign Overview]]`
- `[[ADR-001 Propellant Selection]]`, `[[ADR-002 Flight Computer]]`

**Events**:
- `[[Critical Design Review]]`, `[[Preliminary Design Review]]`
- `[[Test 3]]`, `[[Test 4]]`, `[[Engine Hot Fire Results]]`

---

## See Also

- [Tool Reference](./tools-reference.md) - Complete API documentation
- [Configuration Guide](./configuration.md) - MCP setup options
- [Wikilinks Documentation](./wikilinks.md) - How intelligent linking works
- [Testing Guide](./testing.md) - Manual testing procedures
