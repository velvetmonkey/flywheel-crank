# Flywheel Crank Documentation

Flywheel Crank is the deterministic write companion to Flywheel MCP. While Flywheel provides read-only graph intelligence for Obsidian vaults, Crank enables surgical mutations with optional git commits and undo support.

---

## Quick Links

| I want to... | Read this |
|--------------|-----------|
| See examples and quick start | [EXAMPLES.md](EXAMPLES.md) |
| Get started with Flywheel Crank | [CONFIGURATION.md](CONFIGURATION.md) |
| Install Flywheel Crank | [INSTALL.md](INSTALL.md) |
| Learn what tools are available | [TOOLS_REFERENCE.md](TOOLS_REFERENCE.md) |
| Understand how content is targeted | [CONTENT_TARGETING.md](CONTENT_TARGETING.md) |
| Guide Claude to better tool choices | [GUIDING_CLAUDE.md](GUIDING_CLAUDE.md) |
| Understand auto-wikilinks | [WIKILINKS.md](WIKILINKS.md) |
| Deep dive into wikilink scoring | [WIKILINK_INFERENCE.md](WIKILINK_INFERENCE.md) |
| Use Flywheel as agent memory | [AGENT_MEMORY.md](AGENT_MEMORY.md) |
| Build autonomous agents with safe mutations | [AGENT_MUTATION_PATTERNS.md](AGENT_MUTATION_PATTERNS.md) |
| Handle multi-agent concurrent mutations | [MULTI_AGENT_MUTATIONS.md](MULTI_AGENT_MUTATIONS.md) |
| Compare with alternatives | [COMPARISON.md](COMPARISON.md) |
| See token efficiency benchmarks | [TOKEN_BENCHMARKS.md](TOKEN_BENCHMARKS.md) |
| Verify the 100x savings claim | [TOKEN_SAVINGS.md](TOKEN_SAVINGS.md) |
| Know how my data is handled | [PRIVACY.md](PRIVACY.md) |
| Check performance benchmarks | [PERFORMANCE.md](PERFORMANCE.md) |
| Run scale benchmarks | [SCALE_BENCHMARKS.md](SCALE_BENCHMARKS.md) |
| View benchmark results | [BENCHMARK_RESULTS.md](BENCHMARK_RESULTS.md) |
| Troubleshoot issues | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) |
| Check compatibility | [COMPATIBILITY.md](COMPATIBILITY.md) |
| Migrate from raw editing | [MIGRATION.md](MIGRATION.md) |
| Understand limitations | [LIMITATIONS.md](LIMITATIONS.md) |
| Run tests or contribute | [TESTING.md](TESTING.md) |
| Learn about policy orchestration | [POLICIES.md](POLICIES.md) |
| Understand the platform architecture | [PLATFORM.md](PLATFORM.md) |
| Use integration patterns | [INTEGRATION_PATTERNS.md](INTEGRATION_PATTERNS.md) |

---

## Documentation Guide

### [EXAMPLES.md](EXAMPLES.md)
Quick start guide with copy-paste examples for core mutation tools. Includes 3 workflow scenarios (Daily Standup, Meeting Notes, Project Update) using the Flywheel demo vaults.

**Read when:** You want to get started quickly or see real-world usage patterns.

### [INSTALL.md](INSTALL.md)
Step-by-step installation guide for Flywheel Crank. Covers npm installation, MCP server configuration, and first-run verification.

**Read when:** Installing Flywheel Crank for the first time.

### [TOOLS_REFERENCE.md](TOOLS_REFERENCE.md)
Complete reference for all 22 MCP tools with visual examples, decision guides, and parameter documentation. Covers mutation tools, task operations, frontmatter management, note lifecycle operations, move/rename tools, and policy orchestration.

**Read when:** You want to know what Crank can do or need syntax examples.

### [CONTENT_TARGETING.md](CONTENT_TARGETING.md)
How Flywheel-Crank determines where mutations place content. Covers note selection (path parameter), section targeting (case-insensitive matching, boundaries), position and placement (append/prepend, list nesting), format types, and frontmatter targeting.

**Read when:** You want to understand exactly where your content will be placed, or troubleshoot targeting issues.

### [CONFIGURATION.md](CONFIGURATION.md)
MCP server setup for Claude Code, environment variables, tool parameters, git commit prefixes, and permission models. Includes examples for Unix, Windows native, and WSL environments.

**Read when:** Setting up Flywheel Crank for the first time or troubleshooting configuration.

### [GUIDING_CLAUDE.md](GUIDING_CLAUDE.md)
How to give feedback when Claude picks the wrong tool, teach Claude your vault's patterns through CLAUDE.md, and verify mutations. Covers the iterative feedback loop and common corrections.

**Read when:** Claude makes tool choices you want to refine, or you want to improve Claude's defaults for your vault.

### [WIKILINKS.md](WIKILINKS.md)
Explains how Crank automatically links known entities (people, projects, technologies) as you write. Covers the feedback loop, entity inference rules, excluded folders, and how to control linking behavior.

**Read when:** You use wikilinks in your vault and want to understand or customize auto-linking.

**See also:** [WIKILINK_INFERENCE.md](WIKILINK_INFERENCE.md) for the technical scoring algorithm.

### [WIKILINK_INFERENCE.md](WIKILINK_INFERENCE.md)
Technical deep dive into the 7-layer wikilink scoring algorithm. Covers quality filters, word matching (exact and stem), co-occurrence boosts, type boosts, context-aware boosts, recency boosts, and strictness modes.

**Read when:** You want to understand exactly how wikilink suggestions are scored and selected.

**See also:** [WIKILINKS.md](WIKILINKS.md) for the user-facing auto-linking guide.

### [TOKEN_BENCHMARKS.md](TOKEN_BENCHMARKS.md)
Quantified token efficiency data comparing Flywheel-Crank to traditional file operations. Includes read/write operation benchmarks, monthly cost projections, and the 200K token threshold implications.

**Read when:** You want hard numbers on token savings or need to justify Flywheel-Crank's value.

**See also:** [TOKEN_SAVINGS.md](TOKEN_SAVINGS.md) for measured verification of claims.

### [TOKEN_SAVINGS.md](TOKEN_SAVINGS.md)
Measured verification of the "100x token savings" claim. Includes actual token counts for 5 common tasks (orientation, backlinks, search, metadata, section read) on the carter-strategy demo vault. Spoiler: the claim is validated - average 109x savings across typical operations.

**Read when:** You're skeptical of the 100x claim and want to see the real measured data.

**See also:** [TOKEN_BENCHMARKS.md](TOKEN_BENCHMARKS.md) for projected costs.

### [AGENT_MEMORY.md](AGENT_MEMORY.md)
How to use Flywheel + Crank as a persistent memory layer for AI coding assistants like Claude Code. Covers session memory patterns, CLAUDE.md integration, and token efficiency.

**Read when:** You want your AI assistant to remember context across sessions.

**See also:** [AGENT_MUTATION_PATTERNS.md](AGENT_MUTATION_PATTERNS.md) for safe autonomous mutations.

### [AGENT_MUTATION_PATTERNS.md](AGENT_MUTATION_PATTERNS.md)
Comprehensive guide for autonomous agents performing safe, deterministic vault mutations. Covers append-only logging, section-scoped updates, task management, frontmatter updates, error handling, git best practices, and template vault structures.

**Read when:** Building autonomous agents that need to write to vaults safely without conflicts.

**See also:** [MULTI_AGENT_MUTATIONS.md](MULTI_AGENT_MUTATIONS.md) for concurrent access patterns.

### [MULTI_AGENT_MUTATIONS.md](MULTI_AGENT_MUTATIONS.md)
Handling concurrent vault mutations from multiple agents. Covers last-write-wins semantics, conflict resolution, and coordination strategies.

**Read when:** Running multiple Claude instances or agents that may mutate the same vault.

**See also:** [AGENT_MUTATION_PATTERNS.md](AGENT_MUTATION_PATTERNS.md) for general mutation patterns.

### [COMPARISON.md](COMPARISON.md)
Detailed comparison of Flywheel-Crank vs alternatives (Dataview, Edit tool, other MCP servers). Includes token cost comparisons, decision matrices, and honest trade-offs.

**Read when:** Evaluating whether Flywheel-Crank is the right tool for your use case.

### [PRIVACY.md](PRIVACY.md)
Architectural overview of data handling. Explains what runs locally, what gets indexed, what flows to Claude's API, and best practices for privacy-conscious usage.

**Read when:** You have sensitive data in your vault or need to understand the privacy implications.

### [PERFORMANCE.md](PERFORMANCE.md)
Performance benchmarks and optimization guidance. Covers mutation timing, entity index performance, and memory usage.

**Read when:** Working with large vaults or optimizing performance.

**See also:** [SCALE_BENCHMARKS.md](SCALE_BENCHMARKS.md) for large-scale testing, [BENCHMARK_RESULTS.md](BENCHMARK_RESULTS.md) for CI results.

### [SCALE_BENCHMARKS.md](SCALE_BENCHMARKS.md)
Large-scale benchmark methodology and results for 1k/5k/10k note vaults. Covers memory scaling, time thresholds, and leak detection.

**Read when:** Testing Flywheel-Crank at scale or contributing performance improvements.

**See also:** [PERFORMANCE.md](PERFORMANCE.md) for optimization guidance.

### [BENCHMARK_RESULTS.md](BENCHMARK_RESULTS.md)
Auto-generated benchmark results from CI. Shows current performance metrics across test suites.

**Read when:** Checking current performance numbers or comparing against baselines.

### [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
Common issues and solutions for MCP setup, tool behavior, and platform-specific problems.

**Read when:** Something isn't working as expected.

**See also:** [COMPATIBILITY.md](COMPATIBILITY.md) for platform-specific issues.

### [COMPATIBILITY.md](COMPATIBILITY.md)
Platform compatibility matrix and known limitations across macOS, Linux, Windows, and WSL.

**Read when:** Setting up on a new platform or encountering platform-specific issues.

**See also:** [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for problem resolution.

### [MIGRATION.md](MIGRATION.md)
Step-by-step guide for transitioning from raw file editing (Edit tool, sed) to Flywheel-Crank. Covers migration strategies, gradual adoption timeline, permission workflows, rollback procedures, and common migration patterns.

**Read when:** Transitioning an existing vault or workflow to use Crank tools.

### [LIMITATIONS.md](LIMITATIONS.md)
Comprehensive documentation of what Crank cannot do, including architectural limitations, content restrictions, wikilink boundaries, and platform-specific issues. Includes decision tree for when to use alternative tools.

**Read when:** Understanding Crank's boundaries or deciding whether Crank is the right tool for a task.

### [TESTING.md](TESTING.md)
Automated test suite overview (1472 tests), manual MCP testing procedures, and git integration behavior. Includes common development workflows.

**Read when:** Contributing to Flywheel Crank or debugging tool behavior.

### [POLICIES.md](POLICIES.md)
Policy orchestration system for declarative workflow definitions. Covers YAML policy format, step execution, fail-fast behavior, and enterprise workflow patterns.

**Read when:** Building complex multi-step workflows or enterprise integrations.

**See also:** [INTEGRATION_PATTERNS.md](INTEGRATION_PATTERNS.md) for common integration scenarios.

### [PLATFORM.md](PLATFORM.md)
The Flywheel platform architecture overview (Eyes + Hands model). Explains how Flywheel (read) and Crank (write) complement each other.

**Read when:** Understanding the overall Flywheel ecosystem and architectural decisions.

### [INTEGRATION_PATTERNS.md](INTEGRATION_PATTERNS.md)
Common integration patterns for connecting Flywheel-Crank with other tools and workflows. Covers CI/CD integration, automation scripts, and third-party tool connections.

**Read when:** Integrating Flywheel-Crank into existing development workflows.

**See also:** [POLICIES.md](POLICIES.md) for workflow orchestration.

---

## Recommended Reading Order

**New users:**
1. [EXAMPLES.md](EXAMPLES.md) - Quick start with copy-paste examples
2. [INSTALL.md](INSTALL.md) - Get installed
3. [CONFIGURATION.md](CONFIGURATION.md) - Get configured
4. [TOOLS_REFERENCE.md](TOOLS_REFERENCE.md) - Learn the tools
5. [CONTENT_TARGETING.md](CONTENT_TARGETING.md) - Understand where content goes
6. [GUIDING_CLAUDE.md](GUIDING_CLAUDE.md) - Master the feedback loop
7. [WIKILINKS.md](WIKILINKS.md) - Understand auto-linking

**Migrating from raw editing:**
1. [MIGRATION.md](MIGRATION.md) - Step-by-step migration guide
2. [LIMITATIONS.md](LIMITATIONS.md) - Understand what Crank can/cannot do
3. [CONFIGURATION.md](CONFIGURATION.md) - Set up permissions

**Privacy-focused users:**
1. [PRIVACY.md](PRIVACY.md) - Understand data flow
2. [CONFIGURATION.md](CONFIGURATION.md) - Set up with recommended permissions

**AI agent developers:**
1. [AGENT_MEMORY.md](AGENT_MEMORY.md) - Use Flywheel as persistent memory
2. [AGENT_MUTATION_PATTERNS.md](AGENT_MUTATION_PATTERNS.md) - Safe mutation patterns for autonomous agents
3. [MULTI_AGENT_MUTATIONS.md](MULTI_AGENT_MUTATIONS.md) - Handle concurrent access
4. [COMPARISON.md](COMPARISON.md) - Understand vs alternatives
5. [TOOLS_REFERENCE.md](TOOLS_REFERENCE.md) - Learn tool capabilities
6. [WIKILINKS.md](WIKILINKS.md) - Leverage auto-linking

**Enterprise/workflow users:**
1. [POLICIES.md](POLICIES.md) - Policy orchestration
2. [INTEGRATION_PATTERNS.md](INTEGRATION_PATTERNS.md) - Integration patterns
3. [PLATFORM.md](PLATFORM.md) - Platform architecture

**Contributors:**
1. [TESTING.md](TESTING.md) - Understand the test suite (1472 tests)
2. [TOOLS_REFERENCE.md](TOOLS_REFERENCE.md) - Learn tool patterns
3. [PERFORMANCE.md](PERFORMANCE.md) - Understand benchmarks
4. [SCALE_BENCHMARKS.md](SCALE_BENCHMARKS.md) - Large-scale testing

---

## See Also

- [Main README](../README.md) - Project overview, installation, quick start
- [CLAUDE.md](../CLAUDE.md) - AI contributor guidelines and architecture details
