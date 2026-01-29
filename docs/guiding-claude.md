# Guiding Claude's Tool Choices

Success with Flywheel + Crank comes from **iterative feedback**. Claude makes good tool choices most of the time, but you can guide it when needed.

---

## The Feedback Loop

Working with Claude follows a natural rhythm:

1. **Claude suggests a tool** → Review the choice
2. **Refine if needed** → "Use vault_add_to_section instead"
3. **Approve execution** → Tool runs
4. **Verify result** → "Show me the updated note"

This loop gets faster as Claude learns your patterns from the CLAUDE.md file and your feedback.

---

## Common Corrections

When Claude picks the wrong tool, a quick correction gets you back on track:

| Claude Does | You Say |
|-------------|---------|
| Tries to use Write tool directly | "Use flywheel-crank tools to mutate" |
| Picks the wrong section tool | "Use get_section_content first to read" |
| Skips verification | "Verify with get_note_metadata" |
| Modifies too much | "Just add to Log section, don't rewrite" |
| Reads whole file unnecessarily | "Use flywheel to query the index instead" |
| Creates new file when append would work | "Append to the existing note" |

---

## Guiding by Intent

Sometimes it's easier to describe what you want rather than name the tool:

| Your Intent | What to Say |
|-------------|-------------|
| Add without replacing | "Append to the section, don't replace it" |
| Surgical change | "Only modify that one field" |
| Preserve existing | "Keep everything else, just add this line" |
| Check before changing | "Read the section first, then suggest changes" |
| Atomic commits | "Commit this change separately" |

---

## Teaching Claude Your Patterns

The more specific your vault's CLAUDE.md file, the better Claude's tool choices become.

### What to Include

**Section conventions:**
```markdown
## Sections I Use
- `## Log` - Timestamped activity entries (append only)
- `## Tasks` - Checkbox items, never overwrite completed ones
- `## Notes` - Freeform content, can be replaced
```

**Frontmatter rules:**
```markdown
## Frontmatter Patterns
- `status` is always lowercase: draft, active, done
- `date` uses YYYY-MM-DD format
- `tags` is an array, not a string
```

**Mutation preferences:**
```markdown
## How I Want Changes Made
- Always append to Log, never replace
- Update frontmatter atomically, one field at a time
- Commit after each logical change, not in batches
```

---

## Verification Patterns

After mutations, verify the result:

### Quick Verification
```
You: "Show me the updated section"
Claude: [uses get_section_content]
```

### Full Note Check
```
You: "Read back the whole note"
Claude: [uses get_note_metadata + get_section_content]
```

### Graph Verification
```
You: "Did that create the right links?"
Claude: [uses get_forward_links on the modified note]
```

---

## When Claude Gets It Right

When Claude makes good tool choices, the workflow is seamless:

```
You: "Add 'finished API review' to today's log"

Claude: I'll add that to today's daily note.
[uses vault_add_to_section with section="Log"]

Added to daily-notes/2026-01-29.md:
  ## Log
  - 09:15 Morning standup
  - 14:30 finished API review  ← NEW

Committed: "note(daily): Add log entry"
```

No corrections needed—Claude picked the right tool, used append mode, and committed appropriately.

---

## Building Good Habits

### Start Sessions with Context
```
You: "I'm working on client deliverables today, focusing on Acme Corp"
```
This primes Claude to make relevant tool choices.

### Correct Early
If Claude's first tool choice is wrong, correct it immediately. This helps Claude adjust for the rest of the session.

### Be Specific About Scope
```
"Update the status field only"           ← Clear scope
"Make some updates to the frontmatter"   ← Vague, might over-edit
```

### Confirm Destructive Changes
```
You: "Replace the whole Implementation section"
Claude: "This will replace the existing Implementation section (47 lines). Proceed?"
```

---

## Related Docs

- **[Tools Reference](tools-reference.md)** — What each tool does
- **[Configuration](configuration.md)** — Permission setup
- **[Wikilinks](wikilinks.md)** — Auto-linking behavior
