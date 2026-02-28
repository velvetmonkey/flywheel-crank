<div align="center">
  <img src="flywheel.png" alt="Flywheel" width="256"/>
  <h1>Flywheel Crank</h1>
  <p><strong>Graph intelligence & semantic search for your vault.</strong><br/>Obsidian plugin -- thin UI over flywheel-memory's MCP server.</p>
</div>

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Obsidian](https://img.shields.io/badge/Obsidian-plugin-blueviolet.svg)](https://obsidian.md/)
[![Platform](https://img.shields.io/badge/platform-desktop%20only-blue.svg)](https://github.com/velvetmonkey/flywheel-crank)

## Features

- **Entity inbox** -- Triage new and pending entity suggestions
- **Inline suggestions** -- Context-aware wikilink suggestions as you type
- **Entity page** -- Deep-dive view for any entity (backlinks, co-occurrence, feedback history)
- **Graph sidebar** -- Interactive graph visualization of your vault's link structure
- **Entity browser** -- Browse and explore extracted entities across your vault
- **Semantic search** -- Hybrid search (BM25 + embeddings) via search modal
- **Connection explorer** -- Discover paths and relationships between entities
- **Task dashboard** -- Query and visualize tasks across your vault
- **Weekly digest** -- Summary of vault activity and emerging patterns
- **Vault health** -- Diagnostics for orphans, broken links, and vault stats
- **Wikilink suggest** -- Editor completions powered by entity index and scoring
- **Context menu feedback** -- Right-click to approve/reject wikilink suggestions
- **Status bar pulse** -- Live connection status and index freshness indicator

## Installation

Manual install (copy built artifacts to your Obsidian plugins directory):

```bash
cd flywheel-crank
npm install
npm run build
cp main.js manifest.json styles.css /path/to/vault/.obsidian/plugins/flywheel-crank/
```

Then enable "Flywheel Crank" in Obsidian Settings > Community Plugins.

## Requirements

- Obsidian desktop (not mobile)
- [Flywheel Memory](https://github.com/velvetmonkey/flywheel-memory) MCP server (provides the vault index and entity data)

## Architecture

```
flywheel-crank/
├── src/
│   ├── main.ts                      # Plugin entry point
│   ├── settings.ts                  # Plugin settings tab
│   ├── mcp/
│   │   ├── client.ts                # MCP client (connects to flywheel-memory)
│   │   └── cache.ts                 # MCP response caching
│   ├── core/
│   │   ├── types.ts                 # Shared type definitions
│   │   ├── protectedZones.ts        # Code block / frontmatter protection
│   │   ├── wikilinks.ts             # Wikilink application logic
│   │   ├── stemmer.ts               # Porter stemmer
│   │   ├── levenshtein.ts           # Edit distance for fuzzy matching
│   │   └── similarity.ts            # Content similarity scoring
│   ├── db/
│   │   ├── schema.ts                # SQLite schema definitions
│   │   ├── persistence.ts           # Database persistence layer
│   │   ├── sql-js-adapter.ts        # sql.js FTS5 adapter
│   │   └── sql-js-fts5.d.ts         # Type declarations
│   ├── index/
│   │   ├── vault-index.ts           # Vault indexing and entity tracking
│   │   ├── entities.ts              # Entity extraction and management
│   │   ├── fts5.ts                  # Full-text search (FTS5)
│   │   └── embeddings.ts            # Semantic embeddings (local)
│   ├── suggest/
│   │   ├── wikilink-suggest.ts      # Wikilink completion provider
│   │   └── inline-suggestions.ts    # Context-aware inline suggestions
│   └── views/
│       ├── entity-inbox.ts          # Entity triage inbox
│       ├── entity-page.ts           # Single-entity deep-dive
│       ├── graph-sidebar.ts         # Graph visualization panel
│       ├── entity-browser.ts        # Entity browser view
│       ├── search-modal.ts          # Search modal (hybrid search)
│       ├── connection-explorer.ts   # Entity relationship explorer
│       ├── task-dashboard.ts        # Task query and visualization
│       ├── weekly-digest.ts         # Weekly vault activity digest
│       └── vault-health.ts          # Vault health diagnostics
├── manifest.json                    # Obsidian plugin manifest
├── styles.css                       # Plugin styles
└── esbuild.config.mjs               # Build configuration
```

## Development

```bash
npm install
npm run dev    # watch mode (rebuilds on change)
npm run build  # production build
npm run lint   # type check
```

---

Part of the [Flywheel](https://github.com/velvetmonkey/flywheel) ecosystem. Powered by [Flywheel Memory](https://github.com/velvetmonkey/flywheel-memory).

Apache 2.0 — see [LICENSE](./LICENSE) for details.
