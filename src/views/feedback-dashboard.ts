/**
 * Feedback Loop Dashboard View
 *
 * Visualises the flywheel feedback loop as a vertical pipeline with 5 stages
 * connected by an animated return arc. Each stage is a collapsible accordion
 * showing aggregate stats and last batch changes.
 */

import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type {
  FlywheelMcpClient,
  McpFeedbackDashboardResponse,
  McpHealthCheckResponse,
  McpPipelineStep,
} from '../mcp/client';

export const FEEDBACK_DASHBOARD_VIEW_TYPE = 'flywheel-feedback-dashboard';

interface StageConfig {
  id: string;
  name: string;
  icon: string;
}

const STAGES: StageConfig[] = [
  { id: 'discover', name: 'Discover', icon: 'search' },
  { id: 'suggest', name: 'Suggest', icon: 'sparkles' },
  { id: 'apply', name: 'Apply', icon: 'check-circle' },
  { id: 'learn', name: 'Learn', icon: 'brain' },
  { id: 'adapt', name: 'Adapt', icon: 'sliders-horizontal' },
];

export class FeedbackDashboardView extends ItemView {
  private mcpClient: FlywheelMcpClient;
  private dashboardData: McpFeedbackDashboardResponse['dashboard'] | null = null;
  private healthData: McpHealthCheckResponse | null = null;
  private expandedStages = new Set<string>(STAGES.map(s => s.id));
  private indexReady = false;
  private healthUnsub: (() => void) | null = null;
  private pipelineTimestamp = 0;
  private stageContentEls = new Map<string, HTMLElement>();
  private loopContainer: HTMLElement | null = null;
  private captionEl: HTMLElement | null = null;
  private stageHeaderEls = new Map<string, HTMLElement>();

  constructor(leaf: WorkspaceLeaf, mcpClient: FlywheelMcpClient) {
    super(leaf);
    this.mcpClient = mcpClient;
  }

  getViewType(): string {
    return FEEDBACK_DASHBOARD_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Flywheel Feedback Loop';
  }

  getIcon(): string {
    return 'refresh-cw';
  }

  async onOpen(): Promise<void> {
    await this.render();
  }

  private async render(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('flywheel-feedback-dashboard');

    if (!this.mcpClient.connected || !this.indexReady) {
      const splash = container.createDiv('flywheel-splash');
      const imgPath = `${this.app.vault.configDir}/plugins/flywheel-crank/flywheel.png`;
      const imgEl = splash.createEl('img', { cls: 'flywheel-splash-logo' });
      imgEl.src = this.app.vault.adapter.getResourcePath(imgPath);
      imgEl.alt = '';
      splash.createDiv('flywheel-splash-text').setText(
        this.mcpClient.connected ? 'Building vault index...' : 'Connecting to flywheel-memory...'
      );
      if (!this.healthUnsub) {
        this.healthUnsub = this.mcpClient.onHealthUpdate(health => {
          if (health.index_state === 'ready' && !this.indexReady) {
            this.indexReady = true;
            this.render();
          }
        });
      }
      return;
    }

    // Re-subscribe for live updates
    if (this.healthUnsub) { this.healthUnsub(); this.healthUnsub = null; }
    this.healthUnsub = this.mcpClient.onHealthUpdate(health => {
      const newTs = health.last_pipeline?.timestamp ?? 0;
      if (newTs !== this.pipelineTimestamp) {
        this.pipelineTimestamp = newTs;
        this.healthData = health;
        this.updateCaption();
        this.populateBatchDeltas();
        this.refreshExpandedStages();
      }
    });

    // Loop visual
    this.loopContainer = container.createDiv('flywheel-loop');
    const loopContainer = this.loopContainer;

    // Compact batch caption (replaces bordered banner)
    this.captionEl = loopContainer.createDiv('flywheel-loop-caption');
    this.updateCaption();
    const stageEls = new Map<string, HTMLElement>();

    for (const stage of STAGES) {
      const stageEl = loopContainer.createDiv('flywheel-loop-stage-accordion');
      stageEl.dataset.stage = stage.id;

      // Header row (always visible)
      const headerEl = stageEl.createDiv('flywheel-loop-stage');
      headerEl.dataset.stage = stage.id;

      const chevronEl = headerEl.createDiv('flywheel-loop-stage-chevron');
      setIcon(chevronEl, 'chevron-right');

      const iconEl = headerEl.createDiv('flywheel-loop-stage-icon');
      setIcon(iconEl, stage.icon);

      headerEl.createDiv('flywheel-loop-stage-name').setText(stage.name);
      headerEl.createDiv('flywheel-loop-stage-stat').setText('...');
      headerEl.createDiv('flywheel-loop-stage-delta');

      // Content area (collapsible)
      const contentEl = stageEl.createDiv('flywheel-loop-stage-content');
      this.stageContentEls.set(stage.id, contentEl);

      if (this.expandedStages.has(stage.id)) {
        stageEl.addClass('is-expanded');
      }

      headerEl.addEventListener('click', () => {
        if (this.expandedStages.has(stage.id)) {
          this.expandedStages.delete(stage.id);
          stageEl.removeClass('is-expanded');
        } else {
          this.expandedStages.add(stage.id);
          stageEl.addClass('is-expanded');
          this.renderStageContent(stage.id, contentEl);
        }
        // Re-render arc after layout change
        requestAnimationFrame(() => {
          if (this.loopContainer) this.renderArc(this.loopContainer);
        });
      });

      stageEls.set(stage.id, headerEl);
      this.stageHeaderEls.set(stage.id, headerEl);
    }

    // Load data
    try {
      const [health, feedback] = await Promise.all([
        this.mcpClient.healthCheck(),
        this.mcpClient.wikilinkFeedbackDashboard(),
      ]);
      this.healthData = health;
      this.dashboardData = feedback.dashboard;
    } catch {
      this.healthData = this.mcpClient.lastHealth;
      this.dashboardData = null;
    }

    // Update caption now that we have health data
    this.updateCaption();

    // Populate headline stats + batch deltas + tooltips
    this.populateHeadlines(stageEls);
    this.populateBatchDeltas();
    this.populateTooltips();

    // Render SVG arc after stages are laid out
    requestAnimationFrame(() => this.renderArc(loopContainer));

    // Render content for any expanded stages
    for (const stageId of this.expandedStages) {
      const contentEl = this.stageContentEls.get(stageId);
      if (contentEl) this.renderStageContent(stageId, contentEl);
    }
  }

  private populateHeadlines(stageEls: Map<string, HTMLElement>): void {
    const d = this.dashboardData;
    const h = this.healthData;

    const setStat = (stageId: string, text: string) => {
      const el = stageEls.get(stageId);
      if (el) {
        const stat = el.querySelector('.flywheel-loop-stage-stat');
        if (stat) stat.setText(text);
      }
    };

    setStat('discover', `${h?.entity_count ?? 0} entities`);
    setStat('suggest', '11 layers');

    if (d) {
      const applied = d.applications.applied;
      setStat('apply', `${applied} active`);
      const acc = Math.round(d.overall_accuracy * 100);
      setStat('learn', `${acc}% accuracy`);
      const boosted = d.boost_tiers.reduce((sum, t) => sum + (t.boost > 0 ? t.entities.length : 0), 0);
      const suppressed = d.suppressed.length;
      setStat('adapt', `${boosted} boosted · ${suppressed} suppressed`);
    } else {
      setStat('apply', '0 active');
      setStat('learn', '— accuracy');
      setStat('adapt', '0 boosted');
    }
  }

  private renderArc(loopContainer: HTMLElement): void {
    // Remove existing arc before re-rendering
    const existingArc = loopContainer.querySelector('.flywheel-loop-arc');
    if (existingArc) existingArc.remove();

    const stages = loopContainer.querySelectorAll('.flywheel-loop-stage');
    if (stages.length < 2) return;

    const containerRect = loopContainer.getBoundingClientRect();
    const firstRect = stages[0].getBoundingClientRect();
    const lastRect = stages[stages.length - 1].getBoundingClientRect();

    const w = loopContainer.offsetWidth;
    const h = loopContainer.offsetHeight;

    const firstY = firstRect.top - containerRect.top + firstRect.height / 2;
    const lastY = lastRect.top - containerRect.top + lastRect.height / 2;

    const stageRight = w - 28;
    const arcFar = w - 6;
    const r = 18;

    const pathD = [
      `M ${stageRight} ${lastY}`,
      `L ${arcFar - r} ${lastY}`,
      `Q ${arcFar} ${lastY} ${arcFar} ${lastY - r}`,
      `L ${arcFar} ${firstY + r}`,
      `Q ${arcFar} ${firstY} ${arcFar - r} ${firstY}`,
      `L ${stageRight} ${firstY}`,
    ].join(' ');

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.addClass('flywheel-loop-arc');
    svg.setAttribute('width', `${w}`);
    svg.setAttribute('height', `${h}`);
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', 'flywheel-arc-arrow');
    marker.setAttribute('viewBox', '0 0 6 6');
    marker.setAttribute('refX', '6');
    marker.setAttribute('refY', '3');
    marker.setAttribute('markerWidth', '6');
    marker.setAttribute('markerHeight', '6');
    marker.setAttribute('orient', 'auto');
    const arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    arrowPath.setAttribute('d', 'M 0 0 L 6 3 L 0 6 z');
    arrowPath.setAttribute('fill', 'var(--text-faint)');
    arrowPath.setAttribute('opacity', '0.5');
    marker.appendChild(arrowPath);
    defs.appendChild(marker);
    svg.appendChild(defs);

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathD);
    path.setAttribute('marker-end', 'url(#flywheel-arc-arrow)');
    svg.appendChild(path);

    loopContainer.appendChild(svg);
  }

  // =========================================================================
  // Compact batch caption
  // =========================================================================

  private updateCaption(): void {
    if (!this.captionEl) return;
    const pipeline = this.healthData?.last_pipeline;
    if (!pipeline) {
      this.captionEl.setText('Waiting for file changes\u2026');
      return;
    }
    const agoStr = this.formatPipelineAgo();
    const files = pipeline.files_changed ?? '?';
    const plural = pipeline.files_changed !== 1 ? 's' : '';
    this.captionEl.setText(
      `Last batch: ${files} file${plural} \u00B7 ${pipeline.duration_ms}ms${agoStr ? ` \u00B7 ${agoStr}` : ''}`
    );
  }

  // =========================================================================
  // Batch deltas on stage headers
  // =========================================================================

  private populateBatchDeltas(): void {
    const setDelta = (stageId: string, text: string) => {
      const el = this.stageHeaderEls.get(stageId);
      if (!el) return;
      const delta = el.querySelector('.flywheel-loop-stage-delta');
      if (delta) delta.setText(text);
    };

    // Discover delta from entity_scan step
    const entityStep = this.getStep('entity_scan');
    if (entityStep) {
      const output = entityStep.output;
      const added = output.added as Array<string | { name: string }> | undefined;
      const removed = output.removed as Array<string | { name: string }> | undefined;
      const aliasChanges = output.alias_changes as Array<{ entity: string; before: string[]; after: string[] }> | undefined;
      const parts: string[] = [];
      if (added && added.length > 0) parts.push(`+${added.length}`);
      if (removed && removed.length > 0) parts.push(`-${removed.length}`);
      if (aliasChanges && aliasChanges.length > 0) parts.push(`~${aliasChanges.length} aliases`);
      setDelta('discover', parts.length > 0 ? parts.join(' / ') : '');
    } else {
      setDelta('discover', '');
    }

    // Suggest delta from hub_scores + embeddings steps
    const hubStep = this.getStep('hub_scores');
    const embStep = this.getStep('note_embeddings');
    {
      const parts: string[] = [];
      if (hubStep && !hubStep.skipped) {
        const diffs = hubStep.output.diffs as Array<unknown> | undefined;
        if (diffs && diffs.length > 0) parts.push(`${diffs.length} hub changes`);
      }
      if (embStep && !embStep.skipped) {
        const updated = embStep.output.updated as number | undefined;
        if (updated && updated > 0) parts.push(`${updated} embedding${updated !== 1 ? 's' : ''}`);
      }
      setDelta('suggest', parts.length > 0 ? parts.join(' \u00B7 ') : '');
    }

    // Apply delta from wikilink_check step
    const wlStep = this.getStep('wikilink_check');
    if (wlStep) {
      const tracked = wlStep.output.tracked as Array<{ file: string; entities: string[] }> | undefined;
      const total = tracked?.reduce((s, t) => s + t.entities.length, 0) ?? 0;
      setDelta('apply', total > 0 ? `${total} tracked links` : '');
    } else {
      setDelta('apply', '');
    }

    // Learn delta from implicit_feedback step
    const fbStep = this.getStep('implicit_feedback');
    if (fbStep) {
      const removals = fbStep.output.removals as Array<unknown> | undefined;
      setDelta('learn', removals && removals.length > 0 ? `${removals.length} removal${removals.length !== 1 ? 's' : ''} detected` : '');
    } else {
      setDelta('learn', '');
    }

    setDelta('adapt', '');
  }

  // =========================================================================
  // Tooltips (narrative text as aria-label)
  // =========================================================================

  private static readonly STAGE_TOOLTIPS: Record<string, string> = {
    discover: 'Flywheel continuously scans your vault, identifying entities (people, technologies, projects, concepts) that power the suggestion engine.',
    suggest: 'Each potential wikilink is scored through 11 layers before being suggested. Higher scores mean stronger relevance.',
    apply: 'When flywheel auto-applies wikilinks, it tracks each one. If you remove a link, that\u2019s recorded as implicit negative feedback.',
    learn: 'Your feedback loop is active. Flywheel learns from both explicit feedback and implicit signals like link removal.',
    adapt: 'Flywheel adapts its scoring based on your feedback. High-accuracy entities get boosted; consistently wrong ones get suppressed.',
  };

  private populateTooltips(): void {
    for (const [stageId, el] of this.stageHeaderEls) {
      const tooltip = FeedbackDashboardView.STAGE_TOOLTIPS[stageId];
      if (tooltip) el.setAttribute('aria-label', tooltip);
    }
  }

  // =========================================================================
  // Stage content rendering (accordion body)
  // =========================================================================

  private renderStageContent(stageId: string, el: HTMLElement): void {
    el.empty();
    switch (stageId) {
      case 'discover': this.renderDiscoverContent(el); break;
      case 'suggest': this.renderSuggestContent(el); break;
      case 'apply': this.renderApplyContent(el); break;
      case 'learn': this.renderLearnContent(el); break;
      case 'adapt': this.renderAdaptContent(el); break;
    }
  }

  private refreshExpandedStages(): void {
    for (const stageId of this.expandedStages) {
      const el = this.stageContentEls.get(stageId);
      if (el) this.renderStageContent(stageId, el);
    }
  }

  private renderInfoRow(container: HTMLElement, label: string, value: string): void {
    const row = container.createDiv('flywheel-loop-info-row');
    row.createSpan('flywheel-loop-info-label').setText(label);
    row.createSpan('flywheel-loop-info-value').setText(value);
  }

  // =========================================================================
  // Recent pipelines helper
  // =========================================================================

  private getRecentPipelines(): Array<{
    timestamp: number;
    trigger: string;
    duration_ms: number;
    files_changed: number | null;
    changed_paths: string[] | null;
    steps: McpPipelineStep[];
  }> {
    const h = this.healthData;
    if (!h) return [];
    if (h.recent_pipelines && h.recent_pipelines.length > 0) return h.recent_pipelines;
    if (h.last_pipeline) return [h.last_pipeline];
    return [];
  }

  private formatBatchHeader(pipeline: { timestamp: number; files_changed: number | null; changed_paths: string[] | null }): string {
    const paths = pipeline.changed_paths ?? [];
    const fileCount = pipeline.files_changed ?? paths.length;
    const ago = this.formatTimestampAgo(pipeline.timestamp);

    if (paths.length === 0) {
      return `${fileCount} file${fileCount !== 1 ? 's' : ''} \u00B7 ${ago}`;
    }
    if (paths.length === 1) {
      return `${this.shortenPath(paths[0])} \u00B7 ${ago}`;
    }
    const first = this.shortenPath(paths[0]);
    if (paths.length === 2) {
      return `${first}, ${this.shortenPath(paths[1])} \u00B7 ${ago}`;
    }
    return `${paths.length} files \u00B7 ${first}, +${paths.length - 1} more \u00B7 ${ago}`;
  }

  private shortenPath(p: string): string {
    return p.replace(/\.md$/, '').split('/').pop() || p;
  }

  private formatTimestampAgo(ts: number): string {
    const ago = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (ago < 60) return `${ago}s ago`;
    if (ago < 3600) return `${Math.floor(ago / 60)}m ago`;
    const h = Math.floor(ago / 3600);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  private getStepFromPipeline(pipeline: { steps: McpPipelineStep[] }, name: string): McpPipelineStep | null {
    return pipeline.steps.find(s => s.name === name) ?? null;
  }

  // =========================================================================
  // Per-stage batch detail renderers
  // =========================================================================

  private renderDiscoverBatchDetail(batchEl: HTMLElement, step: McpPipelineStep): void {
    const output = step.output;
    const added = output.added as Array<string | { name: string; category: string; path: string }> | undefined;
    const removed = output.removed as Array<string | { name: string; category: string; path: string }> | undefined;
    const aliasChanges = output.alias_changes as Array<{ entity: string; before: string[]; after: string[] }> | undefined;

    if (!added?.length && !removed?.length && !aliasChanges?.length) {
      return; // Skip empty — no noise
    }

    const formatEntity = (e: string | { name: string; category: string; path: string }): string => {
      if (typeof e === 'string') return e;
      const folder = e.path.replace(/\.md$/, '').split('/').slice(0, -1).join('/');
      return folder ? `${e.name} (${e.category}) in ${folder}/` : `${e.name} (${e.category})`;
    };

    if (added && added.length > 0) {
      for (const entity of added.slice(0, 5)) {
        batchEl.createDiv('flywheel-batch-change flywheel-batch-change-added').setText(`+ ${formatEntity(entity)}`);
      }
      if (added.length > 5) {
        batchEl.createDiv('flywheel-batch-change flywheel-batch-change-more').setText(`+${added.length - 5} more added`);
      }
    }
    if (removed && removed.length > 0) {
      for (const entity of removed.slice(0, 5)) {
        batchEl.createDiv('flywheel-batch-change flywheel-batch-change-removed').setText(`- ${formatEntity(entity)}`);
      }
      if (removed.length > 5) {
        batchEl.createDiv('flywheel-batch-change flywheel-batch-change-more').setText(`+${removed.length - 5} more removed`);
      }
    }
    if (aliasChanges && aliasChanges.length > 0) {
      for (const change of aliasChanges.slice(0, 3)) {
        const text = `~ ${change.entity}: [${change.before.join(', ')}] \u2192 [${change.after.join(', ')}]`;
        batchEl.createDiv('flywheel-batch-change flywheel-batch-change-alias').setText(text);
      }
      if (aliasChanges.length > 3) {
        batchEl.createDiv('flywheel-batch-change flywheel-batch-change-more').setText(`+${aliasChanges.length - 3} more alias changes`);
      }
    }
  }

  private renderSuggestBatchDetail(batchEl: HTMLElement, pipeline: { steps: McpPipelineStep[] }): void {
    const hubStep = this.getStepFromPipeline(pipeline, 'hub_scores');
    const entEmbStep = this.getStepFromPipeline(pipeline, 'entity_embeddings');
    let hasContent = false;

    // Hub score diffs
    if (hubStep && !hubStep.skipped) {
      const diffs = hubStep.output.diffs as Array<{ entity: string; before: number; after: number }> | undefined;
      if (diffs && diffs.length > 0) {
        const diffStrs = diffs.slice(0, 5).map(d => `${d.entity} ${d.before}\u2192${d.after}`);
        batchEl.createDiv('flywheel-batch-detail').setText(`Hub: ${diffStrs.join(', ')}`);
        hasContent = true;
      }
    }

    // Entity embedding names (skip note embeddings — always same as changed files, obvious noise)
    if (entEmbStep && !entEmbStep.skipped) {
      const entities = entEmbStep.output.updated_entities as string[] | undefined;
      if (entities && entities.length > 0) {
        const text = entities.slice(0, 5).join(', ') + (entities.length > 5 ? `, +${entities.length - 5} more` : '');
        batchEl.createDiv('flywheel-batch-detail').setText(`Entity embedding: ${text}`);
        hasContent = true;
      }
    }

    // Return without rendering anything if no meaningful content — caller will skip this batch
    if (!hasContent) return;
  }

  private renderApplyBatchDetail(batchEl: HTMLElement, step: McpPipelineStep): void {
    const tracked = step.output.tracked as Array<{ file: string; entities: string[] }> | undefined;
    if (!tracked || tracked.length === 0) return;
    for (const t of tracked.slice(0, 5)) {
      const entities = t.entities.map(e => `[[${e}]]`).join(', ');
      batchEl.createDiv('flywheel-batch-detail').setText(`${this.shortenPath(t.file)}: ${entities}`);
    }
    if (tracked.length > 5) {
      batchEl.createDiv('flywheel-batch-change flywheel-batch-change-more').setText(`+${tracked.length - 5} more files`);
    }
  }

  private renderLearnBatchDetail(batchEl: HTMLElement, step: McpPipelineStep): void {
    const removals = step.output.removals as Array<{ entity: string; file: string }> | undefined;
    if (!removals || removals.length === 0) return;
    for (const r of removals.slice(0, 5)) {
      batchEl.createDiv('flywheel-batch-change flywheel-batch-change-removed').setText(
        `[[${r.entity}]] removed from ${this.shortenPath(r.file)} \u2192 negative feedback`
      );
    }
    if (removals.length > 5) {
      batchEl.createDiv('flywheel-batch-change flywheel-batch-change-more').setText(`+${removals.length - 5} more removals`);
    }
  }

  // =========================================================================
  // Stage content renderers
  // =========================================================================

  // -- Discover --
  private renderDiscoverContent(panel: HTMLElement): void {
    const h = this.healthData;
    const pipelines = this.getRecentPipelines();

    // Recent batch cards — only render if batch has meaningful entity changes
    if (pipelines.length > 0) {
      for (const pipeline of pipelines) {
        const step = this.getStepFromPipeline(pipeline, 'entity_scan');
        if (!step) continue;
        const output = step.output;
        const added = output.added as Array<unknown> | undefined;
        const removed = output.removed as Array<unknown> | undefined;
        const aliasChanges = output.alias_changes as Array<unknown> | undefined;
        if (!added?.length && !removed?.length && !aliasChanges?.length) continue;
        const batchEl = panel.createDiv('flywheel-batch-section');
        batchEl.createDiv('flywheel-batch-section-header').setText(this.formatBatchHeader(pipeline));
        this.renderDiscoverBatchDetail(batchEl, step);
      }
    }

    // Aggregate state below
    this.renderInfoRow(panel, 'Entities', `${h?.entity_count ?? 0}`);
    this.renderInfoRow(panel, 'Notes', `${h?.note_count ?? 0}`);
  }

  // -- Suggest --
  private renderSuggestContent(panel: HTMLElement): void {
    const d = this.dashboardData;
    const h = this.healthData;
    const pipelines = this.getRecentPipelines();

    // Show only the most recent batch with meaningful suggest changes (avoids duplication)
    if (pipelines.length > 0) {
      const latest = pipelines.find(pipeline => {
        const hubStep = this.getStepFromPipeline(pipeline, 'hub_scores');
        const entEmbStep = this.getStepFromPipeline(pipeline, 'entity_embeddings');
        const hubDiffs = hubStep && !hubStep.skipped ? hubStep.output.diffs as Array<unknown> | undefined : undefined;
        const entEntities = entEmbStep && !entEmbStep.skipped ? entEmbStep.output.updated_entities as Array<unknown> | undefined : undefined;
        return hubDiffs?.length || entEntities?.length;
      });
      if (latest) {
        const batchEl = panel.createDiv('flywheel-batch-section');
        batchEl.createDiv('flywheel-batch-section-header').setText(this.formatBatchHeader(latest));
        this.renderSuggestBatchDetail(batchEl, latest);
      }
    }

    // Aggregate notes
    if (d) {
      const feedbackEntities = d.boost_tiers.reduce(
        (sum, t) => sum + t.entities.length, 0
      );
      if (feedbackEntities > 0) {
        panel.createDiv('flywheel-loop-detail-note').setText(
          `Layer 10: adjusting ${feedbackEntities} entities`
        );
      }
    }

    if (h?.embeddings_ready && h.embeddings_count) {
      panel.createDiv('flywheel-loop-detail-note').setText(
        `Layer 11: ${h.embeddings_count} embeddings active`
      );
    }
  }

  // -- Apply --
  private renderApplyContent(panel: HTMLElement): void {
    const d = this.dashboardData;

    // Aggregate stats only — per-batch wikilink_check is always empty for watcher batches
    if (d && (d.applications.applied > 0 || d.applications.removed > 0)) {
      const { applied, removed } = d.applications;
      this.renderInfoRow(panel, 'Active auto-wikilinks', `${applied}`);
      this.renderInfoRow(panel, 'Removed by you', `${removed}`);
      const total = applied + removed;
      const retention = total > 0 ? Math.round((applied / total) * 100) : 100;
      this.renderInfoRow(panel, 'Retention', `${retention}%`);
    } else {
      panel.createDiv('flywheel-loop-detail-note').setText('No wikilink applications tracked yet.');
    }
  }

  // -- Learn --
  private renderLearnContent(panel: HTMLElement): void {
    const d = this.dashboardData;
    const pipelines = this.getRecentPipelines();

    // Recent batch cards — only render if removals were detected
    if (pipelines.length > 0) {
      for (const pipeline of pipelines) {
        const step = this.getStepFromPipeline(pipeline, 'implicit_feedback');
        if (!step) continue;
        const removals = step.output.removals as Array<unknown> | undefined;
        if (!removals?.length) continue;
        const batchEl = panel.createDiv('flywheel-batch-section');
        batchEl.createDiv('flywheel-batch-section-header').setText(this.formatBatchHeader(pipeline));
        this.renderLearnBatchDetail(batchEl, step);
      }
    }

    // Aggregate feedback stats
    if (d && d.total_feedback > 0) {
      this.renderInfoRow(panel, 'Total feedback', `${d.total_feedback}`);
      const expAcc = d.feedback_sources.explicit.count > 0
        ? Math.round((d.feedback_sources.explicit.correct / d.feedback_sources.explicit.count) * 100)
        : 0;
      this.renderInfoRow(panel, 'Explicit', `${d.feedback_sources.explicit.count} (${expAcc}% correct)`);
      this.renderInfoRow(panel, 'Implicit', `${d.feedback_sources.implicit.count} removals detected`);

      // Recent entries
      if (d.recent.length > 0) {
        const recentTitle = panel.createDiv('flywheel-loop-section-title');
        recentTitle.setText('Recent');

        const recentList = panel.createDiv('flywheel-loop-recent');
        for (const entry of d.recent.slice(0, 10)) {
          const row = recentList.createDiv('flywheel-loop-recent-entry');
          const indicator = row.createSpan('flywheel-loop-recent-indicator');
          indicator.setText(entry.correct ? '\u2713' : '\u2717');
          indicator.addClass(entry.correct ? 'is-correct' : 'is-incorrect');

          row.createSpan('flywheel-loop-recent-entity').setText(entry.entity);

          const noteName = entry.note_path.replace(/\.md$/, '').split('/').pop() || entry.note_path;
          row.createSpan('flywheel-loop-recent-note').setText(noteName);

          const isImplicit = entry.context.startsWith('implicit:');
          if (isImplicit) {
            row.createSpan('flywheel-loop-recent-badge').setText('auto');
          }

          row.createSpan('flywheel-loop-recent-time').setText(this.formatRelativeTime(entry.created_at));
        }
      }

      // 30-day timeline
      if (d.timeline.length > 0) {
        const timelineTitle = panel.createDiv('flywheel-loop-section-title');
        timelineTitle.setText('30-day trend');

        const timelineEl = panel.createDiv('flywheel-loop-timeline');
        const maxCount = Math.max(...d.timeline.map(t => t.count), 1);

        for (const day of d.timeline) {
          const barWrap = timelineEl.createDiv('flywheel-loop-timeline-bar-wrap');
          const bar = barWrap.createDiv('flywheel-loop-timeline-bar');
          const height = Math.max(4, (day.count / maxCount) * 40);
          bar.style.height = `${height}px`;

          const accuracy = day.count > 0 ? day.correct / day.count : 0;
          if (accuracy >= 0.8) bar.addClass('is-good');
          else if (accuracy >= 0.5) bar.addClass('is-ok');
          else bar.addClass('is-poor');

          barWrap.setAttribute('aria-label', `${day.day}: ${day.count} (${Math.round(accuracy * 100)}% correct)`);
        }
      }
    } else if (!pipelines.length) {
      panel.createDiv('flywheel-loop-detail-note').setText('No feedback recorded yet.');
    }
  }

  // -- Adapt --
  private renderAdaptContent(panel: HTMLElement): void {
    const d = this.dashboardData;

    if (!d || d.total_feedback === 0) {
      panel.createDiv('flywheel-loop-detail-note').setText(
        'No adaptation data \u2014 feedback will appear as you use wikilink suggestions'
      );
      return;
    }

    // Boost tiers
    for (const tier of d.boost_tiers) {
      if (tier.entities.length === 0) continue;

      const tierEl = panel.createDiv('flywheel-loop-tier');
      tierEl.createDiv('flywheel-loop-tier-label').setText(`${tier.label} (+${tier.boost})`);

      for (const entity of tier.entities.slice(0, 8)) {
        const row = tierEl.createDiv('flywheel-loop-tier-entity');
        row.createSpan('flywheel-loop-tier-entity-name').setText(entity.entity);
        const meta = row.createSpan('flywheel-loop-tier-entity-meta');
        meta.setText(`${Math.round(entity.accuracy * 100)}%, ${entity.total} samples`);
      }
      if (tier.entities.length > 8) {
        tierEl.createDiv('flywheel-loop-tier-more').setText(`+${tier.entities.length - 8} more`);
      }
    }

    // Suppressed
    if (d.suppressed.length > 0) {
      const suppressEl = panel.createDiv('flywheel-loop-tier flywheel-loop-tier-suppressed');
      suppressEl.createDiv('flywheel-loop-tier-label').setText(`Suppressed (${d.suppressed.length})`);
      for (const entity of d.suppressed) {
        const row = suppressEl.createDiv('flywheel-loop-tier-entity');
        row.createSpan('flywheel-loop-tier-entity-name').setText(entity.entity);
        row.createSpan('flywheel-loop-tier-entity-meta').setText(
          `${Math.round(entity.false_positive_rate * 100)}% false positive rate`
        );
      }
    }

    // Learning
    if (d.learning.length > 0) {
      const learnEl = panel.createDiv('flywheel-loop-tier');
      learnEl.createDiv('flywheel-loop-tier-label').setText(`Learning (${d.learning.length})`);
      for (const entity of d.learning.slice(0, 5)) {
        const row = learnEl.createDiv('flywheel-loop-tier-entity');
        row.createSpan('flywheel-loop-tier-entity-name').setText(entity.entity);
        row.createSpan('flywheel-loop-tier-entity-meta').setText(
          `needs ${5 - entity.total} more feedback points`
        );
      }
      if (d.learning.length > 5) {
        learnEl.createDiv('flywheel-loop-tier-more').setText(`+${d.learning.length - 5} more`);
      }
    }
  }

  // =========================================================================
  // Pipeline step helpers
  // =========================================================================

  private getStep(name: string): McpPipelineStep | null {
    const pipeline = this.healthData?.last_pipeline;
    if (!pipeline) return null;
    return pipeline.steps.find(s => s.name === name) ?? null;
  }

  private formatPipelineAgo(): string {
    const pipeline = this.healthData?.last_pipeline;
    if (!pipeline) return '';
    const ago = Math.max(0, Math.floor((Date.now() - pipeline.timestamp) / 1000));
    if (ago < 60) return `${ago}s ago`;
    if (ago < 3600) return `${Math.floor(ago / 60)}m ago`;
    return `${Math.floor(ago / 3600)}h ago`;
  }

  private formatRelativeTime(isoDate: string): string {
    const delta = Math.max(0, Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000));
    if (delta < 60) return `${delta}s ago`;
    if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
    const h = Math.floor(delta / 3600);
    if (h < 24) return `${h}h ago`;
    const days = Math.floor(h / 24);
    return `${days}d ago`;
  }

  async onClose(): Promise<void> {
    if (this.healthUnsub) {
      this.healthUnsub();
      this.healthUnsub = null;
    }
  }
}
