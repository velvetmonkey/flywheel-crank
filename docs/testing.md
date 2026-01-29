# Testing Flywheel Crank

This document covers automated unit tests, manual MCP testing, and git integration behavior.

---

## Quick Start

```bash
# Run all tests
npm run test

# Watch mode (auto-rerun on changes)
npm run test:watch

# Type checking
npm run lint
```

---

## Test Structure

### Overview

**Total: 242 tests across 10 test files**

```
test/
├── helpers/
│   └── testUtils.ts         # Temp vault creation, fixtures
├── core/
│   ├── writer.test.ts       # 63 tests - file operations, section parsing
│   ├── git.test.ts          # 10 tests - git operations
│   └── vaultRoot.test.ts    # 8 tests - vault detection
└── tools/
    ├── mutations.test.ts    # 29 tests - add/remove/replace in sections
    ├── tasks.test.ts        # 19 tests - toggle/add tasks
    ├── frontmatter.test.ts  # 14 tests - frontmatter operations
    ├── notes.test.ts        # 14 tests - create/delete notes
    └── system.test.ts       # 13 tests - list sections, undo
```

### Test Patterns

**1. Temporary Vault Pattern**

All tests use isolated temporary vaults that are automatically cleaned up:

```typescript
const vault = await createTestVault({
  'daily-notes/2026-01-28.md': dailyNoteFixture,
});

const result = await tool('mcp__flywheel-crank__vault_add_to_section', {
  path: 'daily-notes/2026-01-28.md',
  section: '## Log',
  content: 'Test entry',
});

expect(result.success).toBe(true);
vault.cleanup();
```

**2. Section Detection Tests**

Tests verify various heading formats are correctly identified:

- Exact match: `## Log` → `## Log`
- Case-insensitive: `## log` → `## Log`
- Fuzzy: `## Food Log` → `## Food`
- Markdown tolerance: `##Log` (missing space)

**3. Format Tests**

Tests verify content formatting options:

- Task: `- [ ] Do thing`
- Bullet: `- Item`
- Numbered: `1. Item`
- Timestamp-bullet: `- **13:45** Item`
- Plain: `Item`

---

## Manual MCP Testing

### Purpose

Manual MCP testing verifies end-to-end integration with Claude Code and validates git behavior with the `AUTO_COMMIT` environment variable.

### Test Session 1: Full Crank Operations

This test validates all mutation tools in sequence and demonstrates the git integration workflow.

#### Tool Call Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        FLYWHEEL-CRANK MCP SERVER                            │
│                     (AUTO_COMMIT: "false" in .mcp.json)                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
    ┌───────────────────────────────┼───────────────────────────────┐
    │                               │                               │
    ▼                               ▼                               ▼
┌─────────┐                   ┌─────────┐                     ┌─────────┐
│  STEP 1 │                   │  STEP 2 │                     │  STEP 3 │
│ CREATE  │──────────────────▶│  LIST   │────────────────────▶│   ADD   │
│  NOTE   │                   │SECTIONS │                     │ CONTENT │
└─────────┘                   └─────────┘                     └─────────┘
    │                               │                               │
    ▼                               ▼                               ▼
┌─────────┐                   ┌─────────┐                     ┌─────────┐
│  STEP 4 │                   │  STEP 5 │                     │  STEP 6 │
│   ADD   │──────────────────▶│ TOGGLE  │────────────────────▶│ UPDATE  │
│  TASK   │                   │  TASK   │                     │FRONTMTR │
└─────────┘                   └─────────┘                     └─────────┘
    │                               │                               │
    ▼                               ▼                               ▼
┌─────────┐                   ┌─────────┐                     ┌─────────┐
│  STEP 7 │                   │  STEP 8 │                     │  STEP 9 │
│   ADD   │──────────────────▶│  READ   │────────────────────▶│  UNDO   │
│  FIELD  │                   │(verify) │                     │ ⚠️ BUG  │
└─────────┘                   └─────────┘                     └─────────┘
                                                                    │
                                                                    ▼
                                                              ┌─────────┐
                                                              │ STEP 10 │
                                                              │ DELETE  │
                                                              └─────────┘
```

#### Detailed Input/Output Log

**Step 1: mcp__flywheel-crank__vault_create_note**

```json
INPUT:
{
  "path": "new/test-flywheel-crank.md",
  "frontmatter": {
    "type": "test",
    "status": "draft",
    "created": "2026-01-28"
  },
  "content": "## Overview\n\nThis is a test note...\n\n## Tasks\n\n## Log"
}

OUTPUT:
{
  "success": true,
  "message": "Created note: new/test-flywheel-crank.md",
  "preview": "Frontmatter fields: type, status, created\nContent length: 96 chars"
}
```

**Step 2: mcp__flywheel-crank__vault_list_sections**

```json
INPUT:
{
  "path": "new/test-flywheel-crank.md"
}

OUTPUT:
{
  "success": true,
  "message": "Found 3 section(s) in new/test-flywheel-crank.md",
  "sections": [
    { "level": 2, "name": "Overview", "line": 1 },
    { "level": 2, "name": "Tasks", "line": 5 },
    { "level": 2, "name": "Log", "line": 7 }
  ]
}
```

**Step 3: mcp__flywheel-crank__vault_add_to_section**

```json
INPUT:
{
  "path": "new/test-flywheel-crank.md",
  "section": "Log",
  "content": "Testing flywheel-crank add_to_section operation",
  "format": "timestamp-bullet"
}

OUTPUT:
{
  "success": true,
  "message": "Added content to section \"Log\" in new/test-flywheel-crank.md",
  "preview": "- **17:44** Testing flywheel-crank add_to_section operation"
}
```

**Step 4: mcp__flywheel-crank__vault_add_task**

```json
INPUT:
{
  "path": "new/test-flywheel-crank.md",
  "section": "Tasks",
  "task": "Complete flywheel-crank testing"
}

OUTPUT:
{
  "success": true,
  "message": "Added task to section \"Tasks\" in new/test-flywheel-crank.md",
  "preview": "- [ ] Complete flywheel-crank testing"
}
```

**Step 5: mcp__flywheel-crank__vault_toggle_task**

```json
INPUT:
{
  "path": "new/test-flywheel-crank.md",
  "task": "Complete flywheel-crank testing"
}

OUTPUT:
{
  "success": true,
  "message": "Toggled task to completed in new/test-flywheel-crank.md",
  "preview": "[x] Complete flywheel-crank testing"
}
```

**Step 6: mcp__flywheel-crank__vault_update_frontmatter**

```json
INPUT:
{
  "path": "new/test-flywheel-crank.md",
  "frontmatter": { "status": "tested" }
}

OUTPUT:
{
  "success": true,
  "message": "Updated 1 frontmatter field(s) in new/test-flywheel-crank.md",
  "preview": "status: \"tested\""
}
```

**Step 7: mcp__flywheel-crank__vault_add_frontmatter_field**

```json
INPUT:
{
  "path": "new/test-flywheel-crank.md",
  "key": "tested_by",
  "value": "Claude"
}

OUTPUT:
{
  "success": true,
  "message": "Added frontmatter field \"tested_by\" to new/test-flywheel-crank.md",
  "preview": "tested_by: \"Claude\""
}
```

**Step 8: Read (Filesystem verification)**

```markdown
---
type: test
status: tested
created: '2026-01-28'
tested_by: Claude
---
## Overview

This is a test note for verifying flywheel-crank MCP operations.

## Tasks

- [x] Complete flywheel-crank testing
## Log

- **17:44** Testing flywheel-crank add_to_section operation
```

**Step 9: mcp__flywheel-crank__vault_undo_last_mutation ⚠️ BUG DISCOVERED**

```json
INPUT:
{
  "confirm": true
}

OUTPUT:
{
  "success": true,  // ⚠️ SHOULD HAVE BEEN false!
  "message": "Undone commit: Log: Added Flywheel MCP tools reference creation",
  "preview": "Commit: 7ce6041\nMessage: Log: Added Flywheel MCP tools reference creation"
}
```

**⚠️ BUG:** Undid an unrelated commit from the git history! The undo should have failed because `AUTO_COMMIT` was disabled, meaning no crank-specific commits existed to undo.

**Step 10: mcp__flywheel-crank__vault_delete_note**

```json
INPUT:
{
  "path": "new/test-flywheel-crank.md",
  "confirm": true
}

OUTPUT:
{
  "success": true,
  "message": "Deleted note: new/test-flywheel-crank.md"
}
```

---

### Test Session 2: Undo Fix Verification

This test verifies the fix for the undo bug discovered in Test Session 1.

#### Tool Call Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        FLYWHEEL-CRANK MCP SERVER                            │
│                     (AUTO_COMMIT: "false" - FIX APPLIED)                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
    ┌───────────────────────────────┼───────────────────────────────┐
    │                               │                               │
    ▼                               ▼                               ▼
┌─────────┐                   ┌─────────┐                     ┌─────────┐
│  STEP 1 │                   │  STEP 2 │                     │  STEP 3 │
│ CREATE  │──────────────────▶│  UNDO   │────────────────────▶│ DELETE  │
│  NOTE   │                   │ ✅ FAIL │                     │  NOTE   │
└─────────┘                   └─────────┘                     └─────────┘
```

#### Detailed Input/Output Log

**Step 1: mcp__flywheel-crank__vault_create_note**

```json
INPUT:
{
  "path": "new/test-undo-fix.md",
  "frontmatter": { "type": "test", "created": "2026-01-28" },
  "content": "## Test\n\nTesting undo behavior with AUTO_COMMIT disabled."
}

OUTPUT:
{
  "success": true,
  "message": "Created note: new/test-undo-fix.md"
}
```

**Step 2: mcp__flywheel-crank__vault_undo_last_mutation ✅ FIX VERIFIED**

```json
INPUT:
{
  "confirm": true
}

OUTPUT:
{
  "success": false,  // ✅ CORRECT!
  "message": "Undo is only available when AUTO_COMMIT is enabled. Set AUTO_COMMIT=\"true\" in .mcp.json to enable automatic git commits for each mutation.",
  "path": ""
}
```

**Step 3: mcp__flywheel-crank__vault_delete_note**

```json
INPUT:
{
  "path": "new/test-undo-fix.md",
  "confirm": true
}

OUTPUT:
{
  "success": true,
  "message": "Deleted note: new/test-undo-fix.md"
}
```

---

### Test Results Summary

| Tool | Session 1 | Session 2 | Status |
|------|-----------|-----------|--------|
| mcp__flywheel-crank__vault_create_note | ✅ | ✅ | Working |
| mcp__flywheel-crank__vault_list_sections | ✅ | - | Working |
| mcp__flywheel-crank__vault_add_to_section | ✅ | - | Working |
| mcp__flywheel-crank__vault_add_task | ✅ | - | Working |
| mcp__flywheel-crank__vault_toggle_task | ✅ | - | Working |
| mcp__flywheel-crank__vault_update_frontmatter | ✅ | - | Working |
| mcp__flywheel-crank__vault_add_frontmatter_field | ✅ | - | Working |
| mcp__flywheel-crank__vault_delete_note | ✅ | ✅ | Working |
| mcp__flywheel-crank__vault_undo_last_mutation | ⚠️ Bug | ✅ Fixed | Fixed |

---

## AUTO_COMMIT Behavior

The `AUTO_COMMIT` environment variable controls git integration behavior. Understanding this setting is critical for safe vault mutations.

### Configuration

```json
{
  "mcpServers": {
    "flywheel-crank": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-crank"],
      "env": {
        "AUTO_COMMIT": "true"  // or "false"
      }
    }
  }
}
```

### Behavior Matrix

| Setting | Mutations | Git Commits | Undo Available |
|---------|-----------|-------------|----------------|
| `"true"` | ✅ Works | ✅ Auto-commits after each mutation | ✅ Yes (undoes last crank commit) |
| `"false"` | ✅ Works | ❌ No commits | ❌ No (returns error) |
| Not set | ✅ Works | ❌ No commits | ❌ No (returns error) |

### Why Undo Requires AUTO_COMMIT

The `mcp__flywheel-crank__vault_undo_last_mutation` tool performs a soft reset to the previous commit:

```bash
git reset --soft HEAD~1
```

**Safety requirement:** Undo should only affect commits created by Crank, not arbitrary commits in the vault's git history.

**Problem (before fix):** When `AUTO_COMMIT: "false"`, Crank doesn't create commits, but the undo tool would still attempt to undo the most recent commit in the repository—potentially undoing unrelated work.

**Solution (applied in Test Session 2):** The undo tool now checks if `AUTO_COMMIT` is enabled. If disabled, it returns an error instead of attempting to undo:

```typescript
if (!autoCommit) {
  return {
    success: false,
    message: 'Undo is only available when AUTO_COMMIT is enabled. Set AUTO_COMMIT="true" in .mcp.json to enable automatic git commits for each mutation.',
    path: '',
  };
}
```

### Recommended Configuration

**For production vaults:**
```json
{
  "AUTO_COMMIT": "true"
}
```

This enables undo safety and provides a clear audit trail of all Crank mutations.

**For testing/development:**
```json
{
  "AUTO_COMMIT": "false"
}
```

This allows manual git commits or integration with external version control workflows.

---

## Known Issues & Fixes

### Issue #1: Undo Without AUTO_COMMIT

**Discovered:** 2026-01-28 (Test Session 1)

**Problem:** When `AUTO_COMMIT: "false"`, the `mcp__flywheel-crank__vault_undo_last_mutation` tool would undo arbitrary commits from the git history instead of failing gracefully.

**Impact:** Risk of data loss by undoing unrelated commits.

**Fix Applied:** Added check in `packages/mcp-server/src/tools/system.ts` (lines 137-145):

```typescript
// Check if auto-commit is enabled
if (!autoCommit) {
  const result: MutationResult = {
    success: false,
    message: 'Undo is only available when AUTO_COMMIT is enabled...',
    path: '',
  };
  return { content: [...] };
}
```

**Verified:** Test Session 2 confirmed the fix works correctly.

**Status:** ✅ Fixed

---

## Running Tests Locally

### Prerequisites

```bash
# Install dependencies
npm install

# Build the project
npm run build
```

### Test Commands

```bash
# Run all tests once
npm run test

# Watch mode (re-run on file changes)
npm run test:watch

# Type checking only
npm run lint

# Full CI check (lint + test + build)
npm run build && npm run lint && npm run test
```

### Test Output Example

```
 PASS  test/core/writer.test.ts
  ✓ readVaultFile reads file with frontmatter (8 ms)
  ✓ writeVaultFile writes file with frontmatter (3 ms)
  ✓ extractHeadings finds all headings (2 ms)
  ✓ findSection locates section boundaries (4 ms)
  ...

Test Suites: 10 passed, 10 total
Tests:       242 passed, 242 total
Snapshots:   0 total
Time:        4.532 s
```

---

## Writing New Tests

### Template

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestVault } from '../helpers/testUtils.js';

describe('my_new_tool', () => {
  let vault: Awaited<ReturnType<typeof createTestVault>>;

  beforeEach(async () => {
    vault = await createTestVault({
      'test-note.md': '## Section\n\nContent here',
    });
  });

  afterEach(() => {
    vault.cleanup();
  });

  it('does something useful', async () => {
    // Your test here
    expect(true).toBe(true);
  });
});
```

### Best Practices

1. **Use isolated test vaults** - Never test against real vaults
2. **Test both success and failure paths** - Verify error handling
3. **Test edge cases** - Empty sections, missing frontmatter, malformed markdown
4. **Verify file contents** - Read files to confirm mutations succeeded
5. **Clean up** - Use `afterEach` to remove test vaults

---

## Continuous Integration

Tests run automatically on:
- Pull requests
- Pushes to `main` branch
- Releases

CI configuration: `.github/workflows/test.yml`

---

## Related Documentation

- [CLAUDE.md](../CLAUDE.md) - Development guidelines
- [README.md](../README.md) - Project overview
- [API Reference](./tools-reference.md) - Tool documentation (planned)
