# Flywheel Crank Documentation

Flywheel Crank is the deterministic write companion to Flywheel MCP. While Flywheel provides read-only graph intelligence for Obsidian vaults, Crank enables surgical mutations with optional git commits and undo support.

---

## Quick Links

| I want to... | Read this |
|--------------|-----------|
| See examples and quick start | [EXAMPLES.md](EXAMPLES.md) |
| Get started with Flywheel Crank | [configuration.md](configuration.md) |
| Learn what tools are available | [tools-reference.md](tools-reference.md) |
| Guide Claude to better tool choices | [guiding-claude.md](guiding-claude.md) |
| Understand auto-wikilinks | [wikilinks.md](wikilinks.md) |
| Use Flywheel as agent memory | [AGENT-MEMORY.md](AGENT-MEMORY.md) |
| Compare with alternatives | [COMPARISON.md](COMPARISON.md) |
| Know how my data is handled | [privacy.md](privacy.md) |
| Check performance benchmarks | [PERFORMANCE.md](PERFORMANCE.md) |
| Troubleshoot issues | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) |
| Check compatibility | [COMPATIBILITY.md](COMPATIBILITY.md) |
| Migrate from raw editing | [MIGRATION.md](MIGRATION.md) |
| Understand limitations | [LIMITATIONS.md](LIMITATIONS.md) |
| Run tests or contribute | [testing.md](testing.md) |

---

## Documentation Guide

### [EXAMPLES.md](EXAMPLES.md)
Quick start guide with copy-paste examples for all 11 tools. Includes 3 workflow scenarios (Daily Standup, Meeting Notes, Project Update) using the Flywheel demo vaults.

**Read when:** You want to get started quickly or see real-world usage patterns.

### [tools-reference.md](tools-reference.md)
Complete reference for all 11 MCP tools with visual examples, decision guides, and parameter documentation. Covers mutation tools, task operations, frontmatter management, and note lifecycle operations.

**Read when:** You want to know what Crank can do or need syntax examples.

### [configuration.md](configuration.md)
MCP server setup for Claude Code, environment variables, tool parameters, git commit prefixes, and permission models. Includes examples for Unix, Windows native, and WSL environments.

**Read when:** Setting up Flywheel Crank for the first time or troubleshooting configuration.

### [guiding-claude.md](guiding-claude.md)
How to give feedback when Claude picks the wrong tool, teach Claude your vault's patterns through CLAUDE.md, and verify mutations. Covers the iterative feedback loop and common corrections.

**Read when:** Claude makes tool choices you want to refine, or you want to improve Claude's defaults for your vault.

### [wikilinks.md](wikilinks.md)
Explains how Crank automatically links known entities (people, projects, technologies) as you write. Covers the feedback loop, entity inference rules, excluded folders, and how to control linking behavior.

**Read when:** You use wikilinks in your vault and want to understand or customize auto-linking.

### [AGENT-MEMORY.md](AGENT-MEMORY.md)
How to use Flywheel + Crank as a persistent memory layer for AI coding assistants like Claude Code. Covers session memory patterns, CLAUDE.md integration, and token efficiency.

**Read when:** You want your AI assistant to remember context across sessions.

### [COMPARISON.md](COMPARISON.md)
Detailed comparison of Flywheel-Crank vs alternatives (Dataview, Edit tool, other MCP servers). Includes token cost comparisons, decision matrices, and honest trade-offs.

**Read when:** Evaluating whether Flywheel-Crank is the right tool for your use case.

### [privacy.md](privacy.md)
Architectural overview of data handling. Explains what runs locally, what gets indexed, what flows to Claude's API, and best practices for privacy-conscious usage.

**Read when:** You have sensitive data in your vault or need to understand the privacy implications.

### [PERFORMANCE.md](PERFORMANCE.md)
Performance benchmarks and optimization guidance. Covers mutation timing, entity index performance, and memory usage.

**Read when:** Working with large vaults or optimizing performance.

### [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
Common issues and solutions for MCP setup, tool behavior, and platform-specific problems.

**Read when:** Something isn't working as expected.

### [COMPATIBILITY.md](COMPATIBILITY.md)
Platform compatibility matrix and known limitations across macOS, Linux, Windows, and WSL.

**Read when:** Setting up on a new platform or encountering platform-specific issues.

### [MIGRATION.md](MIGRATION.md)
Step-by-step guide for transitioning from raw file editing (Edit tool, sed) to Flywheel-Crank. Covers migration strategies, gradual adoption timeline, permission workflows, rollback procedures, and common migration patterns.

**Read when:** Transitioning an existing vault or workflow to use Crank tools.

### [LIMITATIONS.md](LIMITATIONS.md)
Comprehensive documentation of what Crank cannot do, including architectural limitations, content restrictions, wikilink boundaries, and platform-specific issues. Includes decision tree for when to use alternative tools.

**Read when:** Understanding Crank's boundaries or deciding whether Crank is the right tool for a task.

### [testing.md](testing.md)
Automated test suite overview (523 tests), manual MCP testing procedures, and git integration behavior. Includes common development workflows.

**Read when:** Contributing to Flywheel Crank or debugging tool behavior.

---

## Recommended Reading Order

**New users:**
1. [EXAMPLES.md](EXAMPLES.md) - Quick start with copy-paste examples
2. [configuration.md](configuration.md) - Get set up
3. [tools-reference.md](tools-reference.md) - Learn the tools
4. [guiding-claude.md](guiding-claude.md) - Master the feedback loop
5. [wikilinks.md](wikilinks.md) - Understand auto-linking

**Migrating from raw editing:**
1. [MIGRATION.md](MIGRATION.md) - Step-by-step migration guide
2. [LIMITATIONS.md](LIMITATIONS.md) - Understand what Crank can/cannot do
3. [configuration.md](configuration.md) - Set up permissions

**Privacy-focused users:**
1. [privacy.md](privacy.md) - Understand data flow
2. [configuration.md](configuration.md) - Set up with recommended permissions

**AI agent developers:**
1. [AGENT-MEMORY.md](AGENT-MEMORY.md) - Use Flywheel as persistent memory
2. [COMPARISON.md](COMPARISON.md) - Understand vs alternatives
3. [tools-reference.md](tools-reference.md) - Learn tool capabilities
4. [wikilinks.md](wikilinks.md) - Leverage auto-linking

**Contributors:**
1. [testing.md](testing.md) - Understand the test suite (523 tests)
2. [tools-reference.md](tools-reference.md) - Learn tool patterns
3. [PERFORMANCE.md](PERFORMANCE.md) - Understand benchmarks

---

## See Also

- [Main README](../README.md) - Project overview, installation, quick start
- [CLAUDE.md](../CLAUDE.md) - AI contributor guidelines and architecture details
