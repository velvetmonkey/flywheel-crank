/**
 * Entity Page: Dedicated Entity Detail View
 *
 * Shows everything about a single entity: metadata, score timeline,
 * backlinks, unlinked mentions, and feedback actions.
 */

import { ItemView, WorkspaceLeaf, TFile, setIcon, Notice } from 'obsidian';
import type { FlywheelMcpClient } from '../mcp/client';

export const ENTITY_PAGE_VIEW_TYPE = 'flywheel-entity-page';

export class EntityPageView extends ItemView {
  private mcpClient: FlywheelMcpClient;
  private entityName: string | null = null;

  constructor(leaf: WorkspaceLeaf, mcpClient: FlywheelMcpClient) {
    super(leaf);
    this.mcpClient = mcpClient;
  }

  getViewType(): string { return ENTITY_PAGE_VIEW_TYPE; }
  getDisplayText(): string { return this.entityName ? `Entity: ${this.entityName}` : 'Flywheel Entity'; }
  getIcon(): string { return 'tag'; }

  /** Navigate to a specific entity and re-render. */
  async showEntity(name: string): Promise<void> {
    this.entityName = name;
    this.leaf.updateHeader();
    await this.render();
  }

  async onOpen(): Promise<void> {
    if (!this.entityName) {
      const container = this.containerEl.children[1] as HTMLElement;
      container.empty();
      container.addClass('flywheel-entity-page');
      container.createDiv('flywheel-entity-page-placeholder').setText('Select an entity to view details');
    }
  }

  async onClose(): Promise<void> {}

  private async render(): Promise<void> {
    if (!this.entityName) return;

    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('flywheel-entity-page');

    // Header
    const header = container.createDiv('flywheel-entity-page-header');
    header.createDiv('flywheel-entity-page-name').setText(this.entityName);

    // Score timeline chart
    try {
      const timeline = await this.mcpClient.entityScoreTimeline(this.entityName, 30, 50);
      if (timeline.timeline?.length > 1) {
        const chartSection = container.createDiv('flywheel-entity-page-section');
        chartSection.createDiv('flywheel-entity-page-section-title').setText('Score History');
        this.renderScoreChart(chartSection, timeline.timeline);
      }
    } catch { /* no timeline data */ }

    // Backlinks — notes that link to this entity
    try {
      const entityPath = this.entityName + '.md';
      const bl = await this.mcpClient.getBacklinks(entityPath);
      if (bl.backlinks?.length > 0) {
        const section = container.createDiv('flywheel-entity-page-section');
        section.createDiv('flywheel-entity-page-section-title').setText(
          `Referenced in ${bl.backlinks.length} notes`
        );
        for (const b of bl.backlinks.slice(0, 20)) {
          const row = section.createDiv('flywheel-entity-page-ref');
          const link = row.createSpan('flywheel-entity-page-ref-link');
          link.setText(b.source.replace(/\.md$/, '').split('/').pop() || b.source);
          link.addEventListener('click', () => this.app.workspace.openLinkText(b.source, '', false));
          if (b.context) {
            row.createDiv('flywheel-entity-page-ref-context').setText(b.context);
          }
        }
      }
    } catch { /* ignore */ }

    // Unlinked mentions
    try {
      const mentions = await this.mcpClient.getUnlinkedMentions(this.entityName, 10);
      if (mentions.mentions?.length > 0) {
        const section = container.createDiv('flywheel-entity-page-section');
        section.createDiv('flywheel-entity-page-section-title').setText(
          `${mentions.mention_count} unlinked mention${mentions.mention_count !== 1 ? 's' : ''}`
        );
        for (const m of mentions.mentions) {
          const row = section.createDiv('flywheel-entity-page-ref');
          const link = row.createSpan('flywheel-entity-page-ref-link');
          link.setText(m.path.replace(/\.md$/, '').split('/').pop() || m.path);
          link.addEventListener('click', () => this.app.workspace.openLinkText(m.path, '', false));
          if (m.context) {
            row.createDiv('flywheel-entity-page-ref-context').setText(m.context);
          }

          const linkBtn = row.createEl('button', { cls: 'flywheel-entity-page-link-btn', text: 'Link' });
          const entityName = this.entityName!;
          linkBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
              const file = this.app.vault.getAbstractFileByPath(m.path);
              if (file instanceof TFile) {
                const escaped = entityName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                await this.app.vault.process(file, (content) => {
                  const pattern = new RegExp(`(?<!\\[\\[)\\b${escaped}\\b(?!\\]\\])`, 'i');
                  return content.replace(pattern, `[[${entityName}]]`);
                });
                linkBtn.setText('\u2713');
                linkBtn.disabled = true;
                linkBtn.addClass('flywheel-entity-page-link-done');
              }
            } catch (err) {
              console.error('Entity page: failed to link', err);
            }
          });
        }
      }
    } catch { /* ignore */ }

    // Feedback actions
    const actionsSection = container.createDiv('flywheel-entity-page-actions');

    const goodBtn = actionsSection.createEl('button', {
      cls: 'flywheel-entity-page-action-btn flywheel-entity-page-action-positive',
      text: 'Good entity',
    });
    const goodIcon = goodBtn.createSpan();
    setIcon(goodIcon, 'thumbs-up');
    const entityNameForFeedback = this.entityName;
    goodBtn.addEventListener('click', async () => {
      await this.mcpClient.reportWikilinkFeedback(entityNameForFeedback, '', true);
      new Notice(`Positive feedback for "${entityNameForFeedback}"`);
      goodBtn.disabled = true;
    });

    const badBtn = actionsSection.createEl('button', {
      cls: 'flywheel-entity-page-action-btn flywheel-entity-page-action-negative',
      text: 'Bad entity',
    });
    const badIcon = badBtn.createSpan();
    setIcon(badIcon, 'thumbs-down');
    badBtn.addEventListener('click', async () => {
      await this.mcpClient.reportWikilinkFeedback(entityNameForFeedback, '', false);
      new Notice(`Negative feedback for "${entityNameForFeedback}"`);
      badBtn.disabled = true;
    });
  }

  private renderScoreChart(
    container: HTMLElement,
    timeline: Array<{ timestamp: number; score: number }>,
  ): void {
    const width = 280;
    const height = 80;
    const pad = 8;

    const scores = timeline.map(t => t.score);
    const minS = Math.min(...scores);
    const maxS = Math.max(...scores);
    const range = maxS - minS || 1;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('class', 'flywheel-entity-page-chart');
    container.appendChild(svg);

    const points = timeline.map((t, i) => {
      const x = pad + (i / (timeline.length - 1)) * (width - 2 * pad);
      const y = height - pad - ((t.score - minS) / range) * (height - 2 * pad);
      return `${x},${y}`;
    });

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    line.setAttribute('points', points.join(' '));
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', 'var(--interactive-accent)');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(line);
  }
}
