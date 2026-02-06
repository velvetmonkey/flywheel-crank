# Flywheel-Crank Test Suite Documentation

Comprehensive documentation of the 1465+ tests validating Flywheel-Crank's deterministic mutation capabilities.

---

## Overview

| Metric | Value |
|--------|-------|
| Total Tests | 1465+ |
| Test Files | 40+ |
| Coverage Target | 60% statements, 50% branches |
| Platforms | Ubuntu, Windows, macOS |
| Node Versions | 18, 20, 22 |

---

## Test Categories

### Core Tests

**`test/core/`** - Foundation functionality

| File | Tests | Purpose |
|------|-------|---------|
| `writer.test.ts` | 63 | File operations, section parsing, format preservation |
| `git.test.ts` | 10 | Git operations, commit verification, undo |
| `vaultRoot.test.ts` | 8 | Vault detection, path resolution |
| `wikilinks.test.ts` | 35 | Entity matching, link formatting, aliases |
| `policy/parser.test.ts` | 42 | YAML policy parsing, validation |
| `policy/executor.test.ts` | 28 | Policy execution, atomic commits |

### Tool Tests

**`test/tools/`** - Individual mutation tools

| File | Tests | Purpose |
|------|-------|---------|
| `mutations.test.ts` | 29 | add/remove/replace in sections |
| `tasks.test.ts` | 19 | toggle/add tasks, checkbox handling |
| `frontmatter.test.ts` | 14 | YAML frontmatter operations |
| `notes.test.ts` | 14 | create/delete/move/rename notes |
| `move-notes.test.ts` | 22 | Note moving with backlink updates |
| `system.test.ts` | 13 | list sections, undo, system operations |
| `policy.test.ts` | 38 | Policy execute/preview/validate |

### Battle-Hardening Tests

**`test/battle-hardening/`** - Edge cases and stress tests

| File | Tests | Purpose |
|------|-------|---------|
| `fuzzing.test.ts` | 100+ | Random input generation (fast-check) |
| `concurrent.test.ts` | 15 | Parallel mutation handling |
| `git-conflicts.test.ts` | 12 | Conflict detection and recovery |
| `malformed-input.test.ts` | 45 | Invalid markdown, broken YAML |
| `edge-cases.test.ts` | 35 | Unicode, empty files, huge sections |

### Golden Tests

**`test/golden/`** - Regression prevention snapshots

### Platform Tests

**`test/platform/`** - OS-specific behavior (WSL, Windows paths, symlinks)

### Performance Tests

**`test/performance/`** - Benchmarks and scaling validation

### Security Tests

**`test/security/`** - Path traversal, injection prevention, boundary enforcement

---

## Running Tests

```bash
# All tests
npm test

# Specific category
npm run test:battle-hardening
npm run test:golden
npm run test:platform

# Coverage report
npm run test:coverage
```

### CI Matrix

Tests run across Ubuntu, Windows, macOS with Node 18, 20, 22.

---

## Coverage Thresholds

| Metric | Target |
|--------|--------|
| Statements | 60% |
| Branches | 50% |
| Functions | 60% |
| Lines | 60% |

---

## Additional Test Suites

### Cold Start Tests

**Location:** `test/coldstart/`

Tests for initialization and edge-case vault states:

| File | Tests | Purpose |
|------|-------|---------|
| `empty-vault.test.ts` | 4 | Empty vault, first note creation |
| `missing-directories.test.ts` | 3 | Auto-creation of .claude/.flywheel directories |
| `git-init.test.ts` | 4 | Non-git vault handling, graceful commit failures |
| `readonly-vault.test.ts` | 3 | Permission errors, descriptive EACCES messages |

```bash
npm run test:coldstart
```

### Policy Execution Tests

**Location:** `test/core/policy/`

Tests for multi-step workflow execution:

| File | Tests | Purpose |
|------|-------|---------|
| `rollback.test.ts` | 5 | Fail-fast behavior, partial execution cleanup |
| `transactions.test.ts` | 4 | Git commit atomicity, file consistency |
| `complex-policies.test.ts` | 3 | Multi-step workflows (10-step daily standup) |

```bash
npm run test:policy
```

### Undo Sequence Tests

**Location:** `test/tools/undo-sequences.test.ts`

Tests for undo edge cases:

| Scenario | Coverage |
|----------|----------|
| Sequential undos | 3 crank commits → undo → undo → undo |
| External commit interference | undo → external commit → undo warns/fails safely |
| Stash preservation | Undo with stashed changes preserves stash |
| Dirty working tree | Fails gracefully with clear message |

```bash
npm run test:undo
```

### Concurrent Mutation Tests

**Location:** `test/stress/`

Tests for race conditions and last-write-wins semantics:

| File | Tests | Purpose |
|------|-------|---------|
| `same-file-races.test.ts` | 4 | Parallel writes: 5 concurrent → no corruption |
| `last-write-wins.test.ts` | 4 | LWW semantics documented and validated |

```bash
npm run test:concurrency
```

**Behaviors tested:**
- **Parallel writes**: 5 concurrent writes → no corruption, at least 1 write present
- **Sequential writes**: 20 rapid sequential → all entries preserved
- **LWW documented**: Agent 2 overwrites Agent 1's unseen change
- **Atomic write**: Large content write is complete, not partial

---

## Related Documentation

- [testing.md](./testing.md) - Manual MCP testing procedures
- [PERFORMANCE.md](./PERFORMANCE.md) - Performance benchmarks
- [SCALE_BENCHMARKS.md](./SCALE_BENCHMARKS.md) - Scale validation results
