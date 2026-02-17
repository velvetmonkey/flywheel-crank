/**
 * Graph Sidebar View — powered by flywheel-memory MCP
 *
 * Collapsible sections: Vault Info (always), Backlinks, Forward Links,
 * Related Notes (when a note is active). All data from MCP tool calls.
 */

import { ItemView, WorkspaceLeaf, TFile, setIcon } from 'obsidian';
import type {
  FlywheelMcpClient,
  McpBacklinksResponse,
  McpForwardLinksResponse,
  McpSuggestWikilinksResponse,
  McpSimilarResponse,
  McpHealthCheckResponse,
} from '../mcp/client';

export const GRAPH_VIEW_TYPE = 'flywheel-graph';

export class GraphSidebarView extends ItemView {
  private mcpClient: FlywheelMcpClient;
  private contentContainer!: HTMLDivElement;
  /** Vault-level sections (Vault Info, Stats, etc.) — rendered once, persist across note changes. */
  private vaultContainer!: HTMLDivElement;
  /** Note-level sections (Backlinks, Forward Links, etc.) — refreshed on active note change. */
  private noteContainer!: HTMLDivElement;
  private currentNotePath: string | null = null;
  private vaultSectionsRendered = false;
  /** Folder prefixes for periodic notes (daily-notes/, weekly-notes/, etc.) */
  private periodicPrefixes: string[] = [];
  /** Remember collapsed state per section title across note changes */
  private sectionCollapsed = new Map<string, boolean>();

  constructor(leaf: WorkspaceLeaf, mcpClient: FlywheelMcpClient) {
    super(leaf);
    this.mcpClient = mcpClient;
  }

  getViewType(): string {
    return GRAPH_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Flywheel Graph';
  }

  getIcon(): string {
    return 'git-fork';
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('flywheel-graph-sidebar');

    this.contentContainer = container.createDiv('flywheel-graph-content');
    this.noteContainer = this.contentContainer.createDiv();
    this.vaultContainer = this.contentContainer.createDiv();
    this.refresh();
  }

  refresh(force = false): void {
    const activeFile = this.app.workspace.getActiveFile();
    const newPath = activeFile?.path ?? null;

    // Skip refresh if the active note hasn't changed (avoids redundant MCP calls)
    if (!force && newPath === this.currentNotePath && this.noteContainer.childElementCount > 0) {
      return;
    }
    this.currentNotePath = newPath;

    if (!this.mcpClient.connected) {
      this.showSplash('Connecting to flywheel-memory...');
      return;
    }

    // Show splash while index builds, then render everything once ready
    if (!this.vaultSectionsRendered || force) {
      this.showSplash('Syncing vault index...');
      this.waitForIndexThenRender(activeFile, force);
      return;
    }

    // Note sections: always refresh on note change
    this.noteContainer.empty();
    if (activeFile) {
      this.renderNoteHeader(activeFile);
      this.renderNoteSections(activeFile);
    }
  }

  private showSplash(message: string): void {
    this.vaultContainer.empty();
    this.noteContainer.empty();
    this.vaultSectionsRendered = false;

    const empty = this.vaultContainer.createDiv('flywheel-graph-empty');
    const imgPath = `${this.app.vault.configDir}/plugins/flywheel-crank/flywheel.png`;
    const imgEl = empty.createEl('img', { cls: 'flywheel-graph-logo' });
    imgEl.src = this.app.vault.adapter.getResourcePath(imgPath);
    imgEl.alt = 'Flywheel';
    empty.createDiv('flywheel-graph-empty-text').setText(message);
  }

  private async waitForIndexThenRender(activeFile: TFile | null, force: boolean): Promise<void> {
    try {
      await this.mcpClient.waitForIndex();
    } catch {
      // Timed out — render what we can anyway
    }

    // Render vault overview
    this.vaultContainer.empty();
    this.vaultSectionsRendered = true;
    this.renderVaultOverview();

    // Render note sections
    this.noteContainer.empty();
    if (activeFile) {
      this.renderNoteHeader(activeFile);
      this.renderNoteSections(activeFile);
    }
  }

  // ---------------------------------------------------------------------------
  // Vault Overview section (merged Vault Info + Vault Stats)
  // ---------------------------------------------------------------------------

  private async renderVaultOverview(): Promise<void> {
    const section = this.renderSection('Vault Overview', 'info', undefined, (container) => {
      container.createDiv('flywheel-graph-info-row')
        .createSpan('flywheel-graph-info-value').setText('loading...');
    }, true, this.vaultContainer);

    this.populateVaultOverview(section);
  }

  private async populateVaultOverview(section: HTMLDivElement): Promise<void> {
    if (!section.isConnected) return;

    try {
      const health = await this.mcpClient.healthCheck();
      const content = section.querySelector('.flywheel-graph-section-content') as HTMLDivElement;
      if (!content) return;
      content.empty();

      // Counts row with status on the right
      const countsRow = content.createDiv('flywheel-graph-counts-row');
      this.renderCountBadge(countsRow, 'file-text', String(health.note_count), 'notes');
      this.renderCountBadge(countsRow, 'users', String(health.entity_count), 'entities');
      this.renderCountBadge(countsRow, 'tag', String(health.tag_count), 'tags');

      // Status indicator on right of counts row
      const statusEl = countsRow.createSpan('flywheel-graph-counts-status');
      if (health.index_state === 'building') {
        const icon = statusEl.createSpan('flywheel-graph-status-icon');
        setIcon(icon, 'loader');
        icon.addClass('flywheel-status-spin');
        const progress = (health as any).index_progress;
        if (progress?.total > 0) {
          statusEl.createSpan().setText(` ${progress.parsed}/${progress.total}`);
        } else {
          statusEl.createSpan().setText(' syncing');
        }
      } else {
        const icon = statusEl.createSpan('flywheel-graph-status-icon flywheel-graph-status-ok');
        setIcon(icon, 'check-circle');
        const age = health.index_age_seconds >= 0 ? this.formatAge(health.index_age_seconds) : '—';
        statusEl.createSpan().setText(` indexed ${age} ago`);
      }

      // Periodic note locations + templates from inferred config — behind toggle
      if (health.config && Object.keys(health.config).length > 0) {
        const cfg = health.config as Record<string, any>;
        const paths = cfg.paths as Record<string, string> | undefined;
        const templates = cfg.templates as Record<string, string> | undefined;
        const hasConfig = (paths && Object.keys(paths).length > 0) ||
          (templates && Object.keys(templates).length > 0);

        // Store periodic folder prefixes for cloud splitting
        if (paths) {
          this.periodicPrefixes = Object.values(paths)
            .filter((p): p is string => !!p)
            .map(p => p.endsWith('/') ? p : `${p}/`);
        }

        if (hasConfig) {
          const configToggle = content.createDiv('flywheel-graph-more');
          configToggle.setText('+ vault config');
          const configGroup = content.createDiv('flywheel-graph-info-group flywheel-graph-details-hidden');

          if (paths && Object.keys(paths).length > 0) {
            const periodicGroup = configGroup.createDiv('flywheel-graph-info-group');
            periodicGroup.createDiv('flywheel-graph-info-group-label').setText('Periodic Locations');
            const labels: Record<string, string> = {
              daily_notes: 'Daily', weekly_notes: 'Weekly', monthly_notes: 'Monthly',
              quarterly_notes: 'Quarterly', yearly_notes: 'Yearly', templates: 'Templates',
            };
            for (const [key, path] of Object.entries(paths)) {
              if (path) this.renderInfoRow(periodicGroup, labels[key] ?? key, path);
            }
          }

          if (templates && Object.keys(templates).length > 0) {
            const tplGroup = configGroup.createDiv('flywheel-graph-info-group');
            tplGroup.createDiv('flywheel-graph-info-group-label').setText('Templates');
            const tplLabels: Record<string, string> = {
              daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly',
              quarterly: 'Quarterly', yearly: 'Yearly',
            };
            for (const [key, path] of Object.entries(templates)) {
              if (path) this.renderInfoRow(tplGroup, tplLabels[key] ?? key, path);
            }
          }

          configToggle.addEventListener('click', () => {
            if (configGroup.hasClass('flywheel-graph-details-hidden')) {
              configGroup.removeClass('flywheel-graph-details-hidden');
              configToggle.setText('- vault config');
            } else {
              configGroup.addClass('flywheel-graph-details-hidden');
              configToggle.setText('+ vault config');
            }
          });
        }
      }

      // Lazy "more" toggle — loads vault stats on first expand
      let statsLoaded = false;
      const moreToggle = content.createDiv('flywheel-graph-more');
      moreToggle.setText('+ vault stats');
      const statsGroup = content.createDiv('flywheel-graph-info-group flywheel-graph-details-hidden');

      moreToggle.addEventListener('click', async () => {
        if (statsLoaded) {
          // Toggle visibility
          if (statsGroup.hasClass('flywheel-graph-details-hidden')) {
            statsGroup.removeClass('flywheel-graph-details-hidden');
            moreToggle.setText('- vault stats');
          } else {
            statsGroup.addClass('flywheel-graph-details-hidden');
            moreToggle.setText('+ vault stats');
          }
          return;
        }

        statsLoaded = true;
        statsGroup.removeClass('flywheel-graph-details-hidden');
        moreToggle.setText('- vault stats');
        statsGroup.createDiv('flywheel-graph-section-empty').setText('loading...');

        try {
          await this.mcpClient.waitForIndex();
          const stats = await this.mcpClient.vaultStats();
          statsGroup.empty();

          this.renderInfoRow(statsGroup, 'Avg links/note', stats.average_links_per_note.toFixed(1));
          if (stats.orphan_notes.total > 0) {
            this.renderInfoRow(statsGroup, 'Orphans', `${stats.orphan_notes.content} content, ${stats.orphan_notes.periodic} periodic`);
          }

          // Most linked notes
          if (stats.most_linked_notes.length > 0) {
            const hubGroup = statsGroup.createDiv('flywheel-graph-info-group');
            hubGroup.createDiv('flywheel-graph-info-group-label').setText('Most Linked');
            for (const note of stats.most_linked_notes.slice(0, 5)) {
              const name = note.path.replace(/\.md$/, '').split('/').pop() || note.path;
              this.renderInfoRow(hubGroup, name, `${note.backlinks}`);
            }
          }

          // Top tags
          if (stats.top_tags.length > 0) {
            const tagGroup = statsGroup.createDiv('flywheel-graph-info-group');
            tagGroup.createDiv('flywheel-graph-info-group-label').setText('Top Tags');
            for (const tag of stats.top_tags.slice(0, 5)) {
              this.renderInfoRow(tagGroup, tag.tag, String(tag.count));
            }
          }
        } catch (err) {
          statsGroup.empty();
          statsGroup.createDiv('flywheel-graph-section-empty')
            .setText(err instanceof Error ? err.message : 'Failed to load stats');
        }
      });

      // Technical details — hidden behind toggle
      const detailsToggle = content.createDiv('flywheel-graph-more');
      detailsToggle.setText('+ technical details');
      const detailsGroup = content.createDiv('flywheel-graph-info-group flywheel-graph-details-hidden');

      // Index statuses sub-group
      const indexGroup = detailsGroup.createDiv('flywheel-graph-info-group');
      indexGroup.createDiv('flywheel-graph-info-group-label').setText('Indexes');

      const graphStatus = health.index_state === 'ready'
        ? `ready · ${health.note_count} notes`
        : health.index_state === 'building' ? 'building...' : 'error';
      this.renderInfoRow(indexGroup, 'Graph index', graphStatus);

      const fts5Status = health.fts5_building
        ? 'building...'
        : health.fts5_ready ? 'ready · full-text with stemming' : 'not built';
      this.renderInfoRow(indexGroup, 'Keyword search', fts5Status);

      const semanticStatus = health.embeddings_building
        ? 'building...'
        : health.embeddings_ready
          ? `ready · ${health.embeddings_count} embeddings`
          : 'not built';
      this.renderInfoRow(indexGroup, 'Semantic search', semanticStatus);

      // Server info sub-group
      const serverGroup = detailsGroup.createDiv('flywheel-graph-info-group');
      serverGroup.createDiv('flywheel-graph-info-group-label').setText('Server');
      this.renderInfoRow(serverGroup, 'Vault path', health.vault_path);
      this.renderInfoRow(serverGroup, 'StateDb', `${health.vault_path}/.flywheel/state.db`);
      if (health.schema_version) {
        this.renderInfoRow(serverGroup, 'Schema', `v${health.schema_version}`);
      }
      this.renderInfoRow(serverGroup, 'MCP', 'connected (stdio)');

      detailsToggle.addEventListener('click', () => {
        if (detailsGroup.hasClass('flywheel-graph-details-hidden')) {
          detailsGroup.removeClass('flywheel-graph-details-hidden');
          detailsToggle.setText('- technical details');
        } else {
          detailsGroup.addClass('flywheel-graph-details-hidden');
          detailsToggle.setText('+ technical details');
        }
      });

      // Update count badge
      const countEl = section.querySelector('.flywheel-graph-section-count') as HTMLElement;
      if (countEl) countEl.setText(`${health.note_count}`);

      // Keep polling while any index is building or config not yet inferred
      const configMissing = !health.config || Object.keys(health.config).length === 0;
      const stillBuilding = health.index_state === 'building' || health.fts5_building || health.embeddings_building || configMissing;
      if (stillBuilding) {
        const delay = health.index_state === 'building' ? 5000 : 3000;
        setTimeout(() => this.populateVaultOverview(section), delay);
      }
    } catch (err) {
      const content = section.querySelector('.flywheel-graph-section-content') as HTMLDivElement;
      if (content) {
        content.empty();
        this.renderInfoRow(content, 'Error', err instanceof Error ? err.message : 'Failed to load');
      }
    }
  }

  /** Format seconds into a human-readable age string. */
  private formatAge(seconds: number): string {
    if (seconds < 0) return 'unknown';
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  private renderCountBadge(container: HTMLDivElement, icon: string, count: string, label: string): void {
    const badge = container.createDiv('flywheel-graph-count-badge');
    const iconEl = badge.createSpan('flywheel-graph-count-icon');
    setIcon(iconEl, icon);
    badge.createSpan('flywheel-graph-count-num').setText(count);
    badge.createSpan('flywheel-graph-count-label').setText(label);
  }

  private renderInfoRow(container: HTMLDivElement, label: string, value: string): void {
    const row = container.createDiv('flywheel-graph-info-row');
    row.createSpan('flywheel-graph-info-label').setText(label);
    row.createSpan('flywheel-graph-info-value').setText(value);
  }

  /** Render folder conventions inline within a folder detail panel. */
  private renderFolderConventionsInline(
    container: HTMLDivElement,
    conv: import('../mcp/client').McpFolderConventionsResponse,
  ): void {
    // Coverage + naming pattern
    const summaryRow = container.createDiv('flywheel-graph-info-row');
    summaryRow.createSpan('flywheel-graph-info-label').setText('Coverage');
    summaryRow.createSpan('flywheel-graph-info-value').setText(`${Math.round(conv.coverage * 100)}%`);

    if (conv.naming_pattern) {
      const patRow = container.createDiv('flywheel-graph-info-row');
      patRow.createSpan('flywheel-graph-info-label').setText('Naming');
      patRow.createSpan('flywheel-graph-info-value').setText(conv.naming_pattern);
    }

    const NOISE_FIELDS = new Set(['word_count', 'link_count']);

    // Inferred fields (top by frequency)
    const fields = conv.inferred_fields
      .filter(f => f.frequency >= 0.2 && !NOISE_FIELDS.has(f.name))
      .sort((a, b) => b.frequency - a.frequency);

    if (fields.length > 0) {
      container.createDiv('flywheel-graph-info-group-label').setText('Inferred Fields');
      for (const field of fields.slice(0, 8)) {
        const row = container.createDiv('flywheel-graph-schema-field');
        const header = row.createDiv('flywheel-graph-schema-field-header');
        const iconEl = header.createSpan('flywheel-graph-schema-field-icon');
        setIcon(iconEl, 'hash');
        header.createSpan('flywheel-graph-schema-field-name').setText(field.name);
        const pct = Math.round(field.frequency * 100);
        header.createSpan('flywheel-graph-schema-field-meta')
          .setText(`${field.inferred_type} · ${pct}%`);

        if (field.common_values && field.common_values.length > 0) {
          const vals = field.common_values
            .slice(0, 4)
            .map(v => typeof v === 'string' ? v : JSON.stringify(v))
            .join(' · ');
          row.createDiv('flywheel-graph-schema-field-examples').setText(vals);
        }
      }
    }

    // Computed field suggestions
    const suggestions = (conv.computed_field_suggestions ?? []).filter(s => !NOISE_FIELDS.has(s.name));
    if (suggestions.length > 0) {
      container.createDiv('flywheel-graph-info-group-label').setText('Suggested Fields');
      for (const sug of suggestions) {
        const row = container.createDiv('flywheel-graph-info-row');
        row.createSpan('flywheel-graph-info-label').setText(sug.name);
        const desc = sug.sample_value
          ? `${sug.description} (e.g. ${JSON.stringify(sug.sample_value)})`
          : sug.description;
        row.createSpan('flywheel-graph-info-value').setText(desc);
      }
    }

    if (fields.length === 0 && (!conv.computed_field_suggestions || conv.computed_field_suggestions.length === 0) && !conv.naming_pattern) {
      container.createDiv('flywheel-graph-section-empty').setText('No conventions detected');
    }
  }

  // ---------------------------------------------------------------------------
  // Folder section (merged folder conventions + browse all folders)
  // ---------------------------------------------------------------------------

  private async renderFolderSection(file: TFile): Promise<void> {
    const folder = file.path.split('/').slice(0, -1).join('/') || '';
    const folderLabel = folder || '(root)';

    const section = this.renderSection(`Folder: ${folderLabel}`, 'folder', undefined, (container) => {
      container.createDiv('flywheel-graph-section-empty').setText('loading...');
    }, true, undefined, 'Folder');

    try {
      await this.mcpClient.waitForIndex();
      const conv = await this.mcpClient.folderConventions(folder);
      const content = section.querySelector('.flywheel-graph-section-content') as HTMLDivElement;
      if (!content) return;
      content.empty();

      // Get current note's frontmatter
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter ?? {};

      const NOISE_FIELDS = new Set(['word_count', 'link_count']);

      // Build a map of all inferred fields
      const fieldMap = new Map(conv.inferred_fields.filter(f => !NOISE_FIELDS.has(f.name)).map(f => [f.name, f]));

      // Collect all field names: those in this note + those expected by the folder
      const allFieldNames = new Set<string>();
      for (const key of Object.keys(fm)) {
        if (key !== 'position' && !NOISE_FIELDS.has(key)) allFieldNames.add(key);
      }
      for (const f of conv.inferred_fields) {
        if (!NOISE_FIELDS.has(f.name)) allFieldNames.add(f.name);
      }

      if (allFieldNames.size === 0) {
        content.createDiv('flywheel-graph-section-empty').setText('No frontmatter');
      } else {
        let missingCount = 0;

        // Sort: present first, then missing; within each group by frequency desc
        const sortedNames = [...allFieldNames].sort((a, b) => {
          const aHas = a in fm ? 0 : 1;
          const bHas = b in fm ? 0 : 1;
          if (aHas !== bHas) return aHas - bHas;
          const aFreq = fieldMap.get(a)?.frequency ?? 0;
          const bFreq = fieldMap.get(b)?.frequency ?? 0;
          return bFreq - aFreq;
        });

        for (const name of sortedNames) {
          const hasField = name in fm;
          const inferred = fieldMap.get(name);
          if (!hasField && (!inferred || inferred.frequency < 0.3)) continue;
          if (!hasField) missingCount++;

          const row = content.createDiv('flywheel-graph-schema-field');
          if (!hasField) row.addClass('flywheel-graph-schema-field-missing');

          const nameRow = row.createDiv('flywheel-graph-schema-field-header');
          const iconEl = nameRow.createSpan('flywheel-graph-schema-field-icon');
          setIcon(iconEl, hasField ? 'check-circle' : 'circle');
          nameRow.createSpan('flywheel-graph-schema-field-name').setText(name);

          if (inferred) {
            const pct = Math.round(inferred.frequency * 100);
            nameRow.createSpan('flywheel-graph-schema-field-meta').setText(
              `${inferred.inferred_type} · ${pct}%`
            );
          }

          if (hasField) {
            const val = fm[name];
            const valStr = Array.isArray(val) ? val.join(', ') : String(val ?? '');
            if (valStr) {
              row.createDiv('flywheel-graph-schema-field-value').setText(valStr);
            }
          } else if (inferred?.common_values && inferred.common_values.length > 0) {
            const values = inferred.common_values
              .slice(0, 5)
              .map(v => typeof v === 'string' ? v : JSON.stringify(v))
              .join(' · ');
            row.createDiv('flywheel-graph-schema-field-examples').setText(values);
          }
        }

        const countEl = section.querySelector('.flywheel-graph-section-count') as HTMLElement;
        if (countEl) {
          if (missingCount > 0) {
            countEl.setText(`${missingCount} missing`);
            countEl.addClass('flywheel-graph-section-count-warn');
          } else {
            countEl.setText('complete');
          }
        }
      }

      // Browse all folders toggle
      let browseFoldersLoaded = false;
      const browseToggle = content.createDiv('flywheel-graph-more');
      browseToggle.setText('+ browse all folders');
      const browseGroup = content.createDiv('flywheel-graph-info-group flywheel-graph-details-hidden');

      browseToggle.addEventListener('click', async () => {
        if (browseFoldersLoaded) {
          if (browseGroup.hasClass('flywheel-graph-details-hidden')) {
            browseGroup.removeClass('flywheel-graph-details-hidden');
            browseToggle.setText('- browse all folders');
          } else {
            browseGroup.addClass('flywheel-graph-details-hidden');
            browseToggle.setText('+ browse all folders');
          }
          return;
        }

        browseFoldersLoaded = true;
        browseGroup.removeClass('flywheel-graph-details-hidden');
        browseToggle.setText('- browse all folders');
        browseGroup.createDiv('flywheel-graph-section-empty').setText('loading...');

        try {
          const result = await this.mcpClient.folderStructure();
          browseGroup.empty();

          if (result.folders.length === 0) {
            browseGroup.createDiv('flywheel-graph-section-empty').setText('No folders');
            return;
          }

          const sorted = [...result.folders].sort((a, b) => b.note_count - a.note_count);

          const renderFolderRow = (f: { path: string; note_count: number; subfolder_count: number }) => {
            const wrapper = browseGroup.createDiv('flywheel-graph-folder-item');
            const row = wrapper.createDiv('flywheel-graph-folder-row');
            const chevron = row.createSpan('flywheel-graph-folder-chevron');
            setIcon(chevron, 'chevron-right');
            row.createSpan('flywheel-graph-folder-name').setText(f.path || '(root)');
            const meta = row.createSpan('flywheel-graph-folder-meta');
            meta.setText(f.subfolder_count > 0
              ? `${f.note_count} · ${f.subfolder_count} sub`
              : `${f.note_count}`);

            let expanded = false;
            row.addEventListener('click', async () => {
              if (expanded) {
                expanded = false;
                chevron.empty();
                setIcon(chevron, 'chevron-right');
                wrapper.querySelector('.flywheel-graph-folder-detail')?.remove();
                return;
              }
              expanded = true;
              chevron.empty();
              setIcon(chevron, 'chevron-down');
              const detail = wrapper.createDiv('flywheel-graph-folder-detail');
              detail.createDiv('flywheel-graph-section-empty').setText('loading...');
              try {
                const fConv = await this.mcpClient.folderConventions(f.path);
                detail.empty();
                this.renderFolderConventionsInline(detail, fConv);
              } catch (err) {
                detail.empty();
                detail.createDiv('flywheel-graph-section-empty')
                  .setText(err instanceof Error ? err.message : 'Failed to load');
              }
            });
          };

          for (const f of sorted.slice(0, 20)) {
            renderFolderRow(f);
          }

          if (sorted.length > 20) {
            const moreEl = browseGroup.createDiv('flywheel-graph-more');
            moreEl.setText(`+ ${sorted.length - 20} more folders`);
            moreEl.addEventListener('click', () => {
              moreEl.remove();
              for (const f of sorted.slice(20)) {
                renderFolderRow(f);
              }
            });
          }
        } catch (err) {
          browseGroup.empty();
          browseGroup.createDiv('flywheel-graph-section-empty')
            .setText(err instanceof Error ? err.message : 'Failed to load folders');
        }
      });
    } catch (err) {
      const content = section.querySelector('.flywheel-graph-section-content') as HTMLDivElement;
      if (content) {
        content.empty();
        this.renderInfoRow(content, 'Error', err instanceof Error ? err.message : 'Failed to load');
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Note header + sections
  // ---------------------------------------------------------------------------

  private renderNoteHeader(file: TFile): void {
    const header = this.noteContainer.createDiv('flywheel-graph-header');
    header.createDiv('flywheel-graph-note-title').setText(file.basename);
  }

  private async renderNoteSections(file: TFile): Promise<void> {
    const notePath = file.path;

    try {
      // Wait for the server index before calling graph tools
      await this.mcpClient.waitForIndex();

      const noteContent = await this.app.vault.cachedRead(file);
      const [backlinksResp, forwardLinksResp, suggestResp, similarResp, health, semanticResp] = await Promise.all([
        this.mcpClient.getBacklinks(notePath),
        this.mcpClient.getForwardLinks(notePath),
        this.mcpClient.suggestWikilinks(noteContent, true).catch(() => null),
        this.mcpClient.findSimilar(notePath, 15).catch(() => null),
        this.mcpClient.healthCheck().catch(() => null),
        this.mcpClient.noteIntelligence(notePath, 'semantic_links').catch(() => null),
      ]);

      // Ensure periodic prefixes are set for cloud splitting
      if (this.periodicPrefixes.length === 0 && health?.config) {
        const paths = (health.config as Record<string, any>).paths as Record<string, string> | undefined;
        if (paths) {
          this.periodicPrefixes = Object.values(paths)
            .filter((p): p is string => !!p)
            .map(p => p.endsWith('/') ? p : `${p}/`);
        }
      }

      // Deduplicate forward links by resolved path (or target for dead links)
      const seen = new Set<string>();
      const uniqueLinks = forwardLinksResp.forward_links.filter(link => {
        const key = link.resolved_path ?? link.target;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Context Cloud (rendered first) — unified view of all related notes
      this.renderContextCloud(backlinksResp, forwardLinksResp, suggestResp, similarResp, semanticResp);

      // Folder section (before links)
      this.renderFolderSection(file);

      const MAX_ITEMS = 5;

      // Backlinks section — group by source, sorted by mention count desc
      const blGrouped = new Map<string, { source: string; count: number; lines: number[]; context?: string }>();
      for (const bl of backlinksResp.backlinks) {
        const existing = blGrouped.get(bl.source);
        if (existing) {
          existing.count++;
          existing.lines.push(bl.line);
          if (!existing.context && bl.context) existing.context = bl.context;
        } else {
          blGrouped.set(bl.source, { source: bl.source, count: 1, lines: [bl.line], context: bl.context });
        }
      }
      const blSorted = [...blGrouped.values()].sort((a, b) => b.count - a.count);
      const uniqueBacklinks = blSorted.length;

      this.renderSection('Backlinks', 'arrow-left', uniqueBacklinks, (container) => {
        if (blSorted.length === 0) {
          container.createDiv('flywheel-graph-section-empty').setText('No backlinks');
          return;
        }

        const visible = blSorted.slice(0, MAX_ITEMS);
        for (const bl of visible) {
          this.renderBacklinkGrouped(container, bl);
        }

        const remaining = blSorted.length - visible.length;
        if (remaining > 0) {
          this.renderShowMore(container, remaining, blSorted.slice(MAX_ITEMS), (bl) => {
            this.renderBacklinkGrouped(container, bl);
          });
        }
      }, true);

      // Forward links section
      this.renderSection('Forward Links', 'arrow-right', uniqueLinks.length, (container) => {
        if (uniqueLinks.length === 0) {
          container.createDiv('flywheel-graph-section-empty').setText('No outgoing links');
          return;
        }

        const visible = uniqueLinks.slice(0, MAX_ITEMS);
        for (const link of visible) {
          this.renderForwardLink(container, link);
        }

        const remaining = uniqueLinks.length - visible.length;
        if (remaining > 0) {
          this.renderShowMore(container, remaining, uniqueLinks.slice(MAX_ITEMS), (link) => {
            this.renderForwardLink(container, link);
          });
        }
      }, true);

      // Note Intelligence (lazy-loaded) — structural analysis, not related notes
      this.renderNoteIntelligence(file);
    } catch (err) {
      console.error('Flywheel Crank: graph sidebar error', err);
    }
  }

  private renderBacklink(container: HTMLDivElement, bl: { source: string; line: number; context?: string }): void {
    const item = container.createDiv('flywheel-graph-link-item');
    item.addEventListener('click', () => this.app.workspace.openLinkText(bl.source, '', false));

    const title = bl.source.replace(/\.md$/, '').split('/').pop() || bl.source;
    const nameRow = item.createDiv('flywheel-graph-link-name-row');
    nameRow.createSpan('flywheel-graph-link-name').setText(title);
    nameRow.createSpan('flywheel-graph-link-line').setText(`L${bl.line}`);

    const folder = bl.source.split('/').slice(0, -1).join('/');
    if (folder) item.createDiv('flywheel-graph-link-path').setText(folder);

    if (bl.context) {
      const snippetEl = item.createDiv('flywheel-graph-link-snippet');
      snippetEl.setText(bl.context);
    }
  }

  private renderBacklinkGrouped(
    container: HTMLDivElement,
    bl: { source: string; count: number; lines: number[]; context?: string },
  ): void {
    const item = container.createDiv('flywheel-graph-link-item');
    item.addEventListener('click', () => this.app.workspace.openLinkText(bl.source, '', false));

    const title = bl.source.replace(/\.md$/, '').split('/').pop() || bl.source;
    const nameRow = item.createDiv('flywheel-graph-link-name-row');
    nameRow.createSpan('flywheel-graph-link-name').setText(title);
    if (bl.count > 1) {
      nameRow.createSpan('flywheel-graph-score-badge').setText(`${bl.count}x`);
    }
    nameRow.createSpan('flywheel-graph-link-line').setText(
      bl.lines.length <= 3
        ? bl.lines.map(l => `L${l}`).join(', ')
        : `L${bl.lines[0]}, +${bl.lines.length - 1} more`,
    );

    const folder = bl.source.split('/').slice(0, -1).join('/');
    if (folder) item.createDiv('flywheel-graph-link-path').setText(folder);

    if (bl.context) {
      item.createDiv('flywheel-graph-link-snippet').setText(bl.context);
    }
  }

  private renderForwardLink(container: HTMLDivElement, link: { target: string; exists: boolean; resolved_path?: string }): void {
    const item = container.createDiv('flywheel-graph-link-item');
    if (link.exists && link.resolved_path) {
      item.addEventListener('click', () => this.app.workspace.openLinkText(link.resolved_path!, '', false));
    } else {
      item.addClass('flywheel-graph-dead-link');
      item.setAttribute('aria-label',
        `"${link.target}" doesn't exist yet.\n\n` +
        'Flywheel tracks dead links as signals:\n' +
        '• graph_analysis dead_ends mode surfaces these\n' +
        '• They lower the linking note\'s graph health score\n' +
        '• Creating this note would strengthen the graph\n' +
        '• suggest_wikilinks avoids suggesting dead targets'
      );
      item.addClass('has-tooltip');
    }
    item.createDiv('flywheel-graph-link-name').setText(link.target);

    if (link.exists && link.resolved_path) {
      const folder = link.resolved_path.split('/').slice(0, -1).join('/');
      if (folder) item.createDiv('flywheel-graph-link-path').setText(folder);
    } else if (!link.exists) {
      item.createDiv('flywheel-graph-badge flywheel-graph-badge-dead').setText('missing');
      item.createDiv('flywheel-graph-link-hint').setText('Create this note to strengthen the graph');
    }
  }

  private renderShowMore<T>(container: HTMLDivElement, remaining: number, items: T[], render: (item: T) => void): void {
    const moreEl = container.createDiv('flywheel-graph-more');
    moreEl.setText(`+ ${remaining} more`);
    moreEl.addEventListener('click', () => {
      moreEl.remove();
      for (const item of items) {
        render(item);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Unlinked Mentions
  // ---------------------------------------------------------------------------

  private renderUnlinkedMentions(
    file: TFile,
    suggestResp: McpSuggestWikilinksResponse | null,
  ): void {
    // Use scored suggestions to find entities that exist but aren't linked in this note
    const unlinkedEntities = suggestResp?.scored_suggestions?.filter(s => s.confidence !== 'low') ?? [];
    if (unlinkedEntities.length === 0) return;

    this.renderSection('Unlinked Mentions', 'link-2', unlinkedEntities.length, (container) => {
      // Lazy-load: only fetch full mentions on first expand
      let loaded = false;
      const loadMentions = async () => {
        if (loaded) return;
        loaded = true;
        container.empty();

        for (const sug of unlinkedEntities.slice(0, 15)) {
          const item = container.createDiv('flywheel-graph-mention-item');

          const nameRow = item.createDiv('flywheel-graph-link-name-row');
          const nameEl = nameRow.createSpan('flywheel-graph-link-name');
          nameEl.setText(sug.entity);
          nameEl.addEventListener('click', () => {
            this.app.workspace.openLinkText(sug.path, '', false);
          });
          nameEl.style.cursor = 'pointer';

          const pct = Math.round(sug.totalScore);
          nameRow.createSpan('flywheel-graph-score-badge').setText(`${pct}`);

          // "Link it" button
          const linkBtn = nameRow.createSpan('flywheel-graph-mention-action');
          setIcon(linkBtn, 'link');
          linkBtn.setAttribute('aria-label', `Add [[${sug.entity}]] wikilink`);
          linkBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
              // Read current file content and replace first unlinked occurrence
              const content = await this.app.vault.cachedRead(file);
              const entityName = sug.entity;
              // Find the entity in content outside of existing wikilinks
              const regex = new RegExp(`(?<!\\[\\[)\\b${entityName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b(?!\\]\\])`, 'i');
              const match = regex.exec(content);
              if (match) {
                const newContent = content.slice(0, match.index) + `[[${entityName}]]` + content.slice(match.index + match[0].length);
                await this.app.vault.modify(file, newContent);
                linkBtn.empty();
                setIcon(linkBtn, 'check');
                linkBtn.addClass('flywheel-graph-mention-action-done');
              }
            } catch (err) {
              console.error('Flywheel Crank: failed to add wikilink', err);
            }
          });

          // Tooltip with scoring breakdown
          const bd = sug.breakdown;
          const parts: string[] = [];
          if (bd.hubBoost > 0) parts.push('hub note');
          if (bd.semanticBoost && bd.semanticBoost > 0) parts.push('semantically similar');
          if (bd.contentMatch > 0) parts.push('content overlap');
          if (bd.cooccurrenceBoost > 0) parts.push('co-occurs often');
          if (parts.length > 0) {
            item.createDiv('flywheel-graph-link-snippet').setText(parts.join(' · '));
          }
        }

        if (unlinkedEntities.length > 15) {
          container.createDiv('flywheel-graph-more').setText(`+${unlinkedEntities.length - 15} more`);
        }
      };

      container.createDiv('flywheel-graph-section-empty').setText('Expand to see suggestions...');

      // Override: load on first expand via section observer
      const section = container.parentElement!;
      const observer = new MutationObserver(() => {
        if (!section.hasClass('is-collapsed')) {
          loadMentions();
          observer.disconnect();
        }
      });
      observer.observe(section, { attributes: true, attributeFilter: ['class'] });

      // Also load immediately if section starts expanded
      if (!section.hasClass('is-collapsed')) {
        loadMentions();
        observer.disconnect();
      }
    }, true);
  }

  // ---------------------------------------------------------------------------
  // Semantic Bridges
  // ---------------------------------------------------------------------------

  private renderSemanticBridges(file: TFile, health: McpHealthCheckResponse | null): void {
    const hasEmbeddings = health?.embeddings_ready ?? false;

    this.renderSection('Semantic Bridges', 'git-merge', undefined, (container) => {
      if (!hasEmbeddings) {
        container.createDiv('flywheel-graph-section-empty')
          .setText('Requires semantic index (run "Build semantic embeddings")');
        return;
      }

      let loaded = false;
      const loadBridges = async () => {
        if (loaded) return;
        loaded = true;
        container.empty();

        try {
          // Use per-note semantic_links analysis instead of vault-wide semantic_bridges
          // Returns: { suggestions: [{ entity, similarity }] }
          const result = await this.mcpClient.noteIntelligence(file.path, 'semantic_links');
          const suggestions = (result as any).suggestions ?? [];

          if (suggestions.length === 0) {
            container.createDiv('flywheel-graph-section-empty').setText('No semantic bridges found');
            return;
          }

          for (const sug of suggestions.slice(0, 12)) {
            const item = container.createDiv('flywheel-graph-bridge-item');
            const pair = item.createDiv('flywheel-graph-bridge-pair');

            // Current note → semantically similar entity
            const currentName = file.basename;
            const nodeA = pair.createSpan('flywheel-graph-bridge-node flywheel-graph-bridge-node-current');
            nodeA.setText(currentName);

            pair.createSpan('flywheel-graph-bridge-arrow').setText(' \u2194 ');

            const nodeB = pair.createSpan('flywheel-graph-bridge-node');
            nodeB.setText(sug.entity);
            nodeB.addEventListener('click', () => {
              this.app.workspace.openLinkText(sug.entity, '', false);
            });

            const pct = Math.round((sug.similarity ?? 0) * 100);
            if (pct > 0) {
              pair.createSpan('flywheel-graph-score-badge').setText(`${pct}%`);
            }
          }

          // Update count badge
          const section = container.parentElement!;
          const countEl = section.querySelector('.flywheel-graph-section-count') as HTMLElement;
          if (countEl) countEl.setText(`${suggestions.length}`);
        } catch (err) {
          container.createDiv('flywheel-graph-section-empty')
            .setText(err instanceof Error ? err.message : 'Failed to load');
        }
      };

      container.createDiv('flywheel-graph-section-empty').setText('Expand to discover bridges...');

      const section = container.parentElement!;
      const observer = new MutationObserver(() => {
        if (!section.hasClass('is-collapsed')) {
          loadBridges();
          observer.disconnect();
        }
      });
      observer.observe(section, { attributes: true, attributeFilter: ['class'] });

      if (!section.hasClass('is-collapsed')) {
        loadBridges();
        observer.disconnect();
      }
    }, true);
  }

  // ---------------------------------------------------------------------------
  // Note Intelligence
  // ---------------------------------------------------------------------------

  private renderNoteIntelligence(file: TFile): void {
    this.renderSection('Note Intelligence', 'brain', undefined, (container) => {
      let loaded = false;
      const loadIntelligence = async () => {
        if (loaded) return;
        loaded = true;
        container.empty();

        try {
          const [proseResp, fmResp, crossResp] = await Promise.all([
            this.mcpClient.noteIntelligence(file.path, 'prose_patterns').catch(() => null),
            this.mcpClient.noteIntelligence(file.path, 'suggest_frontmatter').catch(() => null),
            this.mcpClient.noteIntelligence(file.path, 'cross_layer').catch(() => null),
          ]);

          let hasContent = false;

          // Cross-layer analysis (shown first — most actionable)
          // Server returns: { frontmatter_only: [...], prose_only: [...], consistent: [...] }
          const fmOnly = (crossResp as any)?.frontmatter_only ?? [];
          const proseOnly = (crossResp as any)?.prose_only ?? [];
          const crossIssues = [...fmOnly, ...proseOnly];
          if (crossIssues.length > 0) {
            hasContent = true;
            container.createDiv('flywheel-graph-info-group-label').setText('Cross-Layer Gaps');
            if (fmOnly.length > 0) {
              for (const item of fmOnly.slice(0, 3)) {
                const row = container.createDiv('flywheel-graph-intelligence-issue');
                const iconEl = row.createSpan('flywheel-graph-intelligence-issue-icon');
                setIcon(iconEl, 'alert-triangle');
                const desc = `Frontmatter links ${item.target}${item.field ? ` (${item.field})` : ''} but prose doesn't`;
                row.createSpan('flywheel-graph-intelligence-issue-text').setText(desc);
              }
            }
            if (proseOnly.length > 0) {
              for (const item of proseOnly.slice(0, 3)) {
                const row = container.createDiv('flywheel-graph-intelligence-issue');
                const iconEl = row.createSpan('flywheel-graph-intelligence-issue-icon');
                setIcon(iconEl, 'info');
                const desc = `Prose mentions ${item.target}${item.pattern ? ` (${item.pattern})` : ''} but no frontmatter link`;
                row.createSpan('flywheel-graph-intelligence-issue-text').setText(desc);
              }
            }
          }

          // Suggested frontmatter
          // Server returns: { suggestions: [{ field, value, source_lines, confidence, preserveWikilink }] }
          const suggestions = (fmResp as any)?.suggestions ?? [];
          if (suggestions.length > 0) {
            hasContent = true;
            container.createDiv('flywheel-graph-info-group-label').setText('Suggested Frontmatter');
            for (const sug of suggestions.slice(0, 6)) {
              const row = container.createDiv('flywheel-graph-intelligence-suggestion');
              const nameEl = row.createSpan('flywheel-graph-schema-field-name');
              nameEl.setText(sug.field ?? 'unknown');
              const valueEl = row.createSpan('flywheel-graph-schema-field-value');
              const val = sug.value ?? '';
              valueEl.setText(typeof val === 'string' ? val : JSON.stringify(val));
              if (sug.confidence != null) {
                const pct = Math.round(sug.confidence * 100);
                row.createDiv('flywheel-graph-link-snippet').setText(`${pct}% confidence`);
              }
            }
          }

          // Prose patterns
          // Server returns: { patterns: [{ key, value, line, raw, isWikilink }] }
          const patterns = (proseResp as any)?.patterns ?? [];
          if (patterns.length > 0) {
            hasContent = true;
            container.createDiv('flywheel-graph-info-group-label').setText('Prose Patterns');
            for (const pat of patterns.slice(0, 8)) {
              const row = container.createDiv('flywheel-graph-info-row');
              row.createSpan('flywheel-graph-info-label').setText(pat.key ?? 'pattern');
              row.createSpan('flywheel-graph-info-value').setText(pat.value ?? JSON.stringify(pat));
            }
          }

          if (!hasContent) {
            container.createDiv('flywheel-graph-section-empty').setText('No intelligence signals');
          }

          // Update count badge
          const total = crossIssues.length + suggestions.length + patterns.length;
          if (total > 0) {
            const section = container.parentElement!;
            const countEl = section.querySelector('.flywheel-graph-section-count') as HTMLElement;
            if (countEl) countEl.setText(`${total}`);
          }
        } catch (err) {
          container.createDiv('flywheel-graph-section-empty')
            .setText(err instanceof Error ? err.message : 'Failed to load');
        }
      };

      container.createDiv('flywheel-graph-section-empty').setText('Expand to analyze note...');

      const section = container.parentElement!;
      const observer = new MutationObserver(() => {
        if (!section.hasClass('is-collapsed')) {
          loadIntelligence();
          observer.disconnect();
        }
      });
      observer.observe(section, { attributes: true, attributeFilter: ['class'] });

      if (!section.hasClass('is-collapsed')) {
        loadIntelligence();
        observer.disconnect();
      }
    }, true);
  }

  // ---------------------------------------------------------------------------
  // Context Cloud
  // ---------------------------------------------------------------------------

  private renderContextCloud(
    backlinksResp: McpBacklinksResponse,
    forwardLinksResp: McpForwardLinksResponse,
    suggestResp: McpSuggestWikilinksResponse | null,
    similarResp: McpSimilarResponse | null,
    semanticResp: import('../mcp/client').McpNoteIntelligenceResponse | null,
  ): void {
    interface CloudEntry {
      name: string;
      path: string | null;
      score: number;
      reasons: string[];
      sources: Set<string>;
    }

    const cloud = new Map<string, CloudEntry>();

    const mergeEntry = (key: string, entry: Omit<CloudEntry, 'sources'> & { source: string }) => {
      const existing = cloud.get(key);
      if (existing) {
        if (entry.score > existing.score) existing.score = entry.score;
        if (!existing.path && entry.path) existing.path = entry.path;
        // Deduplicate reasons
        for (const r of entry.reasons) {
          if (!existing.reasons.includes(r)) existing.reasons.push(r);
        }
        existing.sources.add(entry.source);
      } else {
        cloud.set(key, {
          name: entry.name,
          path: entry.path,
          score: entry.score,
          reasons: [...entry.reasons],
          sources: new Set([entry.source]),
        });
      }
    };

    // 1. Backlinks
    const blBySource = new Map<string, number>();
    for (const bl of backlinksResp.backlinks) {
      blBySource.set(bl.source, (blBySource.get(bl.source) ?? 0) + 1);
    }
    for (const [source] of blBySource) {
      const name = source.replace(/\.md$/, '').split('/').pop() || source;
      const count = blBySource.get(source)!;
      const score = Math.min(0.7 + 0.1 * (count - 1), 1.0);
      mergeEntry(source, {
        name,
        path: source,
        score,
        reasons: [`Links here from ${name}`],
        source: 'backlink',
      });
    }

    // 2. Forward links
    for (const link of forwardLinksResp.forward_links) {
      const key = link.resolved_path ?? link.target;
      const name = link.target;
      mergeEntry(key, {
        name,
        path: link.exists ? (link.resolved_path ?? null) : null,
        score: link.exists ? 0.5 : 0.2,
        reasons: ['Linked from this note'],
        source: 'forward',
      });
    }

    // 3. Suggest wikilinks (scored suggestions)
    if (suggestResp?.scored_suggestions) {
      for (const sug of suggestResp.scored_suggestions) {
        const name = sug.entity;
        const score = Math.min(sug.totalScore / 80, 1.0);
        const bd = sug.breakdown;
        const parts: string[] = [];
        if (bd.hubBoost > 0) parts.push('highly connected note');
        if (bd.semanticBoost && bd.semanticBoost > 0) parts.push('similar topics');
        if (bd.contentMatch > 0) parts.push('overlapping content');
        if (bd.cooccurrenceBoost > 0) parts.push('frequently mentioned together');
        if (bd.crossFolderBoost > 0) parts.push('bridges different folders');
        if (bd.recencyBoost > 0) parts.push('recently active');
        const partsStr = parts.join(', ');

        // Already in cloud (backlink/forward) → tooltip enrichment; genuinely new → discovery
        const alreadyInCloud = cloud.has(sug.path);
        const reason = alreadyInCloud
          ? (partsStr ? `Suggestion scoring: ${partsStr}` : 'Suggestion scoring')
          : (partsStr ? `Could be linked \u2014 ${partsStr}` : 'Could be linked');

        mergeEntry(sug.path, {
          name,
          path: sug.path,
          score,
          reasons: [reason],
          source: 'suggested',
        });
      }
    }

    // 4. Similar notes — score range is typically 0–5, map to 0.3–1.0
    if (similarResp?.similar) {
      for (const sim of similarResp.similar) {
        const name = sim.title;
        const score = Math.min(0.3 + (sim.score / 5) * 0.7, 1.0);
        mergeEntry(sim.path, {
          name,
          path: sim.path,
          score,
          reasons: ['Similar content'],
          source: 'similar',
        });
      }
    }

    // 5. Semantic links — entities semantically similar but not linked
    const semanticSuggestions = (semanticResp as any)?.suggestions as Array<{ entity: string; similarity: number }> | undefined;
    if (semanticSuggestions) {
      for (const sug of semanticSuggestions) {
        const name = sug.entity;
        const score = Math.min(0.4 + (sug.similarity ?? 0) * 0.6, 1.0);
        mergeEntry(name, {
          name,
          path: null, // entity name, not a path — openLinkText will resolve it
          score,
          reasons: [`Semantically similar (${Math.round((sug.similarity ?? 0) * 100)}%)`],
          source: 'semantic',
        });
      }
    }

    if (cloud.size === 0) return;

    // Split into main vs periodic entries
    const PERIODIC_NAME_RE = /^\d{4}(-\d{2}(-\d{2})?)?$|^\d{4}-W\d{2}$|^\d{4}-Q[1-4]$/;

    const isPeriodic = (entry: { name: string; path: string | null }): boolean => {
      // Name-based: date patterns (2024-05-14, 2025-02, 2024-W07, 2025-Q1)
      if (PERIODIC_NAME_RE.test(entry.name)) return true;
      // Path-based: folder prefix from vault config
      if (entry.path && this.periodicPrefixes.length > 0) {
        return this.periodicPrefixes.some(prefix => entry.path!.startsWith(prefix));
      }
      return false;
    };

    const MAX_MAIN = 30;
    const MAX_PERIODIC = 15;

    const allEntries = [...cloud.values()].filter(e => e.score > 0);
    const mainEntries = allEntries
      .filter(e => !isPeriodic(e))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_MAIN)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    const periodicEntries = allEntries
      .filter(e => isPeriodic(e))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_PERIODIC)
      .sort((a, b) => b.name.localeCompare(a.name, undefined, { sensitivity: 'base' }));

    this.renderSection('Context', 'cloud', mainEntries.length + periodicEntries.length, (container) => {
      // Main cloud
      if (mainEntries.length > 0) {
        this.renderCloudItems(container, mainEntries, 12, 24);
      }

      // Periodic cloud — smaller, more compact
      if (periodicEntries.length > 0) {
        const periodicLabel = container.createDiv('flywheel-cloud-label');
        periodicLabel.setText('periodic');
        this.renderCloudItems(container, periodicEntries, 11, 16);
      }
    });
  }

  private renderCloudItems(
    container: HTMLDivElement,
    entries: Array<{ name: string; path: string | null; score: number; reasons: string[]; sources: Set<string> }>,
    minFontSize: number,
    maxFontSize: number,
  ): void {
    const minScore = Math.min(...entries.map(e => e.score));
    const maxScore = Math.max(...entries.map(e => e.score));
    const scoreRange = maxScore - minScore || 1;

    const cloudEl = container.createDiv('flywheel-cloud');

    for (const entry of entries) {
      const t = (entry.score - minScore) / scoreRange; // 0..1
      const fontSize = minFontSize + t * (maxFontSize - minFontSize);
      const fontWeight = Math.round(400 + t * 300); // 400 to 700
      const opacity = 0.6 + t * 0.4; // 0.6 to 1.0

      const span = cloudEl.createEl('span', { cls: 'flywheel-cloud-item' });
      span.style.fontSize = `${fontSize.toFixed(1)}px`;
      span.style.fontWeight = String(fontWeight);
      span.style.opacity = String(opacity.toFixed(2));
      span.setText(entry.name);

      // Tooltip: score + source signals + reasons
      const sourceLabels: string[] = [];
      if (entry.sources.has('backlink')) sourceLabels.push('backlink');
      if (entry.sources.has('forward')) sourceLabels.push('linked');
      if (entry.sources.has('suggested')) sourceLabels.push('suggested');
      if (entry.sources.has('similar')) sourceLabels.push('similar');
      if (entry.sources.has('semantic')) sourceLabels.push('semantic');
      const tooltipLines = [
        `Score: ${Math.round(entry.score * 100)} · ${sourceLabels.join(', ')}`,
        ...entry.reasons,
      ];
      span.setAttribute('aria-label', tooltipLines.join('\n'));

      // Navigate on click — use path if available, otherwise try name (entity resolution)
      const navTarget = entry.path ?? entry.name;
      if (entry.path || entry.sources.has('semantic') || entry.sources.has('suggested')) {
        span.addEventListener('click', () => {
          this.app.workspace.openLinkText(navTarget, '', false);
        });
      } else {
        span.addClass('flywheel-cloud-dead');
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Related notes
  // ---------------------------------------------------------------------------

  private renderRelatedNotes(response: McpSimilarResponse | null): void {
    if (!response?.similar || response.similar.length === 0) return;

    const method = response.method === 'hybrid' ? 'keyword + semantic' : 'keyword only';
    const topScore = response.similar[0]?.score || 1;

    this.renderSection('Related Notes', 'sparkles', response.similar.length, (container) => {
      for (const result of response.similar.slice(0, 15)) {
        const item = container.createDiv('flywheel-graph-link-item');
        item.addEventListener('click', () => {
          this.app.workspace.openLinkText(result.path, '', false);
        });

        const nameRow = item.createDiv('flywheel-graph-link-name-row');
        nameRow.createSpan('flywheel-graph-link-name').setText(result.title);
        const pct = topScore > 0 ? Math.round((result.score / topScore) * 100) : 0;
        nameRow.createSpan('flywheel-graph-score-badge').setText(`${pct}%`);

        // Tooltip with relatedness explanation
        const folder = result.path.split('/').slice(0, -1).join('/');
        const snippetText = result.snippet
          ? result.snippet.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
          : '';
        const tooltipLines = [
          `Similarity: ${pct}% (via ${method})`,
          folder ? `Folder: ${folder}` : '',
          snippetText ? `Matching content: ${snippetText}` : '',
        ].filter(Boolean);
        item.setAttribute('aria-label', tooltipLines.join('\n'));
      }
    }, true);
  }

  // ---------------------------------------------------------------------------
  // Shared section renderer
  // ---------------------------------------------------------------------------

  private renderSection(
    title: string,
    icon: string,
    count: number | undefined,
    renderContent: (container: HTMLDivElement) => void,
    collapsed = false,
    target?: HTMLDivElement,
    stateKey?: string,
  ): HTMLDivElement {
    const key = stateKey ?? title;
    const section = (target ?? this.noteContainer).createDiv('flywheel-graph-section');
    // Use remembered state if available, otherwise use default
    const isCollapsed = this.sectionCollapsed.has(key)
      ? this.sectionCollapsed.get(key)!
      : collapsed;
    if (isCollapsed) section.addClass('is-collapsed');

    const headerEl = section.createDiv('flywheel-graph-section-header');
    headerEl.addEventListener('click', () => {
      const nowCollapsed = !section.hasClass('is-collapsed');
      section.toggleClass('is-collapsed', nowCollapsed);
      this.sectionCollapsed.set(key, nowCollapsed);
    });

    const iconEl = headerEl.createSpan('flywheel-graph-section-icon');
    setIcon(iconEl, icon);
    headerEl.createSpan('flywheel-graph-section-title').setText(title);
    if (count !== undefined) {
      headerEl.createSpan('flywheel-graph-section-count').setText(`${count}`);
    }

    const chevron = headerEl.createSpan('flywheel-graph-section-chevron');
    setIcon(chevron, 'chevron-down');

    const content = section.createDiv('flywheel-graph-section-content');
    renderContent(content);

    return section;
  }

  async onClose(): Promise<void> {
    this.contentContainer?.empty();
  }
}
