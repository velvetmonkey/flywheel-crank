<div align="center">
  <img src="flywheel.png" alt="Flywheel" width="256"/>
  <h1>Flywheel Crank</h1>
  <p><strong>Graph intelligence & semantic search for your vault.</strong><br/>Obsidian plugin -- thin UI over flywheel-memory's MCP server.</p>
</div>

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Obsidian](https://img.shields.io/badge/Obsidian-plugin-blueviolet.svg)](https://obsidian.md/)
[![Platform](https://img.shields.io/badge/platform-desktop%20only-blue.svg)](https://github.com/velvetmonkey/flywheel-crank)

## What is Flywheel Crank?

Flywheel Crank turns your Obsidian vault into a knowledge graph. It connects to [Flywheel Memory](https://github.com/velvetmonkey/flywheel-memory)'s MCP server to surface entity relationships, suggest wikilinks as you type, and give you semantic search across everything you've written. The more you use it, the smarter its suggestions get -- a flywheel that compounds over time.

## Screenshots

![Graph Sidebar](screenshots/graph-sidebar.png)
![Semantic Search](screenshots/search-modal.png)
![Entity Browser](screenshots/entity-browser.png)
![Vault Health](screenshots/vault-health.png)

## Features

### Search & Discovery

- **Semantic search modal** -- Hybrid search (BM25 + embeddings) across your entire vault
- **Wikilink completions** -- Editor completions powered by the entity index and scoring engine
- **Inline suggestions** -- Context-aware wikilink suggestions as you type

### Graph & Connections

- **Graph sidebar** -- Interactive graph visualization of your vault's link structure
- **Connection explorer** -- Discover paths and relationships between entities

### Entity Intelligence

- **Entity browser** -- Browse and explore extracted entities across 17 categories
- **Entity page** -- Deep-dive view for any entity: backlinks, co-occurrence, feedback history

### Vault Analytics

- **Vault health** -- Diagnostics for orphans, broken links, and vault stats
- **Weekly digest** -- Summary of vault activity and emerging patterns
- **Task dashboard** -- Query and visualize tasks across your vault

### Feedback Loop

- **Context menu feedback** -- Right-click to approve or reject wikilink suggestions
- **Status bar pulse** -- Live connection status and index freshness indicator
- **Auto-reconnect** -- Categorized error handling with actionable status bar messages, plus a manual `reconnect` command

## Requirements

- Obsidian desktop (not mobile)
- [Flywheel Memory](https://github.com/velvetmonkey/flywheel-memory) MCP server (provides the vault index and entity data)

> **Note:** The MCP server is developed and tested with Claude Code. Other MCP clients may work but are untested.

## Installation

Manual install (copy built artifacts to your Obsidian plugins directory):

```bash
cd flywheel-crank
npm install
npm run build
cp main.js manifest.json styles.css flywheel.png /path/to/vault/.obsidian/plugins/flywheel-crank/
```

Then enable "Flywheel Crank" in Obsidian Settings > Community Plugins.

## Configuration

In Obsidian Settings > Flywheel Crank you can configure:

- **MCP server path** -- Path to the flywheel-memory server binary
- **Feature toggles** -- Enable/disable individual views (graph sidebar, inline suggestions, etc.)
- **Exclude folders** -- Folders to skip during indexing

## Development

```bash
npm install
npm run dev    # watch mode (rebuilds on change)
npm run build  # production build
npm run lint   # type check
npm test       # run vitest suite
```

---

Part of the [Flywheel](https://github.com/velvetmonkey/flywheel) ecosystem. Powered by [Flywheel Memory](https://github.com/velvetmonkey/flywheel-memory).

Apache 2.0 -- see [LICENSE](./LICENSE) for details.
