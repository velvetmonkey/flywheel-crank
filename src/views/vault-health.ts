/**
 * Graph Health Dashboard View
 *
 * Shows vault health diagnostics powered by MCP: orphans, dead ends,
 * stale hubs, immature notes, emerging hubs, and growth trends.
 */

import { ItemView, WorkspaceLeaf, TFile, setIcon } from 'obsidian';
import type { FlywheelMcpClient, McpServerLogEntry } from '../mcp/client';

export const VAULT_HEALTH_VIEW_TYPE = 'flywheel-vault-health';

export class VaultHealthView extends ItemView {
  private mcpClient: FlywheelMcpClient;
  /** Track which sections have been loaded to avoid re-fetching */
  private loadedSections = new Set<string>();
  /** Remember collapsed state per section title across re-renders */
  private sectionCollapsed = new Map<string, boolean>();
  /** Auto-refresh interval for the activity log section */
  private activityLogInterval: ReturnType<typeof setInterval> | null = null;

  constructor(leaf: WorkspaceLeaf, mcpClient: FlywheelMcpClient) {
    super(leaf);
    this.mcpClient = mcpClient;
  }

  getViewType(): string {
    return VAULT_HEALTH_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Flywheel Health';
  }

  getIcon(): string {
    return 'heart-pulse';
  }

  async onOpen(): Promise<void> {
    await this.render();
  }

  private async render(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('flywheel-vault-health');

    if (!this.mcpClient.connected) {
      const splash = container.createDiv('flywheel-splash');
      const imgPath = `${this.app.vault.configDir}/plugins/flywheel-crank/flywheel.png`;
      const imgEl = splash.createEl('img', { cls: 'flywheel-splash-logo' });
      imgEl.src = this.app.vault.adapter.getResourcePath(imgPath);
      imgEl.alt = '';
      splash.createDiv('flywheel-splash-text').setText('Connecting to flywheel-memory...');
      // Poll until connected, then re-render
      const poll = setInterval(() => {
        if (this.mcpClient.connected) {
          clearInterval(poll);
          this.render();
        }
      }, 2000);
      return;
    }

    // Stats bar — render placeholders immediately, populate async
    const statsBar = container.createDiv('flywheel-health-stats-bar');
    const notesStat = this.renderStat(statsBar, 'file-text', '...', 'Notes');
    const entitiesStat = this.renderStat(statsBar, 'link', '...', 'Entities');
    const tagsStat = this.renderStat(statsBar, 'tag', '...', 'Tags');
    const linksStat = this.renderStat(statsBar, 'arrow-right-left', '...', 'Links');

    // Populate stats in background (don't block section rendering)
    this.loadStatsBar(notesStat, entitiesStat, tagsStat, linksStat);

    const content = container.createDiv('flywheel-health-content');

    // Vault Config section — lazy-loaded
    this.renderLazySection(content, 'Vault Config', 'settings', async (el) => {
      const health = await this.mcpClient.healthCheck();
      const cfg = health.config as Record<string, any> | undefined;
      if (!cfg || Object.keys(cfg).length === 0) {
        el.createDiv('flywheel-health-empty-msg').setText('No config detected yet');
        return 0;
      }
      let count = 0;
      const paths = cfg.paths as Record<string, string> | undefined;
      const templates = cfg.templates as Record<string, string> | undefined;

      if (paths && Object.keys(paths).length > 0) {
        const labels: Record<string, string> = {
          daily_notes: 'Daily', weekly_notes: 'Weekly', monthly_notes: 'Monthly',
          quarterly_notes: 'Quarterly', yearly_notes: 'Yearly', templates: 'Templates',
        };
        for (const [key, path] of Object.entries(paths)) {
          if (path) { this.renderInfoRow(el, labels[key] ?? key, path); count++; }
        }
      }
      if (templates && Object.keys(templates).length > 0) {
        const tplLabels: Record<string, string> = {
          daily: 'Daily tpl', weekly: 'Weekly tpl', monthly: 'Monthly tpl',
          quarterly: 'Quarterly tpl', yearly: 'Yearly tpl',
        };
        for (const [key, path] of Object.entries(templates)) {
          if (path) { this.renderInfoRow(el, tplLabels[key] ?? key, path); count++; }
        }
      }
      if (count === 0) {
        el.createDiv('flywheel-health-empty-msg').setText('No periodic locations configured');
      }
      return count;
    }, 'Auto-detected folder paths and templates for periodic notes (daily, weekly, monthly, etc.).');

    // Vault Stats section — lazy-loaded
    this.renderLazySection(content, 'Vault Stats', 'bar-chart', async (el) => {
      await this.mcpClient.waitForIndex();
      const stats = await this.mcpClient.vaultStats();
      let count = 0;

      this.renderInfoRow(el, 'Avg links/note', stats.average_links_per_note.toFixed(1));
      count++;
      if (stats.orphan_notes.total > 0) {
        this.renderInfoRow(el, 'Orphans', `${stats.orphan_notes.content} content, ${stats.orphan_notes.periodic} periodic`);
        count++;
      }

      if (stats.most_linked_notes.length > 0) {
        const hubGroup = el.createDiv('flywheel-health-info-group');
        hubGroup.createDiv('flywheel-health-info-group-label').setText('Most Linked');
        for (const note of stats.most_linked_notes.slice(0, 5)) {
          const name = note.path.replace(/\.md$/, '').split('/').pop() || note.path;
          this.renderInfoRow(hubGroup, name, `${note.backlinks}`);
          count++;
        }
      }

      if (stats.top_tags.length > 0) {
        const tagGroup = el.createDiv('flywheel-health-info-group');
        tagGroup.createDiv('flywheel-health-info-group-label').setText('Top Tags');
        for (const tag of stats.top_tags.slice(0, 5)) {
          this.renderInfoRow(tagGroup, tag.tag, String(tag.count));
          count++;
        }
      }

      return count;
    }, 'Aggregate statistics about your vault\'s link structure, most connected notes, and popular tags.');

    // Technical Details section — lazy-loaded
    this.renderLazySection(content, 'Technical Details', 'cpu', async (el) => {
      const health = await this.mcpClient.healthCheck();

      const graphStatus = health.index_state === 'ready'
        ? `ready \u00B7 ${health.note_count} notes`
        : health.index_state === 'building' ? 'building...' : 'error';
      this.renderInfoRow(el, 'Graph index', graphStatus);

      const fts5Status = health.fts5_building
        ? 'building...'
        : health.fts5_ready ? 'ready \u00B7 full-text with stemming' : 'not built';
      this.renderInfoRow(el, 'Keyword search', fts5Status);

      const semanticStatus = health.embeddings_building
        ? 'building...'
        : health.embeddings_ready
          ? `ready \u00B7 ${health.embeddings_count} embeddings`
          : 'not built';
      this.renderInfoRow(el, 'Semantic search', semanticStatus);

      this.renderInfoRow(el, 'Vault path', health.vault_path);
      this.renderInfoRow(el, 'StateDb', `${health.vault_path}/.flywheel/state.db`);
      if (health.schema_version) {
        this.renderInfoRow(el, 'Schema', `v${health.schema_version}`);
      }
      const age = health.index_age_seconds >= 0 ? this.formatAge(health.index_age_seconds) : '\u2014';
      this.renderInfoRow(el, 'Index age', `${age} ago`);
      this.renderInfoRow(el, 'MCP', 'connected (stdio)');

      return 1;
    }, 'Server connection status, index health, and database schema information.');

    // Activity Log section — lazy-loaded with auto-refresh
    this.renderActivityLogSection(content);

    // Orphans section — lazy-loaded
    this.renderLazySection(content, 'Orphan Notes', 'unlink', async (el) => {
      el.addClass('flywheel-health-grid-2col');
      const resp = await this.mcpClient.graphAnalysis('orphans', { limit: 30 });
      const items = (resp as any).orphans ?? (resp as any).results ?? [];
      if (items.length === 0) {
        el.createDiv('flywheel-health-empty-msg').setText('No orphans found');
        return items.length;
      }
      for (const orphan of items.slice(0, 30)) {
        const item = el.createDiv('flywheel-health-item flywheel-health-clickable');
        item.addEventListener('click', () => this.app.workspace.openLinkText(orphan.path, '', false));
        item.createDiv('flywheel-health-item-title').setText(orphan.title || orphan.path);
        const folder = orphan.path.split('/').slice(0, -1).join('/');
        if (folder) item.createDiv('flywheel-health-item-path').setText(folder);
      }
      const total = (resp as any).total ?? items.length;
      if (total > 30) {
        el.createDiv('flywheel-health-more').setText(`+${total - 30} more`);
      }
      return total;
    }, 'Notes with no backlinks \u2014 nothing else in the vault links to them. Consider linking them or archiving if obsolete.');

    // Dead Ends section — lazy-loaded
    this.renderLazySection(content, 'Dead Ends', 'arrow-down-to-line', async (el) => {
      el.addClass('flywheel-health-grid-2col');
      const resp = await this.mcpClient.graphAnalysis('dead_ends', { limit: 30 });
      const items = (resp as any).dead_ends ?? (resp as any).results ?? [];
      if (items.length === 0) {
        el.createDiv('flywheel-health-empty-msg').setText('No dead ends found');
        return items.length;
      }
      for (const note of items.slice(0, 30)) {
        const item = el.createDiv('flywheel-health-item flywheel-health-clickable');
        item.addEventListener('click', () => this.app.workspace.openLinkText(note.path, '', false));

        const row = item.createDiv('flywheel-health-hub-row');
        row.createDiv('flywheel-health-item-title').setText(note.title || note.path);
        if (note.backlinks != null || note.backlink_count != null) {
          const badges = row.createDiv('flywheel-health-badges');
          const inBadge = badges.createSpan('flywheel-health-badge flywheel-health-badge-in');
          inBadge.setText(`\u2190 ${note.backlinks ?? note.backlink_count}`);
        }
      }
      const total = (resp as any).total ?? items.length;
      if (total > 30) {
        el.createDiv('flywheel-health-more').setText(`+${total - 30} more`);
      }
      return total;
    }, 'Notes with backlinks but no outgoing links \u2014 they receive attention but don\'t connect forward to other notes.');

    // Broken Links section — lazy-loaded
    this.renderLazySection(content, 'Broken Links', 'unlink', async (el) => {
      const resp = await this.mcpClient.validateLinks(false, 30);
      const items = resp.broken ?? [];
      if (items.length === 0) {
        el.createDiv('flywheel-health-empty-msg').setText('No broken links found');
        return items.length;
      }
      for (const broken of items) {
        const item = el.createDiv('flywheel-health-item flywheel-health-clickable');
        item.addEventListener('click', () => this.app.workspace.openLinkText(broken.source, '', false));

        const row = item.createDiv('flywheel-health-broken-row');

        // Source note title (clickable)
        const sourceEl = row.createSpan('flywheel-health-broken-source flywheel-health-clickable');
        const sourceTitle = broken.source.replace(/\.md$/, '').split('/').pop() || broken.source;
        sourceEl.setText(sourceTitle);
        sourceEl.addEventListener('click', (e) => { e.stopPropagation(); this.app.workspace.openLinkText(broken.source, '', false); });

        row.createSpan('flywheel-health-broken-arrow').setText('\u2192');
        row.createSpan('flywheel-health-broken-target').setText(broken.target);

        if (broken.suggestion) {
          const suggestionName = broken.suggestion.replace(/\.md$/, '').split('/').pop() || broken.suggestion;

          const fixRow = item.createDiv('flywheel-health-broken-fix-row');
          const badge = fixRow.createSpan('flywheel-health-broken-suggestion');
          badge.setText(`\u2192 ${suggestionName}`);

          const fixBtn = fixRow.createSpan('flywheel-health-fix-btn');
          setIcon(fixBtn, 'pencil');
          fixBtn.createSpan({ cls: 'flywheel-health-fix-btn-label', text: 'Fix' });
          fixBtn.setAttribute('aria-label', `Fix: replace [[${broken.target}]] with [[${suggestionName}]]`);
          fixBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
              const file = this.app.vault.getAbstractFileByPath(broken.source);
              if (file instanceof TFile) {
                const content = await this.app.vault.cachedRead(file);
                const newContent = content.replace(
                  `[[${broken.target}]]`,
                  `[[${suggestionName}]]`,
                );
                if (newContent !== content) {
                  await this.app.vault.modify(file, newContent);
                  fixBtn.empty();
                  setIcon(fixBtn, 'check');
                  fixBtn.addClass('flywheel-health-fix-btn-done');
                }
              }
            } catch (err) {
              console.error('Flywheel Crank: failed to fix broken link', err);
            }
          });
        }
      }
      const total = resp.broken_links ?? items.length;
      if (total > 30) {
        el.createDiv('flywheel-health-more').setText(`+${total - 30} more`);
      }
      return total;
    }, 'Wikilinks pointing to notes that don\'t exist. Suggestions show the closest matching note name.');

    // Stale Hubs section — lazy-loaded
    this.renderLazySection(content, 'Stale Hubs', 'clock', async (el) => {
      const resp = await this.mcpClient.graphAnalysis('stale', { days: 90, limit: 20 });
      const items = (resp as any).notes ?? (resp as any).stale_notes ?? [];
      if (items.length === 0) {
        el.createDiv('flywheel-health-empty-msg').setText('No stale hubs found');
        return items.length;
      }
      for (const note of items.slice(0, 20)) {
        const item = el.createDiv('flywheel-health-item flywheel-health-clickable');
        item.addEventListener('click', () => this.app.workspace.openLinkText(note.path, '', false));

        const row = item.createDiv('flywheel-health-hub-row');
        row.createDiv('flywheel-health-item-title').setText(note.title || note.path);

        const badges = row.createDiv('flywheel-health-badges');
        if (note.days_since_modified != null) {
          const ageBadge = badges.createSpan('flywheel-health-badge flywheel-health-badge-out');
          ageBadge.setText(`${note.days_since_modified}d ago`);
        }
        if (note.backlinks != null || note.backlink_count != null) {
          const inBadge = badges.createSpan('flywheel-health-badge flywheel-health-badge-in');
          inBadge.setText(`\u2190 ${note.backlinks ?? note.backlink_count}`);
        }
      }
      const total = (resp as any).total ?? items.length;
      if (total > 20) {
        el.createDiv('flywheel-health-more').setText(`+${total - 20} more`);
      }
      return total;
    }, 'Highly-linked notes not modified in 90+ days. These are important notes that may need updating.');

    // Immature Notes section — lazy-loaded
    this.renderLazySection(content, 'Immature Notes', 'sprout', async (el) => {
      const resp = await this.mcpClient.graphAnalysis('immature', { limit: 20 });
      const items = (resp as any).notes ?? (resp as any).immature_notes ?? [];
      if (items.length === 0) {
        el.createDiv('flywheel-health-empty-msg').setText('No immature notes found');
        return items.length;
      }
      for (const note of items.slice(0, 20)) {
        const item = el.createDiv('flywheel-health-item flywheel-health-clickable');
        item.addEventListener('click', () => this.app.workspace.openLinkText(note.path, '', false));

        const row = item.createDiv('flywheel-health-hub-row');
        row.createDiv('flywheel-health-item-title').setText(note.title || note.path);

        const badges = row.createDiv('flywheel-health-badges');
        // Immature notes have components: { word_count: { value, score }, outlinks: { value, score }, ... }
        const wc = note.components?.word_count?.value ?? note.word_count;
        if (wc != null) {
          const wcBadge = badges.createSpan('flywheel-health-badge flywheel-health-badge-out');
          wcBadge.setText(`${wc}w`);
        }
        const outlinks = note.components?.outlinks?.value ?? note.forward_links ?? note.outlinks ?? 0;
        if (outlinks > 0) {
          const linkBadge = badges.createSpan('flywheel-health-badge flywheel-health-badge-out');
          linkBadge.setText(`${outlinks} links`);
        }
        if (note.maturity_score != null) {
          const scoreBadge = badges.createSpan('flywheel-health-badge flywheel-health-badge-in');
          scoreBadge.setText(`${Math.round(note.maturity_score * 100)}%`);
        }
      }
      const total = (resp as any).total ?? items.length;
      if (total > 20) {
        el.createDiv('flywheel-health-more').setText(`+${total - 20} more`);
      }
      return total;
    }, 'Notes that are short, have few links, or lack frontmatter. Expanding these would strengthen the graph.');

    // Emerging Hubs section — lazy-loaded
    this.renderLazySection(content, 'Emerging Hubs', 'trending-up', async (el) => {
      const resp = await this.mcpClient.graphAnalysis('emerging_hubs', { limit: 15 });
      const items = (resp as any).hubs ?? (resp as any).emerging_hubs ?? [];
      if (items.length === 0) {
        el.createDiv('flywheel-health-empty-msg').setText('No emerging hubs found');
        return items.length;
      }
      for (const hub of items.slice(0, 15)) {
        const item = el.createDiv('flywheel-health-item flywheel-health-clickable');
        const path = hub.path || hub.entity || '';
        if (path) {
          item.addEventListener('click', () => this.app.workspace.openLinkText(path, '', false));
        }

        const row = item.createDiv('flywheel-health-hub-row');
        row.createDiv('flywheel-health-item-title').setText(hub.title || hub.entity || path);

        const badges = row.createDiv('flywheel-health-badges');
        if (hub.growth != null || hub.growth_rate != null) {
          const growthBadge = badges.createSpan('flywheel-health-badge flywheel-health-badge-growth');
          const val = hub.growth ?? hub.growth_rate;
          growthBadge.setText(`+${val}`);
        }
        if (hub.backlinks != null || hub.backlink_count != null) {
          const inBadge = badges.createSpan('flywheel-health-badge flywheel-health-badge-in');
          inBadge.setText(`\u2190 ${hub.backlinks ?? hub.backlink_count}`);
        }
      }
      const total = (resp as any).total ?? items.length;
      if (total > 15) {
        el.createDiv('flywheel-health-more').setText(`+${total - 15} more`);
      }
      return total;
    }, 'Notes gaining backlinks recently \u2014 these are becoming central topics in your vault.');

    // Growth section — lazy-loaded
    this.renderLazySection(content, 'Growth', 'bar-chart-3', async (el) => {
      let itemCount = 0;

      // Recent activity from vaultStats
      try {
        const stats = await this.mcpClient.vaultStats();
        const activity = stats.recent_activity;
        if (activity) {
          const activityDiv = el.createDiv('flywheel-health-growth-block');
          activityDiv.createDiv('flywheel-health-growth-label').setText(`Last ${activity.period_days} days`);

          const row = activityDiv.createDiv('flywheel-health-growth-stats');
          this.renderGrowthStat(row, 'file-plus', `${activity.notes_created}`, 'created');
          this.renderGrowthStat(row, 'file-edit', `${activity.notes_modified}`, 'modified');
          if (activity.most_active_day) {
            this.renderGrowthStat(row, 'calendar', activity.most_active_day, 'most active');
          }
          itemCount++;
        }
      } catch { /* ignore */ }

      // Trends from vaultGrowth
      try {
        const growth = await this.mcpClient.vaultGrowth('trends');
        const trends = growth.trends ?? [];
        if (trends.length > 0) {
          const trendsDiv = el.createDiv('flywheel-health-growth-block');
          trendsDiv.createDiv('flywheel-health-growth-label').setText('Trends');

          for (const trend of trends) {
            const trendRow = trendsDiv.createDiv('flywheel-health-trend-row');
            const label = trendRow.createSpan('flywheel-health-trend-metric');
            label.setText(trend.metric.replace(/_/g, ' '));

            const value = trendRow.createSpan('flywheel-health-trend-value');
            value.setText(`${trend.current}`);

            const delta = trendRow.createSpan('flywheel-health-trend-delta');
            const sign = trend.delta >= 0 ? '+' : '';
            delta.setText(`${sign}${trend.delta}`);
            if (trend.delta > 0) delta.addClass('flywheel-health-trend-up');
            else if (trend.delta < 0) delta.addClass('flywheel-health-trend-down');
          }
          itemCount += trends.length;
        }
      } catch { /* ignore */ }

      if (itemCount === 0) {
        el.createDiv('flywheel-health-empty-msg').setText('No growth data available');
      }
      return itemCount;
    }, 'Vault activity trends: notes created/modified recently and how key metrics are changing over time.');

    // Wikilink Feedback section — lazy-loaded
    this.renderLazySection(content, 'Wikilink Feedback', 'message-square', async (el) => {
      const resp = await this.mcpClient.wikilinkFeedback('stats');
      const stats = resp.stats ?? [];
      const totalFeedback = resp.total_feedback ?? 0;
      const totalSuppressed = resp.total_suppressed ?? 0;

      if (totalFeedback === 0) {
        el.createDiv('flywheel-health-empty-msg').setText('No wikilink feedback yet.');
        return 0;
      }

      // Summary
      const totalCorrect = stats.reduce((sum, s) => sum + s.correct, 0);
      const overallAccuracy = totalFeedback > 0 ? Math.round((totalCorrect / totalFeedback) * 100) : 0;
      this.renderInfoRow(el, 'Total feedback', `${totalFeedback}`);
      this.renderInfoRow(el, 'Overall accuracy', `${overallAccuracy}%`);
      if (totalSuppressed > 0) {
        this.renderInfoRow(el, 'Suppressed entities', `${totalSuppressed}`);
      }

      // Per-entity accuracy table (top 15)
      if (stats.length > 0) {
        for (const entity of stats.slice(0, 15)) {
          const row = el.createDiv('flywheel-health-feedback-entity-row');
          const nameEl = row.createSpan('flywheel-health-feedback-entity-name');
          nameEl.setText(entity.entity);
          if (entity.suppressed) {
            nameEl.addClass('flywheel-health-feedback-suppressed');
          }

          const badges = row.createDiv('flywheel-health-badges');
          const accBadge = badges.createSpan('flywheel-health-badge');
          const acc = Math.round(entity.accuracy * 100);
          accBadge.setText(`${acc}%`);
          if (acc >= 70) {
            accBadge.addClass('flywheel-health-badge-growth');
          } else if (acc <= 30) {
            accBadge.addClass('flywheel-health-badge-in');
          } else {
            accBadge.addClass('flywheel-health-badge-out');
          }

          const countBadge = badges.createSpan('flywheel-health-badge flywheel-health-badge-out');
          countBadge.setText(`n=${entity.total}`);
        }
      }

      return totalFeedback;
    }, 'Wikilink suggestion accuracy: how often suggested links were accepted or rejected, per entity.');
  }

  private renderStat(container: HTMLDivElement, icon: string, value: string, label: string): HTMLDivElement {
    const stat = container.createDiv('flywheel-health-stat');
    const iconEl = stat.createDiv('flywheel-health-stat-icon');
    setIcon(iconEl, icon);
    stat.createDiv('flywheel-health-stat-value').setText(value);
    stat.createDiv('flywheel-health-stat-label').setText(label);
    return stat;
  }

  /** Populate the stats bar asynchronously — health + vaultStats in parallel. */
  private async loadStatsBar(
    notesStat: HTMLDivElement,
    entitiesStat: HTMLDivElement,
    tagsStat: HTMLDivElement,
    linksStat: HTMLDivElement,
  ): Promise<void> {
    try {
      await this.mcpClient.waitForIndex();
      const [health, stats] = await Promise.all([
        this.mcpClient.healthCheck(),
        this.mcpClient.vaultStats().catch(() => null),
      ]);

      const setStatValue = (el: HTMLDivElement, value: string) => {
        const valueEl = el.querySelector('.flywheel-health-stat-value');
        if (valueEl) valueEl.setText(value);
      };

      setStatValue(notesStat, `${health.note_count}`);
      setStatValue(entitiesStat, `${health.entity_count}`);
      setStatValue(tagsStat, `${health.tag_count}`);
      setStatValue(linksStat, stats ? `${stats.total_links}` : '—');
    } catch {
      // Stats failed to load — placeholders remain as "..."
    }
  }

  private renderGrowthStat(container: HTMLDivElement, icon: string, value: string, label: string): void {
    const stat = container.createDiv('flywheel-health-growth-stat');
    const iconEl = stat.createDiv('flywheel-health-growth-stat-icon');
    setIcon(iconEl, icon);
    stat.createDiv('flywheel-health-growth-stat-value').setText(value);
    stat.createDiv('flywheel-health-growth-stat-label').setText(label);
  }

  private renderInfoRow(container: HTMLDivElement, label: string, value: string): void {
    const row = container.createDiv('flywheel-health-info-row');
    row.createSpan('flywheel-health-info-label').setText(label);
    row.createSpan('flywheel-health-info-value').setText(value);
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

  /**
   * Render a collapsible section that lazy-loads data on first expand.
   * Starts collapsed. On first click, calls loadContent to populate.
   */
  private renderLazySection(
    container: HTMLDivElement,
    title: string,
    icon: string,
    loadContent: (el: HTMLDivElement) => Promise<number>,
    info?: string,
  ): void {
    const isCollapsed = this.sectionCollapsed.get(title) ?? true;
    const section = container.createDiv(`flywheel-health-section${isCollapsed ? ' is-collapsed' : ''}`);

    const header = section.createDiv('flywheel-health-section-header');

    const iconEl = header.createSpan('flywheel-health-section-icon');
    setIcon(iconEl, icon);
    header.createSpan('flywheel-health-section-title').setText(title);

    if (info) {
      const infoIcon = header.createSpan('flywheel-health-section-info');
      setIcon(infoIcon, 'info');
      infoIcon.setAttribute('aria-label', info);
      infoIcon.addEventListener('click', (e) => e.stopPropagation());
    }

    const countBadge = header.createSpan('flywheel-health-section-count');
    countBadge.setText('...');

    const chevron = header.createSpan('flywheel-health-section-chevron');
    setIcon(chevron, 'chevron-down');

    const contentEl = section.createDiv('flywheel-health-section-content');

    // Auto-load if section starts expanded (remembered from previous interaction)
    if (!isCollapsed && !this.loadedSections.has(title)) {
      this.loadedSections.add(title);
      const loadingDiv = contentEl.createDiv('flywheel-health-empty-msg');
      loadingDiv.setText('Loading...');
      loadContent(contentEl).then((count) => {
        loadingDiv.remove();
        countBadge.setText(`${count}`);
        if (count > 0 && (title === 'Orphan Notes' || title === 'Dead Ends' || title === 'Broken Links')) {
          countBadge.addClass('flywheel-health-count-warn');
        }
      }).catch((err) => {
        loadingDiv.setText(`Failed to load: ${err instanceof Error ? err.message : 'unknown error'}`);
        countBadge.setText('!');
        countBadge.addClass('flywheel-health-count-warn');
        this.loadedSections.delete(title);
      });
    }

    header.addEventListener('click', async () => {
      const wasCollapsed = section.hasClass('is-collapsed');
      section.toggleClass('is-collapsed', !wasCollapsed);
      this.sectionCollapsed.set(title, !wasCollapsed);

      // Lazy-load on first expand
      if (wasCollapsed && !this.loadedSections.has(title)) {
        this.loadedSections.add(title);
        contentEl.empty();
        const loadingDiv = contentEl.createDiv('flywheel-health-empty-msg');
        loadingDiv.setText('Loading...');

        try {
          const count = await loadContent(contentEl);
          loadingDiv.remove();
          countBadge.setText(`${count}`);
          if (count > 0 && (title === 'Orphan Notes' || title === 'Dead Ends' || title === 'Broken Links')) {
            countBadge.addClass('flywheel-health-count-warn');
          }
        } catch (err) {
          loadingDiv.setText(`Failed to load: ${err instanceof Error ? err.message : 'unknown error'}`);
          countBadge.setText('!');
          countBadge.addClass('flywheel-health-count-warn');
          // Allow retry
          this.loadedSections.delete(title);
        }
      }
    });
  }

  /**
   * Render the Activity Log section with auto-refresh while server is starting.
   */
  private renderActivityLogSection(container: HTMLDivElement): void {
    const title = 'Activity Log';
    const isCollapsed = this.sectionCollapsed.get(title) ?? true;
    const section = container.createDiv(`flywheel-health-section${isCollapsed ? ' is-collapsed' : ''}`);

    const header = section.createDiv('flywheel-health-section-header');
    const iconEl = header.createSpan('flywheel-health-section-icon');
    setIcon(iconEl, 'activity');
    header.createSpan('flywheel-health-section-title').setText(title);

    const infoIcon = header.createSpan('flywheel-health-section-info');
    setIcon(infoIcon, 'info');
    infoIcon.setAttribute('aria-label', 'Timestamped log of server startup stages, indexing progress, and runtime events.');
    infoIcon.addEventListener('click', (e) => e.stopPropagation());

    const countBadge = header.createSpan('flywheel-health-section-count');
    countBadge.setText('...');

    const chevron = header.createSpan('flywheel-health-section-chevron');
    setIcon(chevron, 'chevron-down');

    const contentEl = section.createDiv('flywheel-health-section-content');

    let lastEntryTs = 0;

    const populateLog = async () => {
      try {
        const result = await this.mcpClient.getServerLog({ limit: 100 });
        const entries = result.entries;

        // Only re-render if there are new entries
        if (entries.length > 0 && entries[entries.length - 1].ts > lastEntryTs) {
          contentEl.empty();
          const logContainer = contentEl.createDiv('flywheel-activity-log');
          for (const entry of entries) {
            this.renderLogEntry(logContainer, entry);
          }
          lastEntryTs = entries[entries.length - 1].ts;
          countBadge.setText(`${entries.length}`);

          // Scroll to bottom
          logContainer.scrollTop = logContainer.scrollHeight;
        }

        // Stop auto-refresh when server seems settled (no new entries for a while)
        // Check if the most recent entry is older than 10 seconds
        const now = Date.now();
        const mostRecentTs = entries.length > 0 ? entries[entries.length - 1].ts : 0;
        if (mostRecentTs > 0 && now - mostRecentTs > 10_000 && this.activityLogInterval) {
          clearInterval(this.activityLogInterval);
          this.activityLogInterval = null;
        }
      } catch (err) {
        // Server may not have the tool yet — silently ignore
      }
    };

    const startAutoRefresh = () => {
      if (this.activityLogInterval) return;
      this.activityLogInterval = setInterval(populateLog, 2000);
    };

    const stopAutoRefresh = () => {
      if (this.activityLogInterval) {
        clearInterval(this.activityLogInterval);
        this.activityLogInterval = null;
      }
    };

    // Auto-load if section starts expanded
    if (!isCollapsed) {
      const loadingDiv = contentEl.createDiv('flywheel-health-empty-msg');
      loadingDiv.setText('Loading...');
      populateLog().then(() => loadingDiv.remove());
      startAutoRefresh();
    }

    header.addEventListener('click', async () => {
      const wasCollapsed = section.hasClass('is-collapsed');
      section.toggleClass('is-collapsed', !wasCollapsed);
      this.sectionCollapsed.set(title, !wasCollapsed);

      if (wasCollapsed) {
        // Expanding
        if (!this.loadedSections.has(title)) {
          this.loadedSections.add(title);
          contentEl.empty();
          const loadingDiv = contentEl.createDiv('flywheel-health-empty-msg');
          loadingDiv.setText('Loading...');
          await populateLog();
          loadingDiv.remove();
        }
        startAutoRefresh();
      } else {
        // Collapsing
        stopAutoRefresh();
      }
    });
  }

  /** Render a single log entry row. */
  private renderLogEntry(container: HTMLDivElement, entry: McpServerLogEntry): void {
    const row = container.createDiv('flywheel-activity-entry');
    if (entry.level === 'error') row.addClass('flywheel-activity-entry-error');
    else if (entry.level === 'warn') row.addClass('flywheel-activity-entry-warn');

    const tsEl = row.createSpan('flywheel-activity-ts');
    tsEl.setText(this.formatRelativeTime(entry.ts));

    const badge = row.createSpan(`flywheel-activity-badge flywheel-activity-badge-${entry.component}`);
    badge.setText(entry.component);

    row.createSpan('flywheel-activity-msg').setText(entry.message);
  }

  /** Format a timestamp as relative time (e.g., "2s ago", "1m ago"). */
  private formatRelativeTime(ts: number): string {
    const delta = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (delta < 60) return `${delta}s ago`;
    if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
    const h = Math.floor(delta / 3600);
    const m = Math.floor((delta % 3600) / 60);
    return m > 0 ? `${h}h ${m}m ago` : `${h}h ago`;
  }

  async onClose(): Promise<void> {
    this.loadedSections.clear();
    if (this.activityLogInterval) {
      clearInterval(this.activityLogInterval);
      this.activityLogInterval = null;
    }
  }
}
