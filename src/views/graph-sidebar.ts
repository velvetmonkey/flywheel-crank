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
  /** Fine-grained entity category (e.g. "people", "technologies") */
  category?: string;
  /** 2-hop node — rendered smaller and more faded */
  isSecondary?: boolean;
  /** Periodic note (daily, weekly, etc.) — dimmed and pushed outward */
  isPeriodic?: boolean;
  /** Forward link target that doesn't have its own note */
  isDeadLink?: boolean;
  /** Pill dimensions (computed at render time from text measurement) */
  pillWidth?: number;
  pillHeight?: number;
  /** How this node entered the graph (backlink, forward, suggested, similar, connection) */
  sources?: Set<string>;
  /** Hub score for tooltip */
  hubScore?: number;
  /** Edge weight to current note for tooltip */
  edgeWeight?: number;
  /** Pre-built tooltip text */
  tooltip?: string;
}

/** HSLA fill colors for pill backgrounds on canvas — colorful families only.
 *  Grey family reads --interactive-normal at render time for theme adaptation. */
const FAMILY_FILL: Record<string, { dark: string; light: string }> = {
  blue:   { dark: 'hsla(220, 80%, 60%, 0.40)', light: 'hsl(220, 65%, 55%)' },
  green:  { dark: 'hsla(150, 70%, 50%, 0.40)', light: 'hsl(150, 55%, 42%)' },
  orange: { dark: 'hsla(25, 90%, 60%, 0.40)',  light: 'hsl(25, 75%, 52%)' },
  purple: { dark: 'hsla(270, 70%, 65%, 0.40)', light: 'hsl(270, 55%, 58%)' },
  red:    { dark: 'hsla(0, 75%, 60%, 0.40)',   light: 'hsl(0, 60%, 55%)' },
};

/** Resolve category → pill fill color for canvas rendering. */
function familyFill(category: string): string {
  const family = CATEGORY_FAMILY[category] ?? 'gray';
  if (family === 'gray') {
    return getComputedStyle(document.body).getPropertyValue('--interactive-normal').trim() || 'rgba(128,128,128,0.2)';
  }
  const isLight = document.body.classList.contains('theme-light');
  return FAMILY_FILL[family]?.[isLight ? 'light' : 'dark'] ?? 'rgba(128,128,128,0.3)';
}

interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}

/** Map each fine-grained entity category to one of 6 color families. */
const CATEGORY_FAMILY: Record<string, string> = {
  people: 'blue',        organizations: 'blue',
  technologies: 'green', documents: 'green',     acronyms: 'green',
  locations: 'orange',   events: 'orange',       vehicles: 'orange',
  concepts: 'purple',    projects: 'purple',     hobbies: 'purple',   media: 'purple',
  health: 'red',         food: 'red',            animals: 'red',
  periodical: 'gray',    finance: 'gray',        other: 'gray',
};

/** Map color families to Obsidian CSS custom property names.
 *  These auto-adapt between light/dark themes — no manual overrides needed. */
const FAMILY_CSS_VAR: Record<string, string> = {
  blue: '--color-blue',
  green: '--color-green',
  orange: '--color-orange',
  purple: '--color-purple',
  red: '--color-red',
  gray: '--text-muted',
};

/** Hardcoded fallbacks only used when CSS vars are unavailable. */
const FAMILY_COLORS_FALLBACK: Record<string, string> = {
  blue: '#6EA8FE', green: '#4ADE80', orange: '#FB923C',
  purple: '#C084FC', red: '#F87171', gray: '#94A3B8',
};

/** Resolve category → family color, reading Obsidian's theme-aware CSS variables. */
function familyColor(category: string): string {
  const family = CATEGORY_FAMILY[category] ?? 'gray';
  const cssVar = FAMILY_CSS_VAR[family] ?? '--text-muted';
  return getComputedStyle(document.body).getPropertyValue(cssVar).trim()
    || FAMILY_COLORS_FALLBACK[family] || '#888';
}

/** Single-letter glyphs for canvas node rendering. Unique per category. */
const CATEGORY_GLYPH: Record<string, string> = {
  people: 'P', organizations: 'O', technologies: 'T', locations: 'L',
  concepts: 'C', animals: 'A', media: 'M', events: 'E',
  documents: 'D', vehicles: 'V', health: 'H', finance: 'F',
  food: 'W', projects: 'J', hobbies: 'B', acronyms: '#',
  periodical: '~', other: '\u00B7',
};

/** Human-readable family labels for the legend. */
const FAMILY_LABELS: Record<string, string> = {
  blue: 'people & orgs',
  green: 'tech & docs',
  orange: 'places & events',
  purple: 'ideas & projects',
  red: 'living things',
  gray: 'other',
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

    const cat = (fmType && fmType in CATEGORY_FAMILY ? fmType : null)
      ?? (isPeriodic ? 'periodical' : null)
      ?? await this.mcpClient.getEntityCategory(file.path).catch(() => null)
      ?? await this.mcpClient.getEntityCategory(file.basename).catch(() => null)
      ?? 'other';
    catBadge.dataset.category = cat;
    catBadge.empty();
    const badgeDot = catBadge.createEl('span', { cls: 'flywheel-cat-dot' });
    badgeDot.style.background = familyColor(cat);
    catBadge.createEl('span').setText(cat);
    catBadge.setAttribute('aria-label', 'Click to change category');

    const sortedCategories = Object.keys(CATEGORY_FAMILY).sort();

    catBadge.addEventListener('click', (e) => {
      e.stopPropagation();
      // Remove existing dropdown if any
      const existing = catBadge.querySelector('.flywheel-category-dropdown');
      if (existing) { existing.remove(); catBadge.removeClass('dropdown-open'); return; }

      catBadge.addClass('dropdown-open');
      const dropdown = catBadge.createDiv('flywheel-category-dropdown');
      for (const c of sortedCategories) {
        const opt = dropdown.createDiv('flywheel-category-option');
        const dot = opt.createEl('span', { cls: 'flywheel-cat-dot' });
        dot.style.background = familyColor(c);
        opt.createEl('span').setText(c);
        if (c === cat) opt.addClass('is-active');
        opt.addEventListener('click', async () => {
          dropdown.remove();
          catBadge.removeClass('dropdown-open');
          // Optimistic update — show chosen category immediately
          catBadge.dataset.category = c;
          catBadge.empty();
          const newDot = catBadge.createEl('span', { cls: 'flywheel-cat-dot' });
          newDot.style.background = familyColor(c);
          catBadge.createEl('span').setText(c);
          await this.mcpClient.updateFrontmatter(file.path, { type: c });
          this.mcpClient.bustEntityCache();
        });
      }

      // Close dropdown on outside click
      const close = (ev: MouseEvent) => {
        if (!dropdown.contains(ev.target as Node)) {
          dropdown.remove();
          catBadge.removeClass('dropdown-open');
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

      // Swap: replace old content with fresh container now that data is ready
      if (freshContainer) {
        this.noteContainer.empty();
        while (freshContainer.firstChild) {
          this.noteContainer.appendChild(freshContainer.firstChild);
        }
      }

      // Folder chips (independent MCP call, renders into noteContainer)
      this.renderFolderChips(file, generation);

      // Ensure periodic prefixes are set for cloud splitting
      if (this.periodicPrefixes.length === 0 && health?.config) {
        const paths = (health.config as Record<string, any>).paths as Record<string, string> | undefined;
        if (paths) {
          this.periodicPrefixes = Object.entries(paths)
            .filter(([key, p]) => key !== 'templates' && !!p)
            .map(([, p]) => p.endsWith('/') ? p : `${p}/`);
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

      const safeBacklinks = backlinksResp ?? { note: '', backlink_count: 0, returned_count: 0, backlinks: [] as McpBacklinksResponse['backlinks'] };
      const safeForwardLinks = forwardLinksResp ?? { note: '', forward_link_count: 0, forward_links: [] as McpForwardLinksResponse['forward_links'] };

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

      // Fetch entity categories for graph node coloring
      const categoryPaths: string[] = [];
      for (const b of safeBacklinks.backlinks) categoryPaths.push(b.source);
      for (const f of safeForwardLinks.forward_links) categoryPaths.push(f.resolved_path ?? f.target);
      if (suggestResp?.scored_suggestions) {
        for (const s of suggestResp.scored_suggestions) categoryPaths.push(s.path ?? s.entity);
      }
      if (similarResp?.similar) {
        for (const s of similarResp.similar) categoryPaths.push(s.path);
      }
      const categoryMap = await this.mcpClient.getEntityCategories(categoryPaths).catch(() => new Map<string, string>());

      {
        const { nodes, edges } = await this.buildLocalGraph(notePath, safeBacklinks, safeForwardLinks, edgeWeightMap, entityHubScores, suggestResp, similarResp, connectionsResp, categoryMap);

        // Enrich nodes with scoring breakdown tooltips
        const sugBreakdowns = new Map<string, Record<string, number>>();
        if (suggestResp?.scored_suggestions) {
          for (const sug of suggestResp.scored_suggestions) {
            if (sug.breakdown) sugBreakdowns.set((sug.path ?? sug.entity).toLowerCase(), sug.breakdown);
          }
        }
        const fmt = (v: number) => { const s = v > 0 ? '+' : ''; return `${s}${Math.round(v)}`; };
        for (const n of nodes) {
          if (n.isCurrent) continue;
          const lines = [`${n.label} (${n.category ?? 'other'})`];
          if (n.sources && n.sources.size > 0) lines.push(`Sources: ${[...n.sources].join(', ')}`);
          if (n.hubScore) lines.push(`Hub score: ${n.hubScore.toFixed(1)}`);
          if (n.edgeWeight) lines.push(`Edge weight: ${n.edgeWeight.toFixed(1)}`);
          const bd = sugBreakdowns.get(n.id.toLowerCase()) ?? sugBreakdowns.get(n.label.toLowerCase());
          if (bd) {
            const total = (bd.contentMatch ?? 0) + (bd.cooccurrenceBoost ?? 0) + (bd.typeBoost ?? 0)
              + (bd.contextBoost ?? 0) + (bd.recencyBoost ?? 0) + (bd.crossFolderBoost ?? 0)
              + (bd.hubBoost ?? 0) + (bd.feedbackAdjustment ?? 0)
              + (bd.edgeWeightBoost ?? 0) + (bd.suppressionPenalty ?? 0) + (bd.semanticBoost ?? 0);
            lines.push(
              `\u2500\u2500\u2500 Score: ${Math.round(total)} \u2500\u2500\u2500`,
              `  Content:  ${fmt(bd.contentMatch ?? 0)}`,
              `  Co-occur: ${fmt(bd.cooccurrenceBoost ?? 0)}`,
              `  Type:     ${fmt(bd.typeBoost ?? 0)}`,
              `  Context:  ${fmt(bd.contextBoost ?? 0)}`,
              `  Recency:  ${fmt(bd.recencyBoost ?? 0)}`,
              `  X-folder: ${fmt(bd.crossFolderBoost ?? 0)}`,
              `  Hub:      ${fmt(bd.hubBoost ?? 0)}`,
              `  Edge wt:  ${fmt(bd.edgeWeightBoost ?? 0)}`,
              `  Feedback: ${fmt(bd.feedbackAdjustment ?? 0)}`,
              `  Suppress: ${fmt(bd.suppressionPenalty ?? 0)}`,
              `  Semantic: ${fmt(bd.semanticBoost ?? 0)}`,
            );
          }
          n.tooltip = lines.join('\n');
        }

        const dpr = window.devicePixelRatio || 1;

        if (nodes.length > 1) {
          const graphZone = this.noteContainer.createDiv('flywheel-graph-zone');

          const renderGraph = () => {
            graphZone.empty();
            // Render legend first so we can measure it
            this.renderGraphLegend(graphZone, nodes);
            const legendEl = graphZone.querySelector('.flywheel-graph-legend-wrap') as HTMLElement;
            const W = Math.max(200, this.noteContainer.clientWidth);
            // graphZone top relative to pane, minus legend height and status bar
            const zoneTop = graphZone.getBoundingClientRect().top - this.containerEl.getBoundingClientRect().top;
            const legendH = legendEl ? legendEl.offsetHeight + 8 : 80;
            const available = this.containerEl.clientHeight - zoneTop - legendH - 30;
            const H = Math.max(200, available);
            // Pre-compute pill dimensions for layout collision
            const measureCanvas = document.createElement('canvas');
            const mctx = measureCanvas.getContext('2d')!;
            const PILL_PAD_X = 12;
            const PILL_PAD_Y = 6;
            for (const n of nodes) {
              const fs = n.isCurrent ? 13 : (n.isSecondary || n.isPeriodic) ? 10 : 11;
              mctx.font = `${n.isCurrent ? 'bold ' : ''}${fs}px -apple-system, sans-serif`;
              const maxLen = n.isSecondary ? 14 : 20;
              const lbl = n.label.length > maxLen ? n.label.slice(0, maxLen - 1) + '\u2026' : n.label;
              n.pillWidth = mctx.measureText(lbl).width + PILL_PAD_X * 2;
              n.pillHeight = fs + PILL_PAD_Y * 2;
            }
            this.layoutGraph(nodes, edges, W, H);
            // Insert canvas before legend
            const canvas = this.renderLocalGraphCanvas(graphZone, nodes, edges, W, H);
            if (legendEl) graphZone.insertBefore(canvas, legendEl);
            const cx = W / 2;
            const cy = H / 2;

            const hitTest = (e: MouseEvent): GraphNode | null => {
              const rect = canvas.getBoundingClientRect();
              const mx = (e.clientX - rect.left) * (canvas.width / rect.width / dpr) - cx;
              const my = (e.clientY - rect.top) * (canvas.height / rect.height / dpr) - cy;
              for (const n of nodes) {
                // Pill bounding box hit test
                const hw = (n.pillWidth ?? n.radius * 2) / 2 + 2;
                const hh = (n.pillHeight ?? n.radius * 2) / 2 + 2;
                if (Math.abs(mx - n.x) <= hw && Math.abs(my - n.y) <= hh) return n;
              }
              return null;
            };

            canvas.addEventListener('click', (e) => {
              const node = hitTest(e);
              if (node && !node.isCurrent) {
                this.app.workspace.openLinkText(node.id, '', false);
              }
            });

            // Custom tooltip overlay (native title is too small)
            const tip = graphZone.createDiv('flywheel-graph-tooltip');
            let lastTipNode: GraphNode | null = null;

            canvas.addEventListener('mousemove', (e) => {
              const node = hitTest(e);
              canvas.style.cursor = node ? 'pointer' : 'default';
              if (node && node !== lastTipNode) {
                tip.setText(''); // clear
                const text = node.tooltip ?? node.label;
                for (const line of text.split('\n')) {
                  tip.createDiv().setText(line);
                }
                tip.style.display = 'block';
              } else if (!node) {
                tip.style.display = 'none';
              }
              lastTipNode = node;
              if (node) {
                const rect = canvas.getBoundingClientRect();
                const zoneRect = graphZone.getBoundingClientRect();
                const tipX = e.clientX - zoneRect.left + 12;
                const tipY = e.clientY - zoneRect.top - 10;
                tip.style.left = `${tipX}px`;
                tip.style.top = `${tipY}px`;
                // Keep tooltip in bounds
                requestAnimationFrame(() => {
                  const tipRect = tip.getBoundingClientRect();
                  if (tipRect.right > zoneRect.right - 4) {
                    tip.style.left = `${tipX - tipRect.width - 24}px`;
                  }
                  if (tipRect.bottom > zoneRect.bottom - 4) {
                    tip.style.top = `${tipY - tipRect.height}px`;
                  }
                });
              }
            });
            canvas.addEventListener('mouseleave', () => {
              tip.style.display = 'none';
              lastTipNode = null;
            });
          };

          renderGraph();

          // Re-render graph on pane resize (width or height)
          let lastWidth = this.noteContainer.clientWidth;
          let lastHeight = this.containerEl.clientHeight;
          const resizeObs = new ResizeObserver(() => {
            const newWidth = this.noteContainer.clientWidth;
            const newHeight = this.containerEl.clientHeight;
            if (Math.abs(newWidth - lastWidth) > 10 || Math.abs(newHeight - lastHeight) > 15) {
              lastWidth = newWidth;
              lastHeight = newHeight;
              renderGraph();
            }
          });
          resizeObs.observe(this.containerEl);
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

    const MIN_CLOUD_SCORE = 0.30;
    const MAX_CLOUD_ITEMS = 20;
    const MAX_PERIODIC_ITEMS = 5;

    const allEntries = [...cloud.values()].filter(e => e.score > 0);
    const mainEntries = allEntries
      .filter(e => !isPeriodic(e) && e.score >= MIN_CLOUD_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_CLOUD_ITEMS)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    const periodicEntries = allEntries
      .filter(e => isPeriodic(e) && e.score >= MIN_CLOUD_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_PERIODIC_ITEMS)
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
      cloudZone.createDiv('flywheel-cloud-label').setText(`periodic (${periodicEntries.length})`);
      this.renderCloudItems(cloudZone, periodicEntries, categories, connectionWeights, hubScores);
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
      const cat = categories.get((entry.path ?? '').toLowerCase())
        ?? categories.get(entry.name.toLowerCase())
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
        item.addEventListener('click', () => {
          this.app.workspace.openLinkText(navTarget, '', false);
        });
      }
    }
  }

  private renderCloudLegend(
    container: HTMLDivElement,
    entries: Array<{ name: string; path: string | null; sources: Set<string> }>,
    categories: Map<string, string>,
  ): void {
    // Collect color families present in the cloud (group 18 categories → 6 families)
    const presentFamilies = new Map<string, number>();
    for (const entry of entries) {
      const cat = categories.get((entry.path ?? '').toLowerCase()) ?? categories.get(entry.name.toLowerCase()) ?? 'other';
      const family = CATEGORY_FAMILY[cat] ?? 'gray';
      presentFamilies.set(family, (presentFamilies.get(family) ?? 0) + 1);
    }

    // Sort by count descending, show only families present
    const topFamilies = [...presentFamilies.entries()]
      .sort((a, b) => b[1] - a[1]);

    if (topFamilies.length === 0) return;

    const legendWrap = container.createDiv('flywheel-cloud-legend-wrap');

    // Family color row
    const catRow = legendWrap.createDiv('flywheel-cloud-legend');
    for (const [family] of topFamilies) {
      const item = catRow.createEl('span', { cls: 'flywheel-legend-item' });
      const dot = item.createEl('span', { cls: 'flywheel-legend-dot' });
      const isLight = document.body.classList.contains('theme-light');
      dot.style.background = FAMILY_COLORS[family]?.[isLight ? 'light' : 'dark'] ?? FAMILY_COLORS.gray.dark;
      item.createEl('span').setText(FAMILY_LABELS[family] ?? family);
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
        line.style.borderTop = `3px ${style} ${color}`;
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
    categoryMap?: Map<string, string>,
  ): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    const nodeMap = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];
    const edgeSet = new Set<string>();

    const nameOf = (p: string) => p.replace(/\.md$/, '').replace(/\\/g, '/').split('/').pop() || p;
    // Case-insensitive dedup — prevents duplicates from different MCP sources.
    // Two-level lookup: by lowercased path, then by lowercased label.
    // e.g. backlinks give "tech/Tesla.md", suggestions give "Tesla" — same label.
    const labelIndex = new Map<string, string>(); // lowercase label → nk key
    const nk = (p: string) => p.toLowerCase();
    const hasNode = (p: string): boolean => {
      if (nodeMap.has(nk(p))) return true;
      return labelIndex.has(nameOf(p).toLowerCase());
    };
    const addNode = (p: string, node: GraphNode): void => {
      const key = nk(p);
      nodeMap.set(key, node);
      labelIndex.set(node.label.toLowerCase(), key);
    };
    // Retrieve canonical node ID (original casing) for edge references
    const canonId = (p: string): string => {
      const direct = nodeMap.get(nk(p));
      if (direct) return direct.id;
      const byLabel = labelIndex.get(nameOf(p).toLowerCase());
      if (byLabel) return nodeMap.get(byLabel)?.id ?? p;
      return p;
    };

    const isPeriodicPath = (p: string): boolean => {
      if (this.periodicPrefixes.length > 0) {
        return this.periodicPrefixes.some(prefix => p.startsWith(prefix));
      }
      // Fallback: detect date-like filenames (e.g. 2026-02-28, 2026-W09)
      const stem = nameOf(p);
      return /^\d{4}-\d{2}-\d{2}/.test(stem) || /^\d{4}-W\d{2}/.test(stem);
    };

    // Hub score → node radius: base 10, scale by hub score, cap at 22
    const radiusFor = (p: string): number => {
      const name = nameOf(p).toLowerCase();
      const hs = hubScores.get(name) ?? 0;
      return Math.max(10, Math.min(22, 11 + hs * 0.9));
    };

    // Resolve category from the pre-fetched map
    const catFor = (p: string): string => {
      if (isPeriodicPath(p)) return 'periodical';
      const lp = p.toLowerCase();
      return categoryMap?.get(lp) ?? categoryMap?.get(nameOf(p).toLowerCase()) ?? 'other';
    };

    // Add source tag to a node (creates set if needed, merges if node already exists)
    const tagSource = (p: string, source: string): void => {
      const node = nodeMap.get(nk(p));
      if (node) {
        if (!node.sources) node.sources = new Set();
        node.sources.add(source);
      }
    };

    addNode(notePath, {
      id: notePath, label: nameOf(notePath),
      x: 0, y: 0, vx: 0, vy: 0,
      radius: 14, color: 'var(--interactive-accent)', isCurrent: true,
    });

    const neighborPaths: string[] = [];

    for (const b of backlinksResp?.backlinks ?? []) {
      const p = b.source;
      if (!hasNode(p)) {
        const periodic = isPeriodicPath(p);
        const cat = catFor(p);
        const hs = hubScores.get(nameOf(p).toLowerCase()) ?? 0;
        neighborPaths.push(p);
        addNode(p, {
          id: p, label: nameOf(p),
          x: (Math.random() - 0.5) * 200, y: (Math.random() - 0.5) * 200,
          vx: 0, vy: 0, radius: periodic ? Math.max(7, radiusFor(p) * 0.7) : radiusFor(p),
          color: familyColor(cat), isCurrent: false, category: cat,
          isPeriodic: periodic || undefined,
          sources: new Set(['backlink']),
          hubScore: hs > 0 ? hs : undefined,
        });
      } else {
        tagSource(p, 'backlink');
      }
      const cid = canonId(p);
      const key = `${cid}\u2192${notePath}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        const weight = edgeWeightMap.get(key) ?? 1.0;
        edges.push({ source: cid, target: notePath, weight });
        // Store edge weight on node for tooltip
        const node = nodeMap.get(nk(p));
        if (node && !node.edgeWeight) node.edgeWeight = weight;
      }
    }

    const forwardLinkPaths = new Set<string>();
    const MAX_DEAD_LINKS = 5;
    let deadLinkCount = 0;
    for (const f of forwardLinksResp?.forward_links ?? []) {
      const p = f.resolved_path ?? f.target;
      if (!p) continue;
      // Cap dead links to avoid flooding the graph on heavily-linked notes
      if (!f.exists) {
        if (deadLinkCount >= MAX_DEAD_LINKS) continue;
        deadLinkCount++;
      }
      forwardLinkPaths.add(nk(p));
      if (!hasNode(p)) {
        const periodic = isPeriodicPath(p);
        const cat = catFor(p);
        const hs = hubScores.get(nameOf(p).toLowerCase()) ?? 0;
        neighborPaths.push(p);
        addNode(p, {
          id: p, label: nameOf(p),
          x: (Math.random() - 0.5) * 200, y: (Math.random() - 0.5) * 200,
          vx: 0, vy: 0, radius: periodic ? Math.max(7, radiusFor(p) * 0.7) : radiusFor(p),
          color: familyColor(cat), isCurrent: false, category: cat,
          isPeriodic: periodic || undefined,
          isDeadLink: !f.exists || undefined,
          sources: new Set(['forward']),
          hubScore: hs > 0 ? hs : undefined,
        });
      } else {
        tagSource(p, 'forward');
      }
      const cid = canonId(p);
      const key = `${notePath}\u2192${cid}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        const weight = edgeWeightMap.get(key) ?? 1.0;
        edges.push({ source: notePath, target: cid, weight });
        const node = nodeMap.get(nk(p));
        if (node && !node.edgeWeight) node.edgeWeight = weight;
      }
    }

    // Cap neighbors — prioritize entity nodes over periodic (daily) notes
    const MAX_NEIGHBORS = 24;
    const MAX_PERIODIC = 5;
    if (neighborPaths.length > MAX_NEIGHBORS) {
      const ranked = edges
        .map(e => ({ path: e.source === notePath ? e.target : e.source, weight: e.weight }))
        .sort((a, b) => b.weight - a.weight);

      // Split into entity vs periodic, keep best of each within budget
      const keep = new Set<string>();
      let periodicKept = 0;
      for (const r of ranked) {
        const key = nk(r.path);
        const node = nodeMap.get(key);
        if (node?.isPeriodic) {
          if (periodicKept < MAX_PERIODIC) { keep.add(key); periodicKept++; }
        } else {
          keep.add(key);
        }
        if (keep.size >= MAX_NEIGHBORS) break;
      }

      for (const p of neighborPaths) {
        if (!keep.has(nk(p))) {
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
    const TARGET_PRIMARY = 30;
    const currentPrimaryCount = [...nodeMap.values()].filter(n => !n.isSecondary).length;
    const slotsAvailable = Math.max(0, TARGET_PRIMARY - currentPrimaryCount);

    if (slotsAvailable > 0) {
      // Collect candidate paths from all context sources, ranked by relevance
      const candidates: { path: string; weight: number; source: 'suggestion' | 'similar' | 'connection' }[] = [];

      // Strong connections not already in graph
      if (connectionsResp?.connections) {
        for (const conn of connectionsResp.connections) {
          if (!hasNode(conn.node) && nk(conn.node) !== nk(notePath)) {
            candidates.push({ path: conn.resolved_path ?? conn.node, weight: conn.weight, source: 'connection' });
          }
        }
      }

      // Suggested wikilinks (entity name → need to resolve path; use name as ID)
      if (suggestResp?.scored_suggestions) {
        for (const sug of suggestResp.scored_suggestions) {
          const p = sug.path ?? sug.entity;
          if (!hasNode(p) && nk(p) !== nk(notePath) && sug.confidence !== 'low') {
            candidates.push({ path: p, weight: sug.totalScore / 30, source: 'suggestion' });
          }
        }
      }

      // Similar notes
      if (similarResp?.similar) {
        for (const sim of similarResp.similar) {
          if (!hasNode(sim.path) && nk(sim.path) !== nk(notePath)) {
            candidates.push({ path: sim.path, weight: sim.score / 100, source: 'similar' });
          }
        }
      }

      // Sort by weight descending, take what we need
      candidates.sort((a, b) => b.weight - a.weight);
      const fillNodes = candidates.slice(0, slotsAvailable);

      for (const c of fillNodes) {
        if (hasNode(c.path)) continue; // skip if added by earlier candidate
        const periodic = isPeriodicPath(c.path);
        const cat = catFor(c.path);
        const hs = hubScores.get(nameOf(c.path).toLowerCase()) ?? 0;
        addNode(c.path, {
          id: c.path, label: nameOf(c.path),
          x: (Math.random() - 0.5) * 200, y: (Math.random() - 0.5) * 200,
          vx: 0, vy: 0,
          radius: periodic ? Math.max(4, radiusFor(c.path) * 0.7) : radiusFor(c.path),
          color: familyColor(cat), isCurrent: false, category: cat,
          isPeriodic: periodic || undefined,
          sources: new Set([c.source]),
          hubScore: hs > 0 ? hs : undefined,
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
      const MAX_SECONDARY = 8; // expand up to 8 hub neighbors
      const MAX_SECONDARY_EDGES = 8; // up to 8 connections per expanded hub
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
            if (hasNode(p2) || nk(p2) === nk(notePath)) {
              // Still add the inter-neighbor edge if both nodes exist
              const cid2 = canonId(p2);
              const cidHub = canonId(hubPath);
              if (hasNode(p2) && nk(p2) !== nk(notePath)) {
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
            const cat2 = catFor(p2);
            addNode(p2, {
              id: p2, label: nameOf(p2),
              x: hubNode.x + (Math.random() - 0.5) * 80,
              y: hubNode.y + (Math.random() - 0.5) * 80,
              vx: 0, vy: 0,
              radius: Math.max(7, radiusFor(p2) * 0.7),
              color: familyColor(cat2),
              isCurrent: false, category: cat2,
              isSecondary: true,
              isPeriodic: periodic2 || undefined,
              sources: new Set(['secondary']),
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
      const cat = node.isPeriodic ? 'periodical' : (catMap.get(node.id.toLowerCase()) ?? 'other');
      node.color = familyColor(cat);
      node.category = cat;
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

      // Aspect ratio bias — spread more in the longer dimension
      const aspectX = width >= height ? 1.0 : 0.7;
      const aspectY = height >= width ? 1.0 : 0.7;

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
          // Pills are wider than tall — use larger horizontal separation
          const minSep = nodes[i].radius + nodes[j].radius + 50;
          const effectiveDist = Math.max(dist - minSep, 0.01);
          const force = (k * k) / effectiveDist;
          const fx = (dx / dist) * force * aspectX;
          const fy = (dy / dist) * force * aspectY;
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
        const hw = width / 2 - 70;
        const hh = height / 2 - 30;
        n.x = Math.max(-hw, Math.min(hw, n.x));
        n.y = Math.max(-hh, Math.min(hh, n.y));
      }

      temperature -= cooling;
    }

    // Post-layout collision resolution using pill bounding boxes
    const COLLISION_PASSES = 20;
    const COLLISION_GAP = 8; // px gap between pills
    for (let pass = 0; pass < COLLISION_PASSES; pass++) {
      let hadOverlap = false;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const ni = nodes[i], nj = nodes[j];
          // Axis-aligned pill overlap check
          const hwI = (ni.pillWidth ?? ni.radius * 2) / 2 + COLLISION_GAP;
          const hhI = (ni.pillHeight ?? ni.radius * 2) / 2 + COLLISION_GAP;
          const hwJ = (nj.pillWidth ?? nj.radius * 2) / 2 + COLLISION_GAP;
          const hhJ = (nj.pillHeight ?? nj.radius * 2) / 2 + COLLISION_GAP;
          const overlapX = (hwI + hwJ) - Math.abs(ni.x - nj.x);
          const overlapY = (hhI + hhJ) - Math.abs(ni.y - nj.y);
          if (overlapX > 0 && overlapY > 0) {
            hadOverlap = true;
            // Push apart along axis of least overlap
            if (overlapX < overlapY) {
              const sign = ni.x >= nj.x ? 1 : -1;
              if (ni.isCurrent) { nj.x -= sign * overlapX; }
              else if (nj.isCurrent) { ni.x += sign * overlapX; }
              else { ni.x += sign * overlapX * 0.5; nj.x -= sign * overlapX * 0.5; }
            } else {
              const sign = ni.y >= nj.y ? 1 : -1;
              if (ni.isCurrent) { nj.y -= sign * overlapY; }
              else if (nj.isCurrent) { ni.y += sign * overlapY; }
              else { ni.y += sign * overlapY * 0.5; nj.y -= sign * overlapY * 0.5; }
            }
          }
        }
      }
      // Re-clamp to canvas boundaries (account for pill width)
      const hw = width / 2 - 80;
      const hh = height / 2 - 20;
      for (const n of nodes) {
        if (n.isCurrent) continue;
        n.x = Math.max(-hw, Math.min(hw, n.x));
        n.y = Math.max(-hh, Math.min(hh, n.y));
      }
      if (!hadOverlap) break;
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

    // Pre-compute pill dimensions for each node
    const PILL_PAD_X = 16;
    const PILL_PAD_Y = 8;
    const PILL_RADIUS = 10;
    for (const n of nodes) {
      const fontSize = n.isCurrent ? 13 : (n.isSecondary || n.isPeriodic) ? 10 : 11;
      ctx.font = `${n.isCurrent ? 'bold ' : ''}${fontSize}px -apple-system, sans-serif`;
      const maxLen = n.isSecondary ? 14 : 20;
      const label = n.label.length > maxLen ? n.label.slice(0, maxLen - 1) + '\u2026' : n.label;
      const tw = ctx.measureText(label).width;
      n.pillWidth = tw + PILL_PAD_X * 2;
      n.pillHeight = fontSize + PILL_PAD_Y * 2;
    }

    // Theme-aware colors (read CSS vars once, used throughout render)
    const isLightTheme = document.body.classList.contains('theme-light');
    const edgeColor = isLightTheme ? '80, 80, 80' : '128, 128, 128';
    const borderColor = getComputedStyle(container).getPropertyValue('--background-modifier-border').trim() || '#ddd';

    // Shadow edges first — inter-node connections (not involving active note)
    const nodeById = new Map(nodes.map(n => [n.id, n]));
    for (const e of edges) {
      const src = nodeById.get(e.source);
      const tgt = nodeById.get(e.target);
      if (!src || !tgt) continue;
      if (src.isCurrent || tgt.isCurrent) continue;
      ctx.beginPath();
      ctx.moveTo(cx + src.x, cy + src.y);
      ctx.lineTo(cx + tgt.x, cy + tgt.y);
      ctx.lineWidth = isLightTheme ? 1.0 : 0.8;
      ctx.strokeStyle = `rgba(${edgeColor}, ${isLightTheme ? '0.18' : '0.10'})`;
      ctx.setLineDash([3, 4]);
      ctx.stroke();
    }

    // Primary edges — connections to/from active note
    for (const e of edges) {
      const src = nodeById.get(e.source);
      const tgt = nodeById.get(e.target);
      if (!src || !tgt) continue;
      if (!src.isCurrent && !tgt.isCurrent) continue;
      ctx.beginPath();
      ctx.moveTo(cx + src.x, cy + src.y);
      ctx.lineTo(cx + tgt.x, cy + tgt.y);
      const other = src.isCurrent ? tgt : src;
      const isPeriodicEdge = other.isPeriodic;
      const isSecondaryEdge = other.isSecondary;
      const isDimEdge = isPeriodicEdge || isSecondaryEdge;
      ctx.lineWidth = isDimEdge ? 1.5 : Math.min(2 + e.weight * 1.0, 5);
      const alphaBase = isLightTheme ? 0.15 : 0.0;
      const alpha = isPeriodicEdge ? 0.18 + alphaBase : isSecondaryEdge ? 0.25 + alphaBase : Math.min(0.35 + e.weight * 0.15 + alphaBase, 0.75);
      ctx.strokeStyle = `rgba(${edgeColor}, ${alpha.toFixed(2)})`;
      ctx.setLineDash(isDimEdge ? [3, 3] : []);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Pill nodes — draw periodic/secondary behind, then primary on top
    const textColor = getComputedStyle(container).color || '#ccc';
    const backNodes = nodes.filter(n => n.isPeriodic || n.isSecondary);
    const frontNodes = nodes.filter(n => !n.isPeriodic && !n.isSecondary);
    for (const n of [...backNodes, ...frontNodes]) {
      const pw = n.pillWidth!;
      const ph = n.pillHeight!;
      const px = cx + n.x - pw / 2;
      const py = cy + n.y - ph / 2;

      // Opaque background to hide edges underneath the pill (always full alpha)
      const bgColor = getComputedStyle(container).getPropertyValue('--background-primary').trim() || (isLightTheme ? '#fff' : '#1e1e1e');
      ctx.beginPath();
      ctx.roundRect(px, py, pw, ph, PILL_RADIUS);
      ctx.fillStyle = bgColor;
      ctx.fill();

      ctx.globalAlpha = n.isPeriodic ? 0.35 : n.isSecondary ? 0.50 : n.isDeadLink ? 0.55 : 1;

      // Fill color
      let fillColor: string;
      if (n.isCurrent) {
        fillColor = getComputedStyle(container).getPropertyValue('--interactive-accent').trim() || '#7c3aed';
      } else {
        fillColor = familyFill(n.category ?? 'other');
      }

      // Draw rounded rect pill
      ctx.beginPath();
      ctx.roundRect(px, py, pw, ph, PILL_RADIUS);

      const family = CATEGORY_FAMILY[n.category ?? 'other'] ?? 'gray';

      if (n.isDeadLink) {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = familyColor(n.category ?? 'other');
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = fillColor;
        ctx.fill();
        // Source-colored border showing why this node is on the graph
        if (!n.isCurrent && n.sources) {
          const isMulti = n.sources.size > 1;
          const accentColor = getComputedStyle(container).getPropertyValue('--text-accent').trim() || '#7c3aed';
          if (isMulti) {
            ctx.lineWidth = 3;
            ctx.strokeStyle = accentColor;
            ctx.setLineDash([]);
          } else if (n.sources.has('backlink')) {
            ctx.lineWidth = 2.5; ctx.strokeStyle = '#5b9bf5'; ctx.setLineDash([]);
          } else if (n.sources.has('forward')) {
            ctx.lineWidth = 2.5; ctx.strokeStyle = '#43d17a'; ctx.setLineDash([]);
          } else if (n.sources.has('suggestion')) {
            ctx.lineWidth = 2.5; ctx.strokeStyle = '#f59e42'; ctx.setLineDash([5, 3]);
          } else if (n.sources.has('similar')) {
            ctx.lineWidth = 2.5; ctx.strokeStyle = '#a78bfa'; ctx.setLineDash([3, 3]);
          } else if (n.sources.has('connection')) {
            ctx.lineWidth = 2.5; ctx.strokeStyle = '#06b6d4'; ctx.setLineDash([]);
          } else if (family === 'gray') {
            // Grey pills get a subtle border to define their shape
            ctx.lineWidth = 1; ctx.strokeStyle = borderColor; ctx.setLineDash([]);
          } else {
            ctx.lineWidth = 1.5; ctx.strokeStyle = familyColor(n.category ?? 'other'); ctx.setLineDash([]);
          }
          ctx.stroke();
          ctx.setLineDash([]);
        } else if (!n.isCurrent && family === 'gray') {
          // Grey pills always get a border for definition
          ctx.lineWidth = 1; ctx.strokeStyle = borderColor; ctx.setLineDash([]);
          ctx.stroke();
        }
      }

      // Label text inside pill
      const fontSize = n.isCurrent ? 13 : (n.isSecondary || n.isPeriodic) ? 10 : 11;
      ctx.font = `${n.isCurrent ? 'bold ' : ''}${fontSize}px -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // Grey and dead-link pills use theme text; colorful pills use white
      ctx.fillStyle = n.isCurrent ? '#fff' : (n.isDeadLink || family === 'gray') ? textColor : '#fff';
      const maxLen = n.isSecondary ? 14 : 20;
      const label = n.label.length > maxLen ? n.label.slice(0, maxLen - 1) + '\u2026' : n.label;
      ctx.fillText(label, cx + n.x, cy + n.y);

      ctx.globalAlpha = 1;
    }

    return canvas;
  }

  // ---------------------------------------------------------------------------
  // Graph legend — filled pills for category families
  // ---------------------------------------------------------------------------

  private renderGraphLegend(container: HTMLElement, _nodes: GraphNode[]): void {
    const isLight = document.body.classList.contains('theme-light');
    container.createEl('hr', { cls: 'flywheel-graph-legend-hr' });
    const legendWrap = container.createDiv('flywheel-graph-legend-wrap');

    // Row 1: all category family pills
    const allFamilies: [string, string][] = [
      ['blue', FAMILY_LABELS.blue],
      ['green', FAMILY_LABELS.green],
      ['purple', FAMILY_LABELS.purple],
      ['orange', FAMILY_LABELS.orange],
      ['red', FAMILY_LABELS.red],
      ['gray', FAMILY_LABELS.gray],
    ];
    legendWrap.createEl('span', { cls: 'flywheel-legend-label', text: 'category' });
    const catRow = legendWrap.createDiv('flywheel-graph-legend');
    for (const [family, label] of allFamilies) {
      const cssVar = FAMILY_CSS_VAR[family] ?? '--text-muted';
      const color = getComputedStyle(document.body).getPropertyValue(cssVar).trim()
        || FAMILY_COLORS_FALLBACK[family] || '#888';
      const pill = catRow.createEl('span', { cls: 'flywheel-legend-pill' });
      if (family === 'gray') {
        // Grey pill: subtle bg + theme text (matches graph pill style)
        pill.style.background = getComputedStyle(document.body).getPropertyValue('--interactive-hover').trim() || '#e9e9e9';
        pill.style.color = getComputedStyle(document.body).getPropertyValue('--text-normal').trim() || '#ccc';
        pill.style.border = `1px solid ${getComputedStyle(document.body).getPropertyValue('--background-modifier-border').trim() || '#ddd'}`;
      } else {
        pill.style.background = color;
      }
      pill.setText(label);
    }

    // Row 2: all source border styles
    const sourceStyles: [string, string, string][] = [
      ['backlink', '#5b9bf5', 'solid'],
      ['forward', '#43d17a', 'solid'],
      ['suggested', '#f59e42', 'dashed'],
      ['similar', '#a78bfa', 'dotted'],
      ['multi', 'var(--text-accent)', 'solid'],
    ];
    legendWrap.createEl('span', { cls: 'flywheel-legend-label', text: 'source' });
    const srcRow = legendWrap.createDiv('flywheel-graph-legend');
    for (const [label, color, style] of sourceStyles) {
      const item = srcRow.createEl('span', { cls: 'flywheel-legend-item' });
      const line = item.createEl('span', { cls: 'flywheel-legend-line' });
      line.style.borderTop = `3px ${style} ${color}`;
      item.createEl('span').setText(label);
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

  /**
   * Handle pipeline completion by refreshing the entity cloud.
   * Previously animated individual entities from raw step output arrays,
   * but compact step summaries only contain counters — so we refresh instead.
   */
  private handlePipelineUpdate(_health: McpHealthCheckResponse): void {
    this.refresh();
  }
}
