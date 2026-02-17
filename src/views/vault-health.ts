/**
 * Graph Health Dashboard View
 *
 * Shows vault health diagnostics powered by MCP: orphans, dead ends,
 * stale hubs, immature notes, emerging hubs, and growth trends.
 */

import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type { FlywheelMcpClient } from '../mcp/client';

export const VAULT_HEALTH_VIEW_TYPE = 'flywheel-vault-health';

export class VaultHealthView extends ItemView {
  private mcpClient: FlywheelMcpClient;
  /** Track which sections have been loaded to avoid re-fetching */
  private loadedSections = new Set<string>();

  constructor(leaf: WorkspaceLeaf, mcpClient: FlywheelMcpClient) {
    super(leaf);
    this.mcpClient = mcpClient;
  }

  getViewType(): string {
    return VAULT_HEALTH_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Graph Health';
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
      const empty = container.createDiv('flywheel-health-empty');
      setIcon(empty.createDiv(), 'loader');
      empty.createDiv().setText('Connecting to MCP server...');
      return;
    }

    // Load stats bar from healthCheck
    const statsBar = container.createDiv('flywheel-health-stats-bar');
    try {
      const health = await this.mcpClient.healthCheck();
      this.renderStat(statsBar, 'file-text', `${health.note_count}`, 'Notes');
      this.renderStat(statsBar, 'link', `${health.entity_count}`, 'Entities');
      this.renderStat(statsBar, 'tag', `${health.tag_count}`, 'Tags');
      // Get link count from vaultStats
      try {
        const stats = await this.mcpClient.vaultStats();
        this.renderStat(statsBar, 'arrow-right-left', `${stats.total_links}`, 'Links');
      } catch {
        this.renderStat(statsBar, 'arrow-right-left', '...', 'Links');
      }
    } catch {
      statsBar.createDiv('flywheel-health-empty-msg').setText('Failed to load stats');
    }

    const content = container.createDiv('flywheel-health-content');

    // Orphans section — lazy-loaded
    this.renderLazySection(content, 'Orphan Notes', 'unlink', async (el) => {
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
    });

    // Dead Ends section — lazy-loaded
    this.renderLazySection(content, 'Dead Ends', 'arrow-down-to-line', async (el) => {
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
    });

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
    });

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
    });

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
    });

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
    });
  }

  private renderStat(container: HTMLDivElement, icon: string, value: string, label: string): void {
    const stat = container.createDiv('flywheel-health-stat');
    const iconEl = stat.createDiv('flywheel-health-stat-icon');
    setIcon(iconEl, icon);
    stat.createDiv('flywheel-health-stat-value').setText(value);
    stat.createDiv('flywheel-health-stat-label').setText(label);
  }

  private renderGrowthStat(container: HTMLDivElement, icon: string, value: string, label: string): void {
    const stat = container.createDiv('flywheel-health-growth-stat');
    const iconEl = stat.createDiv('flywheel-health-growth-stat-icon');
    setIcon(iconEl, icon);
    stat.createDiv('flywheel-health-growth-stat-value').setText(value);
    stat.createDiv('flywheel-health-growth-stat-label').setText(label);
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
  ): void {
    const section = container.createDiv('flywheel-health-section is-collapsed');

    const header = section.createDiv('flywheel-health-section-header');

    const iconEl = header.createSpan('flywheel-health-section-icon');
    setIcon(iconEl, icon);
    header.createSpan('flywheel-health-section-title').setText(title);

    const countBadge = header.createSpan('flywheel-health-section-count');
    countBadge.setText('...');

    const chevron = header.createSpan('flywheel-health-section-chevron');
    setIcon(chevron, 'chevron-down');

    const contentEl = section.createDiv('flywheel-health-section-content');

    header.addEventListener('click', async () => {
      const wasCollapsed = section.hasClass('is-collapsed');
      section.toggleClass('is-collapsed', !wasCollapsed);

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
          if (count > 0 && (title === 'Orphan Notes' || title === 'Dead Ends')) {
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

  async onClose(): Promise<void> {
    this.loadedSections.clear();
  }
}
