# The Flywheel Platform

## The Deterministic Agent Problem

Modern AI agents are powerful but **unpredictable**. The same prompt can produce different outputs. This is problematic for enterprise workflows, safety-critical operations, and automation at scale.

## The Eyes + Hands Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Your Agent                              │
│    ┌───────────────────┐        ┌───────────────────┐          │
│    │   Flywheel        │        │   Flywheel-Crank  │          │
│    │   (Eyes)          │───────▶│   (Hands)         │          │
│    │   READ-ONLY       │        │   WRITE-SAFE      │          │
│    └───────────────────┘        └───────────────────┘          │
└─────────────────────────────────────────────────────────────────┘
                                 │
                    ┌───────────────────────┐
                    │   Your Obsidian Vault │
                    └───────────────────────┘
```

### Flywheel: The Eyes
**51 read-only tools** for vault intelligence: backlinks, semantic search, frontmatter analysis.

### Flywheel-Crank: The Hands
**11 surgical mutation tools** + policy engine: section-scoped operations, git integration, undo support.

## Why Policies Matter

| Without Policies | With Policies |
|------------------|---------------|
| Agent chooses format | Format defined once |
| No rollback | Git undo available |
| Hard to audit | Full commit history |

## Getting Started

```json
{
  "mcpServers": {
    "flywheel": { "command": "npx", "args": ["-y", "@velvetmonkey/flywheel-mcp"] },
    "flywheel-crank": { "command": "npx", "args": ["-y", "@velvetmonkey/flywheel-crank"] }
  }
}
```

## Further Reading

- [AGENT_MUTATION_PATTERNS.md](./AGENT_MUTATION_PATTERNS.md)
- [MULTI_AGENT_MUTATIONS.md](./MULTI_AGENT_MUTATIONS.md)
- [TOKEN_BENCHMARKS.md](./TOKEN_BENCHMARKS.md)
