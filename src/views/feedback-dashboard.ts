/**
 * Feedback Loop Dashboard — Commit-centric pipeline view
 *
 * Shows each vault edit flowing through 5 gates:
 *   Discover → Suggest → Apply → Learn → Adapt
 *
 * Architecture:
 * - render() builds DOM skeleton once (on open / index ready / drilldown return)
 * - fillContent() populates the skeleton from current data
 * - refreshPipeline() does incremental update on health polls (no container.empty())
 * - Pipeline subjects (entities from edited files) cascade through ALL gates
 * - Active items shown prominently; pass-through items shown as dim summary
 * - Detail sections (heatmap, graph diff, timeline) live in entity drilldown only
 */

import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type {
  FlywheelMcpClient,
  McpFeedbackDashboardResponse,
  McpHealthCheckResponse,
  McpPipelineStep,
  McpEntityScoreTimelineEntry,
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

const LAYER_COLORS: Record<string, string> = {
  contentMatch: 'hsl(210, 70%, 55%)',
  cooccurrenceBoost: 'hsl(210, 55%, 65%)',
  typeBoost: 'hsl(145, 60%, 45%)',
  contextBoost: 'hsl(145, 45%, 55%)',
  hubBoost: 'hsl(145, 50%, 50%)',
  crossFolderBoost: 'hsl(150, 40%, 58%)',
  recencyBoost: 'hsl(38, 90%, 55%)',
  feedbackAdjustment: 'hsl(25, 85%, 55%)',
  semanticBoost: 'hsl(270, 60%, 60%)',
};

const LAYER_LABELS: Record<string, string> = {
  contentMatch: 'Content Match',
  cooccurrenceBoost: 'Co-occurrence',
  typeBoost: 'Type Boost',
  contextBoost: 'Context',
  recencyBoost: 'Recency',
  crossFolderBoost: 'Cross-folder',
  hubBoost: 'Hub Score',
  feedbackAdjustment: 'Feedback',
  semanticBoost: 'Semantic',
};

type PipelineRecord = NonNullable<McpHealthCheckResponse['last_pipeline']>;

export class FeedbackDashboardView extends ItemView {
  private mcpClient: FlywheelMcpClient;
  private dashboardData: McpFeedbackDashboardResponse['dashboard'] | null = null;
  private healthData: McpHealthCheckResponse | null = null;
  private indexReady = false;
  private healthUnsub: (() => void) | null = null;
  private pipelineTimestamp = 0;
  private pipelineCount = 0;
  private loopContainer: HTMLElement | null = null;
  private entityDrilldownActive = false;
  private isRefreshing = false;
  private skeletonBuilt = false;
  private selectedPipelineIndex = 0;

  // Pipeline subjects — entities from edited files that flow through all gates
  private pipelineSubjects: string[] = [];
  private subjectCache = new Map<number, string[]>(); // keyed by pipeline timestamp

  // Skeleton DOM refs
  private headerEl: HTMLElement | null = null;
  private historyEl: HTMLElement | null = null;
  private gateEls: Map<string, { summary: HTMLElement; items: HTMLElement }> = new Map();
  private scoreEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, mcpClient: FlywheelMcpClient) {
    super(leaf);
    this.mcpClient = mcpClient;
  }

  getViewType(): string { return FEEDBACK_DASHBOARD_VIEW_TYPE; }
  getDisplayText(): string { return 'Flywheel Feedback Loop'; }
  getIcon(): string { return 'refresh-cw'; }

  async onOpen(): Promise<void> { await this.render(); }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  private async render(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('flywheel-feedback-dashboard');
    this.skeletonBuilt = false;
    this.gateEls.clear();

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

    // Subscribe for incremental updates
    if (this.healthUnsub) { this.healthUnsub(); this.healthUnsub = null; }
    this.healthUnsub = this.mcpClient.onHealthUpdate(health => {
      const newTs = health.last_pipeline?.timestamp ?? 0;
      if (newTs !== this.pipelineTimestamp) {
        this.pipelineTimestamp = newTs;
        this.pipelineCount++;
        this.healthData = health;
        this.selectedPipelineIndex = 0;
        this.refreshPipeline();
      }
    });

    // Build skeleton
    this.loopContainer = container.createDiv('flywheel-loop');
    const lc = this.loopContainer;

    lc.addEventListener('click', (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.hasClass('flywheel-viz-entity-link')) {
        e.stopPropagation();
        const entityName = target.dataset.entity;
        if (entityName) this.openEntityDrilldown(entityName);
      }
    });

    this.headerEl = lc.createDiv('flywheel-pipeline-header');
    this.historyEl = lc.createDiv('flywheel-pipeline-history');

    for (const stage of STAGES) {
      lc.createDiv('flywheel-pipeline-connector');
      const gateEl = lc.createDiv('flywheel-pipeline-gate');
      gateEl.dataset.stage = stage.id;

      const headerRow = gateEl.createDiv('flywheel-gate-header');
      const iconEl = headerRow.createDiv('flywheel-gate-icon');
      setIcon(iconEl, stage.icon);
      headerRow.createDiv('flywheel-gate-name').setText(stage.name);
      const summaryEl = headerRow.createDiv('flywheel-gate-summary');
      const itemsEl = gateEl.createDiv('flywheel-gate-items');

      this.gateEls.set(stage.id, { summary: summaryEl, items: itemsEl });
    }

    lc.createDiv('flywheel-pipeline-connector');
    this.scoreEl = lc.createDiv('flywheel-pipeline-score');

    this.skeletonBuilt = true;
    await this.renderContent();
  }

  private async renderContent(): Promise<void> {
    try {
      const [health, feedback] = await Promise.all([
        this.mcpClient.healthCheck(),
        this.mcpClient.wikilinkFeedbackDashboard(),
      ]);
      this.healthData = health;
      this.dashboardData = feedback.dashboard;
      this.pipelineTimestamp = health.last_pipeline?.timestamp ?? 0;
    } catch {
      this.healthData = this.mcpClient.lastHealth;
      this.dashboardData = null;
    }
    await this.buildSubjects();
    this.fillContent();
  }

  private async refreshPipeline(): Promise<void> {
    if (this.isRefreshing || !this.skeletonBuilt) return;
    this.isRefreshing = true;

    try {
      const feedback = await this.mcpClient.wikilinkFeedbackDashboard();
      this.dashboardData = feedback.dashboard;
    } catch { /* keep existing */ }

    await this.buildSubjects();
    this.fillContent();

    // Flash gates
    for (const [, els] of this.gateEls) {
      const gate = els.summary.parentElement?.parentElement;
      if (gate) {
        gate.removeClass('is-fresh');
        void gate.offsetWidth;
        gate.addClass('is-fresh');
      }
    }
    this.isRefreshing = false;
  }

  // =========================================================================
  // Pipeline subjects — entities referenced in the edited files
  // =========================================================================

  private async buildSubjects(): Promise<void> {
    const pipeline = this.getActivePipeline();
    if (!pipeline) {
      this.pipelineSubjects = [];
      return;
    }

    // Check cache
    const cached = this.subjectCache.get(pipeline.timestamp);
    if (cached) {
      this.pipelineSubjects = cached;
      return;
    }

    const subjects = new Set<string>();

    // 1. Forward links from changed files — entities referenced in the edited note
    const paths = pipeline.changed_paths ?? [];
    const fetchPaths = paths.slice(0, 5); // limit to avoid hammering MCP
    try {
      const results = await Promise.all(
        fetchPaths.map(p => this.mcpClient.getForwardLinks(p).catch(() => null))
      );
      for (const result of results) {
        if (!result) continue;
        for (const link of result.forward_links) {
          // Use the target name (strip path, strip .md)
          const name = link.target.replace(/\.md$/, '').split('/').pop() || link.target;
          subjects.add(name);
        }
      }
    } catch { /* ignore */ }

    // 2. Entities from entity_scan (added/removed)
    const entityStep = pipeline.steps.find(s => s.name === 'entity_scan');
    const added = (entityStep?.output.added as Array<string | { name: string }>) ?? [];
    const removed = (entityStep?.output.removed as Array<string | { name: string }>) ?? [];
    for (const e of added) subjects.add(typeof e === 'string' ? e : e.name);
    for (const e of removed) subjects.add(typeof e === 'string' ? e : e.name);

    // 3. Entities from hub_scores diffs
    const hubStep = pipeline.steps.find(s => s.name === 'hub_scores');
    const diffs = hubStep && !hubStep.skipped
      ? (hubStep.output.diffs as Array<{ entity: string }>) ?? [] : [];
    for (const d of diffs) subjects.add(d.entity);

    // 4. Entities from wikilink_check tracked
    const wlStep = pipeline.steps.find(s => s.name === 'wikilink_check');
    const tracked = (wlStep?.output.tracked as Array<{ entities: string[] }>) ?? [];
    for (const t of tracked) for (const e of t.entities) subjects.add(e);

    // 5. Entities from implicit_feedback removals
    const fbStep = pipeline.steps.find(s => s.name === 'implicit_feedback');
    const removals = (fbStep?.output.removals as Array<{ entity: string }>) ?? [];
    for (const r of removals) subjects.add(r.entity);

    this.pipelineSubjects = Array.from(subjects);

    // Cache (keep max 10 entries)
    this.subjectCache.set(pipeline.timestamp, this.pipelineSubjects);
    if (this.subjectCache.size > 10) {
      const oldest = this.subjectCache.keys().next().value;
      if (oldest !== undefined) this.subjectCache.delete(oldest);
    }
  }

  private fillContent(): void {
    if (!this.skeletonBuilt) return;

    this.fillHeader();
    this.fillHistory();

    for (const stage of STAGES) {
      const els = this.gateEls.get(stage.id);
      if (!els) continue;
      els.summary.empty();
      els.items.empty();
      switch (stage.id) {
        case 'discover': this.renderDiscoverGate(els.summary, els.items); break;
        case 'suggest': this.renderSuggestGate(els.summary, els.items); break;
        case 'apply': this.renderApplyGate(els.summary, els.items); break;
        case 'learn': this.renderLearnGate(els.summary, els.items); break;
        case 'adapt': this.renderAdaptGate(els.summary, els.items); break;
      }
    }

    this.fillVaultScore();
  }

  // =========================================================================
  // Active pipeline
  // =========================================================================

  private getActivePipeline(): PipelineRecord | undefined {
    const recent = this.healthData?.recent_pipelines;
    if (recent && recent.length > 0 && this.selectedPipelineIndex < recent.length) {
      return recent[this.selectedPipelineIndex];
    }
    return this.healthData?.last_pipeline ?? undefined;
  }

  private getStep(name: string): McpPipelineStep | null {
    const pipeline = this.getActivePipeline();
    if (!pipeline) return null;
    return pipeline.steps.find(s => s.name === name) ?? null;
  }

  // =========================================================================
  // Header — commit-centric
  // =========================================================================

  private fillHeader(): void {
    if (!this.headerEl) return;
    this.headerEl.empty();

    const pipeline = this.getActivePipeline();
    if (!pipeline) {
      this.headerEl.createDiv('flywheel-pipeline-title').setText('Waiting for first edit\u2026');
      return;
    }

    const paths = pipeline.changed_paths ?? [];
    const filename = paths.length > 0
      ? paths.length === 1 ? this.shortenPath(paths[0]) : `${paths.length} files`
      : 'vault';
    this.headerEl.createDiv('flywheel-pipeline-title').setText(filename);

    const ago = this.formatTimestampAgo(pipeline.timestamp);
    const subjectCount = this.pipelineSubjects.length;
    const dur = Math.round(pipeline.duration_ms);

    const parts: string[] = [ago];
    if (subjectCount > 0) parts.push(`${subjectCount} entities`);
    parts.push(`${dur}ms`);

    this.headerEl.createDiv('flywheel-pipeline-subtitle').setText(parts.join(' \u00B7 '));
  }

  // =========================================================================
  // History — horizontal pills
  // =========================================================================

  private fillHistory(): void {
    if (!this.historyEl) return;
    this.historyEl.empty();

    const pipelines = this.healthData?.recent_pipelines;
    if (!pipelines || pipelines.length <= 1) return;

    for (let i = 0; i < Math.min(pipelines.length, 5); i++) {
      const p = pipelines[i];
      const item = this.historyEl.createDiv('flywheel-history-item');
      if (i === this.selectedPipelineIndex) item.addClass('is-active');

      const paths = p.changed_paths ?? [];
      const fileText = paths.length === 0 ? 'vault'
        : paths.length === 1 ? this.shortenPath(paths[0])
        : `${paths.length} files`;
      item.createSpan('flywheel-history-item-file').setText(fileText);
      item.createSpan('flywheel-history-item-time').setText(this.formatTimestampAgo(p.timestamp));

      const idx = i;
      item.addEventListener('click', async () => {
        this.selectedPipelineIndex = idx;
        await this.buildSubjects();
        this.fillContent();
      });
    }
  }

  // =========================================================================
  // Gate helpers
  // =========================================================================

  private createGateItem(
    container: HTMLElement,
    icon: string,
    name: string,
    delta: string,
    deltaClass: 'is-positive' | 'is-negative' | 'is-neutral',
    tooltip: string,
    entityClickable?: string,
  ): void {
    const item = container.createDiv('flywheel-gate-item');
    item.setAttribute('aria-label', tooltip);
    item.createDiv('flywheel-gate-item-icon').setText(icon);

    const nameEl = item.createDiv('flywheel-gate-item-name');
    if (entityClickable) {
      const link = nameEl.createSpan('flywheel-viz-entity-link');
      link.setText(name);
      link.dataset.entity = entityClickable;
    } else {
      nameEl.setText(name);
    }

    const deltaEl = item.createDiv('flywheel-gate-item-delta');
    deltaEl.setText(delta);
    deltaEl.addClass(deltaClass);
  }

  private createPassthroughLine(container: HTMLElement, text: string): void {
    container.createDiv('flywheel-gate-passthrough').setText(text);
  }

  // =========================================================================
  // DISCOVER — entities added/removed + pass-through for existing subjects
  // =========================================================================

  private renderDiscoverGate(summaryEl: HTMLElement, itemsEl: HTMLElement): void {
    const entityStep = this.getStep('entity_scan');
    const added = entityStep?.output.added as Array<string | { name: string; category: string; path: string }> | undefined;
    const removed = entityStep?.output.removed as Array<string | { name: string; category: string; path: string }> | undefined;
    const aliasChanges = entityStep?.output.alias_changes as Array<{ entity: string; before: string[]; after: string[] }> | undefined;

    const activeNames = new Set<string>();
    let activeCount = 0;

    if (added) {
      for (const entity of added) {
        const name = typeof entity === 'string' ? entity : entity.name;
        const cat = typeof entity === 'string' ? '' : ` (${entity.category})`;
        this.createGateItem(itemsEl, '\u2713', `${name}${cat}`, '+1', 'is-positive',
          'New entity discovered', name);
        activeNames.add(name);
        activeCount++;
      }
    }

    if (removed) {
      for (const entity of removed) {
        const name = typeof entity === 'string' ? entity : entity.name;
        this.createGateItem(itemsEl, '\u2717', name, '-1', 'is-negative',
          'Entity removed', name);
        activeNames.add(name);
        activeCount++;
      }
    }

    if (aliasChanges) {
      for (const change of aliasChanges) {
        for (const alias of change.after.filter(a => !change.before.includes(a))) {
          this.createGateItem(itemsEl, '\u2713', `${alias} \u2192 ${change.entity}`, '+1', 'is-positive',
            'New alias');
          activeCount++;
        }
        for (const alias of change.before.filter(a => !change.after.includes(a))) {
          this.createGateItem(itemsEl, '\u2717', `${alias} \u2192 ${change.entity}`, '-1', 'is-negative',
            'Alias removed');
          activeCount++;
        }
      }
    }

    // Pass-through: subjects that existed already (not added/removed)
    const passthrough = this.pipelineSubjects.filter(s => !activeNames.has(s));
    if (passthrough.length > 0) {
      this.createPassthroughLine(itemsEl,
        `${passthrough.length} entit${passthrough.length === 1 ? 'y' : 'ies'} already indexed`);
    }

    if (activeCount === 0 && passthrough.length === 0) {
      summaryEl.setText('scanned');
    } else if (activeCount === 0) {
      summaryEl.setText(`${passthrough.length} indexed`);
    } else {
      const parts: string[] = [];
      if (added?.length) parts.push(`+${added.length}`);
      if (removed?.length) parts.push(`-${removed.length}`);
      summaryEl.setText(parts.join(', ') || `${activeCount} changes`);
    }
  }

  // =========================================================================
  // SUGGEST — hub score diffs, separating primary subjects from ripple effects
  // =========================================================================

  private renderSuggestGate(summaryEl: HTMLElement, itemsEl: HTMLElement): void {
    const pipeline = this.getActivePipeline();
    const hubStep = pipeline?.steps.find(s => s.name === 'hub_scores');

    if (!hubStep || hubStep.skipped) {
      summaryEl.setText('skipped');
      if (this.pipelineSubjects.length > 0) {
        this.createPassthroughLine(itemsEl,
          `${this.pipelineSubjects.length} entit${this.pipelineSubjects.length === 1 ? 'y' : 'ies'} \u2014 skipped`);
      }
      return;
    }

    const diffs = hubStep.output.diffs as Array<{ entity: string; before: number; after: number }> | undefined;
    const diffMap = new Map((diffs ?? []).map(d => [d.entity, d]));
    const subjectSet = new Set(this.pipelineSubjects);

    // Primary: diffs for entities in our subjects
    const primaryDiffs: Array<{ entity: string; before: number; after: number }> = [];
    // Ripple: diffs for entities NOT in our subjects
    const rippleDiffs: Array<{ entity: string; before: number; after: number }> = [];

    for (const diff of (diffs ?? [])) {
      if (subjectSet.has(diff.entity)) {
        primaryDiffs.push(diff);
      } else {
        rippleDiffs.push(diff);
      }
    }

    // Show primary diffs (subjects with hub changes)
    const sorted = [...primaryDiffs].sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before));
    for (const diff of sorted.slice(0, 12)) {
      const delta = diff.after - diff.before;
      const deltaStr = delta >= 0 ? `+${delta}` : `${delta}`;
      this.createGateItem(
        itemsEl,
        delta >= 0 ? '\u2191' : '\u2193',
        `${diff.entity}  ${diff.before}\u2192${diff.after}`,
        deltaStr,
        delta >= 0 ? 'is-positive' : 'is-negative',
        diff.before === 0 ? 'First-time calculation' : `Hub ${diff.before} \u2192 ${diff.after}`,
        diff.entity,
      );
    }

    // Pass-through: subjects with no hub changes
    const unchangedCount = this.pipelineSubjects.filter(s => !diffMap.has(s)).length;
    if (unchangedCount > 0) {
      this.createPassthroughLine(itemsEl,
        `${unchangedCount} entit${unchangedCount === 1 ? 'y' : 'ies'} \u2014 scores unchanged`);
    }

    // Ripple effects: hub changes for entities outside the edited files
    if (rippleDiffs.length > 0) {
      this.createPassthroughLine(itemsEl,
        `${rippleDiffs.length} ripple effect${rippleDiffs.length === 1 ? '' : 's'}`);
    }

    // Summary
    const totalActive = primaryDiffs.length + rippleDiffs.length;
    if (totalActive === 0) {
      summaryEl.setText('no changes');
    } else if (primaryDiffs.length > 0) {
      summaryEl.setText(`${primaryDiffs.length} recalculated`);
    } else {
      summaryEl.setText(`${rippleDiffs.length} ripple`);
    }
  }

  // =========================================================================
  // APPLY — auto-wikilinks tracked, with pass-through for other subjects
  // =========================================================================

  private renderApplyGate(summaryEl: HTMLElement, itemsEl: HTMLElement): void {
    const wlStep = this.getStep('wikilink_check');
    const tracked = wlStep?.output.tracked as Array<{ file: string; entities: string[] }> | undefined;

    const trackedNames = new Set<string>();
    let total = 0;

    if (tracked) {
      for (const t of tracked) {
        const shortFile = this.shortenPath(t.file);
        for (const entity of t.entities) {
          this.createGateItem(
            itemsEl, '\u2713', `${entity} in ${shortFile}`, '+1', 'is-positive',
            `Auto-wikilink tracked in ${shortFile}`, entity);
          trackedNames.add(entity);
          total++;
        }
      }
    }

    // Pass-through: subjects not tracked
    const passthrough = this.pipelineSubjects.filter(s => !trackedNames.has(s));
    if (passthrough.length > 0) {
      this.createPassthroughLine(itemsEl,
        `${passthrough.length} entit${passthrough.length === 1 ? 'y' : 'ies'} \u2014 no auto-links`);
    }

    if (total > 0) {
      summaryEl.setText(`${total} tracked`);
    } else if (passthrough.length > 0) {
      summaryEl.setText('checked');
    } else {
      summaryEl.setText('pass');
    }
  }

  // =========================================================================
  // LEARN — feedback signals, with pass-through for other subjects
  // =========================================================================

  private renderLearnGate(summaryEl: HTMLElement, itemsEl: HTMLElement): void {
    const fbStep = this.getStep('implicit_feedback');
    const removals = fbStep?.output.removals as Array<{ entity: string; file: string }> | undefined;

    const signalNames = new Set<string>();

    if (removals && removals.length > 0) {
      for (const r of removals) {
        const shortFile = this.shortenPath(r.file);
        this.createGateItem(
          itemsEl, '\u2717', `${r.entity} removed from ${shortFile}`, '-1', 'is-negative',
          'User removed auto-wikilink \u2014 negative feedback', r.entity);
        signalNames.add(r.entity);
      }
    }

    // Pass-through: subjects with no feedback signals
    const passthrough = this.pipelineSubjects.filter(s => !signalNames.has(s));
    if (passthrough.length > 0) {
      this.createPassthroughLine(itemsEl,
        `${passthrough.length} entit${passthrough.length === 1 ? 'y' : 'ies'} \u2014 no signals`);
    }

    if (signalNames.size > 0) {
      summaryEl.setText(`${signalNames.size} signal${signalNames.size !== 1 ? 's' : ''}`);
    } else if (passthrough.length > 0) {
      summaryEl.setText('checked');
    } else {
      summaryEl.setText('no signals');
    }
  }

  // =========================================================================
  // ADAPT — trust status for all pipeline subjects
  // =========================================================================

  private renderAdaptGate(summaryEl: HTMLElement, itemsEl: HTMLElement): void {
    const d = this.dashboardData;
    const subjects = this.pipelineSubjects;

    if (subjects.length === 0) {
      summaryEl.setText(d && d.total_feedback > 0 ? 'pass' : 'calibrating');
      return;
    }

    if (!d || d.total_feedback === 0) {
      summaryEl.setText('calibrating');
      this.createPassthroughLine(itemsEl,
        `${subjects.length} entit${subjects.length === 1 ? 'y' : 'ies'} \u2014 awaiting feedback`);
      return;
    }

    // Build lookup maps
    const boostMap = new Map<string, { label: string; boost: number; accuracy: number; total: number }>();
    for (const tier of d.boost_tiers) {
      for (const entity of tier.entities) {
        boostMap.set(entity.entity, { label: tier.label, boost: tier.boost, accuracy: entity.accuracy, total: entity.total });
      }
    }
    const suppressedMap = new Map(d.suppressed.map(s => [s.entity, s]));
    const learningMap = new Map(d.learning.map(l => [l.entity, l]));

    let shown = 0;
    let newCount = 0;

    for (const name of subjects) {
      if (suppressedMap.has(name)) {
        const s = suppressedMap.get(name)!;
        this.createGateItem(itemsEl, '\uD83D\uDEAB', `${name}: suppressed`,
          '\u2014', 'is-negative',
          `${Math.round(s.false_positive_rate * 100)}% false positive rate`, name);
        shown++;
      } else if (boostMap.has(name)) {
        const b = boostMap.get(name)!;
        const icon = b.boost > 0 ? '\u2B06' : b.boost < 0 ? '\u2B07' : '\u2713';
        const cls = b.boost > 0 ? 'is-positive' : b.boost < 0 ? 'is-negative' : 'is-neutral';
        const deltaStr = b.boost > 0 ? `+${b.boost}` : b.boost < 0 ? `${b.boost}` : '\u2014';
        this.createGateItem(itemsEl, icon, `${name}: ${b.label}`,
          deltaStr, cls as 'is-positive' | 'is-negative' | 'is-neutral',
          `${Math.round(b.accuracy * 100)}% accuracy, ${b.total} samples`, name);
        shown++;
      } else if (learningMap.has(name)) {
        const l = learningMap.get(name)!;
        this.createGateItem(itemsEl, '\uD83D\uDCCA',
          `${name}: ${Math.round(l.accuracy * 100)}% (${l.total} samples)`,
          '\u2014', 'is-neutral',
          `Need ${Math.max(1, 5 - l.total)} more samples`, name);
        shown++;
      } else {
        newCount++;
      }
    }

    // Pass-through: entities with no feedback history
    if (newCount > 0) {
      this.createPassthroughLine(itemsEl,
        `${newCount} entit${newCount === 1 ? 'y' : 'ies'} \u2014 new (no feedback yet)`);
    }

    if (shown === 0) {
      summaryEl.setText(`${subjects.length} new`);
    } else {
      summaryEl.setText(`${shown} adapted`);
    }
  }

  // =========================================================================
  // Vault score — compact single section
  // =========================================================================

  private fillVaultScore(): void {
    if (!this.scoreEl) return;
    this.scoreEl.empty();

    const h = this.healthData;
    const d = this.dashboardData;

    const entityStep = this.getStep('entity_scan');
    const addedCount = ((entityStep?.output.added as Array<unknown>) ?? []).length;
    const removedCount = ((entityStep?.output.removed as Array<unknown>) ?? []).length;
    const entityDelta = addedCount - removedCount;

    const row = this.scoreEl.createDiv('flywheel-score-compact');

    const addStat = (label: string, value: string, delta?: number) => {
      const stat = row.createSpan('flywheel-score-stat');
      stat.createSpan('flywheel-score-stat-value').setText(value);
      if (delta && delta !== 0) {
        const dEl = stat.createSpan('flywheel-score-stat-delta');
        dEl.setText(delta > 0 ? `+${delta}` : `${delta}`);
        dEl.addClass(delta > 0 ? 'is-positive' : 'is-negative');
      }
      stat.createSpan('flywheel-score-stat-label').setText(label);
    };

    addStat('entities', (h?.entity_count ?? 0).toLocaleString(), entityDelta);
    addStat('notes', (h?.note_count ?? 0).toLocaleString());

    if (d) {
      addStat('accuracy', `${Math.round(d.overall_accuracy * 100)}%`);
      const trusted = d.boost_tiers.reduce((sum, t) => sum + (t.boost > 0 ? t.entities.length : 0), 0);
      if (trusted > 0) addStat('trusted', trusted.toLocaleString());
    }
  }

  // =========================================================================
  // Entity drilldown — detailed view for one entity
  // =========================================================================

  private async openEntityDrilldown(entityName: string): Promise<void> {
    if (this.entityDrilldownActive) return;
    this.entityDrilldownActive = true;

    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    this.skeletonBuilt = false;

    const breadcrumb = container.createDiv('flywheel-viz-breadcrumb');
    const backBtn = breadcrumb.createSpan('flywheel-viz-breadcrumb-back');
    setIcon(backBtn, 'arrow-left');
    backBtn.createSpan().setText(' Dashboard');
    backBtn.addEventListener('click', () => this.closeEntityDrilldown());

    breadcrumb.createSpan('flywheel-viz-breadcrumb-sep').setText(' / ');
    breadcrumb.createSpan('flywheel-viz-breadcrumb-current').setText(entityName);

    const panel = container.createDiv('flywheel-viz-entity-drilldown');

    // Score timeline
    try {
      const timelineData = await this.mcpClient.entityScoreTimeline(entityName);
      if (timelineData.timeline.length > 0) {
        panel.createDiv('flywheel-loop-section-title').setText('Score Timeline');
        this.renderEntityTimeline(panel, timelineData.timeline);
      } else {
        panel.createDiv('flywheel-loop-detail-note').setText('No timeline data yet.');
      }
    } catch {
      panel.createDiv('flywheel-loop-detail-note').setText('Timeline not available.');
    }

    // Journey summary
    this.renderEntityJourney(panel, entityName);

    // Layer heatmap (detailed, only in drilldown)
    await this.renderLayerHeatmap(panel);

    // Graph diff (detailed, only in drilldown)
    await this.renderGraphDiff(panel);
  }

  private closeEntityDrilldown(): void {
    this.entityDrilldownActive = false;
    this.render();
  }

  private renderEntityTimeline(panel: HTMLElement, timeline: McpEntityScoreTimelineEntry[]): void {
    if (timeline.length === 0) return;

    const chartHeight = 120;
    const chartWidth = panel.clientWidth || 400;
    const padding = { top: 10, right: 20, bottom: 20, left: 40 };
    const innerW = chartWidth - padding.left - padding.right;
    const innerH = chartHeight - padding.top - padding.bottom;

    const container = panel.createDiv('flywheel-viz-timeline-chart');
    container.style.height = `${chartHeight}px`;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', `${chartHeight}`);
    svg.setAttribute('viewBox', `0 0 ${chartWidth} ${chartHeight}`);
    svg.style.overflow = 'visible';

    const minTs = Math.min(...timeline.map(t => t.timestamp));
    const maxTs = Math.max(...timeline.map(t => t.timestamp));
    const tsRange = maxTs - minTs || 1;
    const maxScore = Math.max(...timeline.map(t => t.score), 1);
    const threshold = timeline[0]?.threshold ?? 0.3;

    const thresholdY = padding.top + innerH - (threshold / maxScore) * innerH;
    const thresholdLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    thresholdLine.setAttribute('x1', `${padding.left}`);
    thresholdLine.setAttribute('x2', `${chartWidth - padding.right}`);
    thresholdLine.setAttribute('y1', `${thresholdY}`);
    thresholdLine.setAttribute('y2', `${thresholdY}`);
    thresholdLine.setAttribute('class', 'flywheel-viz-threshold-line');
    svg.appendChild(thresholdLine);

    const thresholdLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    thresholdLabel.setAttribute('x', `${padding.left - 4}`);
    thresholdLabel.setAttribute('y', `${thresholdY - 4}`);
    thresholdLabel.setAttribute('text-anchor', 'end');
    thresholdLabel.setAttribute('class', 'flywheel-viz-timeline-label');
    thresholdLabel.textContent = `${threshold.toFixed(2)}`;
    svg.appendChild(thresholdLabel);

    const points: string[] = [];
    for (const entry of timeline) {
      const x = padding.left + ((entry.timestamp - minTs) / tsRange) * innerW;
      const y = padding.top + innerH - (entry.score / maxScore) * innerH;
      points.push(`${x},${y}`);
    }

    if (points.length > 1) {
      const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      polyline.setAttribute('points', points.join(' '));
      polyline.setAttribute('class', 'flywheel-viz-timeline-line');
      svg.appendChild(polyline);
    }

    for (const entry of timeline) {
      const x = padding.left + ((entry.timestamp - minTs) / tsRange) * innerW;
      const y = padding.top + innerH - (entry.score / maxScore) * innerH;
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', `${x}`);
      circle.setAttribute('cy', `${y}`);
      circle.setAttribute('r', '4');
      circle.setAttribute('class', `flywheel-viz-timeline-dot ${entry.passed ? 'is-passed' : 'is-failed'}`);
      circle.setAttribute('aria-label',
        `${new Date(entry.timestamp).toLocaleDateString()}: ${entry.score.toFixed(3)} (${entry.passed ? 'passed' : 'failed'})`
      );
      svg.appendChild(circle);
    }
    container.appendChild(svg);

    const details = panel.createDiv('flywheel-viz-timeline-details');
    for (const entry of timeline.slice(0, 5)) {
      const dateStr = new Date(entry.timestamp).toLocaleDateString();
      const noteShort = entry.notePath.replace(/\.md$/, '').split('/').pop() || entry.notePath;
      details.createDiv('flywheel-viz-timeline-entry-label').setText(`${dateStr} \u00B7 ${noteShort}`);
      this.renderScoreCard(details, entry.breakdown, `Score at ${dateStr}`, entry.score, entry.passed);
    }
  }

  private renderEntityJourney(panel: HTMLElement, entityName: string): void {
    panel.createDiv('flywheel-loop-section-title').setText('Journey');
    const journey = panel.createDiv('flywheel-viz-journey');

    const stages = [
      { icon: 'search', label: 'Discovered', detail: this.healthData?.entity_count ? 'Entity indexed' : 'Pending' },
      { icon: 'sparkles', label: 'Suggested', detail: (() => {
        const e = this.dashboardData?.topEntities?.find(e => e.entity === entityName);
        return e ? `${e.suggestionCount} times, avg ${e.avgScore.toFixed(2)}` : 'No data';
      })() },
      { icon: 'check-circle', label: 'Applied', detail: this.dashboardData?.applications.applied ? 'Links tracked' : 'No applications' },
      { icon: 'brain', label: 'Feedback', detail: (() => {
        const r = this.dashboardData?.recent.filter(r => r.entity === entityName) ?? [];
        return r.length > 0 ? `${r.length} entries` : 'No feedback';
      })() },
      { icon: 'sliders-horizontal', label: 'Adapted', detail: (() => {
        if (this.dashboardData?.suppressed.some(s => s.entity === entityName)) return 'Suppressed';
        const tier = this.dashboardData?.boost_tiers.find(t => t.entities.some(e => e.entity === entityName));
        return tier ? `${tier.label} (+${tier.boost})` : 'Neutral';
      })() },
    ];

    for (const s of stages) {
      const el = journey.createDiv('flywheel-viz-journey-stage');
      el.createSpan('flywheel-viz-journey-icon');
      setIcon(el.querySelector('.flywheel-viz-journey-icon')!, s.icon);
      el.createSpan('flywheel-viz-journey-label').setText(s.label);
      el.createSpan('flywheel-viz-journey-detail').setText(s.detail);
    }
  }

  private renderScoreCard(
    container: HTMLElement,
    breakdown: Record<string, number>,
    entityName: string,
    totalScore: number,
    passed: boolean,
  ): void {
    const card = container.createDiv('flywheel-viz-score-card');
    const header = card.createDiv('flywheel-viz-score-card-header');
    const nameEl = header.createSpan('flywheel-viz-entity-link');
    nameEl.setText(entityName);
    nameEl.dataset.entity = entityName;
    header.createSpan(`flywheel-viz-score-badge ${passed ? 'is-passed' : 'is-failed'}`)
      .setText(totalScore.toFixed(3));

    const barContainer = card.createDiv('flywheel-viz-score-bar');
    const entries = Object.entries(breakdown).filter(([, v]) => v > 0);
    const sum = entries.reduce((s, [, v]) => s + v, 0);

    for (const [layer, value] of entries) {
      const segment = barContainer.createDiv('flywheel-viz-score-segment');
      segment.style.width = `${Math.max(sum > 0 ? (value / sum) * 100 : 0, 2)}%`;
      segment.style.backgroundColor = LAYER_COLORS[layer] ?? 'var(--text-faint)';
      segment.setAttribute('aria-label', `${LAYER_LABELS[layer] ?? layer}: ${value.toFixed(3)}`);
    }

    const legend = card.createDiv('flywheel-viz-score-legend');
    for (const [layer, value] of entries) {
      const item = legend.createSpan('flywheel-viz-score-legend-item');
      const dot = item.createSpan('flywheel-viz-score-legend-dot');
      dot.style.backgroundColor = LAYER_COLORS[layer] ?? 'var(--text-faint)';
      item.createSpan().setText(`${LAYER_LABELS[layer] ?? layer} ${value.toFixed(3)}`);
    }
  }

  // Layer heatmap & graph diff — only in drilldown
  private async renderLayerHeatmap(panel: HTMLElement): Promise<void> {
    const section = panel.createDiv('flywheel-viz-heatmap-section');
    section.createDiv('flywheel-loop-section-title').setText('Layer contributions (30 days)');
    try {
      const data = await this.mcpClient.layerContributionTimeseries('day', 30);
      if (!data.timeseries || data.timeseries.length === 0) {
        section.createDiv('flywheel-loop-detail-note').setText('No data yet.');
        return;
      }
      const layerNames = new Set<string>();
      for (const bucket of data.timeseries) {
        for (const key of Object.keys(bucket.layers)) layerNames.add(key);
      }
      const layers = Array.from(layerNames);
      const maxVal = Math.max(...data.timeseries.flatMap(b => layers.map(l => b.layers[l] ?? 0)), 0.001);

      const sparkSection = section.createDiv('flywheel-viz-sparkline-section');
      for (const layer of layers) {
        const row = sparkSection.createDiv('flywheel-viz-sparkline-row');
        row.createSpan('flywheel-viz-sparkline-label').setText(LAYER_LABELS[layer] ?? layer);
        const bars = row.createDiv('flywheel-viz-sparkline');
        for (const bucket of data.timeseries) {
          const val = bucket.layers[layer] ?? 0;
          const bar = bars.createDiv('flywheel-viz-sparkline-bar');
          bar.style.height = `${Math.max(2, (val / maxVal) * 24)}px`;
          bar.style.backgroundColor = LAYER_COLORS[layer] ?? 'var(--interactive-accent)';
        }
      }
    } catch {
      section.createDiv('flywheel-loop-detail-note').setText('Not available.');
    }
  }

  private async renderGraphDiff(panel: HTMLElement): Promise<void> {
    const section = panel.createDiv('flywheel-viz-graph-diff-section');
    section.createDiv('flywheel-loop-section-title').setText('Graph changes (7 days)');
    try {
      const now = Date.now();
      const diffData = await this.mcpClient.snapshotDiff(now - 7 * 86400000, now);
      const diff = diffData.diff;

      if (diff.hubScoreChanges.length > 0) {
        const sorted = [...diff.hubScoreChanges].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
        for (const hub of sorted.slice(0, 8)) {
          const row = section.createDiv('flywheel-viz-hub-change');
          const nameEl = row.createSpan('flywheel-viz-entity-link');
          nameEl.setText(hub.entity);
          nameEl.dataset.entity = hub.entity;
          row.createSpan('flywheel-viz-hub-before').setText(`${hub.before}`);
          row.createSpan('flywheel-viz-hub-arrow').setText('\u2192');
          row.createSpan('flywheel-viz-hub-after').setText(`${hub.after}`);
          const deltaEl = row.createSpan(`flywheel-viz-delta ${hub.delta >= 0 ? 'is-positive' : 'is-negative'}`);
          deltaEl.setText(`${hub.delta >= 0 ? '+' : ''}${hub.delta}`);
        }
      } else {
        section.createDiv('flywheel-loop-detail-note').setText('No graph changes.');
      }
    } catch {
      section.createDiv('flywheel-loop-detail-note').setText('Not available.');
    }
  }

  // =========================================================================
  // Utilities
  // =========================================================================

  private shortenPath(p: string): string {
    return p.replace(/\.md$/, '').split('/').pop() || p;
  }

  private formatTimestampAgo(timestamp: number): string {
    const ago = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (ago < 60) return `${ago}s ago`;
    if (ago < 3600) return `${Math.floor(ago / 60)}m ago`;
    return `${Math.floor(ago / 3600)}h ago`;
  }

  async onClose(): Promise<void> {
    if (this.healthUnsub) {
      this.healthUnsub();
      this.healthUnsub = null;
    }
  }
}
