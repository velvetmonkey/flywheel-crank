# Policy Authoring Guide

Deep dive on writing deterministic workflow policies for Flywheel-Crank.

---

## What Are Policies?

Policies are YAML definitions that orchestrate multiple mutations into atomic workflows.

**Key benefits:**
- **Deterministic** - Same input → same output
- **Atomic** - All steps commit together or rollback on failure
- **Reversible** - Single undo reverts everything
- **Reviewable** - YAML lives in git

---

## Quick Example

```yaml
# .claude/policies/daily-log.yaml
version: "1.0"
name: daily-log
description: Add timestamped entry to daily note with auto-wikilinks

variables:
  content:
    type: string
    required: true
    description: What to log

steps:
  - id: add-entry
    tool: vault_add_to_section
    params:
      path: "daily-notes/{{today}}.md"
      section: "## Log"
      content: "- {{time}} {{content}}"
      format: timestamp-bullet
      suggestOutgoingLinks: true
```

---

## Policy Structure

```yaml
version: "1.0"                    # Required, always "1.0"
name: <unique-identifier>         # Required
description: <what this policy does>  # Required

variables:                        # Optional: input parameters
  <name>:
    type: string|number|boolean|array|enum
    required: true|false
    default: <default-value>
    enum: [option1, option2]      # For enum type only
    description: <help text>

conditions:                       # Optional: state checks
  - id: <condition-id>
    check: <check-type>
    path: <file-path>
    # Additional fields per check type

steps:                            # Required: at least one step
  - id: <step-id>
    tool: <crank-tool-name>
    when: "{{conditions.check-id}}"  # Optional: conditional execution
    params:
      <tool-specific-params>
    description: <optional step description>
```

---

## Policy Storage

Policies live in `.claude/policies/`:

```
vault/
├── .claude/
│   ├── policies/
│   │   ├── daily-log.yaml
│   │   └── capture-decision.yaml
│   └── flywheel.db               # State database
```

---

## Template Variables

### Built-in Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `{{today}}` | Today's date (YYYY-MM-DD) | `2026-02-06` |
| `{{time}}` | Current time (HH:MM) | `14:32` |
| `{{date}}` | Same as today | `2026-02-06` |
| `{{now}}` | ISO timestamp | `2026-02-06T14:32:00.000Z` |

### User Variables

Access variables defined in the `variables:` section:

```yaml
variables:
  title:
    type: string
    required: true

steps:
  - id: create-note
    tool: vault_create_note
    params:
      path: "notes/{{title}}.md"
```

### Nested Access

Use dot notation for nested values:

```yaml
# {{user.name}} accesses user: { name: "Alice" }
```

---

## Filters

Apply filters with the pipe syntax: `{{value | filter}}`

| Filter | Description | Example |
|--------|-------------|---------|
| `upper` | Uppercase | `{{name \| upper}}` → `ALICE` |
| `lower` | Lowercase | `{{name \| lower}}` → `alice` |
| `trim` | Remove whitespace | `{{text \| trim}}` |
| `default(val)` | Fallback if empty | `{{name \| default(Anonymous)}}` |
| `date` | Format as YYYY-MM-DD | `{{timestamp \| date}}` |
| `time` | Format as HH:MM | `{{timestamp \| time}}` |
| `iso` | ISO timestamp | `{{timestamp \| iso}}` |
| `join(sep)` | Join array | `{{tags \| join(, )}}` |
| `first` | First element/char | `{{items \| first}}` |
| `last` | Last element/char | `{{items \| last}}` |
| `slug` | URL-safe slug | `{{title \| slug}}` → `my-title` |

---

## Variable Types

### String

```yaml
variables:
  title:
    type: string
    required: true
    description: Note title
```

### Number

```yaml
variables:
  priority:
    type: number
    default: 3
```

### Boolean

```yaml
variables:
  archived:
    type: boolean
    default: false
```

### Array

```yaml
variables:
  tags:
    type: array
    default: ["inbox"]
```

### Enum

```yaml
variables:
  status:
    type: enum
    enum: ["draft", "review", "published"]
    required: true
```

---

## Condition Types

Conditions check vault state before execution. Use `when:` in steps to conditionally run.

### File Conditions

```yaml
conditions:
  - id: note-exists
    check: file_exists
    path: "daily-notes/{{today}}.md"

  - id: note-missing
    check: file_not_exists
    path: "archive/old-note.md"
```

### Section Conditions

```yaml
conditions:
  - id: has-log-section
    check: section_exists
    path: "daily-notes/{{today}}.md"
    section: "## Log"

  - id: no-summary
    check: section_not_exists
    path: "daily-notes/{{today}}.md"
    section: "## Summary"
```

### Frontmatter Conditions

```yaml
conditions:
  - id: is-draft
    check: frontmatter_equals
    path: "projects/{{name}}.md"
    field: status
    value: draft

  - id: has-status
    check: frontmatter_exists
    path: "projects/{{name}}.md"
    field: status

  - id: no-priority
    check: frontmatter_not_exists
    path: "projects/{{name}}.md"
    field: priority
```

### Using Conditions in Steps

```yaml
steps:
  - id: create-daily
    tool: vault_create_note
    when: "{{conditions.note-missing}}"
    params:
      path: "daily-notes/{{today}}.md"
      content: "# {{today}}\n\n## Log\n"

  - id: add-log
    tool: vault_add_to_section
    params:
      path: "daily-notes/{{today}}.md"
      section: "## Log"
      content: "{{entry}}"
```

---

## Available Tools

| Tool | Description |
|------|-------------|
| `vault_add_to_section` | Add content to a section |
| `vault_remove_from_section` | Remove matching lines |
| `vault_replace_in_section` | Find and replace in section |
| `vault_create_note` | Create new note |
| `vault_delete_note` | Delete a note |
| `vault_toggle_task` | Toggle checkbox state |
| `vault_add_task` | Add a new task |
| `vault_update_frontmatter` | Update YAML fields |
| `vault_add_frontmatter_field` | Add new frontmatter field |

---

## Multi-Step Policies

Steps execute in order and commit together:

```yaml
version: "1.0"
name: capture-decision
description: Create ADR and log to daily note

variables:
  id:
    type: string
    required: true
  title:
    type: string
    required: true
  context:
    type: string
    required: true

steps:
  - id: create-adr
    tool: vault_create_note
    params:
      path: "decisions/ADR-{{id}} {{title}}.md"
      content: |
        ---
        status: proposed
        date: {{today}}
        ---
        # ADR-{{id}}: {{title}}

        ## Context
        {{context}}

        ## Decision


        ## Consequences


  - id: log-creation
    tool: vault_add_to_section
    params:
      path: "daily-notes/{{today}}.md"
      section: "## Log"
      content: "- Created [[ADR-{{id}} {{title}}]]"
      suggestOutgoingLinks: true
```

**Commit:** `[Policy:capture-decision] Update 2 file(s)`

**Undo:** Single command reverts both files.

---

## MCP Policy Tools

| Tool | Description |
|------|-------------|
| `policy_validate` | Validate policy YAML syntax and schema |
| `policy_preview` | Dry-run showing planned changes |
| `policy_execute` | Run policy with variables |
| `policy_list` | List available policies |
| `policy_diff` | Compare policy versions |
| `policy_export` | Export policy as JSON |
| `policy_import` | Import policy from JSON |

### Example: Preview Before Execute

```typescript
// Validate first
await policy_validate({ name: "daily-log" });

// Preview changes
const preview = await policy_preview({
  name: "daily-log",
  variables: { content: "Met with Sarah about API design" }
});

// Execute if preview looks good
await policy_execute({
  name: "daily-log",
  variables: { content: "Met with Sarah about API design" }
});
```

---

## Rollback Behavior

If any step fails, all previous steps are rolled back:

```yaml
steps:
  - id: step-1
    tool: vault_add_to_section   # Succeeds
    params: ...

  - id: step-2
    tool: vault_create_note      # Fails (file already exists)
    params: ...
```

**Result:** Step 1 is rolled back. Vault state unchanged.

---

## Best Practices

1. **Keep policies focused** - One workflow per policy
2. **Use descriptive names** - `capture-client-interaction` not `p1`
3. **Validate first** - Use `policy_validate` before executing
4. **Preview changes** - Use `policy_preview` for complex policies
5. **Version control** - Commit policies to git
6. **Add descriptions** - Document variables and steps
7. **Use conditions** - Check state before mutating

---

## Complete Example

```yaml
# .claude/policies/weekly-rollup.yaml
version: "1.0"
name: weekly-rollup
description: Create weekly summary from daily notes

variables:
  week:
    type: string
    required: true
    description: Week identifier (e.g., "2026-W06")
  highlights:
    type: array
    default: []
    description: Key highlights to include

conditions:
  - id: rollup-missing
    check: file_not_exists
    path: "weekly/{{week}}.md"

steps:
  - id: create-rollup
    tool: vault_create_note
    when: "{{conditions.rollup-missing}}"
    params:
      path: "weekly/{{week}}.md"
      content: |
        ---
        type: weekly-rollup
        week: {{week}}
        created: {{today}}
        ---
        # Week {{week}}

        ## Highlights
        {{highlights | join(\n- )}}

        ## Summary


  - id: log-rollup
    tool: vault_add_to_section
    params:
      path: "daily-notes/{{today}}.md"
      section: "## Log"
      content: "- Created weekly rollup: [[{{week}}]]"
      suggestOutgoingLinks: true

output:
  summary: "Created weekly rollup for {{week}}"
  files:
    - "weekly/{{week}}.md"
    - "daily-notes/{{today}}.md"
```

---

## See Also

- [Tools Reference](./tools-reference.md) - Complete tool documentation
- [Wikilinks](./wikilinks.md) - Auto-wikilink behavior
- [Configuration](./configuration.md) - Vault settings
