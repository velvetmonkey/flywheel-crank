# Policy Authoring Guide

Deep dive on writing deterministic workflow policies for Flywheel-Crank.

---

## What Are Policies?

Policies are YAML definitions that orchestrate multiple mutations into atomic workflows.

**Key benefits:**
- **Deterministic** - Same input → same output
- **Atomic** - All steps commit together
- **Reversible** - Single undo reverts everything
- **Reviewable** - YAML lives in git

---

## Quick Example

```yaml
# .crank/policies/daily-log.yaml
name: daily-log
description: Add timestamped entry to daily note with auto-wikilinks
trigger: "Log *"
actions:
  - tool: vault_add_to_section
    target: daily-notes/{today}.md
    section: "## Log"
    content: "- {time} {input}"
    format: timestamp-bullet
    wikilinks: auto
```

---

## Policy Structure

```yaml
name: <unique-identifier>
description: <what this policy does>
trigger: <optional natural language pattern>
params:
  - name: <param-name>
    type: string|date|path
    required: true|false
actions:
  - id: <step-id>
    tool: <crank-tool-name>
    target: <file-path-with-templates>
```

---

## Template Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `{today}` | Today's date | `2026-02-01` |
| `{time}` | Current time | `14:32` |
| `{input}` | Trigger input | `discussed turbopump...` |

---

## Available Tools

- `vault_add_to_section` - Add content to section
- `vault_remove_from_section` - Remove content
- `vault_replace_in_section` - Replace content
- `vault_toggle_task` - Toggle task state
- `vault_update_frontmatter` - Update YAML fields
- `vault_create_note` - Create new note

---

## Multi-Step Policies

Steps execute in order, commit together:

```yaml
name: capture-decision
actions:
  - id: create-adr
    tool: vault_create_note
    target: decisions/ADR-{id} {title}.md

  - id: log-creation
    tool: vault_add_to_section
    target: daily-notes/{today}.md
    section: "## Log"
    content: "- Created [[ADR-{id} {title}]]"
```

**Commit:** `[Policy:capture-decision] Update 2 file(s)`

**Undo:** Single command reverts both files.

---

## Policy Storage

Policies live in `.crank/policies/`:

```
vault/
├── .crank/
│   └── policies/
│       ├── daily-log.yaml
│       └── capture-decision.yaml
```

---

## Best Practices

1. **Keep policies focused** - One workflow per policy
2. **Use descriptive names** - `capture-client-interaction` not `p1`
3. **Test with preview first** - `policy_preview` before `policy_execute`
4. **Version control** - Commit policies to git

---

## See Also

- [Examples](./EXAMPLES.md) - Copy-paste examples
- [Tools Reference](./tools-reference.md) - Complete tool documentation
