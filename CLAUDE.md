# Flywheel Crank

Obsidian plugin — thin UI over flywheel-memory's MCP server for search, graph sidebar, and vault intelligence.

## Deploy

### `/deploy-crank-local` — Build and deploy to Windows Obsidian

```bash
cd /home/ben/src/flywheel-crank && npm run build && cp main.js manifest.json styles.css "/mnt/c/Users/benca/obsidian/Ben/.obsidian/plugins/flywheel-crank/"
```

Reload in Obsidian after deploying (Ctrl+Shift+I → `app.plugins.disablePlugin('flywheel-crank')` then `app.plugins.enablePlugin('flywheel-crank')`).

### Paths

| What | Path |
|------|------|
| Source | `/home/ben/src/flywheel-crank/` |
| Windows plugin dir | `/mnt/c/Users/benca/obsidian/Ben/.obsidian/plugins/flywheel-crank/` |
| Windows vault | `/mnt/c/Users/benca/obsidian/Ben/` |
| MCP server | `/home/ben/src/flywheel-memory/packages/mcp-server/dist/index.js` |
| StateDb | `<vault>/.flywheel/state.db` |
