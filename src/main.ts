/**
 * Flywheel Crank - Obsidian Plugin
 *
 * Graph intelligence & semantic search for your vault.
 * Search and graph views are powered by flywheel-memory via MCP.
 */

import { Plugin, Notice, WorkspaceLeaf, Menu, Editor, MarkdownView, FuzzySuggestModal, App } from 'obsidian';
import type { FlywheelCrankSettings } from './core/types';
import { DEFAULT_SETTINGS } from './core/types';
import { FlywheelCrankSettingTab } from './settings';
import { SearchModal } from './views/search-modal';
import { ConnectionExplorerModal } from './views/connection-explorer';
import { GraphSidebarView, GRAPH_VIEW_TYPE } from './views/graph-sidebar';
import { EntityBrowserView, ENTITY_BROWSER_VIEW_TYPE } from './views/entity-browser';
import { VaultHealthView, VAULT_HEALTH_VIEW_TYPE } from './views/vault-health';
import { TaskDashboardView, TASK_DASHBOARD_VIEW_TYPE } from './views/task-dashboard';
import { EntityPageView, ENTITY_PAGE_VIEW_TYPE } from './views/entity-page';
import { WeeklyDigestModal } from './views/weekly-digest';
import { WikilinkSuggest } from './suggest/wikilink-suggest';
import { createInlineSuggestionPlugin } from './suggest/inline-suggestions';
import { FlywheelMcpClient, McpEntityItem, McpToolError } from './mcp/client';

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
  /** Entity name from last right-click on a rendered internal link (Live Preview fallback) */
  private contextMenuLinkEntity: string | null = null;
  private contextMenuLinkLine: number | null = null;

  async onload(): Promise<void> {
    console.log(`[flywheel-crank] v${this.manifest.version} loading`);

    await this.loadSettings();

    // Status bar — insert at the left so it doesn't overtake Obsidian Sync
    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass('flywheel-status-bar');
    const statusBar = this.statusBarEl.parentElement;
    if (statusBar) statusBar.prepend(this.statusBarEl);
    this.statusBarEl.style.cursor = 'pointer';
    this.statusBarEl.addEventListener('click', () => {
      const state = this.mcpClient.connectionState;
      if (state === 'error' || state === 'disconnected' || state === 'reconnecting') {
        this.initialize();
      }
    });
    this.setStatus('connecting...', true);

    // Update status bar when auto-reconnect kicks in
    this.mcpClient.onConnectionStateChange(() => {
      if (this.mcpClient.connectionState === 'reconnecting') {
        this.setStatus('reconnecting...', true);
      }
    });

    // Register views
    this.registerView(GRAPH_VIEW_TYPE, (leaf) => new GraphSidebarView(leaf, this.mcpClient));
    this.registerView(ENTITY_BROWSER_VIEW_TYPE, (leaf) => {
      const view = new EntityBrowserView(leaf, this.mcpClient);
      view.onOpenEntityPage = (name) => this.openEntityPage(name);
      return view;
    });
    this.registerView(VAULT_HEALTH_VIEW_TYPE, (leaf) => new VaultHealthView(leaf, this.mcpClient, this.manifest.version));
    this.registerView(TASK_DASHBOARD_VIEW_TYPE, (leaf) => new TaskDashboardView(leaf, this.mcpClient));
    this.registerView(ENTITY_PAGE_VIEW_TYPE, (leaf) => new EntityPageView(leaf, this.mcpClient));

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
      id: 'weekly-digest',
      name: 'Weekly flywheel digest',
      callback: () => new WeeklyDigestModal(this.app, this.mcpClient).open(),
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

    this.addCommand({
      id: 'mcp-reconnect',
      name: 'Reconnect to MCP server',
      callback: () => this.initialize(),
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

    // Inline entity suggestions (dotted underlines on entity mentions)
    if (this.settings.enableInlineSuggestions !== false) {
      this.registerEditorExtension(createInlineSuggestionPlugin(
        this.mcpClient,
        () => this.app.workspace.getActiveFile()?.path,
      ));
    }

    // Initialize on layout ready
    this.app.workspace.onLayoutReady(async () => {
      this.mcpClient.onRetryRequest(() => this.initialize());
      await this.initialize();
    });

    // Show spinner when a note is saved — the server-side watcher will kick off
    // Show spinner immediately on file save — the watcher pipeline typically
    // finishes within 200-500ms (faster than the 3s health poll). The next
    // health poll will overwrite with the real state, so worst case is a
    // 3s spinner for a sub-second pipeline.
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (!file.path.endsWith('.md')) return;
        if (!this.mcpClient.connected || this.indexing) return;
        this.mcpClient.invalidateForPath(file.path);
        this.setStatus('processing...', true);
      })
    );

    // Invalidate plugin-side cache when Obsidian UI creates/deletes/renames notes.
    // The MCP server has its own file watcher, but the plugin cache can serve stale
    // data until the next health poll without these invalidations.
    this.registerEvent(
      this.app.vault.on('create', (file) => {
        this.mcpClient.invalidateForPath(file.path);
        this.mcpClient.invalidateTool('list_entities');
        this.mcpClient.invalidateTool('flywheel_doctor');
      })
    );
    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        this.mcpClient.invalidateForPath(file.path);
        this.mcpClient.invalidateTool('list_entities');
        this.mcpClient.invalidateTool('flywheel_doctor');
      })
    );
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        this.mcpClient.invalidateForPath(file.path);
        this.mcpClient.invalidateForPath(oldPath);
        this.mcpClient.invalidateTool('list_entities');
        this.mcpClient.invalidateTool('flywheel_doctor');
      })
    );

    // Update graph sidebar on active note change
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        this.updateGraphSidebar();
      })
    );

    // Capture right-click target for rendered internal links in Live Preview.
    // In Live Preview, right-clicking a rendered wikilink doesn't reposition
    // the cursor, so getWikilinkAtPosition() fails. This listener grabs the
    // entity from the DOM before editor-menu fires.
    const contextMenuHandler = (evt: MouseEvent) => {
      this.contextMenuLinkEntity = null;
      this.contextMenuLinkLine = null;
      const target = evt.target as HTMLElement;
      if (!target) return;
      const linkEl = target.closest('.internal-link') as HTMLElement | null;
      if (!linkEl) return;
      this.contextMenuLinkEntity = linkEl.getAttribute('data-href')?.trim() || null;
      // Resolve the line number while the element is still in the DOM
      const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (activeView) {
        try {
          const cmEditor = (activeView.editor as any).cm;
          if (cmEditor?.posAtDOM) {
            const pos = cmEditor.posAtDOM(linkEl);
            const lineInfo = cmEditor.state.doc.lineAt(pos);
            this.contextMenuLinkLine = lineInfo.number - 1; // 0-indexed for Editor API
          }
        } catch { /* posAtDOM can throw for detached nodes */ }
      }
    };
    document.addEventListener('contextmenu', contextMenuHandler, true);
    this.register(() => document.removeEventListener('contextmenu', contextMenuHandler, true));

    // Context menu actions on [[wikilinks]]
    this.registerEvent(
      (this.app.workspace as any).on('editor-menu', (menu: Menu, editor: Editor, view: MarkdownView) => {
        if (!this.mcpClient.connected) return;

        const cursor = editor.getCursor();
        const line = editor.getLine(cursor.line);
        let entity = this.getWikilinkAtPosition(line, cursor.ch);
        let wikilinkLine = cursor.line;

        // Fallback: use entity from rendered internal-link element (Live Preview)
        if (!entity && this.contextMenuLinkEntity) {
          entity = this.contextMenuLinkEntity;
          if (this.contextMenuLinkLine !== null) wikilinkLine = this.contextMenuLinkLine;
        }
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
              } catch (e) {
                const detail = e instanceof McpToolError ? ` (${e.toolName})` : '';
                new Notice(`Failed to record feedback${detail}`);
              }
            });
        });

        menu.addItem((item) => {
          item.setTitle('Flywheel: Link is wrong')
            .setIcon('thumbs-down')
            .onClick(async () => {
              try {
                // Strip [[wikilink]] brackets from the editor
                const cur = editor.getCursor();
                const curLine = editor.getLine(cur.line);
                let stripped = this.stripWikilinkAtPosition(curLine, cur.ch);
                if (stripped) {
                  editor.setLine(cur.line, stripped);
                } else {
                  // Fallback: cursor wasn't inside the wikilink (Live Preview)
                  const fallbackLine = editor.getLine(wikilinkLine);
                  stripped = this.stripWikilinkForEntity(fallbackLine, entity);
                  if (stripped) editor.setLine(wikilinkLine, stripped);
                }
                await this.mcpClient.reportWikilinkFeedback(entity, notePath, false, true);
                new Notice(`"${entity}" suppressed — won't be suggested in this note again`);
              } catch (e) {
                const detail = e instanceof McpToolError ? ` (${e.toolName})` : '';
                new Notice(`Failed to record feedback${detail}`);
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

        menu.addItem((item) => {
          item.setTitle('Flywheel: Merge as alias into...')
            .setIcon('arrow-right-circle')
            .onClick(() => {
              new EntityPickerModal(this.app, this.mcpClient, entity).open();
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

    // Cancel any in-flight auto-reconnect to prevent racing
    this.mcpClient.cancelAutoReconnect();

    try {
      this.setStatus(attempt > 1 ? `reconnecting (${attempt}/${MAX_RETRIES})...` : 'connecting...', true);

      // Connect MCP client to flywheel-memory server
      const vaultBase = (this.app.vault.adapter as any).basePath;
      await this.mcpClient.connect(vaultBase, this.settings.mcpServerPath);

      // Refresh graph sidebar now that MCP is connected
      this.updateGraphSidebar(true);

      // Subscribe to centralized health polling
      this.setStatus('connecting...', true);
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

      const errorMsg = err instanceof Error ? err.message : 'Connection failed';
      this.setStatus('connection failed', false, `MCP: error — ${errorMsg}\nClick to reconnect`);
      new Notice(`Flywheel Crank: ${errorMsg}`);
    }
  }

  /** Handle health updates from the centralized health poller. */
  private handleHealthUpdate(health: import('./mcp/client').McpHealthCheckResponse): void {
    // --- Pipeline-change detection (refresh caches when a new pipeline completes) ---
    const pipelineTs = health.last_pipeline?.timestamp ?? 0;
    if (pipelineTs > this.lastPipelineTimestamp) {
      const isFirstPoll = this.lastPipelineTimestamp === 0;
      this.lastPipelineTimestamp = pipelineTs;
      // Pipeline includes entity_scan — aliases/entities may have changed
      if (!isFirstPoll) {
        this.mcpClient.invalidateTool('list_entities');
        this.mcpClient.invalidateTool('suggest_wikilinks');
        this.mcpClient.bustEntityCache();
        this.wikilinkEntitiesLoaded = false;
        this.mcpClient.notifyPipelineComplete();
      }
    }

    // --- Error state ---
    if (health.index_state === 'error') {
      const tooltip = this.buildTooltip(health);
      this.setStatus('index error', false, tooltip);
      return;
    }

    // --- Initial index build ---
    if (health.index_state === 'building') {
      const progress = (health as any).index_progress;
      const tooltip = this.buildTooltip(health);
      if (progress?.total > 0) {
        this.setStatus(`indexing ${progress.parsed}/${progress.total}...`, true, tooltip);
      } else {
        this.setStatus('indexing...', true, tooltip);
      }
      return;
    }

    // --- Index ready: detect rebuilds, load entities ---
    const rebuildTs = health.last_rebuild?.timestamp ?? 0;
    if (rebuildTs > this.lastRebuildTimestamp && this.lastRebuildTimestamp > 0) {
      this.mcpClient.invalidateTool('list_entities');
      this.mcpClient.bustEntityCache();
      this.wikilinkEntitiesLoaded = false;
      this.updateGraphSidebar(true);
    }
    this.lastRebuildTimestamp = rebuildTs;

    if (this.wikilinkSuggest && !this.wikilinkEntitiesLoaded) {
      this.wikilinkEntitiesLoaded = true;
      this.loadWikilinkEntities();
    }

    const tooltip = this.buildTooltip(health);

    // --- Watcher processing (prefer pipeline_activity over watcher_state) ---
    const pa = health.pipeline_activity;
    const pipelineBusy = pa?.busy
      ?? (health.watcher_state === 'rebuilding' || (health.watcher_pending != null && health.watcher_pending > 0));
    if (pipelineBusy) {
      const stepLabel = pa?.current_step ?? null;
      const pending = health.watcher_pending ?? 0;
      const label = stepLabel
        ? `${stepLabel}${pa?.progress ? ` (${pa.progress})` : ''}...`
        : (pending > 0 ? `processing ${pending} files...` : 'processing...');
      this.setStatus(label, true, tooltip);
      return;
    }

    // --- Secondary indexes building ---
    if (health.fts5_building) {
      this.setStatus('indexing search...', true, tooltip);
      return;
    }
    if (health.embeddings_building) {
      this.setStatus(`embedding ${health.embeddings_count ?? 0} notes...`, true, tooltip);
      return;
    }

    // --- Recent activity window (sticky for 10s after batch completion) ---
    const completedAgo = health.pipeline_activity?.last_completed_ago_seconds;
    if (completedAgo != null && completedAgo < 10) {
      this.setStatus('updated just now', false, tooltip);
      return;
    }

    // --- Idle ---
    const ago = health.last_index_activity_ago_seconds ?? health.last_rebuild?.ago_seconds ?? 0;
    const agoText = formatAgo(ago);
    this.setStatus(`ready · ${agoText}`, false, tooltip);
  }

  /** Build a rich tooltip showing all subsystem states. */
  private buildTooltip(health: import('./mcp/client').McpHealthCheckResponse): string {
    const ago = health.last_index_activity_ago_seconds ?? health.last_rebuild?.ago_seconds ?? 0;
    const agoText = formatAgo(ago);
    const pa = health.pipeline_activity;

    const lines: string[] = [];

    // Header
    lines.push(`MCP: connected · ${health.note_count} notes · ${agoText}`);
    lines.push(`Entities: ${health.entity_count} · Tags: ${health.tag_count}`);
    lines.push('');

    // Watcher state
    const ws = health.watcher_state;
    if (ws === undefined) {
      lines.push('Watcher: unknown');
    } else if (pa?.busy || ws === 'rebuilding') {
      const step = pa?.current_step;
      const progress = pa?.progress;
      const pending = health.watcher_pending ?? 0;
      const detail = step
        ? `${step}${progress ? ` (${progress})` : ''}`
        : (pending > 0 ? `${pending} pending` : '');
      lines.push(`Watcher: processing${detail ? ` — ${detail}` : ''}`);
      // Include last pipeline detail if available
      if (health.last_pipeline) {
        const p = health.last_pipeline;
        const stepNames = p.steps
          .filter(s => !s.skipped)
          .map(s => s.name)
          .join(' → ');
        const filesLabel = p.files_changed != null ? `${p.files_changed} files` : 'files';
        lines.push(`  Last: ${filesLabel} · ${p.duration_ms}ms · ${stepNames}`);
      }
    } else if (ws === 'error') {
      lines.push('Watcher: error (index still functional)');
    } else if (ws === 'starting') {
      lines.push('Watcher: starting...');
    } else if (ws === 'dirty') {
      lines.push('Watcher: ready (index may be stale)');
    } else {
      // 'ready'
      const pending = health.watcher_pending ?? 0;
      const completedAgo = pa?.last_completed_ago_seconds;
      if (pending > 0) {
        lines.push(`Watcher: ready (${pending} pending)`);
      } else if (completedAgo != null && completedAgo < 60) {
        lines.push(`Watcher: ready (last batch ${formatAgo(completedAgo)})`);
      } else {
        lines.push('Watcher: ready');
      }
    }

    // Graph index
    if (health.index_state === 'building') {
      const progress = (health as any).index_progress;
      const graphStatus = progress?.total > 0
        ? `building (${progress.parsed}/${progress.total})`
        : 'building...';
      lines.push(`Graph index: ${graphStatus}`);
    } else if (health.index_state === 'error') {
      lines.push('Graph index: error');
    } else {
      lines.push(`Graph index: ready (${agoText})`);
    }

    // Keyword search
    const fts5Label = health.fts5_building ? 'building...'
      : health.fts5_ready ? 'ready' : 'not built';
    lines.push(`Keyword search: ${fts5Label}`);

    // Semantic search
    const semanticLabel = health.embeddings_building
      ? `building... (${health.embeddings_count ?? 0} embedded)`
      : health.embeddings_ready ? `ready (${health.embeddings_count} embeddings)` : 'not built';
    lines.push(`Semantic search: ${semanticLabel}`);

    // Task cache
    const tasksLabel = health.tasks_building ? 'building...'
      : health.tasks_ready ? 'ready' : 'waiting';
    lines.push(`Task cache: ${tasksLabel}`);

    // Errors
    if (this.mcpClient.lastToolError) {
      lines.push('', `⚠ ${this.mcpClient.lastToolError.getActionableMessage()}`);
    }

    return lines.join('\n');
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

  /**
   * Open the Entity Page view for a specific entity.
   * Reuses existing Entity Page leaf if one is already open.
   */
  async openEntityPage(entityName: string): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(ENTITY_PAGE_VIEW_TYPE);

    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      if (leaf) await leaf.setViewState({ type: ENTITY_PAGE_VIEW_TYPE, active: true });
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
      await (leaf.view as EntityPageView).showEntity(entityName);
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
      const detail = err instanceof McpToolError ? ` (${err.toolName})` : '';
      new Notice(`Embedding failed${detail}: ${err instanceof Error ? err.message : 'unknown error'}`);
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
      const detail = err instanceof McpToolError ? ` (${err.toolName})` : '';
      new Notice(`Rebuild failed${detail}: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      this.indexing = false;
    }
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

  /**
   * Strip [[entity]] or [[entity|alias]] at cursor position, returning
   * the modified line. For piped links, keeps the alias text.
   * Returns null if cursor is not inside a wikilink.
   */
  private stripWikilinkAtPosition(line: string, ch: number): string | null {
    // Find open [[ scanning backwards
    let openIdx = -1;
    for (let i = ch - 1; i >= 1; i--) {
      if (line[i] === '[' && line[i - 1] === '[') {
        openIdx = i - 1;
        break;
      }
      if (line[i] === ']' && i > 0 && line[i - 1] === ']') return null;
    }
    if (openIdx === -1) return null;

    // Find close ]] scanning forwards
    let closeIdx = -1;
    for (let i = ch; i < line.length - 1; i++) {
      if (line[i] === ']' && line[i + 1] === ']') {
        closeIdx = i;
        break;
      }
      if (line[i] === '[' && i < line.length - 1 && line[i + 1] === '[') return null;
    }
    if (closeIdx === -1) return null;

    const inner = line.substring(openIdx + 2, closeIdx);
    const pipeIdx = inner.indexOf('|');
    // For [[entity|alias]], keep the alias; for [[entity]], keep entity
    const replacement = pipeIdx >= 0 ? inner.substring(pipeIdx + 1).trim() : inner.trim();

    return line.substring(0, openIdx) + replacement + line.substring(closeIdx + 2);
  }

  /**
   * Strip the first [[entity]] or [[entity|alias]] matching the given entity name.
   * Used as fallback when cursor-based stripping fails (Live Preview rendered links).
   */
  private stripWikilinkForEntity(line: string, entity: string): string | null {
    const escaped = entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\[\\[${escaped}(?:\\|([^\\]]*?))?\\]\\]`);
    const match = line.match(regex);
    if (!match || match.index === undefined) return null;
    const replacement = match[1]?.trim() || entity;
    return line.substring(0, match.index) + replacement + line.substring(match.index + match[0].length);
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

function formatAgo(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

/**
 * Fuzzy entity picker for the "Merge as alias into..." context menu action.
 * Loads all entities from the MCP server and lets the user pick a target.
 */
class EntityPickerModal extends FuzzySuggestModal<McpEntityItem> {
  private mcpClient: FlywheelMcpClient;
  private sourceName: string;
  private entities: McpEntityItem[] = [];

  constructor(app: App, mcpClient: FlywheelMcpClient, sourceName: string) {
    super(app);
    this.mcpClient = mcpClient;
    this.sourceName = sourceName;
    this.setPlaceholder(`Pick target entity to absorb "${sourceName}" into...`);
    this.loadEntities();
  }

  private async loadEntities(): Promise<void> {
    try {
      const index = await this.mcpClient.listEntities();
      const allEntities: McpEntityItem[] = [];
      for (const [key, value] of Object.entries(index)) {
        if (key === '_metadata') continue;
        if (Array.isArray(value)) {
          allEntities.push(...(value as McpEntityItem[]));
        }
      }
      this.entities = allEntities.filter(
        e => e.name.toLowerCase() !== this.sourceName.toLowerCase()
      );
      // Trigger re-render now that entities are loaded
      this.inputEl.dispatchEvent(new Event('input'));
    } catch {
      new Notice('Failed to load entities');
      this.close();
    }
  }

  getItems(): McpEntityItem[] {
    return this.entities;
  }

  getItemText(item: McpEntityItem): string {
    return item.name;
  }

  onChooseItem(item: McpEntityItem): void {
    this.mcpClient.absorbAsAlias(this.sourceName, item.path)
      .then(result => {
        if (result.success) {
          new Notice(`Absorbed "${this.sourceName}" into "${item.name}" (${result.backlinks_updated ?? 0} links updated)`);
        } else {
          new Notice(`Merge failed: ${result.message}`);
        }
      })
      .catch(err => {
        new Notice(`Error: ${err instanceof Error ? err.message : String(err)}`);
      });
  }
}
