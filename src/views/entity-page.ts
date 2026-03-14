/**
 * Entity Page: Dedicated Entity Detail View
 *
 * Shows everything about a single entity: metadata, score timeline,
 * backlinks, unlinked mentions, and feedback actions.
 */

import { ItemView, WorkspaceLeaf, TFile, setIcon, setTooltip, Notice } from 'obsidian';
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

  /** Navigate to a specific entity, open its note, and re-render. */
  async showEntity(name: string): Promise<void> {
    this.entityName = name;
    this.leaf.updateHeader();
    // Open the entity's note in the main editor
    this.app.workspace.openLinkText(name + '.md', '', false);
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
    const nameEl = header.createDiv('flywheel-entity-page-name');
    nameEl.setText(this.entityName);
    nameEl.addClass('flywheel-entity-page-name-clickable');
    nameEl.addEventListener('click', () => {
      this.app.workspace.openLinkText(this.entityName + '.md', '', false);
    });

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
          setTooltip(linkBtn, `Insert [[${this.entityName}]] wikilink into this note`);
          const entityName = this.entityName!;
          linkBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            linkBtn.setText('Linking...');
            linkBtn.disabled = true;
            try {
              const file = this.app.vault.getAbstractFileByPath(m.path);
              if (file instanceof TFile) {
                const escaped = entityName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                await this.app.vault.process(file, (content) => {
                  const pattern = new RegExp(`(?<!\\[\\[)\\b${escaped}\\b(?!\\]\\])`, 'i');
                  return content.replace(pattern, `[[${entityName}]]`);
                });
                linkBtn.setText('Linked \u2713');
                linkBtn.addClass('flywheel-entity-page-link-done');
                setTooltip(linkBtn, `Wikilink inserted into ${m.path.replace(/\.md$/, '').split('/').pop()}`);
              }
            } catch (err) {
              console.error('Entity page: failed to link', err);
              linkBtn.setText('Failed');
              linkBtn.disabled = false;
            }
          });
        }
      }
    } catch { /* ignore */ }

    // Feedback actions
    const actionsSection = container.createDiv('flywheel-entity-page-actions');
    actionsSection.createDiv('flywheel-entity-page-actions-label')
      .setText('Should flywheel suggest linking to this entity?');

    const entityNameForFeedback = this.entityName;

    const goodBtn = actionsSection.createEl('button', {
      cls: 'flywheel-entity-page-action-btn flywheel-entity-page-action-positive',
      text: 'Yes, keep linking',
    });
    const goodIcon = goodBtn.createSpan();
    setIcon(goodIcon, 'thumbs-up');
    setTooltip(goodBtn, 'Boost this entity\u2019s suggestion score \u2014 it will appear more often as a wikilink suggestion');
    goodBtn.addEventListener('click', async () => {
      goodBtn.disabled = true;
      badBtn.disabled = true;
      await this.mcpClient.reportWikilinkFeedback(entityNameForFeedback, '', true);
      goodBtn.setText('Feedback sent \u2713');
      goodBtn.addClass('flywheel-entity-page-action-done');
      new Notice(`Positive feedback recorded for "${entityNameForFeedback}"`);
    });

    const badBtn = actionsSection.createEl('button', {
      cls: 'flywheel-entity-page-action-btn flywheel-entity-page-action-negative',
      text: 'No, stop suggesting',
    });
    const badIcon = badBtn.createSpan();
    setIcon(badIcon, 'thumbs-down');
    setTooltip(badBtn, 'Suppress this entity \u2014 it will be suggested less often or not at all');
    badBtn.addEventListener('click', async () => {
      badBtn.disabled = true;
      goodBtn.disabled = true;
      await this.mcpClient.reportWikilinkFeedback(entityNameForFeedback, '', false);
      badBtn.setText('Feedback sent \u2713');
      badBtn.addClass('flywheel-entity-page-action-done');
      new Notice(`Negative feedback recorded for "${entityNameForFeedback}"`);
    });
  }

  private renderScoreChart(
    container: HTMLElement,
    timeline: Array<{ timestamp: number; score: number }>,
  ): void {
    const width = 400;
    const height = 100;
    const padLeft = 28;
    const padRight = 4;
    const padTop = 8;
    const padBottom = 18;

    const scores = timeline.map(t => t.score);
    const minS = Math.min(...scores);
    const maxS = Math.max(...scores);
    const range = maxS - minS || 1;

    // Legend text
    const legend = container.createDiv('flywheel-entity-page-chart-legend');
    const latest = scores[scores.length - 1];
    const first = scores[0];
    const delta = latest - first;
    const deltaSign = delta >= 0 ? '+' : '';
    legend.setText(
      `Suggestion score over time \u2022 current: ${latest.toFixed(1)} \u2022 change: ${deltaSign}${delta.toFixed(1)}`
    );

    const wrapper = container.createDiv('flywheel-entity-page-chart-wrapper');

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('class', 'flywheel-entity-page-chart');
    wrapper.appendChild(svg);

    // Y-axis labels (min and max)
    const yMaxLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    yMaxLabel.setAttribute('x', `${padLeft - 4}`);
    yMaxLabel.setAttribute('y', `${padTop + 4}`);
    yMaxLabel.setAttribute('text-anchor', 'end');
    yMaxLabel.setAttribute('class', 'flywheel-entity-page-chart-label');
    yMaxLabel.textContent = maxS.toFixed(0);
    svg.appendChild(yMaxLabel);

    const yMinLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    yMinLabel.setAttribute('x', `${padLeft - 4}`);
    yMinLabel.setAttribute('y', `${height - padBottom}`);
    yMinLabel.setAttribute('text-anchor', 'end');
    yMinLabel.setAttribute('class', 'flywheel-entity-page-chart-label');
    yMinLabel.textContent = minS.toFixed(0);
    svg.appendChild(yMinLabel);

    // X-axis labels (first and last date)
    const firstDate = new Date(timeline[0].timestamp);
    const lastDate = new Date(timeline[timeline.length - 1].timestamp);
    const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;

    const xStartLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    xStartLabel.setAttribute('x', `${padLeft}`);
    xStartLabel.setAttribute('y', `${height - 2}`);
    xStartLabel.setAttribute('text-anchor', 'start');
    xStartLabel.setAttribute('class', 'flywheel-entity-page-chart-label');
    xStartLabel.textContent = fmt(firstDate);
    svg.appendChild(xStartLabel);

    const xEndLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    xEndLabel.setAttribute('x', `${width - padRight}`);
    xEndLabel.setAttribute('y', `${height - 2}`);
    xEndLabel.setAttribute('text-anchor', 'end');
    xEndLabel.setAttribute('class', 'flywheel-entity-page-chart-label');
    xEndLabel.textContent = fmt(lastDate);
    svg.appendChild(xEndLabel);

    // Chart area
    const chartW = width - padLeft - padRight;
    const chartH = height - padTop - padBottom;

    const coords = timeline.map((t, i) => {
      const x = padLeft + (i / (timeline.length - 1)) * chartW;
      const y = padTop + chartH - ((t.score - minS) / range) * chartH;
      return { x, y, score: t.score, ts: t.timestamp };
    });

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    line.setAttribute('points', coords.map(c => `${c.x},${c.y}`).join(' '));
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', 'var(--interactive-accent)');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(line);

    // Hover dots (invisible until hovered)
    for (const c of coords) {
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', `${c.x}`);
      dot.setAttribute('cy', `${c.y}`);
      dot.setAttribute('r', '4');
      dot.setAttribute('class', 'flywheel-entity-page-chart-dot');
      const d = new Date(c.ts);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      dot.setAttribute('data-tooltip', `${dateStr}: ${c.score.toFixed(1)}`);
      svg.appendChild(dot);
    }

    // Tooltip element
    const tooltipEl = wrapper.createDiv('flywheel-entity-page-chart-tooltip');
    tooltipEl.style.display = 'none';

    svg.addEventListener('mousemove', (e) => {
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const scaleX = width / rect.width;
      const svgX = mx * scaleX;

      // Find nearest point
      let nearest = coords[0];
      let minDist = Infinity;
      for (const c of coords) {
        const dist = Math.abs(c.x - svgX);
        if (dist < minDist) { minDist = dist; nearest = c; }
      }

      if (minDist < chartW / coords.length) {
        const d = new Date(nearest.ts);
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        tooltipEl.setText(`${dateStr}: ${nearest.score.toFixed(1)}`);
        tooltipEl.style.display = 'block';
        // Position tooltip relative to wrapper
        const wrapperRect = wrapper.getBoundingClientRect();
        tooltipEl.style.left = `${e.clientX - wrapperRect.left + 8}px`;
        tooltipEl.style.top = `${e.clientY - wrapperRect.top - 20}px`;

        // Highlight dot
        svg.querySelectorAll('.flywheel-entity-page-chart-dot').forEach(d => d.classList.remove('is-active'));
        const activeDot = svg.querySelector(`circle[data-tooltip="${dateStr}: ${nearest.score.toFixed(1)}"]`);
        activeDot?.classList.add('is-active');
      } else {
        tooltipEl.style.display = 'none';
        svg.querySelectorAll('.flywheel-entity-page-chart-dot').forEach(d => d.classList.remove('is-active'));
      }
    });

    svg.addEventListener('mouseleave', () => {
      tooltipEl.style.display = 'none';
      svg.querySelectorAll('.flywheel-entity-page-chart-dot').forEach(d => d.classList.remove('is-active'));
    });
  }
}
