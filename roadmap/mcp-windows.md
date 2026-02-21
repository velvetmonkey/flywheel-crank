# MCP Connection & Windows Support Roadmap

**Goal:** Reliable MCP connection from Obsidian on Windows (via WSL) with proper lifecycle management, spawn diagnostics, and pipeline flow visibility in the dashboard.

**Status:** In progress. Pipeline flow visibility implemented, MCP connection fixes pending.

---

## 1. MCP Connection Fix (WSL) — TODO

Cross-spawn wraps `wsl` in `cmd.exe`, mangling nested bash quotes and breaking the MCP server spawn. Fix by using the full path to `wsl.exe` to bypass cross-spawn's shell wrapping.

### Implementation

- In `src/mcp/client.ts` `connect()` method, use `${SYSTEMROOT}\System32\wsl.exe` as the command
- This bypasses cross-spawn's `cmd.exe` wrapper entirely since it's a direct `.exe` path
- Pass the rest of the command (`bash -lc "node ..."`) as arguments array

### Files

| File | Changes |
|------|---------|
| `src/mcp/client.ts` | Use full `wsl.exe` path in `connect()` spawn |

---

## 2. Native Windows Support — DOCUMENTED

When no custom `serverPath` is set, the plugin already uses `npx.cmd -y @velvetmonkey/flywheel-memory` (no WSL needed). This is the end-user path.

### Notes

- End users on Windows get native spawning via `npx.cmd` — no WSL required
- The WSL path is only needed for dev workflow (pointing at a local server build)
- Future: add a settings option to point at a Windows-built server directory for dev use

---

## 3. disconnect() Cleanup — TODO

`disconnect()` currently skips closing the transport when `_connected` is false, leaving zombie child processes on retry and hot-reload.

### Implementation

- Close the transport unconditionally in `disconnect()`, regardless of `_connected` state
- Ensures child processes are cleaned up on connection failure, retry loops, and plugin hot-reload

### Files

| File | Changes |
|------|---------|
| `src/mcp/client.ts` | Fix `disconnect()` to close transport unconditionally |

---

## 4. Spawn Diagnostics — TODO

The MCP SDK discards child process exit codes, making connection debugging blind. Add transport hooks to surface exit info.

### Implementation

- Add `onclose` and `onerror` hooks to the stdio transport
- Log child process exit code, signal, and stderr output
- Surface spawn failures in the dashboard status indicator

### Files

| File | Changes |
|------|---------|
| `src/mcp/client.ts` | Add transport `onclose`/`onerror` hooks |

---

## 5. Pipeline Flow Visibility — IMPLEMENTED

Dashboard rewritten to show the full suggestion pipeline flow: forward links and step outputs cascading through 5 gates (link count, text match, graph, feedback, semantic).

### Implementation

- `buildSubjects()` constructs the full set of forward-linked entities from the current note
- Each pipeline gate shows input count, output count, and passthrough rate
- Horizontal pill layout with compact score display
- Step outputs cascade: output of gate N becomes input of gate N+1

### Status

Implemented in dashboard rewrite. Needs verification after MCP connection is fixed (items 1 + 3).

### Files

| File | Changes |
|------|---------|
| `src/views/feedback-dashboard.ts` | Pipeline flow rewrite with `buildSubjects()` |
| `styles.css` | Horizontal pills, compact score, passthrough styles |
| `src/main.ts` | Retry logic for MCP connection |
| `src/mcp/client.ts` | Added `getForwardLinks` type |

---

## Files Modified (Current Changeset)

| File | Changes |
|------|---------|
| `src/main.ts` | +retry logic for MCP connection |
| `src/mcp/client.ts` | +`getForwardLinks` tool type, interfaces |
| `src/views/feedback-dashboard.ts` | Pipeline flow rewrite (~1374 lines changed) |
| `styles.css` | +horizontal pills, compact score, passthrough styles (~773 lines) |
| `roadmap/mcp-windows.md` | This file |
