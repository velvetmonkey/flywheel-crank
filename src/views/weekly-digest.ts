/**
 * Weekly Flywheel Digest Modal
 *
 * Shows a weekly summary: metric deltas, growing entities,
 * stale hubs needing attention, and activity stats.
 */

import { Modal, App } from 'obsidian';
import type { FlywheelMcpClient } from '../mcp/client';

export class WeeklyDigestModal extends Modal {
  private mcpClient: FlywheelMcpClient;

  constructor(app: App, mcpClient: FlywheelMcpClient) {
    super(app);
    this.mcpClient = mcpClient;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.addClass('flywheel-weekly-digest');
    contentEl.createEl('h2', { text: 'Weekly Flywheel Digest' });

    const loading = contentEl.createDiv('flywheel-digest-loading');
    loading.setText('Computing digest...');

    try {
      await this.buildDigest(contentEl);
      loading.remove();
    } catch (err) {
      loading.setText(`Failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  private async buildDigest(container: HTMLElement): Promise<void> {
    // Section 1: Metric Trends
    try {
      const growth = await this.mcpClient.vaultGrowth('trends', { days_back: 7 });
      const trends = (growth as any).trends ?? [];
      if (trends.length > 0) {
        const section = container.createDiv('flywheel-digest-section');
        section.createDiv('flywheel-digest-section-title').setText('This Week');

        const grid = section.createDiv('flywheel-digest-metrics');
        const keyMetrics = ['note_count', 'link_count', 'entity_count', 'connected_ratio', 'link_density'];
        for (const trend of trends.filter((t: any) => keyMetrics.includes(t.metric))) {
          const card = grid.createDiv('flywheel-digest-metric');
          const label = trend.metric.replace(/_/g, ' ');
          card.createDiv('flywheel-digest-metric-label').setText(label);
          card.createDiv('flywheel-digest-metric-value').setText(`${trend.current}`);
          const deltaEl = card.createDiv('flywheel-digest-metric-delta');
          const sign = trend.delta >= 0 ? '+' : '';
          deltaEl.setText(`${sign}${trend.delta}`);
          if (trend.delta > 0) deltaEl.addClass('flywheel-digest-up');
          else if (trend.delta < 0) deltaEl.addClass('flywheel-digest-down');
        }
      }
    } catch { /* no growth data */ }

    // Section 2: Growing Entities (emerging hubs from past week)
    try {
      const resp = await this.mcpClient.graphAnalysis('emerging_hubs', { days: 7, limit: 5 });
      const hubs = (resp as any).hubs ?? (resp as any).emerging_hubs ?? [];
      if (hubs.length > 0) {
        const section = container.createDiv('flywheel-digest-section');
        section.createDiv('flywheel-digest-section-title').setText('Growing Entities');
        section.createDiv('flywheel-digest-section-desc').setText(
          'Entities gaining the most connections this week'
        );
        for (const hub of hubs) {
          const row = section.createDiv('flywheel-digest-row flywheel-health-clickable');
          row.createSpan('flywheel-digest-row-name').setText(hub.entity || hub.title || hub.path);
          const growth = hub.growth ?? hub.growth_rate ?? 0;
          const badge = row.createSpan('flywheel-digest-row-badge flywheel-digest-up');
          badge.setText(`+${growth}`);
          if (hub.path) {
            row.addEventListener('click', () => {
              this.close();
              this.app.workspace.openLinkText(hub.path, '', false);
            });
          }
        }
      }
    } catch { /* no emerging hub data */ }

    // Section 3: Needs Attention (stale hubs)
    try {
      const resp = await this.mcpClient.graphAnalysis('stale', { days: 30, limit: 5 });
      const stale = (resp as any).notes ?? (resp as any).stale_notes ?? [];
      if (stale.length > 0) {
        const section = container.createDiv('flywheel-digest-section');
        section.createDiv('flywheel-digest-section-title').setText('Needs Attention');
        section.createDiv('flywheel-digest-section-desc').setText(
          'Important notes (many backlinks) not updated in 30+ days'
        );
        for (const note of stale) {
          const row = section.createDiv('flywheel-digest-row flywheel-health-clickable');
          row.createSpan('flywheel-digest-row-name').setText(note.title || note.path);
          const badge = row.createSpan('flywheel-digest-row-badge');
          badge.setText(`${note.days_since_modified}d stale`);
          row.addEventListener('click', () => {
            this.close();
            this.app.workspace.openLinkText(note.path, '', false);
          });
        }
      }
    } catch { /* no stale data */ }

    // Section 4: Activity Summary
    try {
      const stats = await this.mcpClient.vaultStats();
      if ((stats as any).recent_activity) {
        const section = container.createDiv('flywheel-digest-section');
        section.createDiv('flywheel-digest-section-title').setText('Activity');
        const a = (stats as any).recent_activity;
        section.createDiv('flywheel-digest-activity').setText(
          `${a.notes_created} notes created, ${a.notes_modified} modified in the last ${a.period_days} days`
        );
        if (a.most_active_day) {
          section.createDiv('flywheel-digest-activity').setText(
            `Most active day: ${a.most_active_day}`
          );
        }
      }
    } catch { /* no activity data */ }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
