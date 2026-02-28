/**
 * Graph Sidebar View — powered by flywheel-memory MCP
 *
 * Collapsible sections: Folder, Context Cloud, Backlinks, Forward Links,
 * Note Intelligence (when a note is active). All data from MCP tool calls.
 */

import { ItemView, WorkspaceLeaf, TFile, setIcon } from 'obsidian';
import type {
  FlywheelMcpClient,
  McpBacklinksResponse,
  McpForwardLinksResponse,
  McpSuggestWikilinksResponse,
  McpSimilarResponse,
  McpHealthCheckResponse,
  McpAliasSuggestionsResponse,
  McpStrongConnectionsResponse,
} from '../mcp/client';

export const GRAPH_VIEW_TYPE = 'flywheel-graph';

interface GraphNode {
  id: string;
  label: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  isCurrent: boolean;
  /** 2-hop node — rendered smaller and more faded */
  isSecondary?: boolean;
  /** Periodic note (daily, weekly, etc.) — dimmed and pushed outward */
  isPeriodic?: boolean;
}

interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}

/** Solid category colors for canvas rendering — maximally distinct hues. */
const CATEGORY_CANVAS_COLORS: Record<string, string> = {
  people:        '#5b9bf5', // blue
  projects:      '#43d17a', // green
  technologies:  '#a78bfa', // violet
  locations:     '#f59e42', // orange
  organizations: '#06b6d4', // cyan
  concepts:      '#ec4899', // hot pink
  animals:       '#84cc16', // lime
  media:         '#d946ef', // magenta
  events:        '#eab308', // yellow
  documents:     '#78716c', // warm gray
  vehicles:      '#e67635', // burnt orange
  health:        '#ef4444', // red
  finance:       '#10b981', // emerald
  food:          '#f5a623', // amber
  hobbies:       '#8b5cf6', // purple
  acronyms:      '#38bdf8', // sky blue
  periodical:    '#6b7280', // slate
  other:         '#a1a1aa', // zinc
};

export class GraphSidebarView extends ItemView {
  private mcpClient: FlywheelMcpClient;
  private contentContainer!: HTMLDivElement;
  /** Note-level sections (Backlinks, Forward Links, etc.) — refreshed on active note change. */
  private noteContainer!: HTMLDivElement;
  private currentNotePath: string | null = null;
  /** Whether the index has been awaited at least once (avoids splash on every note change). */
  private indexReady = false;
  /** Folder prefixes for periodic notes (daily-notes/, weekly-notes/, etc.) */
  private periodicPrefixes: string[] = [];
  /** Remember collapsed state per section title across note changes */
  private sectionCollapsed = new Map<string, boolean>();
  /** Monotonically increasing counter to detect stale renders */
  private renderGeneration = 0;
  /** Whether a retry after render failure is already scheduled */
  private _retried = false;
  /** Unsubscribe from health updates (used while waiting for index) */
  private healthUnsub: (() => void) | null = null;
  /** Unsubscribe from pipeline health updates (for cloud pulse) */
  private pipelineUnsub: (() => void) | null = null;
  /** Last pipeline timestamp seen (to detect new pipelines) */
  private lastPipelineTs = 0;

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
    this._retried = false;
    this.register(this.mcpClient.onConnectionStateChange(() => this.refresh()));

    // Subscribe to pipeline events for cloud pulse animations
    if (!this.pipelineUnsub) {
      this.pipelineUnsub = this.mcpClient.onHealthUpdate((health) => {
        const ts = health.last_pipeline?.timestamp ?? 0;
        if (ts > this.lastPipelineTs && this.lastPipelineTs > 0) {
          this.handlePipelineUpdate(health);
        }
        this.lastPipelineTs = ts;
      });
    }

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

    // First load: show splash while index builds, subscribe to health updates
    if (!this.indexReady) {
      this.showSplash('Syncing vault index...');
      if (!this.healthUnsub) {
        this.healthUnsub = this.mcpClient.onHealthUpdate((health) => {
          if (health.index_state === 'ready' && !this.indexReady) {
            this.indexReady = true;
            if (this.healthUnsub) { this.healthUnsub(); this.healthUnsub = null; }
            this.refresh(true);
          }
        });
      }
      return;
    }

    // Note sections: build into a fresh container, then swap when data is ready.
    // This avoids flashing empty while async fetches are in progress.
    const generation = ++this.renderGeneration;
    if (activeFile) {
      const freshContainer = document.createElement('div');
      this.renderNoteHeader(activeFile, freshContainer);
      this.renderNoteSections(activeFile, generation, freshContainer);
    } else {
      this.noteContainer.empty();
    }
  }

  private showSplash(message: string): void {
    this.noteContainer.empty();

    const isError = this.mcpClient.connectionState === 'error';
    const splash = this.noteContainer.createDiv('flywheel-splash');
    const imgPath = `${this.app.vault.configDir}/plugins/flywheel-crank/flywheel.png`;
    const imgEl = splash.createEl('img', { cls: isError ? 'flywheel-splash-logo flywheel-splash-logo-static' : 'flywheel-splash-logo' });
    imgEl.src = this.app.vault.adapter.getResourcePath(imgPath);
    imgEl.alt = 'Flywheel';
    if (isError) {
      splash.createDiv('flywheel-splash-error').setText(this.mcpClient.lastError ?? 'Connection failed');
      const retryBtn = splash.createEl('button', { cls: 'flywheel-splash-retry' });
      retryBtn.setText('Retry');
      retryBtn.addEventListener('click', () => this.mcpClient.requestRetry());
    } else {
      splash.createDiv('flywheel-splash-text').setText(message);
    }
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
  // Folder chips (compact frontmatter suggestions)
  // ---------------------------------------------------------------------------

  private async renderFolderChips(file: TFile, generation: number): Promise<void> {
    const folder = file.path.split('/').slice(0, -1).join('/') || '';
    try {
      const conv = await this.mcpClient.folderConventions(folder).catch(() => null);
      if (generation !== this.renderGeneration || !conv) return;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};

      const chips: { name: string; value: string; rawValue: unknown }[] = [];
      for (const field of conv.inferred_fields ?? []) {
        if (field.name in fm || field.frequency < 0.5) continue;
        if (field.name === 'position' || field.name === 'word_count' || field.name === 'link_count') continue;
        const topValue = field.common_values?.[0];
        if (topValue != null) {
          chips.push({ name: field.name, value: String(topValue), rawValue: topValue });
        }
      }

      if (chips.length > 0) {
        const chipBar = this.noteContainer.createDiv('flywheel-folder-chips');
        // Insert after header
        const header = this.noteContainer.querySelector('.flywheel-graph-header');
        if (header?.nextSibling) {
          this.noteContainer.insertBefore(chipBar, header.nextSibling);
        }
        for (const { name, value, rawValue } of chips.slice(0, 3)) {
          const chip = chipBar.createEl('span', { cls: 'flywheel-folder-chip' });
          chip.setText(`+${name}:${value}`);
          chip.setAttribute('aria-label', `Set ${name}: ${value}`);
          chip.addEventListener('click', async () => {
            await this.mcpClient.updateFrontmatter(file.path, { [name]: rawValue });
            this.refresh(true);
          });
        }
      }
    } catch {
      // Folder conventions not available — skip chips silently
    }
  }

  // ---------------------------------------------------------------------------
  // Folder section (merged folder conventions + browse all folders)
  // ---------------------------------------------------------------------------

  private async renderFolderSection(file: TFile, generation: number): Promise<void> {
    const folder = file.path.split('/').slice(0, -1).join('/') || '';
    const folderLabel = folder || '(root)';

    const folderInfo = 'Shows frontmatter fields used in this folder and how this note compares. ' +
      'Missing fields are common in sibling notes but absent here.';
    const section = this.renderSection(`Folder: ${folderLabel}`, 'folder', undefined, (container) => {
      container.createDiv('flywheel-graph-section-empty').setText('loading...');
    }, true, undefined, 'Folder', folderInfo);

    try {
      if (generation !== this.renderGeneration) return;
      const conv = await this.mcpClient.folderConventions(folder);
      if (generation !== this.renderGeneration) return;
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
          } else if (!hasField && inferred?.common_values && inferred.common_values.length > 0) {
            const valuesRow = row.createDiv('flywheel-graph-schema-field-actions');
            for (const v of inferred.common_values.slice(0, 5)) {
              const valStr = typeof v === 'string' ? v : JSON.stringify(v);
              const chip = valuesRow.createSpan('flywheel-graph-field-chip');
              chip.setText(valStr);
              chip.setAttribute('aria-label', `Set ${name}: ${valStr}`);
              chip.addEventListener('click', async (e) => {
                e.stopPropagation();
                await this.mcpClient.updateFrontmatter(file.path, { [name]: v });
                this.refresh(true);
              });
            }
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

      // Alias suggestions toggle (lazy-loaded)
      let aliasSuggestionsLoaded = false;
      const aliasToggle = content.createDiv('flywheel-graph-more');
      aliasToggle.setText('+ alias suggestions');
      const aliasGroup = content.createDiv('flywheel-graph-info-group flywheel-graph-details-hidden');

      aliasToggle.addEventListener('click', async () => {
        if (aliasSuggestionsLoaded) {
          if (aliasGroup.hasClass('flywheel-graph-details-hidden')) {
            aliasGroup.removeClass('flywheel-graph-details-hidden');
            aliasToggle.setText('- alias suggestions');
          } else {
            aliasGroup.addClass('flywheel-graph-details-hidden');
            aliasToggle.setText('+ alias suggestions');
          }
          return;
        }

        aliasSuggestionsLoaded = true;
        aliasGroup.removeClass('flywheel-graph-details-hidden');
        aliasToggle.setText('- alias suggestions');
        aliasGroup.createDiv('flywheel-graph-section-empty').setText('loading...');

        try {
          const result = await this.mcpClient.suggestEntityAliases(folder);
          aliasGroup.empty();

          if (result.suggestions.length === 0) {
            aliasGroup.createDiv('flywheel-graph-section-empty')
              .setText('No alias suggestions for this folder');
            return;
          }

          for (const s of result.suggestions) {
            const row = aliasGroup.createDiv('flywheel-alias-suggestion');
            row.createSpan('flywheel-alias-entity').setText(s.entity);
            row.createSpan('flywheel-alias-arrow').setText('\u2192');
            row.createSpan('flywheel-alias-candidate').setText(s.candidate);

            if (s.mentions > 0) {
              row.createSpan('flywheel-alias-mentions').setText(`${s.mentions}\u00d7`);
            }

            if (s.mentions > 0) {
              const addBtn = row.createSpan('flywheel-alias-add');
              setIcon(addBtn, 'plus');
              addBtn.setAttribute('aria-label', `Add "${s.candidate}" as alias for ${s.entity}`);
              addBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const newAliases = [...s.current_aliases, s.candidate];
                await this.mcpClient.updateFrontmatter(s.entity_path, { aliases: newAliases });
                row.remove();
                if (aliasGroup.querySelectorAll('.flywheel-alias-suggestion').length === 0) {
                  aliasGroup.createDiv('flywheel-graph-section-empty').setText('All suggestions applied');
                }
              });
            }
          }
        } catch (err) {
          aliasGroup.empty();
          aliasGroup.createDiv('flywheel-graph-section-empty')
            .setText(err instanceof Error ? err.message : 'Failed to load');
        }
      });

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

  private renderNoteHeader(file: TFile, target?: HTMLElement): void {
    const container = target ?? this.noteContainer;
    const header = container.createDiv('flywheel-graph-header');
    header.createDiv('flywheel-graph-note-title').setText(file.basename);

    // Category badge — loads async, renders when ready
    const catBadge = header.createEl('span', { cls: 'flywheel-header-category' });
    catBadge.setText('\u2026'); // placeholder while loading

    this.loadCategoryBadge(file, header, catBadge);
  }

  private async loadCategoryBadge(file: TFile, header: HTMLElement, catBadge: HTMLElement): Promise<void> {
    // Prefer frontmatter type (instant, no index lag) over entity index
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const fmType = fm?.type as string | undefined;

    // Detect periodic notes by path or date-like filename
    const isPeriodic = this.periodicPrefixes.some(prefix => file.path.startsWith(prefix))
      || /^\d{4}-\d{2}-\d{2}/.test(file.basename) || /^\d{4}-W\d{2}/.test(file.basename);

    const cat = (fmType && fmType in CATEGORY_CANVAS_COLORS ? fmType : null)
      ?? (isPeriodic ? 'periodical' : null)
      ?? await this.mcpClient.getEntityCategory(file.path).catch(() => null)
      ?? await this.mcpClient.getEntityCategory(file.basename).catch(() => null)
      ?? 'other';
    catBadge.dataset.category = cat;
    catBadge.empty();
    const badgeDot = catBadge.createEl('span', { cls: 'flywheel-cat-dot' });
    badgeDot.style.background = CATEGORY_CANVAS_COLORS[cat] ?? CATEGORY_CANVAS_COLORS.other;
    catBadge.createEl('span').setText(cat);
    catBadge.setAttribute('aria-label', 'Click to change category');

    const sortedCategories = Object.keys(CATEGORY_CANVAS_COLORS).sort();

    catBadge.addEventListener('click', (e) => {
      e.stopPropagation();
      // Remove existing dropdown if any
      const existing = catBadge.querySelector('.flywheel-category-dropdown');
      if (existing) { existing.remove(); return; }

      const dropdown = catBadge.createDiv('flywheel-category-dropdown');
      for (const c of sortedCategories) {
        const opt = dropdown.createDiv('flywheel-category-option');
        const dot = opt.createEl('span', { cls: 'flywheel-cat-dot' });
        dot.style.background = CATEGORY_CANVAS_COLORS[c];
        opt.createEl('span').setText(c);
        if (c === cat) opt.addClass('is-active');
        opt.addEventListener('click', async () => {
          dropdown.remove();
          // Optimistic update — show chosen category immediately
          catBadge.dataset.category = c;
          catBadge.empty();
          const newDot = catBadge.createEl('span', { cls: 'flywheel-cat-dot' });
          newDot.style.background = CATEGORY_CANVAS_COLORS[c] ?? CATEGORY_CANVAS_COLORS.other;
          catBadge.createEl('span').setText(c);
          await this.mcpClient.updateFrontmatter(file.path, { type: c });
          this.mcpClient.bustEntityCache();
        });
      }

      // Close dropdown on outside click
      const close = (ev: MouseEvent) => {
        if (!dropdown.contains(ev.target as Node)) {
          dropdown.remove();
          document.removeEventListener('click', close, true);
        }
      };
      setTimeout(() => document.addEventListener('click', close, true), 0);
    });
  }

  private async renderNoteSections(file: TFile, generation: number, freshContainer?: HTMLElement): Promise<void> {
    const notePath = file.path;

    try {
      if (generation !== this.renderGeneration) return;

      const noteContent = await this.app.vault.cachedRead(file);
      const [backlinksResp, forwardLinksResp, suggestResp, similarResp, health, semanticResp, connectionsResp, entityHubScores] = await Promise.all([
        this.mcpClient.getBacklinks(notePath).catch(() => null),
        this.mcpClient.getForwardLinks(notePath).catch(() => null),
        this.mcpClient.suggestWikilinks(noteContent, true).catch(() => null),
        this.mcpClient.findSimilar(notePath, 15).catch(() => null),
        this.mcpClient.healthCheck().catch(() => null),
        this.mcpClient.noteIntelligence(notePath, 'semantic_links').catch(() => null),
        this.mcpClient.getStrongConnections(notePath, 30).catch(() => null as McpStrongConnectionsResponse | null),
        this.mcpClient.getEntityHubScores().catch(() => new Map<string, number>()),
      ]);

      if (generation !== this.renderGeneration) return;

      // Swap: replace old content with the fresh container now that data is ready
      if (freshContainer) {
        this.noteContainer.empty();
        while (freshContainer.firstChild) {
          this.noteContainer.appendChild(freshContainer.firstChild);
        }
      }

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
      const uniqueLinks = (forwardLinksResp?.forward_links ?? []).filter(link => {
        const key = link.resolved_path ?? link.target;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Folder chips — compact frontmatter suggestions below header
      await this.renderFolderChips(file, generation);

      const safeBacklinks: McpBacklinksResponse = backlinksResp ?? { backlinks: [] };
      const safeForwardLinks: McpForwardLinksResponse = forwardLinksResp ?? { forward_links: [] };

      // Build edge weight map (used by both cloud tooltips and local graph)
      const edgeWeightMap = new Map<string, number>();
      // Also build a simpler path→weight map for cloud tooltips
      const connectionWeights = new Map<string, number>();
      if (connectionsResp?.connections) {
        for (const conn of connectionsResp.connections) {
          const key = conn.direction === 'outgoing'
            ? `${notePath}\u2192${conn.node}`
            : `${conn.node}\u2192${notePath}`;
          edgeWeightMap.set(key, conn.weight);
          connectionWeights.set(conn.node, conn.weight);
        }
      }

      // Context Cloud — rendered directly (no section wrapper)
      await this.renderContextCloud(safeBacklinks, safeForwardLinks, suggestResp, similarResp, semanticResp, connectionWeights, entityHubScores);

      {
        const { nodes, edges } = await this.buildLocalGraph(notePath, safeBacklinks, safeForwardLinks, edgeWeightMap, entityHubScores, suggestResp, similarResp, connectionsResp);
        const dpr = window.devicePixelRatio || 1;

        if (nodes.length > 1) {
          const graphZone = this.noteContainer.createDiv('flywheel-graph-zone');

          const renderGraph = () => {
            graphZone.empty();
            const W = Math.max(200, this.noteContainer.clientWidth);
            const H = Math.round(W * 0.75);
            this.layoutGraph(nodes, edges, W, H);
            const canvas = this.renderLocalGraphCanvas(graphZone, nodes, edges, W, H);
            const cx = W / 2;
            const cy = H / 2;

            const hitTest = (e: MouseEvent): GraphNode | null => {
              const rect = canvas.getBoundingClientRect();
              const mx = (e.clientX - rect.left) * (canvas.width / rect.width / dpr) - cx;
              const my = (e.clientY - rect.top) * (canvas.height / rect.height / dpr) - cy;
              for (const n of nodes) {
                const dx = mx - n.x;
                const dy = my - n.y;
                if (dx * dx + dy * dy <= (n.radius + 3) ** 2) return n;
              }
              return null;
            };

            canvas.addEventListener('click', (e) => {
              const node = hitTest(e);
              if (node && !node.isCurrent) {
                this.app.workspace.openLinkText(node.id, '', false);
              }
            });

            canvas.addEventListener('mousemove', (e) => {
              const node = hitTest(e);
              canvas.style.cursor = node ? 'pointer' : 'default';
              canvas.title = node ? node.label : '';
            });
          };

          renderGraph();

          // Re-render graph on pane resize
          let lastWidth = this.noteContainer.clientWidth;
          const resizeObs = new ResizeObserver(() => {
            const newWidth = this.noteContainer.clientWidth;
            if (Math.abs(newWidth - lastWidth) > 10) {
              lastWidth = newWidth;
              renderGraph();
            }
          });
          resizeObs.observe(this.noteContainer);
          this.register(() => resizeObs.disconnect());
        }
      }
    } catch (err) {
      console.error('Flywheel Crank: graph sidebar error', err);
      // Retry once after 3s (server may still be starting)
      if (!this._retried) {
        this._retried = true;
        setTimeout(() => {
          this._retried = false;
          this.refresh(true);
        }, 3000);
      }
    }
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

    const unlinkedInfo = 'Entities in your vault that appear in this note\'s content but aren\'t linked yet. ' +
      'The score reflects how relevant the entity is based on: content overlap, co-occurrence patterns, ' +
      'entity importance (hub notes, people), cross-folder connections, recency, and semantic similarity.';

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
    }, true, undefined, undefined, unlinkedInfo);
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

  // ---------------------------------------------------------------------------
  // Context Cloud
  // ---------------------------------------------------------------------------

  private async renderContextCloud(
    backlinksResp: McpBacklinksResponse,
    forwardLinksResp: McpForwardLinksResponse,
    suggestResp: McpSuggestWikilinksResponse | null,
    similarResp: McpSimilarResponse | null,
    semanticResp: import('../mcp/client').McpNoteIntelligenceResponse | null,
    connectionWeights?: Map<string, number>,
    hubScores?: Map<string, number>,
  ): Promise<void> {
    interface CloudEntry {
      name: string;
      path: string | null;
      score: number;
      reasons: string[];
      sources: Set<string>;
      breakdown?: {
        contentMatch: number;
        cooccurrenceBoost: number;
        typeBoost: number;
        contextBoost: number;
        recencyBoost: number;
        crossFolderBoost: number;
        hubBoost: number;
        feedbackAdjustment: number;
        suppressionPenalty?: number;
        semanticBoost?: number;
        edgeWeightBoost?: number;
      };
    }

    const cloud = new Map<string, CloudEntry>();

    const mergeEntry = (key: string, entry: Omit<CloudEntry, 'sources'> & { source: string }) => {
      let existing = cloud.get(key);

      // If no exact key match, check for existing entry with same name
      // (handles path vs bare-name key mismatch from semantic sources)
      if (!existing) {
        for (const [k, v] of cloud) {
          if (v.name.toLowerCase() === entry.name.toLowerCase()) {
            existing = v;
            key = k;
            break;
          }
        }
      }

      if (existing) {
        if (entry.score > existing.score) existing.score = entry.score;
        if (!existing.path && entry.path) existing.path = entry.path;
        if (entry.breakdown && !existing.breakdown) existing.breakdown = entry.breakdown;
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
          breakdown: entry.breakdown,
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
          breakdown: sug.breakdown,
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

    const MIN_CLOUD_SCORE = 0.15;
    const MAX_CLOUD_ITEMS = 50;

    const allEntries = [...cloud.values()].filter(e => e.score > 0);
    const mainEntries = allEntries
      .filter(e => !isPeriodic(e) && e.score >= MIN_CLOUD_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_CLOUD_ITEMS)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    const periodicEntries = allEntries
      .filter(e => isPeriodic(e) && e.score >= MIN_CLOUD_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_CLOUD_ITEMS)
      .sort((a, b) => b.name.localeCompare(a.name, undefined, { sensitivity: 'base' }));

    // Fetch entity categories for pill coloring
    const categoryKeys = allEntries.map(e => e.path ?? e.name);
    const categories = await this.mcpClient.getEntityCategories(categoryKeys).catch(() => new Map<string, string>());

    // Override periodic entries to 'periodical' category
    for (const entry of periodicEntries) {
      const key = entry.path ?? entry.name;
      categories.set(key, 'periodical');
    }

    // Render cloud directly (no section wrapper)
    const cloudZone = this.noteContainer.createDiv('flywheel-cloud-zone');

    if (mainEntries.length > 0) {
      this.renderCloudItems(cloudZone, mainEntries, categories, connectionWeights, hubScores);
    }

    if (periodicEntries.length > 0) {
      const periodicToggle = cloudZone.createDiv('flywheel-cloud-label flywheel-periodic-toggle');
      periodicToggle.setText(`periodic (${periodicEntries.length})`);
      const periodicWrap = cloudZone.createDiv('flywheel-periodic-wrap');
      periodicWrap.style.display = 'none';
      this.renderCloudItems(periodicWrap, periodicEntries, categories, connectionWeights, hubScores);
      periodicToggle.addEventListener('click', () => {
        const hidden = periodicWrap.style.display === 'none';
        periodicWrap.style.display = hidden ? '' : 'none';
        periodicToggle.toggleClass('is-expanded', hidden);
      });
    }

    this.renderCloudLegend(cloudZone, [...mainEntries, ...periodicEntries], categories);
  }

  private renderCloudItems(
    container: HTMLDivElement,
    entries: Array<{ name: string; path: string | null; score: number; reasons: string[]; sources: Set<string>; breakdown?: Record<string, number> }>,
    categories: Map<string, string>,
    connectionWeights?: Map<string, number>,
    hubScores?: Map<string, number>,
  ): void {
    const minScore = Math.min(...entries.map(e => e.score));
    const maxScore = Math.max(...entries.map(e => e.score));
    const scoreRange = maxScore - minScore || 1;

    const cloudEl = container.createDiv('flywheel-cloud');

    // Source priority for border styling (when multiple sources, pick highest priority)
    const SOURCE_PRIORITY = ['backlink', 'forward', 'suggested', 'similar', 'semantic'];

    for (const entry of entries) {
      const t = (entry.score - minScore) / scoreRange; // 0..1

      const item = cloudEl.createEl('span', { cls: 'flywheel-cloud-item' });

      // Category for pill coloring (aligned with graph node colors)
      const cat = categories.get(entry.path ?? '')
        ?? categories.get(entry.name)
        ?? 'other';
      item.dataset.category = cat;

      // Source indicator via left border style
      const isMulti = entry.sources.size > 1;
      const primarySource = SOURCE_PRIORITY.find(s => entry.sources.has(s)) ?? 'suggested';
      if (isMulti) {
        item.dataset.multi = 'true';
      }
      item.dataset.source = primarySource;

      // Store entity name for pipeline pulse matching
      item.dataset.entity = entry.name;

      // Name label — inner span for CSS pill text coloring
      const nameEl = item.createEl('span', { cls: 'flywheel-cloud-name' });
      nameEl.setText(entry.name);
      nameEl.style.opacity = String((0.65 + t * 0.35).toFixed(2));

      // Tooltip: name, sources, reasons first — then 12-stage scores at bottom
      const sourceLabels: string[] = [];
      if (entry.sources.has('backlink')) sourceLabels.push('backlink');
      if (entry.sources.has('forward')) sourceLabels.push('linked');
      if (entry.sources.has('suggested')) sourceLabels.push('suggested');
      if (entry.sources.has('similar')) sourceLabels.push('similar');
      if (entry.sources.has('semantic')) sourceLabels.push('semantic');

      const ew = connectionWeights?.get(entry.path ?? '');
      const nameKey = entry.name.toLowerCase();
      const hs = hubScores?.get(nameKey);

      const tooltipLines = [
        `${entry.name} (${cat})`,
        `Sources: ${sourceLabels.join(', ')}`,
      ];
      if (ew != null) tooltipLines.push(`Edge weight: ${ew.toFixed(1)}`);
      if (hs != null && hs > 0) tooltipLines.push(`Hub score: ${hs.toFixed(1)}`);
      if (entry.reasons.length > 0) tooltipLines.push(...entry.reasons);

      // 12-stage scoring breakdown at the bottom
      if (entry.breakdown) {
        const bd = entry.breakdown;
        const total = bd.contentMatch + bd.cooccurrenceBoost + bd.typeBoost
          + bd.contextBoost + bd.recencyBoost + bd.crossFolderBoost
          + bd.hubBoost + bd.feedbackAdjustment
          + (bd.edgeWeightBoost ?? 0) + (bd.suppressionPenalty ?? 0)
          + (bd.semanticBoost ?? 0);

        const fmt = (v: number) => { const s = v > 0 ? '+' : ''; return `${s}${Math.round(v)}`; };
        tooltipLines.push(
          `\u2500\u2500\u2500 Scoring: ${Math.round(total)} \u2500\u2500\u2500`,
          `  Content:  ${fmt(bd.contentMatch)}`,
          `  Co-occur: ${fmt(bd.cooccurrenceBoost)}`,
          `  Type:     ${fmt(bd.typeBoost)}`,
          `  Context:  ${fmt(bd.contextBoost)}`,
          `  Recency:  ${fmt(bd.recencyBoost)}`,
          `  X-folder: ${fmt(bd.crossFolderBoost)}`,
          `  Hub:      ${fmt(bd.hubBoost)}`,
          `  Edge wt:  ${fmt(bd.edgeWeightBoost ?? 0)}`,
          `  Feedback: ${fmt(bd.feedbackAdjustment)}`,
          `  Suppress: ${fmt(bd.suppressionPenalty ?? 0)}`,
          `  Semantic: ${fmt(bd.semanticBoost ?? 0)}`,
        );
      }

      item.setAttribute('aria-label', tooltipLines.join('\n'));

      // Navigate on click — use path if available, otherwise try name (entity resolution)
      const navTarget = entry.path ?? entry.name;
      if (entry.path || entry.sources.has('semantic') || entry.sources.has('suggested')) {
        item.addEventListener('click', () => {
          this.app.workspace.openLinkText(navTarget, '', false);
        });
      } else {
        item.addClass('flywheel-cloud-dead');
      }
    }
  }

  private renderCloudLegend(
    container: HTMLDivElement,
    entries: Array<{ name: string; path: string | null; sources: Set<string> }>,
    categories: Map<string, string>,
  ): void {
    // Collect unique categories present in the cloud
    const presentCats = new Map<string, number>();
    for (const entry of entries) {
      const cat = categories.get(entry.path ?? '') ?? categories.get(entry.name) ?? 'other';
      presentCats.set(cat, (presentCats.get(cat) ?? 0) + 1);
    }

    // Sort by count descending, show top 6
    const topCats = [...presentCats.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);

    if (topCats.length === 0) return;

    const legendWrap = container.createDiv('flywheel-cloud-legend-wrap');

    // Category row
    const catRow = legendWrap.createDiv('flywheel-cloud-legend');
    for (const [cat] of topCats) {
      const item = catRow.createEl('span', { cls: 'flywheel-legend-item' });
      const dot = item.createEl('span', { cls: 'flywheel-legend-dot' });
      dot.style.background = CATEGORY_CANVAS_COLORS[cat] ?? CATEGORY_CANVAS_COLORS.other;
      item.createEl('span').setText(cat);
    }

    // Source border row
    const sourceStyles: [string, string, string][] = [
      ['backlink', '#60a5fa', 'solid'],
      ['forward', '#4ade80', 'solid'],
      ['suggested', '#fb923c', 'dashed'],
      ['similar', '#c084fc', 'dotted'],
      ['semantic', '#22d3ee', 'double'],
    ];

    const presentSources = new Set<string>();
    for (const entry of entries) {
      for (const s of entry.sources) presentSources.add(s);
    }

    const activeSources = sourceStyles.filter(([label]) => presentSources.has(label));
    if (activeSources.length > 0) {
      const srcRow = legendWrap.createDiv('flywheel-cloud-legend');
      for (const [label, color, style] of activeSources) {
        const item = srcRow.createEl('span', { cls: 'flywheel-legend-item' });
        const line = item.createEl('span', { cls: 'flywheel-legend-line' });
        line.style.borderTop = `2.5px ${style} ${color}`;
        item.createEl('span').setText(label);
      }
      if (presentSources.size > 1) {
        const item = srcRow.createEl('span', { cls: 'flywheel-legend-item' });
        const line = item.createEl('span', { cls: 'flywheel-legend-line' });
        line.style.borderTop = '3px solid var(--text-accent)';
        item.createEl('span').setText('multi');
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
  // Wikilink rendering helper
  // ---------------------------------------------------------------------------

  /** Render text, converting [[wikilinks]] into clickable spans. */
  private renderTextWithWikilinks(el: HTMLElement, text: string): void {
    const wikiRe = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = wikiRe.exec(text)) !== null) {
      if (match.index > lastIndex) {
        el.appendText(text.slice(lastIndex, match.index));
      }
      const target = match[1];
      const display = match[2] || target.split('/').pop() || target;
      const link = el.createSpan('flywheel-task-wikilink');
      link.setText(display);
      link.addEventListener('click', (e) => {
        e.stopPropagation();
        this.app.workspace.openLinkText(target, '', false);
      });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      el.appendText(text.slice(lastIndex));
    }
    if (lastIndex === 0) {
      el.setText(text);
    }
  }

  // ---------------------------------------------------------------------------
  // Local Graph: force-directed 1-hop neighborhood
  // ---------------------------------------------------------------------------

  private async buildLocalGraph(
    notePath: string,
    backlinksResp: McpBacklinksResponse | null,
    forwardLinksResp: McpForwardLinksResponse | null,
    edgeWeightMap: Map<string, number>,
    hubScores: Map<string, number>,
    suggestResp?: McpSuggestWikilinksResponse | null,
    similarResp?: McpSimilarResponse | null,
    connectionsResp?: McpStrongConnectionsResponse | null,
  ): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    const nodeMap = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];
    const edgeSet = new Set<string>();

    const nameOf = (p: string) => p.replace(/\.md$/, '').split('/').pop() || p;
    // Case-insensitive key for nodeMap — prevents duplicates from
    // different MCP sources returning variant casings of the same path
    const nk = (p: string) => p.toLowerCase();
    // Retrieve canonical node ID (original casing) for edge references
    const canonId = (p: string) => nodeMap.get(nk(p))?.id ?? p;

    const isPeriodicPath = (p: string): boolean => {
      if (this.periodicPrefixes.length > 0) {
        return this.periodicPrefixes.some(prefix => p.startsWith(prefix));
      }
      // Fallback: detect date-like filenames (e.g. 2026-02-28, 2026-W09)
      const stem = nameOf(p);
      return /^\d{4}-\d{2}-\d{2}/.test(stem) || /^\d{4}-W\d{2}/.test(stem);
    };

    // Hub score → node radius: base 6, scale by hub score, cap at 14
    const radiusFor = (p: string): number => {
      const name = nameOf(p).toLowerCase();
      const hs = hubScores.get(name) ?? 0;
      return Math.max(6, Math.min(14, 7 + hs * 0.4));
    };

    nodeMap.set(nk(notePath), {
      id: notePath, label: nameOf(notePath),
      x: 0, y: 0, vx: 0, vy: 0,
      radius: 10, color: 'var(--interactive-accent)', isCurrent: true,
    });

    const neighborPaths: string[] = [];

    for (const b of backlinksResp?.backlinks ?? []) {
      const p = b.source;
      if (!nodeMap.has(nk(p))) {
        const periodic = isPeriodicPath(p);
        neighborPaths.push(p);
        nodeMap.set(nk(p), {
          id: p, label: nameOf(p),
          x: (Math.random() - 0.5) * 200, y: (Math.random() - 0.5) * 200,
          vx: 0, vy: 0, radius: periodic ? Math.max(4, radiusFor(p) * 0.7) : radiusFor(p),
          color: CATEGORY_CANVAS_COLORS.other, isCurrent: false,
          isPeriodic: periodic || undefined,
        });
      }
      const cid = canonId(p);
      const key = `${cid}\u2192${notePath}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        const weight = edgeWeightMap.get(key) ?? 1.0;
        edges.push({ source: cid, target: notePath, weight });
      }
    }

    for (const f of forwardLinksResp?.forward_links ?? []) {
      const p = f.resolved_path ?? f.target;
      if (!p || !f.exists) continue;
      if (!nodeMap.has(nk(p))) {
        const periodic = isPeriodicPath(p);
        neighborPaths.push(p);
        nodeMap.set(nk(p), {
          id: p, label: nameOf(p),
          x: (Math.random() - 0.5) * 200, y: (Math.random() - 0.5) * 200,
          vx: 0, vy: 0, radius: periodic ? Math.max(4, radiusFor(p) * 0.7) : radiusFor(p),
          color: CATEGORY_CANVAS_COLORS.other, isCurrent: false,
          isPeriodic: periodic || undefined,
        });
      }
      const cid = canonId(p);
      const key = `${notePath}\u2192${cid}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        const weight = edgeWeightMap.get(key) ?? 1.0;
        edges.push({ source: notePath, target: cid, weight });
      }
    }

    // Cap neighbors to avoid overcrowded graphs — keep highest-weight edges
    const MAX_NEIGHBORS = 8;
    if (neighborPaths.length > MAX_NEIGHBORS) {
      const ranked = edges
        .map(e => ({ path: e.source === notePath ? e.target : e.source, weight: e.weight }))
        .sort((a, b) => b.weight - a.weight);
      const keep = new Set(ranked.slice(0, MAX_NEIGHBORS).map(r => r.path));
      for (const p of neighborPaths) {
        if (!keep.has(p)) {
          nodeMap.delete(nk(p));
        }
      }
      // Remove edges to pruned nodes
      edges.length = 0;
      for (const key of edgeSet) {
        const [src, tgt] = key.split('\u2192');
        if (nodeMap.has(nk(src)) && nodeMap.has(nk(tgt))) {
          edges.push({ source: src, target: tgt, weight: edgeWeightMap.get(key) ?? 1.0 });
        }
      }
    }

    // Fill graph with context from suggestions, similar, and strong connections
    // so the graph is always dense-ish (target ~15 primary nodes)
    const TARGET_PRIMARY = 15;
    const currentPrimaryCount = [...nodeMap.values()].filter(n => !n.isSecondary).length;
    const slotsAvailable = Math.max(0, TARGET_PRIMARY - currentPrimaryCount);

    if (slotsAvailable > 0) {
      // Collect candidate paths from all context sources, ranked by relevance
      const candidates: { path: string; weight: number; source: 'suggestion' | 'similar' | 'connection' }[] = [];

      // Strong connections not already in graph
      if (connectionsResp?.connections) {
        for (const conn of connectionsResp.connections) {
          if (!nodeMap.has(nk(conn.node)) && nk(conn.node) !== nk(notePath)) {
            candidates.push({ path: conn.node, weight: conn.weight, source: 'connection' });
          }
        }
      }

      // Suggested wikilinks (entity name → need to resolve path; use name as ID)
      if (suggestResp?.scored_suggestions) {
        for (const sug of suggestResp.scored_suggestions) {
          const p = sug.existing_note ?? sug.entity;
          if (!nodeMap.has(nk(p)) && nk(p) !== nk(notePath) && sug.confidence !== 'low') {
            candidates.push({ path: p, weight: sug.score / 30, source: 'suggestion' });
          }
        }
      }

      // Similar notes
      if (similarResp?.similar) {
        for (const sim of similarResp.similar) {
          if (!nodeMap.has(nk(sim.path)) && nk(sim.path) !== nk(notePath)) {
            candidates.push({ path: sim.path, weight: sim.score / 100, source: 'similar' });
          }
        }
      }

      // Sort by weight descending, take what we need
      candidates.sort((a, b) => b.weight - a.weight);
      const fillNodes = candidates.slice(0, slotsAvailable);

      for (const c of fillNodes) {
        if (nodeMap.has(nk(c.path))) continue; // skip if added by earlier candidate
        const periodic = isPeriodicPath(c.path);
        nodeMap.set(nk(c.path), {
          id: c.path, label: nameOf(c.path),
          x: (Math.random() - 0.5) * 200, y: (Math.random() - 0.5) * 200,
          vx: 0, vy: 0,
          radius: periodic ? Math.max(4, radiusFor(c.path) * 0.7) : radiusFor(c.path),
          color: CATEGORY_CANVAS_COLORS.other, isCurrent: false,
          isPeriodic: periodic || undefined,
        });
        // Add a soft edge to the current note
        const eKey = `${notePath}\u2192${c.path}`;
        if (!edgeSet.has(eKey)) {
          edgeSet.add(eKey);
          edges.push({ source: notePath, target: c.path, weight: Math.max(0.3, c.weight * 0.5) });
        }
      }
    }

    // N+1 hops: expand top hub neighbors to show bridge structure
    try {
      const MAX_SECONDARY = 5; // expand up to 5 hub neighbors
      const MAX_SECONDARY_EDGES = 6; // up to 6 connections per expanded hub
      const currentNeighbors = [...nodeMap.keys()].filter(p => p !== notePath);
      const hubNeighbors = currentNeighbors
        .map(p => ({ path: p, hs: hubScores.get(nameOf(p).toLowerCase()) ?? 0 }))
        .filter(n => n.hs > 0)
        .sort((a, b) => b.hs - a.hs)
        .slice(0, MAX_SECONDARY);

      if (hubNeighbors.length > 0) {
        const secondaryFetches = hubNeighbors.map(n =>
          this.mcpClient.getStrongConnections(n.path, MAX_SECONDARY_EDGES + 2).catch(() => null)
        );
        const secondaryResults = await Promise.all(secondaryFetches);

        for (let i = 0; i < hubNeighbors.length; i++) {
          const hubPath = hubNeighbors[i].path;
          const conns = secondaryResults[i]?.connections;
          if (!conns) continue;

          for (const conn of conns.slice(0, MAX_SECONDARY_EDGES)) {
            const p2 = conn.node;
            // Skip if already in graph or is the current note
            if (nodeMap.has(nk(p2)) || nk(p2) === nk(notePath)) {
              // Still add the inter-neighbor edge if both nodes exist
              const cid2 = canonId(p2);
              const cidHub = canonId(hubPath);
              if (nodeMap.has(nk(p2)) && nk(p2) !== nk(notePath)) {
                const dir = conn.direction ?? 'outgoing';
                const eKey = dir === 'outgoing' ? `${cidHub}\u2192${cid2}` : `${cid2}\u2192${cidHub}`;
                if (!edgeSet.has(eKey)) {
                  edgeSet.add(eKey);
                  edges.push({ source: cidHub, target: cid2, weight: conn.weight * 0.5 });
                }
              }
              continue;
            }

            // Add secondary node — smaller, faded
            const hubNode = nodeMap.get(nk(hubPath))!;
            const periodic2 = isPeriodicPath(p2);
            nodeMap.set(nk(p2), {
              id: p2, label: nameOf(p2),
              x: hubNode.x + (Math.random() - 0.5) * 80,
              y: hubNode.y + (Math.random() - 0.5) * 80,
              vx: 0, vy: 0,
              radius: Math.max(4, radiusFor(p2) * 0.7),
              color: CATEGORY_CANVAS_COLORS.other,
              isCurrent: false,
              isSecondary: true,
              isPeriodic: periodic2 || undefined,
            });

            const cidHub = canonId(hubPath);
            const dir = conn.direction ?? 'outgoing';
            const eKey = dir === 'outgoing' ? `${cidHub}\u2192${p2}` : `${p2}\u2192${cidHub}`;
            if (!edgeSet.has(eKey)) {
              edgeSet.add(eKey);
              edges.push({ source: cidHub, target: p2, weight: conn.weight * 0.5 });
            }
          }
        }
      }
    } catch (err) {
      console.error('Flywheel: N+1 hub expansion failed, skipping', err);
    }

    // Batch-fetch category colors for all visible nodes
    // Use original node IDs (not lowercase keys) for the MCP category query
    const visibleNodes = [...nodeMap.values()].filter(n => !n.isCurrent);
    const visibleIds = visibleNodes.map(n => n.id);
    const catMap = await this.mcpClient.getEntityCategories(visibleIds).catch(() => new Map<string, string>());
    for (const node of visibleNodes) {
      // Periodic notes get their own muted color regardless of entity category
      const cat = node.isPeriodic ? 'periodical' : (catMap.get(node.id) ?? 'other');
      node.color = CATEGORY_CANVAS_COLORS[cat] ?? CATEGORY_CANVAS_COLORS.other;
    }

    return { nodes: Array.from(nodeMap.values()), edges };
  }

  private layoutGraph(nodes: GraphNode[], edges: GraphEdge[], width: number, height: number): void {
    if (nodes.length <= 1) return;

    const area = width * height;
    const k = Math.sqrt(area / nodes.length);
    const ITERATIONS = 60;
    let temperature = width / 10;
    const cooling = temperature / ITERATIONS;

    for (let iter = 0; iter < ITERATIONS; iter++) {
      for (const n of nodes) { n.vx = 0; n.vy = 0; }

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
          const force = (k * k) / dist;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          nodes[i].vx += fx; nodes[i].vy += fy;
          nodes[j].vx -= fx; nodes[j].vy -= fy;
        }
      }

      for (const e of edges) {
        const src = nodes.find(n => n.id === e.source);
        const tgt = nodes.find(n => n.id === e.target);
        if (!src || !tgt) continue;
        const dx = src.x - tgt.x;
        const dy = src.y - tgt.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
        const force = (dist * dist) / k;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        src.vx -= fx; src.vy -= fy;
        tgt.vx += fx; tgt.vy += fy;
      }

      // Push periodic notes away from center (centrifugal force)
      for (const n of nodes) {
        if (n.isPeriodic && !n.isCurrent) {
          const dist = Math.max(Math.sqrt(n.x * n.x + n.y * n.y), 0.01);
          const push = k * 1.5; // strong outward force
          n.vx += (n.x / dist) * push;
          n.vy += (n.y / dist) * push;
        }
      }

      for (const n of nodes) {
        if (n.isCurrent) continue;
        const disp = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
        if (disp > 0) {
          const capped = Math.min(disp, temperature);
          n.x += (n.vx / disp) * capped;
          n.y += (n.vy / disp) * capped;
        }
        const hw = width / 2 - 40;
        const hh = height / 2 - 40;
        n.x = Math.max(-hw, Math.min(hw, n.x));
        n.y = Math.max(-hh, Math.min(hh, n.y));
      }

      temperature -= cooling;
    }
  }

  private renderLocalGraphCanvas(
    container: HTMLElement,
    nodes: GraphNode[],
    edges: GraphEdge[],
    width: number,
    height: number,
  ): HTMLCanvasElement {
    const dpr = window.devicePixelRatio || 1;
    const canvas = container.createEl('canvas', { cls: 'flywheel-local-graph-canvas' });
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);

    const cx = width / 2;
    const cy = height / 2;

    ctx.clearRect(0, 0, width, height);

    // Edges — thickness + opacity scaled by edge weight
    for (const e of edges) {
      const src = nodes.find(n => n.id === e.source);
      const tgt = nodes.find(n => n.id === e.target);
      if (!src || !tgt) continue;
      ctx.beginPath();
      ctx.moveTo(cx + src.x, cy + src.y);
      ctx.lineTo(cx + tgt.x, cy + tgt.y);
      const isPeriodicEdge = src.isPeriodic || tgt.isPeriodic;
      const isSecondaryEdge = src.isSecondary || tgt.isSecondary;
      const isDimEdge = isPeriodicEdge || isSecondaryEdge;
      ctx.lineWidth = isDimEdge ? 1 : Math.min(1 + e.weight * 0.8, 5);
      const alpha = isPeriodicEdge ? 0.15 : isSecondaryEdge ? 0.25 : Math.min(0.3 + e.weight * 0.15, 0.7);
      ctx.strokeStyle = `rgba(128, 128, 128, ${alpha.toFixed(2)})`;
      ctx.setLineDash(isDimEdge ? [3, 3] : []);
      ctx.stroke();
    }

    // Nodes
    for (const n of nodes) {
      ctx.beginPath();
      ctx.arc(cx + n.x, cy + n.y, n.radius, 0, Math.PI * 2);
      ctx.globalAlpha = n.isPeriodic ? 0.3 : n.isSecondary ? 0.45 : 1;
      // Resolve CSS var for current node color
      if (n.isCurrent) {
        ctx.fillStyle = getComputedStyle(container).getPropertyValue('--interactive-accent').trim() || '#7c3aed';
      } else {
        ctx.fillStyle = n.color;
      }
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Labels
    const textColor = getComputedStyle(container).color || '#ccc';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const n of nodes) {
      ctx.globalAlpha = n.isPeriodic ? 0.25 : n.isSecondary ? 0.4 : 1;
      ctx.fillStyle = textColor;
      ctx.font = n.isCurrent ? 'bold 14px -apple-system, sans-serif'
        : (n.isSecondary || n.isPeriodic) ? '11px -apple-system, sans-serif'
        : '12px -apple-system, sans-serif';
      const maxLen = n.isSecondary ? 14 : 18;
      const label = n.label.length > maxLen ? n.label.slice(0, maxLen - 2) + '\u2026' : n.label;
      ctx.fillText(label, cx + n.x, cy + n.y + n.radius + 3);
      ctx.globalAlpha = 1;
    }

    return canvas;
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
    info?: string,
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

    if (info) {
      const infoIcon = headerEl.createSpan('flywheel-graph-section-info');
      setIcon(infoIcon, 'info');
      infoIcon.setAttribute('aria-label', info);
      infoIcon.addEventListener('click', (e) => e.stopPropagation());
    }

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
    if (this.healthUnsub) { this.healthUnsub(); this.healthUnsub = null; }
    if (this.pipelineUnsub) { this.pipelineUnsub(); this.pipelineUnsub = null; }
    this.contentContainer?.empty();
  }

  // ---------------------------------------------------------------------------
  // Pipeline pulse — animate cloud pills on pipeline events (T4 + T5)
  // ---------------------------------------------------------------------------

  private handlePipelineUpdate(health: McpHealthCheckResponse): void {
    const pipeline = health.last_pipeline;
    if (!pipeline) return;

    // Collect entity names affected by pipeline steps
    const affectedEntities = new Set<string>();

    const entityStep = pipeline.steps?.find(s => s.name === 'entity_scan');
    if (entityStep && !entityStep.skipped) {
      const added = (entityStep.output?.added as Array<string | { name: string }>) ?? [];
      const removed = (entityStep.output?.removed as Array<string | { name: string }>) ?? [];
      for (const e of added) affectedEntities.add(typeof e === 'string' ? e : e.name);
      for (const e of removed) affectedEntities.add(typeof e === 'string' ? e : e.name);
    }

    const wlStep = pipeline.steps?.find(s => s.name === 'wikilink_check');
    if (wlStep && !wlStep.skipped) {
      const mentions = (wlStep.output?.mentions as Array<{ entities: string[] }>) ?? [];
      for (const m of mentions) for (const e of m.entities ?? []) affectedEntities.add(e);
    }

    const fbStep = pipeline.steps?.find(s => s.name === 'implicit_feedback');
    if (fbStep && !fbStep.skipped) {
      const removals = (fbStep.output?.removals as Array<{ entity: string }>) ?? [];
      for (const r of removals) affectedEntities.add(r.entity);
    }

    // Collect hub_score diffs for floating score changes (T5)
    const hubStep = pipeline.steps?.find(s => s.name === 'hub_scores');
    const hubDiffs = new Map<string, number>();
    if (hubStep && !hubStep.skipped) {
      const diffs = (hubStep.output?.diffs as Array<{ entity: string; before: number; after: number }>) ?? [];
      for (const d of diffs) {
        const delta = d.after - d.before;
        if (delta !== 0) {
          hubDiffs.set(d.entity, delta);
          affectedEntities.add(d.entity);
        }
      }
    }

    if (affectedEntities.size === 0) return;

    // Find matching cloud pills and animate
    const cloudItems = this.contentContainer?.querySelectorAll('.flywheel-cloud-item[data-entity]');
    if (!cloudItems) return;

    for (const el of Array.from(cloudItems)) {
      const entityName = (el as HTMLElement).dataset.entity;
      if (!entityName) continue;

      const matched = affectedEntities.has(entityName) ||
        Array.from(affectedEntities).some(e => e.toLowerCase() === entityName.toLowerCase());

      if (!matched) continue;

      // Pulse animation (T4)
      el.classList.remove('flywheel-cloud-pulse');
      void (el as HTMLElement).offsetWidth; // force reflow to re-trigger
      el.classList.add('flywheel-cloud-pulse');
      el.addEventListener('animationend', () => el.classList.remove('flywheel-cloud-pulse'), { once: true });

      // Floating score change (T5)
      const delta = hubDiffs.get(entityName) ??
        Array.from(hubDiffs.entries()).find(([k]) => k.toLowerCase() === entityName.toLowerCase())?.[1];
      if (delta != null) {
        const rect = (el as HTMLElement).getBoundingClientRect();
        const parentRect = this.contentContainer!.getBoundingClientRect();
        const floater = document.createElement('span');
        floater.className = `flywheel-cloud-score-float ${delta > 0 ? 'flywheel-cloud-score-float-up' : 'flywheel-cloud-score-float-down'}`;
        floater.textContent = delta > 0 ? `+${delta}` : `${delta}`;
        floater.style.left = `${rect.left - parentRect.left + rect.width / 2}px`;
        floater.style.top = `${rect.top - parentRect.top}px`;
        this.contentContainer!.style.position = 'relative';
        this.contentContainer!.appendChild(floater);
        floater.addEventListener('animationend', () => floater.remove());
      }
    }
  }
}
