/**
 * Flywheel Crank - Obsidian Plugin
 *
 * Graph intelligence & semantic search for your vault.
 * Embeds flywheel-memory's intelligence directly into Obsidian.
 */

import { Plugin, TFile, TAbstractFile, Notice, WorkspaceLeaf, setIcon } from 'obsidian';
import type { FlywheelCrankSettings, VaultIndex, EntityIndex } from './core/types';
import { DEFAULT_SETTINGS } from './core/types';
import { FlywheelCrankSettingTab } from './settings';
import Database from './db/sql-js-adapter';
import { DatabasePersistence } from './db/persistence';
import { initSchema } from './db/schema';
import { buildVaultIndex } from './index/vault-index';
import { scanVaultEntities } from './index/entities';
import { setFTS5Database, buildFTS5Index, indexSingleFile, removeFromIndex } from './index/fts5';
import {
  setEmbeddingsDatabase,
  setPluginDir,
  buildEmbeddingsIndex,
  buildEntityEmbeddingsIndex,
  loadEntityEmbeddingsToMemory,
  updateNoteEmbedding,
  removeNoteEmbedding,
  hasEmbeddingsIndex,
  getEmbeddingsCount,
} from './index/embeddings';
import { getAllEntitiesWithTypes } from './index/entities';
import { SearchModal } from './views/search-modal';
import { GraphSidebarView, GRAPH_VIEW_TYPE } from './views/graph-sidebar';
import { EntityBrowserView, ENTITY_BROWSER_VIEW_TYPE } from './views/entity-browser';
import { VaultHealthView, VAULT_HEALTH_VIEW_TYPE } from './views/vault-health';
import { WikilinkSuggest } from './suggest/wikilink-suggest';

export default class FlywheelCrankPlugin extends Plugin {
  settings: FlywheelCrankSettings = DEFAULT_SETTINGS;
  private database: Database | null = null;
  private persistence: DatabasePersistence | null = null;
  private vaultIndex: VaultIndex | null = null;
  private entityIndex: EntityIndex | null = null;
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
    this.setStatus('loading...', true);

    // Register views
    this.registerView(GRAPH_VIEW_TYPE, (leaf) => new GraphSidebarView(leaf));
    this.registerView(ENTITY_BROWSER_VIEW_TYPE, (leaf) => new EntityBrowserView(leaf));
    this.registerView(VAULT_HEALTH_VIEW_TYPE, (leaf) => new VaultHealthView(leaf));

    // Settings tab
    this.addSettingTab(new FlywheelCrankSettingTab(this.app, this));

    // Commands
    this.addCommand({
      id: 'search',
      name: 'Search vault',
      callback: () => new SearchModal(this.app).open(),
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
      id: 'rebuild-index',
      name: 'Rebuild index',
      callback: () => this.rebuildIndex(),
    });

    this.addCommand({
      id: 'init-semantic',
      name: 'Build semantic embeddings',
      callback: () => this.buildSemanticIndex(),
    });

    // Ribbon icons
    this.addRibbonIcon('search', 'Flywheel Search', () => {
      new SearchModal(this.app).open();
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

    // Register vault events for incremental updates
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          this.onFileChanged(file);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on('create', (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          this.onFileChanged(file);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        if (file instanceof TFile) {
          removeFromIndex(file.path);
          removeNoteEmbedding(file.path);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (file instanceof TFile && file.extension === 'md') {
          removeFromIndex(oldPath);
          removeNoteEmbedding(oldPath);
          this.onFileChanged(file);
        }
      })
    );

    // Update graph sidebar on active note change
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        this.updateGraphSidebar();
      })
    );
  }

  async onunload(): Promise<void> {
    console.log('Flywheel Crank: unloading plugin');

    // Save database before unload
    if (this.database && this.persistence) {
      try {
        await this.persistence.forceSave(() => this.database!.export());
      } catch (err) {
        console.error('Flywheel Crank: failed to save database on unload', err);
      }
    }

    if (this.database) {
      try { this.database.close(); } catch { /* ignore */ }
    }

    this.persistence?.destroy();
  }

  private async initialize(): Promise<void> {
    try {
      this.setStatus('initializing...', true);

      // Initialize SQL.js WASM engine + database
      await this.initDatabase();

      // Build indexes
      this.setStatus('indexing...', true);
      await this.buildAllIndexes();

      this.setStatus(`${this.vaultIndex?.notes.size ?? 0} notes`);
      new Notice('Flywheel Crank: Index built');
    } catch (err) {
      console.error('Flywheel Crank: initialization failed', err);
      this.setStatus('error');
      new Notice(`Flywheel Crank: ${err instanceof Error ? err.message : 'Init failed'}`);
    }
  }

  private async initDatabase(): Promise<void> {
    this.persistence = new DatabasePersistence(this.app);

    // Initialize the WASM engine
    try {
      const wasmBinary = await this.app.vault.adapter.readBinary(
        `${this.app.vault.configDir}/plugins/flywheel-crank/sql-wasm.wasm`
      );
      await Database.initialize(wasmBinary);
    } catch {
      // Fallback: let sql.js find the WASM file itself
      await Database.initialize();
    }

    // Load existing DB or create new
    const existingData = await this.persistence.load();
    if (existingData) {
      try {
        this.database = new Database(new Uint8Array(existingData));
        console.log('Flywheel Crank: loaded existing database');
      } catch {
        console.warn('Flywheel Crank: existing database corrupted, creating new');
        this.database = new Database();
      }
    } else {
      this.database = new Database();
    }

    // Initialize schema
    initSchema(this.database);

    // Set up FTS5 and embeddings modules
    setFTS5Database(this.database);
    setEmbeddingsDatabase(this.database);

    // Tell embeddings where to find node_modules (for @huggingface/transformers)
    const vaultBase = (this.app.vault.adapter as any).basePath;
    if (vaultBase && this.manifest.dir) {
      setPluginDir(vaultBase + '/' + this.manifest.dir);
    }

    // Load entity embeddings into memory if they exist
    loadEntityEmbeddingsToMemory();
  }

  private async buildAllIndexes(): Promise<void> {
    this.indexing = true;

    try {
      // Build vault index from MetadataCache
      this.vaultIndex = buildVaultIndex(this.app);

      // Scan entities
      this.entityIndex = scanVaultEntities(this.app, {
        excludeFolders: this.settings.excludeFolders,
      });

      // Enrich entities with hub scores from vault index
      if (this.vaultIndex && this.entityIndex) {
        this.enrichHubScores();
      }

      // Update wikilink suggest
      if (this.wikilinkSuggest && this.entityIndex) {
        this.wikilinkSuggest.setEntityIndex(this.entityIndex);
      }

      // Build FTS5 index
      await buildFTS5Index(this.app);

      // Update all views
      this.updateAllViews();

      // Save database
      this.scheduleDatabaseSave();
    } finally {
      this.indexing = false;
    }
  }

  /**
   * Enrich entity hub scores from vault index backlinks
   */
  private enrichHubScores(): void {
    if (!this.vaultIndex || !this.entityIndex) return;

    const categories = [
      'technologies', 'acronyms', 'people', 'projects',
      'organizations', 'locations', 'concepts', 'other',
    ] as const;

    for (const cat of categories) {
      for (const entity of this.entityIndex[cat]) {
        if (typeof entity === 'string') continue;
        const note = this.vaultIndex.notes.get(entity.path);
        if (note) {
          const backlinks = this.vaultIndex.backlinks.get(
            entity.path.toLowerCase().replace(/\.md$/, '')
          );
          entity.hubScore = backlinks?.length ?? 0;
        }
      }
    }
  }

  private onFileChanged(file: TFile): void {
    // Incremental FTS5 update
    indexSingleFile(this.app, file);
    // Incremental embedding update (no-op if model not loaded)
    updateNoteEmbedding(this.app, file);
    this.scheduleDatabaseSave();
  }

  private scheduleDatabaseSave(): void {
    if (this.database && this.persistence) {
      this.persistence.scheduleSave(() => this.database!.export());
    }
  }

  private updateGraphSidebar(): void {
    const leaves = this.app.workspace.getLeavesOfType(GRAPH_VIEW_TYPE);
    for (const leaf of leaves) {
      const view = leaf.view as GraphSidebarView;
      if (this.vaultIndex) {
        view.setIndex(this.vaultIndex);
      }
    }
  }

  private updateAllViews(): void {
    // Graph sidebar
    this.updateGraphSidebar();

    // Entity browser
    const entityLeaves = this.app.workspace.getLeavesOfType(ENTITY_BROWSER_VIEW_TYPE);
    for (const leaf of entityLeaves) {
      const view = leaf.view as EntityBrowserView;
      if (this.entityIndex) view.setEntityIndex(this.entityIndex);
    }

    // Vault health
    const healthLeaves = this.app.workspace.getLeavesOfType(VAULT_HEALTH_VIEW_TYPE);
    for (const leaf of healthLeaves) {
      const view = leaf.view as VaultHealthView;
      if (this.vaultIndex) view.setData(this.vaultIndex, this.entityIndex);
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

      // Set data on the view
      if (viewType === GRAPH_VIEW_TYPE && this.vaultIndex) {
        (leaf.view as GraphSidebarView).setIndex(this.vaultIndex);
      } else if (viewType === ENTITY_BROWSER_VIEW_TYPE && this.entityIndex) {
        (leaf.view as EntityBrowserView).setEntityIndex(this.entityIndex);
      } else if (viewType === VAULT_HEALTH_VIEW_TYPE && this.vaultIndex) {
        (leaf.view as VaultHealthView).setData(this.vaultIndex, this.entityIndex);
      }
    }
  }

  private async buildSemanticIndex(): Promise<void> {
    if (this.indexing) {
      new Notice('Flywheel Crank: Already indexing...');
      return;
    }

    this.indexing = true;
    new Notice('Flywheel Crank: Building semantic embeddings... (downloading model on first run)');
    this.setStatus('embedding...', true);

    try {
      // Build note embeddings
      const progress = await buildEmbeddingsIndex(this.app, (p) => {
        this.setStatus(`embedding ${p.current}/${p.total}...`, true);
      });

      // Build entity embeddings
      if (this.entityIndex) {
        const entityMap = new Map<string, { name: string; path: string; category: string; aliases: string[] }>();
        for (const { entity, category } of getAllEntitiesWithTypes(this.entityIndex)) {
          entityMap.set(entity.name, {
            name: entity.name,
            path: entity.path,
            category,
            aliases: entity.aliases,
          });
        }
        await buildEntityEmbeddingsIndex(this.app, entityMap);
        loadEntityEmbeddingsToMemory();
      }

      this.scheduleDatabaseSave();

      const embedded = progress.total - progress.skipped;
      this.setStatus(`${this.vaultIndex?.notes.size ?? 0} notes | ${embedded} embedded`);
      new Notice(`Flywheel Crank: Semantic index built (${embedded} notes embedded)`);
    } catch (err) {
      this.setStatus('embedding error');
      new Notice(`Flywheel Crank: ${err instanceof Error ? err.message : 'Embedding failed'}`);
      console.error('Flywheel Crank: semantic build failed', err);
    } finally {
      this.indexing = false;
    }
  }

  private async rebuildIndex(): Promise<void> {
    if (this.indexing) {
      new Notice('Flywheel Crank: Already indexing...');
      return;
    }

    new Notice('Flywheel Crank: Rebuilding index...');
    this.setStatus('rebuilding...', true);

    try {
      await this.buildAllIndexes();
      this.setStatus(`${this.vaultIndex?.notes.size ?? 0} notes`);
      new Notice('Flywheel Crank: Index rebuilt');
    } catch (err) {
      this.setStatus('error');
      new Notice(`Flywheel Crank: ${err instanceof Error ? err.message : 'Rebuild failed'}`);
    }
  }

  private setStatus(text: string, active = false): void {
    if (!this.statusBarEl) return;
    this.statusBarEl.empty();
    const icon = this.statusBarEl.createSpan('flywheel-status-icon');
    setIcon(icon, 'refresh-cw');
    if (active) {
      icon.addClass('flywheel-status-spin');
    }
    this.statusBarEl.createSpan().setText(` ${text}`);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
