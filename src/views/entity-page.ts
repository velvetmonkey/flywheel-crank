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
    (this.leaf as any).updateHeader();
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

    // Check suppression status via dashboard's suppressed list
    let isSuppressed = false;
    let suppressionFpRate: number | null = null;
    try {
      const dash = await this.mcpClient.wikilinkFeedbackDashboard();
      const entry = dash.dashboard?.suppressed?.find(
        s => s.entity?.toLowerCase() === this.entityName!.toLowerCase()
      );
      if (entry) {
        isSuppressed = true;
        suppressionFpRate = entry.false_positive_rate ?? null;
      }
    } catch { /* ignore — dashboard not available */ }

    // Header
    const header = container.createDiv('flywheel-entity-page-header');
    const nameEl = header.createDiv('flywheel-entity-page-name');
    nameEl.setText(this.entityName);
    nameEl.addClass('flywheel-entity-page-name-clickable');
    nameEl.addEventListener('click', () => {
      this.app.workspace.openLinkText(this.entityName + '.md', '', false);
    });

    // Suppressed badge + details
    if (isSuppressed) {
      const badge = header.createDiv('flywheel-entity-page-badge-suppressed');
      badge.setText('Suppressed');

      if (suppressionFpRate !== null) {
        const accuracy = Math.round((1 - suppressionFpRate) * 100);
        const details = header.createDiv('flywheel-entity-page-suppression-details');

        // Accuracy bar
        const barWrap = details.createDiv('flywheel-entity-page-accuracy-bar');
        const barFill = barWrap.createDiv('flywheel-entity-page-accuracy-fill');
        barFill.style.width = `${accuracy}%`;
        barFill.addClass(
          accuracy >= 65 ? 'flywheel-accuracy-good'
            : accuracy >= 35 ? 'flywheel-accuracy-mid'
              : 'flywheel-accuracy-low'
        );

        details.createDiv('flywheel-entity-page-suppression-text').setText(
          `Accuracy: ${accuracy}% \u2014 suppressed because accuracy is below 35% threshold`
        );
      }

      const unsuppressBtn = header.createEl('button', {
        cls: 'flywheel-entity-page-unsuppress-btn',
        text: 'Unsuppress',
      });
      setTooltip(unsuppressBtn, 'Remove suppression — re-enable wikilink suggestions for this entity');
      unsuppressBtn.addEventListener('click', async () => {
        unsuppressBtn.disabled = true;
        unsuppressBtn.setText('Unsuppressing...');
        try {
          await this.mcpClient.unsuppressEntity(this.entityName!);
          new Notice(`"${this.entityName}" unsuppressed`);
          await this.render();
        } catch (err) {
          unsuppressBtn.setText('Failed');
          unsuppressBtn.disabled = false;
        }
      });
    }

    // Concept evolution — current state + timeline + co-occurrence neighbors
    let evolution: Awaited<ReturnType<FlywheelMcpClient['trackConceptEvolution']>> | null = null;
    try {
      evolution = await this.mcpClient.trackConceptEvolution(this.entityName, 90);
    } catch { /* temporal tools may not be available */ }

    // Current state block
    if (evolution?.current_state) {
      const cs = evolution.current_state;
      const stateSection = container.createDiv('flywheel-entity-page-section');
      stateSection.createDiv('flywheel-entity-page-section-title').setText('Current State');
      const stateGrid = stateSection.createDiv('flywheel-entity-page-state-grid');

      if (cs.category) {
        const chip = stateGrid.createSpan('flywheel-entity-page-state-chip');
        chip.setText(cs.category);
        setTooltip(chip, 'Entity category');
      }
      if (cs.hub_score > 0) {
        const chip = stateGrid.createSpan('flywheel-entity-page-state-chip');
        chip.setText(`hub: ${cs.hub_score}`);
        setTooltip(chip, 'Hub score — higher means more connected');
      }
      if (cs.mention_count > 0) {
        const chip = stateGrid.createSpan('flywheel-entity-page-state-chip');
        chip.setText(`${cs.mention_count} mentions`);
        setTooltip(chip, 'Total mentions across vault');
      }
      if (cs.last_mentioned) {
        const chip = stateGrid.createSpan('flywheel-entity-page-state-chip');
        chip.setText(`last: ${cs.last_mentioned}`);
        setTooltip(chip, 'Last mentioned date');
      }
      if (cs.aliases?.length > 0) {
        for (const alias of cs.aliases.slice(0, 5)) {
          const chip = stateGrid.createSpan('flywheel-entity-page-state-chip flywheel-entity-page-alias-chip');
          chip.setText(alias);
          setTooltip(chip, 'Alias');
        }
      }
    }

    // Score timeline chart
    try {
      const timeline = await this.mcpClient.entityScoreTimeline(this.entityName, 30, 50);
      if (timeline.timeline?.length > 1) {
        const chartSection = container.createDiv('flywheel-entity-page-section');
        chartSection.createDiv('flywheel-entity-page-section-title').setText('Score History');
        this.renderScoreChart(chartSection, timeline.timeline);
      }
    } catch { /* no timeline data */ }

    // Evolution timeline
    if (evolution?.timeline?.length) {
      const timelineSection = container.createDiv('flywheel-entity-page-section');
      timelineSection.createDiv('flywheel-entity-page-section-title').setText('Activity Timeline');

      const typeIcons: Record<string, string> = {
        link_added: 'link',
        feedback_positive: 'thumbs-up',
        feedback_negative: 'thumbs-down',
        wikilink_applied: 'wand',
        note_moved: 'move',
      };

      const events = evolution.timeline.slice(-30);
      // Group by date
      const grouped = new Map<string, typeof events>();
      for (const evt of events) {
        const list = grouped.get(evt.date) || [];
        list.push(evt);
        grouped.set(evt.date, list);
      }

      const tl = timelineSection.createDiv('flywheel-entity-page-timeline');
      for (const [date, evts] of grouped) {
        const dateGroup = tl.createDiv('flywheel-entity-page-tl-date-group');
        dateGroup.createDiv('flywheel-entity-page-tl-date').setText(date);

        for (const evt of evts) {
          const row = dateGroup.createDiv('flywheel-entity-page-tl-event');
          const iconEl = row.createSpan('flywheel-entity-page-tl-icon');
          setIcon(iconEl, typeIcons[evt.type] || 'tag');
          row.createSpan('flywheel-entity-page-tl-detail').setText(evt.detail);
          if (evt.edits_survived != null && evt.edits_survived > 0) {
            const survBadge = row.createSpan('flywheel-entity-page-tl-survived');
            survBadge.setText(`${evt.edits_survived} edits`);
            setTooltip(survBadge, `Link survived ${evt.edits_survived} subsequent edits`);
          }
        }
      }

      // Link durability stats
      if (evolution.link_stats?.total_links_tracked > 0) {
        const ls = evolution.link_stats;
        const statsRow = timelineSection.createDiv('flywheel-entity-page-link-stats');
        statsRow.setText(
          `${ls.total_links_tracked} links tracked \u2022 ${ls.links_added_in_window} added \u2022 avg ${ls.avg_edits_survived.toFixed(1)} edits survived`
        );
      }
    }

    // Co-occurrence neighbors
    if (evolution?.cooccurrence_neighbors?.length) {
      const coocSection = container.createDiv('flywheel-entity-page-section');
      coocSection.createDiv('flywheel-entity-page-section-title').setText('Co-occurs With');
      const chipContainer = coocSection.createDiv('flywheel-entity-page-cooc-chips');
      for (const neighbor of evolution.cooccurrence_neighbors.slice(0, 15)) {
        const chip = chipContainer.createSpan('flywheel-entity-page-cooc-chip flywheel-health-clickable');
        chip.setText(neighbor.entity);
        setTooltip(chip, `Co-occurs ${neighbor.count} times`);
        chip.addEventListener('click', () => {
          // Navigate to this entity's page
          (this as any).showEntity(neighbor.entity);
        });
      }
    }

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
    setTooltip(goodBtn, 'Record positive feedback \u2014 boosts this entity\u2019s suggestion score over time');
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
    setTooltip(badBtn, 'Immediately suppress this entity everywhere \u2014 it won\u2019t be auto-linked or suggested until you unsuppress it');
    badBtn.addEventListener('click', async () => {
      badBtn.disabled = true;
      goodBtn.disabled = true;
      await this.mcpClient.reportWikilinkFeedback(entityNameForFeedback, '', false);
      badBtn.setText('Entity suppressed \u2713');
      badBtn.addClass('flywheel-entity-page-action-done');
      new Notice(`Entity suppressed: "${entityNameForFeedback}"`);
      // Re-render to show the suppressed badge and unsuppress button
      await this.render();
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
