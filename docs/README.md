# Flywheel Crank Documentation

Flywheel Crank is the deterministic write companion to Flywheel MCP. While Flywheel provides read-only graph intelligence for Obsidian vaults, Crank enables surgical mutations with optional git commits and undo support.

---

## Quick Links

| I want to... | Read this |
|--------------|-----------|
| Get started with Flywheel Crank | [configuration.md](configuration.md) |
| Learn what tools are available | [tools-reference.md](tools-reference.md) |
| Understand auto-wikilinks | [wikilinks.md](wikilinks.md) |
| Know how my data is handled | [privacy.md](privacy.md) |
| Run tests or contribute | [testing.md](testing.md) |

---

## Documentation Guide

### [tools-reference.md](tools-reference.md)
Complete reference for all 11 MCP tools with visual examples, decision guides, and parameter documentation. Covers mutation tools, task operations, frontmatter management, and note lifecycle operations.

**Read when:** You want to know what Crank can do or need syntax examples.

### [configuration.md](configuration.md)
MCP server setup for Claude Code, environment variables, tool parameters, git commit prefixes, and permission models. Includes examples for Unix, Windows native, and WSL environments.

**Read when:** Setting up Flywheel Crank for the first time or troubleshooting configuration.

### [wikilinks.md](wikilinks.md)
Explains how Crank automatically links known entities (people, projects, technologies) as you write. Covers the feedback loop, entity inference rules, excluded folders, and how to control linking behavior.

**Read when:** You use wikilinks in your vault and want to understand or customize auto-linking.

### [privacy.md](privacy.md)
Architectural overview of data handling. Explains what runs locally, what gets indexed, what flows to Claude's API, and best practices for privacy-conscious usage.

**Read when:** You have sensitive data in your vault or need to understand the privacy implications.

### [testing.md](testing.md)
Automated test suite overview (242 tests), manual MCP testing procedures, and git integration behavior. Includes common development workflows.

**Read when:** Contributing to Flywheel Crank or debugging tool behavior.

---

## Recommended Reading Order

**New users:**
1. [configuration.md](configuration.md) - Get set up
2. [tools-reference.md](tools-reference.md) - Learn the tools
3. [wikilinks.md](wikilinks.md) - Understand auto-linking

**Privacy-focused users:**
1. [privacy.md](privacy.md) - Understand data flow
2. [configuration.md](configuration.md) - Set up with recommended permissions

**Contributors:**
1. [testing.md](testing.md) - Understand the test suite
2. [tools-reference.md](tools-reference.md) - Learn tool patterns

---

## See Also

- [Main README](../README.md) - Project overview, installation, quick start
- [CLAUDE.md](../CLAUDE.md) - AI contributor guidelines and architecture details
