/**
 * Graph Sidebar View — powered by flywheel-memory MCP
 *
 * Collapsible sections: Vault Info (always), Backlinks, Forward Links,
 * Related Notes (when a note is active). All data from MCP tool calls.
 */

import { ItemView, WorkspaceLeaf, TFile, setIcon } from 'obsidian';
import type {
  FlywheelMcpClient,
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
      this.vaultContainer.empty();
      this.noteContainer.empty();
      this.vaultSectionsRendered = false;

      const empty = this.vaultContainer.createDiv('flywheel-graph-empty');
      const imgPath = `${this.app.vault.configDir}/plugins/flywheel-crank/flywheel.png`;
      const imgEl = empty.createEl('img', { cls: 'flywheel-graph-logo' });
      imgEl.src = this.app.vault.adapter.getResourcePath(imgPath);
      imgEl.alt = 'Flywheel';
      empty.createDiv('flywheel-graph-empty-text').setText('Connecting to flywheel-memory...');
      return;
    }

    // Vault sections: render once (or on force refresh)
    if (!this.vaultSectionsRendered || force) {
      this.vaultContainer.empty();
      this.vaultSectionsRendered = true;
      this.renderVaultInfo();
      this.renderVaultIntelligence();
    }

    // Note sections: always refresh on note change
    this.noteContainer.empty();
    if (activeFile) {
      this.renderNoteHeader(activeFile);
      this.renderNoteSections(activeFile);
    }
  }

  // ---------------------------------------------------------------------------
  // Vault Info section
  // ---------------------------------------------------------------------------

  private async renderVaultInfo(): Promise<void> {
    const section = this.renderSection('Vault Info', 'info', undefined, (container) => {
      container.createDiv('flywheel-graph-info-row')
        .createSpan('flywheel-graph-info-value').setText('loading...');
    }, true, this.vaultContainer);

    this.populateVaultInfo(section);
  }

  /** Shared renderer for vault info — used by initial load and auto-refresh. */
  private async populateVaultInfo(section: HTMLDivElement): Promise<void> {
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

      // Status indicator on right of counts row — includes index age
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

      // Vault name
      const vaultName = health.vault_path.split('/').pop() || health.vault_path;
      this.renderInfoRow(content, 'Vault', vaultName);

      // Surface inferred config prominently
      if (health.config && Object.keys(health.config).length > 0) {
        const cfg = health.config as Record<string, any>;

        // Periodic note locations
        const paths = cfg.paths as Record<string, string> | undefined;
        if (paths && Object.keys(paths).length > 0) {
          const periodicGroup = content.createDiv('flywheel-graph-info-group');
          periodicGroup.createDiv('flywheel-graph-info-group-label').setText('Periodic Locations');
          const labels: Record<string, string> = {
            daily_notes: 'Daily', weekly_notes: 'Weekly', monthly_notes: 'Monthly',
            quarterly_notes: 'Quarterly', yearly_notes: 'Yearly', templates: 'Templates',
          };
          for (const [key, path] of Object.entries(paths)) {
            if (path) this.renderInfoRow(periodicGroup, labels[key] ?? key, path);
          }
        }

        // Templates
        const templates = cfg.templates as Record<string, string> | undefined;
        if (templates && Object.keys(templates).length > 0) {
          const tplGroup = content.createDiv('flywheel-graph-info-group');
          tplGroup.createDiv('flywheel-graph-info-group-label').setText('Templates');
          const labels: Record<string, string> = {
            daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly',
            quarterly: 'Quarterly', yearly: 'Yearly',
          };
          for (const [key, path] of Object.entries(templates)) {
            if (path) this.renderInfoRow(tplGroup, labels[key] ?? key, path);
          }
        }

        // Excluded task tags
        const excludeTags = cfg.exclude_task_tags as string[] | undefined;
        if (excludeTags && excludeTags.length > 0) {
          this.renderInfoRow(content, 'Excluded tags', excludeTags.join(', '));
        }
      }

      // Technical details — hidden behind toggle
      const detailsToggle = content.createDiv('flywheel-graph-more');
      detailsToggle.setText('+ technical details');
      const detailsGroup = content.createDiv('flywheel-graph-info-group flywheel-graph-details-hidden');
      this.renderInfoRow(detailsGroup, 'Vault path', health.vault_path);
      this.renderInfoRow(detailsGroup, 'StateDb', `${health.vault_path}/.flywheel/state.db`);
      this.renderInfoRow(detailsGroup, 'MCP', 'connected (stdio)');

      detailsToggle.addEventListener('click', () => {
        detailsGroup.removeClass('flywheel-graph-details-hidden');
        detailsToggle.remove();
      });

      // Update count badge
      const countEl = section.querySelector('.flywheel-graph-section-count') as HTMLElement;
      if (countEl) countEl.setText(`${health.note_count}`);

      // Keep polling while building or while config hasn't loaded yet
      const configMissing = !health.config || Object.keys(health.config).length === 0;
      if (health.index_state === 'building' || configMissing) {
        setTimeout(() => this.populateVaultInfo(section), health.index_state === 'building' ? 5000 : 2000);
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

  /** Flatten nested config objects into key/value rows */
  private renderConfigEntries(container: HTMLDivElement, obj: Record<string, unknown>, prefix = ''): void {
    for (const [key, value] of Object.entries(obj)) {
      if (value == null) continue;
      const label = prefix ? `${prefix}.${key}` : key;
      if (typeof value === 'object' && !Array.isArray(value)) {
        this.renderConfigEntries(container, value as Record<string, unknown>, label);
      } else if (Array.isArray(value)) {
        if (value.length > 0) {
          this.renderInfoRow(container, label, value.join(', '));
        }
      } else {
        this.renderInfoRow(container, label, String(value));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Vault Intelligence sections (lazy-loaded on expand)
  // ---------------------------------------------------------------------------

  private renderVaultIntelligence(): void {
    this.renderLazySection('Vault Stats', 'bar-chart-2', () => this.loadVaultStats());
    this.renderLazySection('Folder Structure', 'folder-tree', () => this.loadFolderStructure());
    this.renderLazySection('Type Inconsistencies', 'alert-triangle', () => this.loadInconsistencies());
  }

  /**
   * Render a section that starts collapsed and lazy-loads data on first expand.
   * The loader is called once; subsequent expand/collapse is free.
   */
  private renderLazySection(
    title: string,
    icon: string,
    loader: () => Promise<{ content: HTMLDivElement } | void>,
  ): void {
    const section = this.vaultContainer.createDiv('flywheel-graph-section is-collapsed');

    const headerEl = section.createDiv('flywheel-graph-section-header');
    const iconEl = headerEl.createSpan('flywheel-graph-section-icon');
    setIcon(iconEl, icon);
    headerEl.createSpan('flywheel-graph-section-title').setText(title);
    const countEl = headerEl.createSpan('flywheel-graph-section-count');
    countEl.setText('...');
    const chevron = headerEl.createSpan('flywheel-graph-section-chevron');
    setIcon(chevron, 'chevron-down');

    const content = section.createDiv('flywheel-graph-section-content');
    content.createDiv('flywheel-graph-section-empty').setText('Click to load');

    let loaded = false;
    headerEl.addEventListener('click', async () => {
      const wasCollapsed = section.hasClass('is-collapsed');
      section.toggleClass('is-collapsed', !wasCollapsed);

      if (!loaded && wasCollapsed) {
        loaded = true;
        content.empty();
        content.createDiv('flywheel-graph-section-empty').setText('loading...');
        try {
          await this.mcpClient.waitForIndex();
          await loader();
        } catch (err) {
          content.empty();
          content.createDiv('flywheel-graph-section-empty')
            .setText(err instanceof Error ? err.message : 'Failed to load');
        }
      }
    });
  }

  private async loadVaultStats(): Promise<void> {
    const stats = await this.mcpClient.vaultStats();
    const section = this.findSectionByTitle('Vault Stats');
    if (!section) return;
    const content = section.querySelector('.flywheel-graph-section-content') as HTMLDivElement;
    const countEl = section.querySelector('.flywheel-graph-section-count') as HTMLElement;
    content.empty();

    // Summary counts row
    const row = content.createDiv('flywheel-graph-counts-row');
    this.renderCountBadge(row, 'link', String(stats.total_links), 'links');
    this.renderCountBadge(row, 'tag', String(stats.total_tags), 'tags');
    const avgLabel = row.createSpan('flywheel-graph-counts-status');
    avgLabel.setText(`${stats.average_links_per_note.toFixed(1)} links/note`);

    // Orphans
    if (stats.orphan_notes.total > 0) {
      const orphanGroup = content.createDiv('flywheel-graph-info-group');
      orphanGroup.createDiv('flywheel-graph-info-group-label').setText('Orphans');
      this.renderInfoRow(orphanGroup, 'Content orphans', String(stats.orphan_notes.content));
      this.renderInfoRow(orphanGroup, 'Periodic orphans', String(stats.orphan_notes.periodic));
    }

    // Broken links
    if (stats.broken_links > 0) {
      this.renderInfoRow(content, 'Broken links', String(stats.broken_links));
    }

    // Most linked notes
    if (stats.most_linked_notes.length > 0) {
      const hubGroup = content.createDiv('flywheel-graph-info-group');
      hubGroup.createDiv('flywheel-graph-info-group-label').setText('Most Linked');
      for (const note of stats.most_linked_notes.slice(0, 8)) {
        const name = note.path.replace(/\.md$/, '').split('/').pop() || note.path;
        const item = hubGroup.createDiv('flywheel-graph-link-item');
        item.addEventListener('click', () => this.app.workspace.openLinkText(note.path, '', false));
        const nameRow = item.createDiv('flywheel-graph-link-name-row');
        nameRow.createSpan('flywheel-graph-link-name').setText(name);
        nameRow.createSpan('flywheel-graph-link-line').setText(`${note.backlinks} backlinks`);
      }
    }

    // Top tags
    if (stats.top_tags.length > 0) {
      const tagGroup = content.createDiv('flywheel-graph-info-group');
      tagGroup.createDiv('flywheel-graph-info-group-label').setText('Top Tags');
      for (const tag of stats.top_tags.slice(0, 10)) {
        this.renderInfoRow(tagGroup, tag.tag, String(tag.count));
      }
    }

    // Recent activity
    if (stats.recent_activity) {
      const actGroup = content.createDiv('flywheel-graph-info-group');
      actGroup.createDiv('flywheel-graph-info-group-label').setText(`Activity (${stats.recent_activity.period_days}d)`);
      this.renderInfoRow(actGroup, 'Modified', String(stats.recent_activity.notes_modified));
      this.renderInfoRow(actGroup, 'Created', String(stats.recent_activity.notes_created));
      if (stats.recent_activity.most_active_day) {
        this.renderInfoRow(actGroup, 'Most active', stats.recent_activity.most_active_day);
      }
    }

    if (countEl) countEl.setText(`${stats.total_links} links`);
  }

  private async loadFolderStructure(): Promise<void> {
    const result = await this.mcpClient.folderStructure();
    const section = this.findSectionByTitle('Folder Structure');
    if (!section) return;
    const content = section.querySelector('.flywheel-graph-section-content') as HTMLDivElement;
    const countEl = section.querySelector('.flywheel-graph-section-count') as HTMLElement;
    content.empty();

    if (result.folders.length === 0) {
      content.createDiv('flywheel-graph-section-empty').setText('No folders');
      if (countEl) countEl.setText('0');
      return;
    }

    // Sort by note count descending
    const sorted = [...result.folders].sort((a, b) => b.note_count - a.note_count);

    const renderFolderRow = (folder: { path: string; note_count: number; subfolder_count: number }) => {
      const wrapper = content.createDiv('flywheel-graph-folder-item');
      const row = wrapper.createDiv('flywheel-graph-folder-row');
      const chevron = row.createSpan('flywheel-graph-folder-chevron');
      setIcon(chevron, 'chevron-right');
      row.createSpan('flywheel-graph-folder-name').setText(folder.path || '(root)');
      const meta = row.createSpan('flywheel-graph-folder-meta');
      meta.setText(folder.subfolder_count > 0
        ? `${folder.note_count} · ${folder.subfolder_count} sub`
        : `${folder.note_count}`);

      let expanded = false;
      row.addEventListener('click', async () => {
        if (expanded) {
          // Collapse
          expanded = false;
          chevron.empty();
          setIcon(chevron, 'chevron-right');
          const detail = wrapper.querySelector('.flywheel-graph-folder-detail');
          detail?.remove();
          return;
        }
        expanded = true;
        chevron.empty();
        setIcon(chevron, 'chevron-down');
        const detail = wrapper.createDiv('flywheel-graph-folder-detail');
        detail.createDiv('flywheel-graph-section-empty').setText('loading...');
        try {
          const conv = await this.mcpClient.folderConventions(folder.path);
          detail.empty();
          this.renderFolderConventionsInline(detail, conv);
        } catch (err) {
          detail.empty();
          detail.createDiv('flywheel-graph-section-empty')
            .setText(err instanceof Error ? err.message : 'Failed to load');
        }
      });
    };

    for (const folder of sorted.slice(0, 20)) {
      renderFolderRow(folder);
    }

    if (sorted.length > 20) {
      const moreEl = content.createDiv('flywheel-graph-more');
      moreEl.setText(`+ ${sorted.length - 20} more folders`);
      moreEl.addEventListener('click', () => {
        moreEl.remove();
        for (const folder of sorted.slice(20)) {
          renderFolderRow(folder);
        }
      });
    }

    if (countEl) countEl.setText(`${result.folder_count}`);
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

    // Inferred fields (top by frequency)
    const fields = conv.inferred_fields
      .filter(f => f.frequency >= 0.2)
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
    if (conv.computed_field_suggestions && conv.computed_field_suggestions.length > 0) {
      container.createDiv('flywheel-graph-info-group-label').setText('Suggested Fields');
      for (const sug of conv.computed_field_suggestions) {
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

  private async loadInconsistencies(): Promise<void> {
    const result = await this.mcpClient.schemaInconsistencies();
    const section = this.findSectionByTitle('Type Inconsistencies');
    if (!section) return;
    const content = section.querySelector('.flywheel-graph-section-content') as HTMLDivElement;
    const countEl = section.querySelector('.flywheel-graph-section-count') as HTMLElement;
    content.empty();

    if (result.inconsistency_count === 0) {
      content.createDiv('flywheel-graph-section-empty').setText('No type inconsistencies found');
      if (countEl) countEl.setText('0');
      return;
    }

    for (const inc of result.inconsistencies.slice(0, 10)) {
      const item = content.createDiv('flywheel-graph-inconsistency-item');

      // Header: field name + type summary
      const header = item.createDiv('flywheel-graph-inconsistency-header');
      const iconEl = header.createSpan('flywheel-graph-inconsistency-icon');
      setIcon(iconEl, 'alert-triangle');
      header.createSpan('flywheel-graph-inconsistency-field').setText(inc.field);
      header.createSpan('flywheel-graph-inconsistency-types')
        .setText(`used as ${inc.types_found.join(' and ')}`);

      // Examples: "NoteA → string: "value""
      for (const ex of inc.examples.slice(0, 3)) {
        const exEl = item.createDiv('flywheel-graph-inconsistency-example');
        const noteName = ex.note.replace(/\.md$/, '').split('/').pop() || ex.note;
        const noteSpan = exEl.createSpan('flywheel-graph-inconsistency-note');
        noteSpan.setText(noteName);
        noteSpan.addEventListener('click', () => this.app.workspace.openLinkText(ex.note, '', false));
        const valStr = typeof ex.value === 'string' ? `"${ex.value}"` : JSON.stringify(ex.value);
        exEl.createSpan('flywheel-graph-inconsistency-val').setText(` ${ex.type}: ${valStr}`);
      }
    }

    if (countEl) {
      countEl.setText(`${result.inconsistency_count}`);
      if (result.inconsistency_count > 0) countEl.addClass('flywheel-graph-section-count-warn');
    }
  }

  /** Find a section element by its title text. */
  private findSectionByTitle(title: string): HTMLDivElement | null {
    const sections = this.vaultContainer.querySelectorAll('.flywheel-graph-section');
    for (const s of sections) {
      const titleEl = s.querySelector('.flywheel-graph-section-title');
      if (titleEl?.textContent === title) return s as HTMLDivElement;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Schema section
  // ---------------------------------------------------------------------------

  private async renderFolderSchema(file: TFile): Promise<void> {
    const folder = file.path.split('/').slice(0, -1).join('/') || '';
    const folderLabel = folder || '(root)';

    const section = this.renderSection(`Folder: ${folderLabel}`, 'file-json', undefined, (container) => {
      container.createDiv('flywheel-graph-section-empty').setText('loading...');
    }, true);

    try {
      await this.mcpClient.waitForIndex();
      const conv = await this.mcpClient.folderConventions(folder);
      const content = section.querySelector('.flywheel-graph-section-content') as HTMLDivElement;
      if (!content) return;
      content.empty();

      // Get current note's frontmatter
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter ?? {};

      // Build a map of all inferred fields
      const fieldMap = new Map(conv.inferred_fields.map(f => [f.name, f]));

      // Collect all field names: those in this note + those expected by the folder
      const allFieldNames = new Set<string>();
      for (const key of Object.keys(fm)) {
        if (key !== 'position') allFieldNames.add(key); // skip Obsidian internal
      }
      for (const f of conv.inferred_fields) {
        allFieldNames.add(f.name);
      }

      if (allFieldNames.size === 0) {
        content.createDiv('flywheel-graph-section-empty').setText('No frontmatter');
        return;
      }

      this.renderInfoRow(content, 'Notes in folder', `${conv.note_count}`);
      this.renderInfoRow(content, 'Coverage', `${Math.round(conv.coverage * 100)}%`);

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
        // Skip fields that are neither in the note nor common in the folder (>30%)
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

      const [backlinksResp, forwardLinksResp] = await Promise.all([
        this.mcpClient.getBacklinks(notePath),
        this.mcpClient.getForwardLinks(notePath),
      ]);

      // Deduplicate forward links by resolved path (or target for dead links)
      const seen = new Set<string>();
      const uniqueLinks = forwardLinksResp.forward_links.filter(link => {
        const key = link.resolved_path ?? link.target;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      const MAX_ITEMS = 5;

      // Backlinks section
      this.renderSection('Backlinks', 'arrow-left', backlinksResp.backlink_count, (container) => {
        if (backlinksResp.backlinks.length === 0) {
          container.createDiv('flywheel-graph-section-empty').setText('No backlinks');
          return;
        }

        const visible = backlinksResp.backlinks.slice(0, MAX_ITEMS);
        for (const bl of visible) {
          this.renderBacklink(container, bl);
        }

        const remaining = backlinksResp.backlink_count - visible.length;
        if (remaining > 0) {
          this.renderShowMore(container, remaining, backlinksResp.backlinks.slice(MAX_ITEMS), (bl) => {
            this.renderBacklink(container, bl);
          });
        }
      });

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
      });

      // Folder schema (right after forward links, before related)
      this.renderFolderSchema(file);

      // Related notes via find_similar
      await this.renderRelatedNotes(notePath);
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
  // Related notes
  // ---------------------------------------------------------------------------

  private async renderRelatedNotes(notePath: string): Promise<void> {
    try {
      const response = await this.mcpClient.findSimilar(notePath, 10);

      if (response.similar.length === 0) return;

      this.renderSection('Related Notes', 'sparkles', response.similar.length, (container) => {
        for (const result of response.similar.slice(0, 15)) {
          const item = container.createDiv('flywheel-graph-link-item');
          item.addEventListener('click', () => {
            this.app.workspace.openLinkText(result.path, '', false);
          });

          item.createDiv('flywheel-graph-link-name').setText(result.title);

          if (result.snippet) {
            const snippetEl = item.createDiv('flywheel-graph-link-snippet');
            snippetEl.innerHTML = result.snippet;
          }
        }
      }, true);
    } catch {
      // Skip related notes on error
    }
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
  ): HTMLDivElement {
    const section = (target ?? this.noteContainer).createDiv('flywheel-graph-section');
    if (collapsed) section.addClass('is-collapsed');

    const headerEl = section.createDiv('flywheel-graph-section-header');
    headerEl.addEventListener('click', () => {
      section.toggleClass('is-collapsed', !section.hasClass('is-collapsed'));
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
