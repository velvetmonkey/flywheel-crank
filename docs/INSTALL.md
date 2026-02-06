# Installation Guide

Platform-specific installation instructions for Flywheel-Crank.

---

## Prerequisites

- **Node.js 18+** — [Download](https://nodejs.org)
- **Claude Code** or another MCP client
- **Markdown vault** (Obsidian, plain folders, etc.)

---

## Both Packages Required

Flywheel-Crank provides **22 tools** for writing to your vault:
- Content mutations (add, remove, replace)
- Task management (toggle, add)
- Frontmatter updates
- Note operations (create, delete, move, rename)
- Policy execution

**Flywheel-Crank requires Flywheel** for read operations. The tools work together:

| Package | Purpose | Tools |
|---------|---------|-------|
| [Flywheel](https://github.com/velvetmonkey/flywheel) | Read, search, graph queries | 51 tools |
| Flywheel-Crank | Write, mutate, automate | 22 tools |

**Workflow:** Read (Flywheel) → Write (Crank) → Verify (Flywheel)

Install both for the complete experience.

---

## macOS

macOS uses native FSEvents — no polling required.

### Configuration

Create `.mcp.json` in your vault root:

```json
{
  "mcpServers": {
    "flywheel": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-mcp"]
    },
    "flywheel-crank": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-crank"]
    }
  }
}
```

### Gatekeeper Note

On first run, macOS may block unsigned binaries. If you see security warnings:
1. Open **System Settings > Privacy & Security**
2. Click **Allow Anyway** for the blocked item
3. Restart Claude Code

### Tuning (Optional)

For large vaults, increase debounce to reduce Flywheel index rebuilds:

```json
{
  "mcpServers": {
    "flywheel": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-mcp"],
      "env": {
        "FLYWHEEL_DEBOUNCE_MS": "1000",
        "FLYWHEEL_FLUSH_MS": "5000"
      }
    },
    "flywheel-crank": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-crank"]
    }
  }
}
```

**Recommended debounce:** 1000-5000ms for macOS.

---

## Linux

Linux uses inotify for efficient file watching.

### Configuration

Create `.mcp.json` in your vault root:

```json
{
  "mcpServers": {
    "flywheel": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-mcp"]
    },
    "flywheel-crank": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-crank"]
    }
  }
}
```

### Check inotify Limits

Large vaults may exceed Linux's default watcher limit:

```bash
cat /proc/sys/fs/inotify/max_user_watches
```

Increase if needed:

```bash
# Temporary
sudo sysctl fs.inotify.max_user_watches=524288

# Permanent
echo "fs.inotify.max_user_watches=524288" | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

### Tuning (Optional)

Linux inotify is fast — use lower debounce:

```json
{
  "mcpServers": {
    "flywheel": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-mcp"],
      "env": {
        "FLYWHEEL_DEBOUNCE_MS": "300",
        "FLYWHEEL_FLUSH_MS": "1000"
      }
    }
  }
}
```

**Recommended debounce:** 300-1000ms for native Linux.

---

## Windows (Native)

Windows requires two adjustments:
1. **cmd /c wrapper** — npx must run through cmd
2. **Polling mode** — Enable for reliable file watching

### Configuration

Create `.mcp.json` in your vault root:

```json
{
  "mcpServers": {
    "flywheel": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@velvetmonkey/flywheel-mcp"],
      "env": {
        "FLYWHEEL_WATCH_POLL": "true",
        "FLYWHEEL_POLL_INTERVAL": "10000"
      }
    },
    "flywheel-crank": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@velvetmonkey/flywheel-crank"]
    }
  }
}
```

### Why Polling?

Windows native file watching has reliability issues. Polling ensures Flywheel's index stays current after Crank mutations.

**Poll interval:** 10000ms (10 seconds) is a good default. Increase to 30000-60000ms if CPU usage is a concern.

### Path Format

Windows paths work with either format:

```json
"env": {
  "PROJECT_PATH": "C:\\Users\\YourName\\Documents\\Vault"
}
```

Or:

```json
"env": {
  "PROJECT_PATH": "C:/Users/YourName/Documents/Vault"
}
```

---

## Windows (WSL)

WSL can run npx directly, but vaults on Windows drives require special handling.

### If Vault is on Linux Filesystem

No polling needed:

```json
{
  "mcpServers": {
    "flywheel": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-mcp"]
    },
    "flywheel-crank": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-crank"]
    }
  }
}
```

### If Vault is on Windows Drive (/mnt/c/...)

**Polling is required.** inotify cannot detect changes across the WSL boundary:

```json
{
  "mcpServers": {
    "flywheel": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-mcp"],
      "env": {
        "PROJECT_PATH": "/mnt/c/Users/YourName/Documents/Vault",
        "FLYWHEEL_WATCH_POLL": "true",
        "FLYWHEEL_POLL_INTERVAL": "10000"
      }
    },
    "flywheel-crank": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-crank"],
      "env": {
        "PROJECT_PATH": "/mnt/c/Users/YourName/Documents/Vault"
      }
    }
  }
}
```

**Recommendation:** Keep your vault on the Linux filesystem (`~/vault`) for best performance.

### Tuning for WSL

Higher debounce compensates for polling:

| Setting | Recommended |
|---------|-------------|
| `FLYWHEEL_POLL_INTERVAL` | 10000-60000ms |
| `FLYWHEEL_DEBOUNCE_MS` | 5000-10000ms |

---

## Verify Installation

### 1. Check MCP Registration

```bash
claude mcp list
```

Expected output:
```
flywheel ✓
flywheel-crank ✓
```

### 2. Test Vault Connection

In Claude Code, ask:

```
What vault am I connected to?
```

Claude should report your vault name and note count.

### 3. Test File Watching

1. Edit a note in your vault
2. Wait for the poll interval
3. Ask: "What changed recently?"

### 4. Test Mutations

Try a simple mutation:

```
Add a test task to my daily note: "Test flywheel-crank installation"
```

Then verify:
```
Show me tasks in my daily note
```

### 5. Health Check

```
Run the health_check tool
```

---

## Permission Model

Flywheel-Crank mutations modify your vault. Claude Code will prompt for permission on each tool call.

To pre-approve mutation tools, add to `.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "mcp__flywheel__*",
      "mcp__flywheel-crank__*"
    ]
  }
}
```

**Recommendation:** Start without pre-approval to understand what each tool does, then add permissions for tools you use frequently.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Only `flywheel ✓`, no crank | Add flywheel-crank to `.mcp.json` |
| `flywheel-crank ✗` | Check command wrapper (Windows needs `cmd /c`) |
| Mutations not appearing | Check both servers have same `PROJECT_PATH` |
| File changes not detected | Enable polling on Flywheel (Crank doesn't need it) |
| Windows spawn errors | Use `cmd /c npx` wrapper |
| "Permission denied" errors | Check file permissions; pause cloud sync during operations |

See [Troubleshooting](./TROUBLESHOOTING.md) for more solutions.

---

## Next Steps

- **[Configuration](./configuration.md)** — Full options reference
- **[Examples](./EXAMPLES.md)** — Copy-paste tool examples
- **[Policies](./POLICIES.md)** — Automate with YAML policies
- **[Tools Reference](./tools-reference.md)** — All 22 tools documented
