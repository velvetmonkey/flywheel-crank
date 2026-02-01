# Flywheel-Crank Test Suite Documentation

Comprehensive documentation of the 930+ tests validating Flywheel-Crank's deterministic mutation capabilities.

---

## Overview

| Metric | Value |
|--------|-------|
| Total Tests | 930+ |
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

## Related Documentation

- [testing.md](./testing.md) - Manual MCP testing procedures
- [PERFORMANCE.md](./PERFORMANCE.md) - Performance benchmarks
- [SCALE_BENCHMARKS.md](./SCALE_BENCHMARKS.md) - Scale validation results
