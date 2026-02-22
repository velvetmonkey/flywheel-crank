/**
 * Flywheel Crank - Obsidian Plugin
 *
 * Graph intelligence & semantic search for your vault.
 * Search and graph views are powered by flywheel-memory via MCP.
 */

import { Plugin, Notice, WorkspaceLeaf, Menu, Editor, MarkdownView } from 'obsidian';
import type { FlywheelCrankSettings } from './core/types';
import { DEFAULT_SETTINGS } from './core/types';
import { FlywheelCrankSettingTab } from './settings';
import { SearchModal } from './views/search-modal';
import { ConnectionExplorerModal } from './views/connection-explorer';
import { GraphSidebarView, GRAPH_VIEW_TYPE } from './views/graph-sidebar';
import { EntityBrowserView, ENTITY_BROWSER_VIEW_TYPE } from './views/entity-browser';
import { VaultHealthView, VAULT_HEALTH_VIEW_TYPE } from './views/vault-health';
import { TaskDashboardView, TASK_DASHBOARD_VIEW_TYPE } from './views/task-dashboard';
import { FeedbackDashboardView, FEEDBACK_DASHBOARD_VIEW_TYPE } from './views/feedback-dashboard';
import { EntityInboxView, ENTITY_INBOX_VIEW_TYPE } from './views/entity-inbox';
import { WikilinkSuggest } from './suggest/wikilink-suggest';
import { FlywheelMcpClient } from './mcp/client';

export default class FlywheelCrankPlugin extends Plugin {
  settings: FlywheelCrankSettings = DEFAULT_SETTINGS;
  mcpClient: FlywheelMcpClient = new FlywheelMcpClient();
  private wikilinkSuggest: WikilinkSuggest | null = null;
  private statusBarEl: HTMLElement | null = null;
  private indexing = false;
  private wikilinkEntitiesLoaded = false;
  private healthUnsub: (() => void) | null = null;
  private graphRefreshTimer: number | null = null;
  private lastRebuildTimestamp = 0;
  private lastPipelineTimestamp = 0;
  private pipelineActiveTimer: number | null = null;

  async onload(): Promise<void> {
    console.log('Flywheel Crank: loading plugin');

    await this.loadSettings();

    // Status bar — insert at the left so it doesn't overtake Obsidian Sync
    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass('flywheel-status-bar');
    const statusBar = this.statusBarEl.parentElement;
    if (statusBar) statusBar.prepend(this.statusBarEl);
    this.statusBarEl.style.cursor = 'pointer';
    this.statusBarEl.addEventListener('click', () => {
      if (this.mcpClient.connectionState === 'error') this.initialize();
    });
    this.setStatus('connecting...', true);

    // Register views
    this.registerView(GRAPH_VIEW_TYPE, (leaf) => new GraphSidebarView(leaf, this.mcpClient));
    this.registerView(ENTITY_BROWSER_VIEW_TYPE, (leaf) => new EntityBrowserView(leaf, this.mcpClient));
    this.registerView(VAULT_HEALTH_VIEW_TYPE, (leaf) => new VaultHealthView(leaf, this.mcpClient));
    this.registerView(TASK_DASHBOARD_VIEW_TYPE, (leaf) => new TaskDashboardView(leaf, this.mcpClient));
    this.registerView(FEEDBACK_DASHBOARD_VIEW_TYPE, (leaf) => new FeedbackDashboardView(leaf, this.mcpClient));
    this.registerView(ENTITY_INBOX_VIEW_TYPE, (leaf) => new EntityInboxView(leaf, this.mcpClient));

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
      id: 'open-feedback-dashboard',
      name: 'Open feedback dashboard',
      callback: () => this.activateView(FEEDBACK_DASHBOARD_VIEW_TYPE),
    });

    this.addCommand({
      id: 'open-entity-inbox',
      name: 'Open entity inbox',
      callback: () => this.activateView(ENTITY_INBOX_VIEW_TYPE),
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
      this.mcpClient.onRetryRequest(() => this.initialize());
      await this.initialize();
    });

    // Show spinner when a note is saved — the server-side watcher will kick off
    // a pipeline, but we won't know it's done until the next health poll. Spinning
    // immediately gives feedback that something is happening.
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (!file.path.endsWith('.md')) return;
        if (!this.mcpClient.connected || this.indexing) return;
        this.signalPipelineActive();
      })
    );

    // Invalidate plugin-side cache when Obsidian UI creates/deletes/renames notes.
    // The MCP server has its own file watcher, but the plugin cache can serve stale
    // data until the next health poll without these invalidations.
    this.registerEvent(
      this.app.vault.on('create', (file) => {
        this.mcpClient.invalidateForPath(file.path);
        this.mcpClient.invalidateTool('list_entities');
        this.mcpClient.invalidateTool('get_folder_structure');
        this.mcpClient.invalidateTool('health_check');
      })
    );
    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        this.mcpClient.invalidateForPath(file.path);
        this.mcpClient.invalidateTool('list_entities');
        this.mcpClient.invalidateTool('get_folder_structure');
        this.mcpClient.invalidateTool('health_check');
      })
    );
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        this.mcpClient.invalidateForPath(file.path);
        this.mcpClient.invalidateForPath(oldPath);
        this.mcpClient.invalidateTool('list_entities');
        this.mcpClient.invalidateTool('get_folder_structure');
        this.mcpClient.invalidateTool('health_check');
      })
    );

    // Update graph sidebar on active note change
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        this.updateGraphSidebar();
      })
    );

    // Context menu actions on [[wikilinks]]
    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor, view: MarkdownView) => {
        if (!this.mcpClient.connected) return;

        const cursor = editor.getCursor();
        const line = editor.getLine(cursor.line);
        const entity = this.getWikilinkAtPosition(line, cursor.ch);
        if (!entity) return;

        const notePath = view?.file?.path;
        if (!notePath) return;

        menu.addSeparator();

        menu.addItem((item) => {
          item.setTitle('Flywheel: Link is correct')
            .setIcon('thumbs-up')
            .onClick(async () => {
              try {
                await this.mcpClient.reportWikilinkFeedback(entity, notePath, true);
                new Notice(`Feedback: "${entity}" is correct`);
              } catch {
                new Notice('Failed to record feedback');
              }
            });
        });

        menu.addItem((item) => {
          item.setTitle('Flywheel: Link is wrong')
            .setIcon('thumbs-down')
            .onClick(async () => {
              try {
                await this.mcpClient.reportWikilinkFeedback(entity, notePath, false);
                new Notice(`Feedback: "${entity}" is wrong`);
              } catch {
                new Notice('Failed to record feedback');
              }
            });
        });

        menu.addItem((item) => {
          item.setTitle('Flywheel: View in graph')
            .setIcon('git-fork')
            .onClick(() => {
              this.app.workspace.openLinkText(entity, notePath, false);
              this.activateView(GRAPH_VIEW_TYPE);
            });
        });
      })
    );
  }

  async onunload(): Promise<void> {
    console.log('Flywheel Crank: unloading plugin');

    if (this.healthUnsub) { this.healthUnsub(); this.healthUnsub = null; }
    this.mcpClient.stopHealthPoll();

    // Disconnect MCP client
    try {
      await this.mcpClient.disconnect();
    } catch (err) {
      console.error('Flywheel Crank: failed to disconnect MCP client', err);
    }
  }

  private async initialize(attempt = 1): Promise<void> {
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 3000;

    try {
      this.setStatus(attempt > 1 ? `reconnecting (${attempt}/${MAX_RETRIES})...` : 'connecting...', true);

      // Connect MCP client to flywheel-memory server
      const vaultBase = (this.app.vault.adapter as any).basePath;
      await this.mcpClient.connect(vaultBase, this.settings.mcpServerPath);

      // Refresh graph sidebar now that MCP is connected
      this.updateGraphSidebar(true);

      // Subscribe to centralized health polling
      this.setStatus('syncing...', true);
      this.healthUnsub = this.mcpClient.onHealthUpdate(health => this.handleHealthUpdate(health));
      this.mcpClient.startHealthPoll();
    } catch (err) {
      console.error(`Flywheel Crank: initialization failed (attempt ${attempt}/${MAX_RETRIES})`, err);

      if (attempt < MAX_RETRIES) {
        this.setStatus(`retrying in ${RETRY_DELAY_MS / 1000}s...`, true);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        // Ensure clean state before retry
        try { await this.mcpClient.disconnect(); } catch { /* ignore */ }
        return this.initialize(attempt + 1);
      }

      this.setStatus('connection failed', false, this.mcpClient.lastError ?? undefined);
      new Notice(`Flywheel Crank: ${err instanceof Error ? err.message : 'Connection failed'}`);
    }
  }

  /** Handle health updates from the centralized health poller. */
  private handleHealthUpdate(health: import('./mcp/client').McpHealthCheckResponse): void {
    // If a new pipeline arrived, cancel the processing spinner
    const pipelineTs = health.last_pipeline?.timestamp ?? 0;
    if (pipelineTs > this.lastPipelineTimestamp) {
      this.lastPipelineTimestamp = pipelineTs;
      if (this.pipelineActiveTimer) {
        window.clearTimeout(this.pipelineActiveTimer);
        this.pipelineActiveTimer = null;
      }
    }

    if (health.index_state === 'ready') {
      // Detect index rebuild and refresh entity cache for wikilink suggest
      const rebuildTs = health.last_rebuild?.timestamp ?? 0;
      if (rebuildTs > this.lastRebuildTimestamp && this.lastRebuildTimestamp > 0) {
        // Rebuild happened — re-fetch entities and force-refresh views
        this.wikilinkEntitiesLoaded = false;
        this.updateGraphSidebar(true);
      }
      this.lastRebuildTimestamp = rebuildTs;

      // Load entities for wikilink suggest (once, or after rebuild resets the flag)
      if (this.wikilinkSuggest && !this.wikilinkEntitiesLoaded) {
        this.wikilinkEntitiesLoaded = true;
        this.loadWikilinkEntities();
      }

      const ago = health.last_rebuild?.ago_seconds ?? 0;
      const agoText = ago < 60 ? `${ago}s ago` : ago < 3600 ? `${Math.floor(ago / 60)}m ago` : `${Math.floor(ago / 3600)}h ago`;

      const fts5Label = health.fts5_building ? 'building...'
        : health.fts5_ready ? 'ready' : 'not built';
      const semanticLabel = health.embeddings_building
        ? `building... (${health.embeddings_count ?? 0} embedded)`
        : health.embeddings_ready ? `ready (${health.embeddings_count} embeddings)` : 'not built';
      const tasksLabel = health.tasks_building ? 'building...'
        : health.tasks_ready ? 'ready' : 'waiting';
      const tooltip = [
        `Vault: ${health.note_count} notes · ${health.entity_count} entities · ${health.tag_count} tags`,
        '',
        `Graph index: ready (${agoText})`,
        `Keyword search: ${fts5Label}`,
        `Semantic search: ${semanticLabel}`,
        `Task cache: ${tasksLabel}`,
      ].join('\n');

      // Still building secondary indexes
      if (health.fts5_building) {
        this.setStatus('indexing search...', true, tooltip);
        return;
      }
      if (health.embeddings_building) {
        this.setStatus(`embedding ${health.embeddings_count ?? 0} notes...`, true, tooltip);
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
  }

  private async loadWikilinkEntities(): Promise<void> {
    try {
      const entities = await this.mcpClient.listEntities();
      this.wikilinkSuggest?.setEntityIndex(entities as any);
      console.log('Flywheel Crank: wikilink suggest loaded', (entities as any)._metadata?.total_entities, 'entities');
    } catch (err) {
      this.wikilinkEntitiesLoaded = false; // allow retry on next poll
      console.error('Flywheel Crank: failed to load entities for wikilink suggest', err);
    }
  }

  private updateGraphSidebar(force = false): void {
    if (this.graphRefreshTimer) window.clearTimeout(this.graphRefreshTimer);
    this.graphRefreshTimer = window.setTimeout(() => {
      this.graphRefreshTimer = null;
      const leaves = this.app.workspace.getLeavesOfType(GRAPH_VIEW_TYPE);
      for (const leaf of leaves) {
        const view = leaf.view as GraphSidebarView;
        if (typeof view.refresh === 'function') {
          view.refresh(force);
        }
      }
    }, 150);
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

  /** Spin the status bar to signal a pipeline is likely running. Clears itself after 10s max. */
  private signalPipelineActive(): void {
    if (this.pipelineActiveTimer) window.clearTimeout(this.pipelineActiveTimer);
    this.setStatus('processing...', true);
    // Safety: stop spinning after 10s even if health poll never confirms a new pipeline
    this.pipelineActiveTimer = window.setTimeout(() => {
      this.pipelineActiveTimer = null;
      // Only reset if we're still showing "processing..." (not mid-rebuild etc.)
      const health = this.mcpClient.lastHealth;
      if (health) this.handleHealthUpdate(health);
    }, 10_000);
  }

  /**
   * Extract entity name if cursor position is inside [[entity]] or [[entity|alias]].
   * Returns null if cursor is not inside a wikilink.
   */
  private getWikilinkAtPosition(line: string, ch: number): string | null {
    // Scan backwards from cursor for [[
    let openIdx = -1;
    for (let i = ch - 1; i >= 1; i--) {
      if (line[i] === '[' && line[i - 1] === '[') {
        openIdx = i - 1;
        break;
      }
      // Hit a close bracket before finding open — not inside a wikilink
      if (line[i] === ']' && i > 0 && line[i - 1] === ']') return null;
    }
    if (openIdx === -1) return null;

    // Scan forward from cursor for ]]
    let closeIdx = -1;
    for (let i = ch; i < line.length - 1; i++) {
      if (line[i] === ']' && line[i + 1] === ']') {
        closeIdx = i;
        break;
      }
      // Hit another open bracket — nested, bail
      if (line[i] === '[' && i < line.length - 1 && line[i + 1] === '[') return null;
    }
    if (closeIdx === -1) return null;

    const inner = line.substring(openIdx + 2, closeIdx);
    // Handle [[entity|alias]] — entity is before the pipe
    const pipeIdx = inner.indexOf('|');
    const entity = pipeIdx >= 0 ? inner.substring(0, pipeIdx).trim() : inner.trim();
    return entity.length > 0 ? entity : null;
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
