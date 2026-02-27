/**
 * Graph Sidebar View — powered by flywheel-memory MCP
 *
 * Collapsible sections: Folder, Context Cloud, Backlinks, Forward Links,
 * Note Intelligence (when a note is active). All data from MCP tool calls.
 */

import { ItemView, WorkspaceLeaf, TFile, setIcon, MarkdownView } from 'obsidian';
import type {
  FlywheelMcpClient,
  McpBacklinksResponse,
  McpForwardLinksResponse,
  McpSuggestWikilinksResponse,
  McpSimilarResponse,
  McpHealthCheckResponse,
  McpAliasSuggestionsResponse,
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
}

interface GraphEdge {
  source: string;
  target: string;
}

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
  }

  private async renderNoteSections(file: TFile, generation: number, freshContainer?: HTMLElement): Promise<void> {
    const notePath = file.path;

    try {
      if (generation !== this.renderGeneration) return;

      const noteContent = await this.app.vault.cachedRead(file);
      const [backlinksResp, forwardLinksResp, suggestResp, similarResp, health, semanticResp] = await Promise.all([
        this.mcpClient.getBacklinks(notePath).catch(() => null),
        this.mcpClient.getForwardLinks(notePath).catch(() => null),
        this.mcpClient.suggestWikilinks(noteContent, true).catch(() => null),
        this.mcpClient.findSimilar(notePath, 15).catch(() => null),
        this.mcpClient.healthCheck().catch(() => null),
        this.mcpClient.noteIntelligence(notePath, 'semantic_links').catch(() => null),
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

      // Folder section (first — most actionable)
      await this.renderFolderSection(file, generation);

      // Local Graph section — force-directed 1-hop neighborhood
      const safeBacklinks: McpBacklinksResponse = backlinksResp ?? { backlinks: [] };
      const safeForwardLinks: McpForwardLinksResponse = forwardLinksResp ?? { forward_links: [] };

      {
        const W = 280;
        const H = 200;
        const { nodes, edges } = this.buildLocalGraph(notePath, safeBacklinks, safeForwardLinks);
        const dpr = window.devicePixelRatio || 1;

        this.renderSection('Local Graph', 'git-fork', undefined, (sectionContent) => {
          if (nodes.length <= 1) {
            sectionContent.createDiv('flywheel-graph-section-empty').setText('No connections yet');
            return;
          }
          this.layoutGraph(nodes, edges, W, H);
          const canvas = this.renderLocalGraphCanvas(sectionContent, nodes, edges, W, H);
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
        }, true, undefined, 'localGraph');
      }

      // Context Cloud — unified view of all related notes
      this.renderContextCloud(safeBacklinks, safeForwardLinks, suggestResp, similarResp, semanticResp);

      const MAX_ITEMS = 5;

      // Backlinks section — group by source, sorted by mention count desc
      const blGrouped = new Map<string, { source: string; count: number; lines: number[]; context?: string }>();
      for (const bl of safeBacklinks.backlinks) {
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

      const backlinksInfo = 'Notes that link to this note. Grouped by source note \u2014 ' +
        'the count shows how many times each note links here.';
      this.renderSection('Backlinks', 'arrow-left', uniqueBacklinks, (container) => {
        if (!backlinksResp) {
          container.createDiv('flywheel-graph-section-empty').setText('Failed to load backlinks');
          return;
        }
        if (blSorted.length === 0) {
          container.createDiv('flywheel-graph-section-empty').setText('No backlinks');
          return;
        }
        container.addClass('flywheel-graph-grid-2col');

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
      }, false, undefined, undefined, backlinksInfo);

      // Forward links section
      const forwardInfo = 'Outgoing wikilinks from this note. Dead links (marked \'missing\') ' +
        'point to notes that don\'t exist yet.';
      this.renderSection('Forward Links', 'arrow-right', uniqueLinks.length, (container) => {
        if (!forwardLinksResp) {
          container.createDiv('flywheel-graph-section-empty').setText('Failed to load forward links');
          return;
        }
        if (uniqueLinks.length === 0) {
          container.createDiv('flywheel-graph-section-empty').setText('No outgoing links');
          return;
        }
        container.addClass('flywheel-graph-grid-2col');

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
      }, false, undefined, undefined, forwardInfo);
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

  /** Open a note and scroll to a specific line with a brief flash highlight. */
  private async navigateToLine(source: string, line: number): Promise<void> {
    await this.app.workspace.openLinkText(source, '', false);
    // Find the leaf with the target file — getActiveViewOfType returns null from sidebar context
    const target = source.replace(/\.md$/, '');
    const leaf = this.app.workspace.getLeavesOfType('markdown').find(l => {
      const f = (l.view as MarkdownView).file;
      return f && f.path.replace(/\.md$/, '') === target;
    });
    if (!leaf) return;
    const view = leaf.view as MarkdownView;
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    // Small delay for focus to settle, then scroll and flash-select the line
    setTimeout(() => {
      if (!view.editor) return;
      const ln = Math.max(0, line - 1);
      const text = view.editor.getLine(ln);
      view.editor.setSelection({ line: ln, ch: 0 }, { line: ln, ch: text.length });
      view.editor.scrollIntoView({ from: { line: ln, ch: 0 }, to: { line: ln, ch: text.length } }, true);
      setTimeout(() => view.editor.setCursor({ line: ln, ch: 0 }), 250);
    }, 50);
  }

  private renderBacklink(container: HTMLDivElement, bl: { source: string; line: number; context?: string }): void {
    const item = container.createDiv('flywheel-graph-link-item');
    item.addEventListener('click', () => this.navigateToLine(bl.source, bl.line));

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
    item.addEventListener('click', () => bl.lines.length > 0
      ? this.navigateToLine(bl.source, bl.lines[0])
      : this.app.workspace.openLinkText(bl.source, '', false));

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

    const contextInfo = 'Each note\'s size reflects how strongly it relates to the current note. ' +
      'Scoring factors: direct links (backlinks/forward), content similarity (BM25), ' +
      'wikilink suggestion strength (11-layer entity scoring), and semantic similarity ' +
      '(when embeddings are built). Hover individual items for a detailed breakdown.';

    this.renderSection('Context', 'cloud', mainEntries.length + periodicEntries.length, (container) => {
      // Main cloud
      if (mainEntries.length > 0) {
        this.renderCloudItems(container, mainEntries, 11, 18);
      }

      // Periodic cloud — smaller, more compact
      if (periodicEntries.length > 0) {
        const periodicLabel = container.createDiv('flywheel-cloud-label');
        periodicLabel.setText('periodic');
        this.renderCloudItems(container, periodicEntries, 10, 14);
      }
    }, false, undefined, undefined, contextInfo);
  }

  private renderCloudItems(
    container: HTMLDivElement,
    entries: Array<{ name: string; path: string | null; score: number; reasons: string[]; sources: Set<string> }>,
    _minFontSize?: number,
    _maxFontSize?: number,
  ): void {
    const minScore = Math.min(...entries.map(e => e.score));
    const maxScore = Math.max(...entries.map(e => e.score));
    const scoreRange = maxScore - minScore || 1;

    const cloudEl = container.createDiv('flywheel-cloud');

    // Source priority for coloring (when multiple sources, pick highest priority)
    const SOURCE_PRIORITY = ['backlink', 'forward', 'suggested', 'similar', 'semantic'];

    for (const entry of entries) {
      const t = (entry.score - minScore) / scoreRange; // 0..1
      const opacity = 0.65 + t * 0.35; // 0.65 to 1.0

      const span = cloudEl.createEl('span', { cls: 'flywheel-cloud-item' });
      span.style.opacity = String(opacity.toFixed(2));
      span.setText(entry.name);

      // Set data-source for CSS coloring — pick primary source
      const isMulti = entry.sources.size > 1;
      if (isMulti) {
        span.dataset.multi = 'true';
      } else {
        const primarySource = SOURCE_PRIORITY.find(s => entry.sources.has(s)) ?? 'suggested';
        span.dataset.source = primarySource;
      }

      // Store entity name for pipeline pulse matching
      span.dataset.entity = entry.name;

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

  private buildLocalGraph(
    notePath: string,
    backlinksResp: McpBacklinksResponse | null,
    forwardLinksResp: McpForwardLinksResponse | null,
  ): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const nodeMap = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];
    const edgeSet = new Set<string>();

    const PALETTE = [
      '#6e9bf5', '#f5a623', '#7ec699', '#e06c75', '#c678dd',
      '#56b6c2', '#d19a66', '#98c379', '#e5c07b', '#61afef',
      '#be5046', '#e6c07b', '#c3a6ff', '#56d5a0', '#ff9e64',
    ];
    const colorFor = (p: string) => {
      let h = 0;
      for (let i = 0; i < p.length; i++) h = ((h << 5) - h + p.charCodeAt(i)) | 0;
      return PALETTE[Math.abs(h) % PALETTE.length];
    };
    const nameOf = (p: string) => p.replace(/\.md$/, '').split('/').pop() || p;

    nodeMap.set(notePath, {
      id: notePath, label: nameOf(notePath),
      x: 0, y: 0, vx: 0, vy: 0,
      radius: 7, color: 'var(--interactive-accent)', isCurrent: true,
    });

    for (const b of backlinksResp?.backlinks ?? []) {
      const p = b.source;
      if (!nodeMap.has(p)) {
        nodeMap.set(p, {
          id: p, label: nameOf(p),
          x: (Math.random() - 0.5) * 200, y: (Math.random() - 0.5) * 200,
          vx: 0, vy: 0, radius: 5, color: colorFor(p), isCurrent: false,
        });
      }
      const key = `${p}→${notePath}`;
      if (!edgeSet.has(key)) { edgeSet.add(key); edges.push({ source: p, target: notePath }); }
    }

    for (const f of forwardLinksResp?.forward_links ?? []) {
      const p = f.resolved_path ?? f.target;
      if (!p || !f.exists) continue;
      if (!nodeMap.has(p)) {
        nodeMap.set(p, {
          id: p, label: nameOf(p),
          x: (Math.random() - 0.5) * 200, y: (Math.random() - 0.5) * 200,
          vx: 0, vy: 0, radius: 5, color: colorFor(p), isCurrent: false,
        });
      }
      const key = `${notePath}→${p}`;
      if (!edgeSet.has(key)) { edgeSet.add(key); edges.push({ source: notePath, target: p }); }
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

      for (const n of nodes) {
        if (n.isCurrent) continue;
        const disp = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
        if (disp > 0) {
          const capped = Math.min(disp, temperature);
          n.x += (n.vx / disp) * capped;
          n.y += (n.vy / disp) * capped;
        }
        const hw = width / 2 - 20;
        const hh = height / 2 - 20;
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

    // Edges
    ctx.lineWidth = 1;
    for (const e of edges) {
      const src = nodes.find(n => n.id === e.source);
      const tgt = nodes.find(n => n.id === e.target);
      if (!src || !tgt) continue;
      ctx.beginPath();
      ctx.moveTo(cx + src.x, cy + src.y);
      ctx.lineTo(cx + tgt.x, cy + tgt.y);
      ctx.strokeStyle = 'rgba(128, 128, 128, 0.3)';
      ctx.setLineDash([]);
      ctx.stroke();
    }

    // Nodes
    for (const n of nodes) {
      ctx.beginPath();
      ctx.arc(cx + n.x, cy + n.y, n.radius, 0, Math.PI * 2);
      // Resolve CSS var for current node color
      if (n.isCurrent) {
        ctx.fillStyle = getComputedStyle(container).getPropertyValue('--interactive-accent').trim() || '#7c3aed';
      } else {
        ctx.fillStyle = n.color;
      }
      ctx.fill();
    }

    // Labels
    const textColor = getComputedStyle(container).color || '#ccc';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const n of nodes) {
      ctx.fillStyle = textColor;
      ctx.font = n.isCurrent ? 'bold 11px -apple-system, sans-serif' : '10px -apple-system, sans-serif';
      const label = n.label.length > 18 ? n.label.slice(0, 16) + '\u2026' : n.label;
      ctx.fillText(label, cx + n.x, cy + n.y + n.radius + 3);
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
