/**
 * Flywheel Crank - Obsidian Plugin
 *
 * Graph intelligence & semantic search for your vault.
 * Search and graph views are powered by flywheel-memory via MCP.
 */

import { Plugin, Notice, WorkspaceLeaf } from 'obsidian';
import type { FlywheelCrankSettings } from './core/types';
import { DEFAULT_SETTINGS } from './core/types';
import { FlywheelCrankSettingTab } from './settings';
import { SearchModal } from './views/search-modal';
import { ConnectionExplorerModal } from './views/connection-explorer';
import { GraphSidebarView, GRAPH_VIEW_TYPE } from './views/graph-sidebar';
import { EntityBrowserView, ENTITY_BROWSER_VIEW_TYPE } from './views/entity-browser';
import { VaultHealthView, VAULT_HEALTH_VIEW_TYPE } from './views/vault-health';
import { TaskDashboardView, TASK_DASHBOARD_VIEW_TYPE } from './views/task-dashboard';
import { WikilinkSuggest } from './suggest/wikilink-suggest';
import { FlywheelMcpClient } from './mcp/client';

export default class FlywheelCrankPlugin extends Plugin {
  settings: FlywheelCrankSettings = DEFAULT_SETTINGS;
  mcpClient: FlywheelMcpClient = new FlywheelMcpClient();
  private wikilinkSuggest: WikilinkSuggest | null = null;
  private statusBarEl: HTMLElement | null = null;
  private indexing = false;

  async onload(): Promise<void> {
    console.log('Flywheel Crank: loading plugin');

    await this.loadSettings();

    // Status bar — insert at the left so it doesn't overtake Obsidian Sync
    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass('flywheel-status-bar');
    const statusBar = this.statusBarEl.parentElement;
    if (statusBar) statusBar.prepend(this.statusBarEl);
    this.setStatus('connecting...', true);

    // Register views
    this.registerView(GRAPH_VIEW_TYPE, (leaf) => new GraphSidebarView(leaf, this.mcpClient));
    this.registerView(ENTITY_BROWSER_VIEW_TYPE, (leaf) => new EntityBrowserView(leaf));
    this.registerView(VAULT_HEALTH_VIEW_TYPE, (leaf) => new VaultHealthView(leaf, this.mcpClient));
    this.registerView(TASK_DASHBOARD_VIEW_TYPE, (leaf) => new TaskDashboardView(leaf, this.mcpClient));

    // Settings tab
    this.addSettingTab(new FlywheelCrankSettingTab(this.app, this));

    // Commands
    this.addCommand({
      id: 'search',
      name: 'Search vault',
      callback: () => new SearchModal(this.app, this.mcpClient).open(),
    });

    this.addCommand({
      id: 'open-graph-sidebar',
      name: 'Open graph sidebar',
      callback: () => this.activateView(GRAPH_VIEW_TYPE),
    });

    this.addCommand({
      id: 'open-entity-browser',
      name: 'Open entity browser',
      callback: () => this.activateView(ENTITY_BROWSER_VIEW_TYPE),
    });

    this.addCommand({
      id: 'open-vault-health',
      name: 'Open vault health',
      callback: () => this.activateView(VAULT_HEALTH_VIEW_TYPE),
    });

    this.addCommand({
      id: 'open-task-dashboard',
      name: 'Open task dashboard',
      callback: () => this.activateView(TASK_DASHBOARD_VIEW_TYPE),
    });

    this.addCommand({
      id: 'rebuild-index',
      name: 'Rebuild index',
      callback: () => this.rebuildIndex(),
    });

    this.addCommand({
      id: 'init-semantic',
      name: 'Build semantic embeddings',
      callback: () => this.buildSemanticIndex(),
    });

    this.addCommand({
      id: 'open-connection-explorer',
      name: 'Explore connections between notes',
      callback: () => new ConnectionExplorerModal(this.app, this.mcpClient).open(),
    });

    // Ribbon icons
    this.addRibbonIcon('search', 'Flywheel Search', () => {
      new SearchModal(this.app, this.mcpClient).open();
    });

    this.addRibbonIcon('git-fork', 'Flywheel Graph', () => {
      this.activateView(GRAPH_VIEW_TYPE);
    });

    // Wikilink suggest
    if (this.settings.enableWikilinkSuggest) {
      this.wikilinkSuggest = new WikilinkSuggest(this.app);
      this.registerEditorSuggest(this.wikilinkSuggest);
    }

    // Initialize on layout ready
    this.app.workspace.onLayoutReady(async () => {
      await this.initialize();
    });

    // Vault file events handled by flywheel-memory's file watcher via MCP.

    // Update graph sidebar on active note change
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        this.updateGraphSidebar();
      })
    );
  }

  async onunload(): Promise<void> {
    console.log('Flywheel Crank: unloading plugin');

    // Disconnect MCP client
    try {
      await this.mcpClient.disconnect();
    } catch (err) {
      console.error('Flywheel Crank: failed to disconnect MCP client', err);
    }
  }

  private async initialize(): Promise<void> {
    try {
      this.setStatus('connecting...', true);

      // Connect MCP client to flywheel-memory server
      const vaultBase = (this.app.vault.adapter as any).basePath;
      await this.mcpClient.connect(vaultBase, this.settings.mcpServerPath);

      // Refresh graph sidebar now that MCP is connected
      this.updateGraphSidebar(true);

      // Poll index state — show syncing until ready
      this.setStatus('syncing...', true);
      this.pollIndexState();
    } catch (err) {
      console.error('Flywheel Crank: initialization failed', err);
      this.setStatus('error', false);
      new Notice(`Flywheel Crank: ${err instanceof Error ? err.message : 'Connection failed'}`);
    }
  }

  /** Poll health_check until all indexes are ready, updating status bar. */
  private async pollIndexState(): Promise<void> {
    try {
      const health = await this.mcpClient.healthCheck();

      if (health.index_state === 'ready') {
        const ago = health.last_rebuild?.ago_seconds ?? 0;
        const agoText = ago < 60 ? `${ago}s ago` : ago < 3600 ? `${Math.floor(ago / 60)}m ago` : `${Math.floor(ago / 3600)}h ago`;

        const fts5Label = health.fts5_building ? 'building...'
          : health.fts5_ready ? 'ready' : 'not built';
        const semanticLabel = health.embeddings_building
          ? `building... (${health.embeddings_count ?? 0} embedded)`
          : health.embeddings_ready ? `ready (${health.embeddings_count} embeddings)` : 'not built';
        const tooltip = [
          `Vault: ${health.note_count} notes · ${health.entity_count} entities · ${health.tag_count} tags`,
          '',
          `Graph index: ready (${agoText})`,
          `Keyword search: ${fts5Label}`,
          `Semantic search: ${semanticLabel}`,
        ].join('\n');

        // Still building secondary indexes
        if (health.fts5_building) {
          this.setStatus('indexing search...', true, tooltip);
          setTimeout(() => this.pollIndexState(), 3000);
          return;
        }
        if (health.embeddings_building) {
          this.setStatus(`embedding ${health.embeddings_count ?? 0} notes...`, true, tooltip);
          setTimeout(() => this.pollIndexState(), 3000);
          return;
        }

        this.setStatus(`ready · ${agoText}`, false, tooltip);
        return;
      }

      // Still building graph — show progress if available
      const progress = (health as any).index_progress;
      const graphStatus = progress?.total > 0
        ? `building (${progress.parsed}/${progress.total})`
        : 'building...';
      const fts5Status = health.fts5_building ? 'building...' : health.fts5_ready ? 'ready' : 'waiting';
      const tooltip = [
        `Graph index: ${graphStatus}`,
        `Keyword search: ${fts5Status}`,
        'Semantic search: waiting',
      ].join('\n');
      if (progress?.total > 0) {
        this.setStatus(`syncing ${progress.parsed}/${progress.total}...`, true, tooltip);
      } else {
        this.setStatus('syncing...', true, tooltip);
      }
    } catch {
      // health check failed, keep current status
    }
    setTimeout(() => this.pollIndexState(), 3000);
  }

  private updateGraphSidebar(force = false): void {
    const leaves = this.app.workspace.getLeavesOfType(GRAPH_VIEW_TYPE);
    for (const leaf of leaves) {
      const view = leaf.view as GraphSidebarView;
      view.refresh(force);
    }
  }

  private async activateView(viewType: string): Promise<void> {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(viewType);

    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({ type: viewType, active: true });
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);

      // Graph sidebar uses MCP client — trigger refresh on activate
      if (viewType === GRAPH_VIEW_TYPE) {
        (leaf.view as GraphSidebarView).refresh(true);
      }
    }
  }

  private async buildSemanticIndex(): Promise<void> {
    if (this.indexing) {
      new Notice('Already indexing...');
      return;
    }
    if (!this.mcpClient.connected) {
      new Notice('MCP server not connected');
      return;
    }

    this.indexing = true;
    new Notice('Building semantic embeddings... (this may take a few minutes)');
    this.setStatus('embedding...', true);

    try {
      // Start build (long-running, up to 10min timeout)
      const buildPromise = this.mcpClient.initSemantic();

      // Poll progress via health check while build is running
      const pollProgress = async () => {
        while (this.indexing) {
          try {
            const health = await this.mcpClient.healthCheck();
            if (health.embeddings_count != null && health.embeddings_count > 0) {
              this.setStatus(`embedding ${health.embeddings_count}/${health.note_count}...`, true);
            }
          } catch { /* ignore poll errors */ }
          await new Promise(r => setTimeout(r, 3000));
        }
      };
      pollProgress(); // fire-and-forget

      const result = await buildPromise;
      this.setStatus('ready');
      new Notice(`Semantic index built (${result.embedded} notes embedded)`);
    } catch (err) {
      this.setStatus('ready');
      new Notice(`${err instanceof Error ? err.message : 'Embedding failed'}`);
      console.error('Flywheel Crank: semantic build failed', err);
    } finally {
      this.indexing = false;
    }
  }

  private async rebuildIndex(): Promise<void> {
    if (this.indexing) {
      new Notice('Already indexing...');
      return;
    }
    if (!this.mcpClient.connected) {
      new Notice('MCP server not connected');
      return;
    }

    this.indexing = true;
    new Notice('Rebuilding index...');
    this.setStatus('rebuilding...', true);

    try {
      const result = await this.mcpClient.refreshIndex();
      this.setStatus('ready');
      new Notice(`Index rebuilt (${result.note_count} notes, ${result.duration_ms}ms)`);
    } catch (err) {
      this.setStatus('ready');
      new Notice(`${err instanceof Error ? err.message : 'Rebuild failed'}`);
    } finally {
      this.indexing = false;
    }
  }

  private setStatus(text: string, active = false, tooltip?: string): void {
    if (!this.statusBarEl) return;
    this.statusBarEl.empty();

    // Use flywheel logo as status icon
    const imgEl = this.statusBarEl.createEl('img', { cls: 'flywheel-status-logo' });
    const imgPath = `${this.app.vault.configDir}/plugins/flywheel-crank/flywheel.png`;
    imgEl.src = this.app.vault.adapter.getResourcePath(imgPath);
    imgEl.alt = '';
    if (active) {
      imgEl.addClass('flywheel-status-spin');
    }

    this.statusBarEl.createSpan().setText(` Flywheel ${text}`);

    if (tooltip) {
      this.statusBarEl.setAttribute('aria-label', tooltip);
      this.statusBarEl.setAttribute('data-tooltip-position', 'top');
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
