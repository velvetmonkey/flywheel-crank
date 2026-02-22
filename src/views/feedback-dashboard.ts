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
  desc: string;
}

const STAGES: StageConfig[] = [
  { id: 'discover', name: 'Discover', icon: 'search',            desc: 'finds entities in edited files' },
  { id: 'suggest',  name: 'Suggest',  icon: 'sparkles',          desc: 'recalculates hub scores' },
  { id: 'apply',    name: 'Apply',    icon: 'check-circle',       desc: 'auto-inserts wikilinks' },
  { id: 'learn',    name: 'Learn',    icon: 'brain',              desc: 'records removed links as feedback' },
  { id: 'adapt',    name: 'Adapt',    icon: 'sliders-horizontal', desc: 'adjusts entity trust weights' },
];

// Percentages along the animation timeline where each gate sits
const GATE_PERCENTS = [10, 22, 34, 46, 58];

interface EntityJourney {
  name: string;
  isDead: boolean;
  category?: string;
  gates: {
    discover?: { action: 'added' | 'removed' | 'category_changed' | 'moved'; detail?: string };
    suggest?: { action: 'score_change'; delta: number; before: number; after: number };
    apply?: { action: 'tracked'; files: string[] };
    learn?: { action: 'removed'; file: string } | { action: 'survived'; file: string; count: number };
    adapt?: { action: 'suppressed' | 'boosted' | 'learning'; detail: string };
  };
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Returns false for obvious agent-prose artifacts that appear as [[dead links]]
 * but are not real vault entity names. Used to suppress noise in the DISCOVER
 * gate dead-link count.
 *
 * Rejects:
 *  - Contains prose punctuation (. ! ?)
 *  - All-uppercase and 5 chars or fewer  (emphasis noise: ZERO, YES, LOT)
 *  - Starts with a common conjunction / preposition / article
 *  - Longer than 50 chars
 *  - Contains nested brackets [[ or ]]
 */
function looksLikeEntityName(text: string): boolean {
  if (text.includes('.') || text.includes('!') || text.includes('?')) return false;
  if (text.length > 50) return false;
  if (text.includes('[[') || text.includes(']]')) return false;
  if (text === text.toUpperCase() && text.length <= 5) return false;

  const PROSE_OPENERS = new Set([
    'if', 'and', 'so', 'are', 'is', 'of', 'the', 'but', 'for', 'from',
    'or', 'at', 'in', 'on', 'a', 'an', 'hey', 'as', 'with', 'by', 'to',
    'not', 'do', 'did',
  ]);
  const firstWord = text.trim().split(/\s+/)[0].toLowerCase();
  if (PROSE_OPENERS.has(firstWord)) return false;

  return true;
}

const PILL_PALETTE = [
  { pill: 'hsl(345, 85%, 55%)', ghost: 'hsl(345, 85%, 55%)' },  // rose
  { pill: 'hsl(25,  90%, 55%)', ghost: 'hsl(25,  90%, 55%)' },  // orange
  { pill: 'hsl(45,  90%, 48%)', ghost: 'hsl(45,  90%, 48%)' },  // gold
  { pill: 'hsl(130, 60%, 42%)', ghost: 'hsl(130, 60%, 42%)' },  // green
  { pill: 'hsl(170, 65%, 40%)', ghost: 'hsl(170, 65%, 40%)' },  // teal
  { pill: 'hsl(210, 80%, 55%)', ghost: 'hsl(210, 80%, 55%)' },  // blue
  { pill: 'hsl(250, 65%, 58%)', ghost: 'hsl(250, 65%, 58%)' },  // indigo
  { pill: 'hsl(280, 65%, 55%)', ghost: 'hsl(280, 65%, 55%)' },  // purple
  { pill: 'hsl(310, 70%, 52%)', ghost: 'hsl(310, 70%, 52%)' },  // magenta
  { pill: 'hsl(85,  65%, 42%)', ghost: 'hsl(85,  65%, 42%)' },  // olive
  { pill: 'hsl(190, 75%, 42%)', ghost: 'hsl(190, 75%, 42%)' },  // cyan
  { pill: 'hsl(265, 55%, 52%)', ghost: 'hsl(265, 55%, 52%)' },  // mauve
  { pill: 'hsl(35,  85%, 50%)', ghost: 'hsl(35,  85%, 50%)' },  // amber
  { pill: 'hsl(215, 60%, 52%)', ghost: 'hsl(215, 60%, 52%)' },  // steel
  { pill: 'hsl(355, 80%, 52%)', ghost: 'hsl(355, 80%, 52%)' },  // crimson
];

const PILL_TEXT = '#ffffff';

function pillColor(name: string, isDead: boolean): { pill: string; ghost: string } {
  if (isDead) return { pill: 'hsl(0, 75%, 50%)', ghost: 'hsl(0, 75%, 50%)' };
  return PILL_PALETTE[hashCode(name) % PILL_PALETTE.length];
}

const GATE_TOOLTIPS: Record<string, string> = {
  discover: 'Runs on every file save — scans changed notes for new or deleted entities (notes, people, places). Trigger: save any file.',
  suggest:  'Recalculates how "hub-like" each entity is by counting connections. Higher hub score = entity surfaces more in suggestions. Trigger: any entity graph change.',
  apply:    'Checks whether entity names appear as plain text (unwikified) in the edited file. If score > threshold, marks it as tracked. Trigger: edit a file containing entity names without [[ ]].',
  learn:    'Detects when a [[wikilink]] that was previously auto-inserted has been deleted by you. Records it as a rejection signal. Trigger: delete [[ ]] brackets around an auto-link.',
  adapt:    'After 5+ feedback events for an entity, adjusts its boost or suppress weight. Suppressed entities stop appearing in suggestions. Trigger: accumulated accept/reject history.',
};

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
  private _connStateUnsub: (() => void) | null = null;
  private pipelineTimestamp = 0;
  private pipelineCount = 0;
  private loopContainer: HTMLElement | null = null;
  private entityDrilldownActive = false;
  private isRefreshing = false;
  private skeletonBuilt = false;
  private selectedPipelineIndex = 0;

  // Pipeline subjects — entities from edited files that flow through all gates
  private pipelineSubjects: string[] = [];
  private deadLinkSubjects = new Set<string>();
  private subjectCache = new Map<number, { subjects: string[]; deadLinks: Set<string> }>(); // keyed by pipeline timestamp

  // Elapsed time auto-refresh
  private agoTimerId: ReturnType<typeof setInterval> | null = null;
  private subtitleEl: HTMLElement | null = null;

  // Skeleton DOM refs
  private headerEl: HTMLElement | null = null;
  private historyEl: HTMLElement | null = null;
  private gateEls: Map<string, { summary: HTMLElement; items: HTMLElement }> = new Map();
  private waterfallEl: HTMLElement | null = null;
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
      const isError = this.mcpClient.connectionState === 'error';
      const splash = container.createDiv('flywheel-splash');
      const imgPath = `${this.app.vault.configDir}/plugins/flywheel-crank/flywheel.png`;
      const imgEl = splash.createEl('img', { cls: isError ? 'flywheel-splash-logo flywheel-splash-logo-static' : 'flywheel-splash-logo' });
      imgEl.src = this.app.vault.adapter.getResourcePath(imgPath);
      imgEl.alt = '';
      if (isError) {
        splash.createDiv('flywheel-splash-error').setText(this.mcpClient.lastError ?? 'Connection failed');
        const retryBtn = splash.createEl('button', { cls: 'flywheel-splash-retry' });
        retryBtn.setText('Retry');
        retryBtn.addEventListener('click', () => this.mcpClient.requestRetry());
      } else {
        splash.createDiv('flywheel-splash-text').setText(
          this.mcpClient.connected ? 'Building vault index...' : 'Connecting to flywheel-memory...'
        );
      }
      if (!this.healthUnsub) {
        this.healthUnsub = this.mcpClient.onHealthUpdate(health => {
          if (health.index_state === 'ready' && !this.indexReady) {
            this.indexReady = true;
            this.render();
          }
        });
      }
      if (!this._connStateUnsub) {
        this._connStateUnsub = this.mcpClient.onConnectionStateChange(() => {
          if (this.mcpClient.connectionState === 'error' || this.mcpClient.connectionState === 'connected') {
            this.render();
          }
        });
        this.register(this._connStateUnsub);
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
    this.waterfallEl = lc.createDiv('flywheel-waterfall-container');

    // Keep gate skeleton for backward-compat (used by refreshPipeline flash)
    for (const stage of STAGES) {
      lc.createDiv('flywheel-pipeline-connector');
      const gateEl = lc.createDiv('flywheel-pipeline-gate');
      gateEl.dataset.stage = stage.id;
      gateEl.style.display = 'none'; // hidden — waterfall takes over

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
    this.stopAgoTimer();
    this.agoTimerId = setInterval(() => this.refreshAgoText(), 10_000);
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
    try { await this.buildSubjects(); } catch { /* subjects stay as-is */ }
    this.fillContent();
  }

  private async refreshPipeline(): Promise<void> {
    if (this.isRefreshing || !this.skeletonBuilt) return;
    this.isRefreshing = true;

    try {
      try {
        const feedback = await this.mcpClient.wikilinkFeedbackDashboard();
        this.dashboardData = feedback.dashboard;
      } catch { /* keep existing */ }

      try { await this.buildSubjects(); } catch { /* subjects stay as-is */ }
      this.fillContent();

      // Flash waterfall on new pipeline
      if (this.waterfallEl) {
        this.waterfallEl.removeClass('is-fresh');
        void this.waterfallEl.offsetWidth;
        this.waterfallEl.addClass('is-fresh');
      }
    } finally {
      this.isRefreshing = false;
    }
  }

  // =========================================================================
  // Pipeline subjects — entities referenced in the edited files
  // =========================================================================

  private async buildSubjects(): Promise<void> {
    const pipeline = this.getActivePipeline();
    if (!pipeline) {
      this.pipelineSubjects = [];
      this.deadLinkSubjects = new Set();
      return;
    }

    // Check cache
    const cached = this.subjectCache.get(pipeline.timestamp);
    if (cached) {
      this.pipelineSubjects = cached.subjects;
      this.deadLinkSubjects = cached.deadLinks;
      return;
    }

    const subjects = new Set<string>();
    const deadLinks = new Set<string>();

    // 1. Forward links from pipeline step output (no MCP round-trip needed)
    const flStep = pipeline.steps.find(s => s.name === 'forward_links');
    if (flStep && !flStep.skipped) {
      const links = (flStep.output.links as Array<{ file: string; resolved: string[]; dead: string[] }>) ?? [];
      for (const entry of links) {
        for (const name of entry.resolved ?? []) subjects.add(name);
        for (const name of entry.dead ?? []) {
          subjects.add(name);
          if (looksLikeEntityName(name)) deadLinks.add(name);
        }
      }
    } else {
      // Fallback for older pipelines without the step — timeout to avoid blocking UI
      const paths = pipeline.changed_paths ?? [];
      const fetchPaths = paths.slice(0, 5);
      try {
        const timeout = new Promise<null[]>(r => setTimeout(() => r(fetchPaths.map(() => null)), 3000));
        const results = await Promise.race([
          Promise.all(fetchPaths.map(p => this.mcpClient.getForwardLinks(p).catch(() => null))),
          timeout,
        ]);
        for (const result of results) {
          if (!result) continue;
          for (const link of result.forward_links) {
            const name = link.target.replace(/\.md$/, '').split('/').pop() || link.target;
            subjects.add(name);
            if (!link.exists && looksLikeEntityName(name)) deadLinks.add(name);
          }
        }
      } catch { /* ignore */ }
    }

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
    for (const t of tracked) for (const e of t.entities ?? []) subjects.add(e);

    // 5. Entities from implicit_feedback removals
    const fbStep = pipeline.steps.find(s => s.name === 'implicit_feedback');
    const removals = (fbStep?.output.removals as Array<{ entity: string }>) ?? [];
    for (const r of removals) subjects.add(r.entity);

    this.pipelineSubjects = Array.from(subjects);
    this.deadLinkSubjects = deadLinks;

    // Cache (keep max 10 entries)
    this.subjectCache.set(pipeline.timestamp, { subjects: this.pipelineSubjects, deadLinks });
    if (this.subjectCache.size > 10) {
      const oldest = this.subjectCache.keys().next().value;
      if (oldest !== undefined) this.subjectCache.delete(oldest);
    }
  }

  // =========================================================================
  // Entity Journeys — build per-entity gate data for waterfall
  // =========================================================================

  private buildEntityJourneys(): EntityJourney[] {
    const pipeline = this.getActivePipeline();
    const d = this.dashboardData;

    // Step outputs
    const entityStep = pipeline?.steps.find(s => s.name === 'entity_scan');
    const addedRaw = (entityStep?.output.added as Array<string | { name: string; category?: string }>) ?? [];
    const removedRaw = (entityStep?.output.removed as Array<string | { name: string }>) ?? [];

    const hubStep = pipeline?.steps.find(s => s.name === 'hub_scores');
    const diffs = (!hubStep?.skipped ? (hubStep?.output.diffs as Array<{ entity: string; before: number; after: number }>) : null) ?? [];

    const wlStep = pipeline?.steps.find(s => s.name === 'wikilink_check');
    const tracked = (wlStep?.output.tracked as Array<{ file: string; entities: string[] }>) ?? [];

    const fbStep = pipeline?.steps.find(s => s.name === 'implicit_feedback');
    const removals = (fbStep?.output.removals as Array<{ entity: string; file: string }>) ?? [];

    // Read link_diffs from forward_links step (P0b)
    const flStep = pipeline?.steps.find(s => s.name === 'forward_links');
    const linkDiffs = (flStep?.output?.link_diffs as Array<{ file: string; added: string[]; removed: string[] }>) ?? [];
    const linkAddMap = new Map<string, string[]>();
    const linkRemoveMap = new Map<string, string>();
    for (const diff of linkDiffs) {
      for (const name of diff.added) {
        const key = name.toLowerCase();
        linkAddMap.set(key, [...(linkAddMap.get(key) ?? []), diff.file]);
      }
      for (const name of diff.removed) {
        if (!linkRemoveMap.has(name.toLowerCase())) {
          linkRemoveMap.set(name.toLowerCase(), diff.file);
        }
      }
    }

    // Read survived links from forward_links step
    const survivedRaw = (flStep?.output?.survived as
      Array<{ entity: string; file: string; count: number }> | undefined) ?? [];
    const survivedMap = new Map<string, { file: string; count: number }>();
    for (const s of survivedRaw) {
      if (!survivedMap.has(s.entity)) {
        survivedMap.set(s.entity, { file: s.file, count: s.count });
      }
    }

    // Read category changes from entity_scan step (P8 T1)
    const categoryChanges = (entityStep?.output?.category_changes as Array<{ entity: string; from: string; to: string }>) ?? [];
    const categoryChangeMap = new Map(categoryChanges.map(c => [c.entity.toLowerCase(), c]));

    // Read note moves from note_moves step (P8 T4)
    const movesStep = pipeline?.steps.find(s => s.name === 'note_moves');
    const moveRenames = (movesStep?.output?.renames as Array<{ oldPath: string; newPath: string }>) ?? [];
    const moveMap = new Map<string, { oldFolder: string; newFolder: string }>();
    for (const r of moveRenames) {
      const entityName = (r.newPath.split('/').pop() ?? r.newPath).replace(/\.md$/, '');
      const oldFolder = r.oldPath.includes('/') ? r.oldPath.split('/').slice(0, -1).join('/') : '';
      const newFolder = r.newPath.includes('/') ? r.newPath.split('/').slice(0, -1).join('/') : '';
      if (oldFolder !== newFolder) moveMap.set(entityName.toLowerCase(), { oldFolder, newFolder });
    }

    // Collect all entity names
    const allNames = new Set<string>();
    for (const e of addedRaw) allNames.add(typeof e === 'string' ? e : e.name);
    for (const e of removedRaw) allNames.add(typeof e === 'string' ? e : e.name);
    for (const d of diffs) allNames.add(d.entity);
    for (const t of tracked) for (const e of t.entities ?? []) allNames.add(e);
    for (const r of removals) allNames.add(r.entity);
    for (const diff of linkDiffs) {
      for (const name of diff.added) allNames.add(name);
      for (const name of diff.removed) allNames.add(name);
    }
    for (const c of categoryChanges) allNames.add(c.entity);
    for (const s of survivedRaw) allNames.add(s.entity);
    for (const r of moveRenames) {
      const entityName = (r.newPath.split('/').pop() ?? r.newPath).replace(/\.md$/, '');
      allNames.add(entityName);
    }
    // Lookup maps
    const addedMap = new Map<string, string | undefined>();
    for (const e of addedRaw) {
      const name = typeof e === 'string' ? e : e.name;
      const cat = typeof e === 'string' ? undefined : e.category;
      addedMap.set(name, cat);
    }
    const removedSet = new Set(removedRaw.map(e => typeof e === 'string' ? e : e.name));
    const diffMap = new Map(diffs.map(d => [d.entity, d]));

    // tracked: entity → files[]
    const trackedMap = new Map<string, string[]>();
    for (const t of tracked) {
      for (const e of t.entities ?? []) {
        const existing = trackedMap.get(e) ?? [];
        existing.push(t.file);
        trackedMap.set(e, existing);
      }
    }

    const removalMap = new Map(removals.map(r => [r.entity, r]));

    const suppressedMap = new Map(d?.suppressed.map(s => [s.entity, s]) ?? []);
    const boostMap = new Map<string, { label: string; boost: number }>();
    if (d) {
      for (const tier of d.boost_tiers) {
        for (const e of tier.entities) {
          boostMap.set(e.entity, { label: tier.label, boost: tier.boost });
        }
      }
    }
    const learningMap = new Map(d?.learning.map(l => [l.entity, l]) ?? []);

    // Build journeys
    const journeys: EntityJourney[] = [];
    for (const name of allNames) {
      const journey: EntityJourney = {
        name,
        isDead: this.deadLinkSubjects.has(name),
        category: addedMap.get(name),
        gates: {},
      };

      if (addedMap.has(name)) {
        journey.gates.discover = { action: 'added' };
      } else if (removedSet.has(name)) {
        journey.gates.discover = { action: 'removed' };
      } else {
        const catChange = categoryChangeMap.get(name.toLowerCase());
        if (catChange) {
          journey.gates.discover = { action: 'category_changed', detail: `${catChange.from} → ${catChange.to}` };
        } else {
          const move = moveMap.get(name.toLowerCase());
          if (move) {
            journey.gates.discover = { action: 'moved', detail: `${move.oldFolder || '(root)'} → ${move.newFolder || '(root)'}` };
          }
        }
      }

      const diff = diffMap.get(name);
      if (diff) {
        journey.gates.suggest = {
          action: 'score_change',
          delta: diff.after - diff.before,
          before: diff.before,
          after: diff.after,
        };
      }

      const files = trackedMap.get(name);
      const diffAddFiles = linkAddMap.get(name.toLowerCase());
      if (files && files.length > 0) {
        journey.gates.apply = { action: 'tracked', files };
      } else if (diffAddFiles && diffAddFiles.length > 0) {
        journey.gates.apply = { action: 'tracked', files: diffAddFiles };
      }

      const removal = removalMap.get(name);
      const diffRemoveFile = linkRemoveMap.get(name.toLowerCase());
      if (removal) {
        journey.gates.learn = { action: 'removed', file: removal.file };
      } else if (diffRemoveFile) {
        journey.gates.learn = { action: 'removed', file: diffRemoveFile };
      } else {
        const survived = survivedMap.get(name.toLowerCase());
        if (survived) {
          journey.gates.learn = { action: 'survived', file: survived.file, count: survived.count };
        }
      }

      if (suppressedMap.has(name)) {
        const s = suppressedMap.get(name)!;
        journey.gates.adapt = {
          action: 'suppressed',
          detail: `${Math.round(s.false_positive_rate * 100)}% false positive`,
        };
      } else if (boostMap.has(name)) {
        const b = boostMap.get(name)!;
        journey.gates.adapt = {
          action: 'boosted',
          detail: `${b.label} (${b.boost > 0 ? '+' : ''}${b.boost})`,
        };
      } else if (learningMap.has(name)) {
        const l = learningMap.get(name)!;
        journey.gates.adapt = {
          action: 'learning',
          detail: `${Math.round(l.accuracy * 100)}% (${l.total} samples)`,
        };
      }

      journeys.push(journey);
    }

    // Sort: dead links last, then alpha
    journeys.sort((a, b) => {
      if (a.isDead !== b.isDead) return a.isDead ? 1 : -1;
      return a.name.localeCompare(b.name);
    });

    return journeys;
  }

  private fillContent(): void {
    if (!this.skeletonBuilt) return;

    const journeys = this.buildEntityJourneys();  // compute first

    this.fillHeader(journeys);  // pass journeys for active count
    this.fillHistory();

    if (this.waterfallEl) {
      this.waterfallEl.empty();
      this.renderWaterfall(this.waterfallEl, journeys);
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

  private fillHeader(journeys?: EntityJourney[]): void {
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

    const activeCount = journeys?.filter(j =>
      j.gates.discover || j.gates.suggest || j.gates.apply || j.gates.learn || j.gates.adapt
    ).length ?? 0;

    const parts: string[] = [ago];
    if (activeCount > 0) parts.push(`${activeCount} active`);
    else if (subjectCount > 0) parts.push(`${subjectCount} entities`);
    parts.push(`${dur}ms`);

    this.subtitleEl = this.headerEl.createDiv('flywheel-pipeline-subtitle');
    this.subtitleEl.setText(parts.join(' \u00B7 '));
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
        try { await this.buildSubjects(); } catch { /* use existing subjects */ }
        this.fillContent();
      });
    }
  }

  // =========================================================================
  // Waterfall renderer — animates entity pills through gate stages
  // =========================================================================

  private renderWaterfall(container: HTMLElement, journeys: EntityJourney[]): void {
    if (journeys.length === 0) {
      // No entity activity — show gate structure with summaries, no pills
      const quiet = container.createDiv('flywheel-waterfall-quiet');
      for (const stage of STAGES) {
        const gateDiv = quiet.createDiv('flywheel-waterfall-gate');
        const bar = gateDiv.createDiv('flywheel-waterfall-gate-bar');
        bar.title = GATE_TOOLTIPS[stage.id] ?? '';
        const iconEl = bar.createDiv('flywheel-gate-icon');
        setIcon(iconEl, stage.icon);
        bar.createSpan('flywheel-waterfall-gate-name').setText(stage.name.toUpperCase());
        bar.createSpan('flywheel-waterfall-gate-desc').setText(stage.desc);
        bar.createSpan('flywheel-waterfall-gate-summary').setText(
          this.buildGateSummary(stage.id, [], this.getActivePipeline())
        );
      }
      return;
    }

    const wf = container.createDiv('flywheel-waterfall');

    // Replay button (top right of pipeline header)
    const replayBtn = wf.createDiv('flywheel-waterfall-replay');
    replayBtn.setText('↺ Replay');
    replayBtn.addEventListener('click', () => {
      wf.removeClass('is-animating');
      void wf.offsetHeight; // force reflow
      wf.addClass('is-animating');
    });

    // Spawn row
    wf.createDiv('flywheel-waterfall-start');

    // Gate shelves
    const gateEls: HTMLElement[] = [];
    for (let gi = 0; gi < STAGES.length; gi++) {
      const stage = STAGES[gi];
      const gateDiv = wf.createDiv('flywheel-waterfall-gate');
      gateDiv.dataset.stage = stage.id;
      gateEls.push(gateDiv);

      // Gate bar: icon + label + desc + summary text
      const bar = gateDiv.createDiv('flywheel-waterfall-gate-bar');
      bar.title = GATE_TOOLTIPS[stage.id] ?? '';
      const iconEl = bar.createDiv('flywheel-gate-icon');
      setIcon(iconEl, stage.icon);
      bar.createSpan('flywheel-waterfall-gate-name').setText(stage.name.toUpperCase());
      bar.createSpan('flywheel-waterfall-gate-desc').setText(stage.desc);
      bar.createSpan('flywheel-waterfall-gate-summary').setText(
        this.buildGateSummary(stage.id, journeys, this.getActivePipeline())
      );

      // Shelf: ghost pills for entities that had activity at this gate
      const shelf = gateDiv.createDiv('flywheel-waterfall-shelf');
      for (let ji = 0; ji < journeys.length; ji++) {
        const journey = journeys[ji];
        const gateAction = this.getGateAction(stage.id, journey);
        if (!gateAction) continue;

        const ghostColor = pillColor(journey.name, journey.isDead);
        const ghost = shelf.createSpan('flywheel-pill-ghost');
        ghost.style.background = ghostColor.ghost;
        ghost.style.color = PILL_TEXT;
        ghost.setText(journey.name);
        ghost.title = gateAction.tooltip;

        const badge = ghost.createSpan('flywheel-pill-badge');
        badge.setText(gateAction.badge);

        // Feedback buttons: thumbs-up / thumbs-down
        const notePath = stage.id === 'apply'
          ? (journey.gates.apply?.files?.[0] ?? '')
          : stage.id === 'learn'
            ? (journey.gates.learn?.file ?? '')
            : '';
        const btns = ghost.createSpan('flywheel-feedback-btns');
        const plus = btns.createEl('button', { cls: 'flywheel-feedback-btn flywheel-feedback-positive' });
        plus.textContent = '+';
        plus.title = `Good suggestion — mark "${journey.name}" as correct`;
        const minus = btns.createEl('button', { cls: 'flywheel-feedback-btn flywheel-feedback-negative' });
        minus.textContent = '−';
        minus.title = `Bad suggestion — mark "${journey.name}" as incorrect`;
        const markSubmitted = () => {
          plus.addClass('flywheel-feedback-submitted');
          minus.addClass('flywheel-feedback-submitted');
        };
        plus.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (plus.hasClass('flywheel-feedback-submitted')) return;
          markSubmitted();
          try { await this.mcpClient.reportWikilinkFeedback(journey.name, notePath, true); }
          catch { /* fire-and-forget; visual already updated */ }
        });
        minus.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (minus.hasClass('flywheel-feedback-submitted')) return;
          markSubmitted();
          try { await this.mcpClient.reportWikilinkFeedback(journey.name, notePath, false); }
          catch { /* fire-and-forget; visual already updated */ }
        });

        // Delay: pill at index ji reaches gate gi at gatePercent% of total duration (2s)
        const ghostDelay = ji * 0.025 + 2 * (GATE_PERCENTS[gi] / 100);
        ghost.style.setProperty('--ghost-delay', `${ghostDelay}s`);
      }
    }

    // After layout, set CSS custom properties for gate positions and start animation
    requestAnimationFrame(() => {
      const wfRect = wf.getBoundingClientRect();
      const wfTop = wfRect.top;

      gateEls.forEach((gate, i) => {
        const y = gate.getBoundingClientRect().top - wfTop;
        wf.style.setProperty(`--gate-${i + 1}-y`, `${y}px`);
      });

      wf.addClass('is-animating');
    });
  }

  private getGateAction(stageId: string, journey: EntityJourney): { badge: string; tooltip: string } | null {
    const name = journey.name;
    switch (stageId) {
      case 'discover': {
        const g = journey.gates.discover;
        if (!g) return null;
        if (g.action === 'added') return { badge: '+1', tooltip: `"${name}" added to entity index — will be suggested as a wikilink` };
        if (g.action === 'removed') return { badge: '-1', tooltip: `"${name}" removed from entity index` };
        if (g.action === 'moved') return { badge: '→', tooltip: `"${name}" moved: ${g.detail ?? ''}` };
        return { badge: '~', tooltip: `"${name}" category changed: ${g.detail ?? ''}` };
      }
      case 'suggest': {
        const g = journey.gates.suggest;
        if (!g) return null;
        const sign = g.delta >= 0 ? '+' : '';
        const badge = `${sign}${g.delta}`;
        if (g.delta > 0) return { badge, tooltip: `"${name}" hub score ↑${g.delta} (${g.before} → ${g.after}) — gaining connections, will surface more often in suggestions` };
        if (g.delta < 0) return { badge, tooltip: `"${name}" hub score ↓${Math.abs(g.delta)} (${g.before} → ${g.after}) — losing connections, lower suggestion priority` };
        return { badge, tooltip: `"${name}" hub score stable at ${g.before} — no connection change this pipeline` };
      }
      case 'apply': {
        const g = journey.gates.apply;
        if (!g) return null;
        const badge = `✓${g.files.length > 1 ? ` ×${g.files.length}` : ''}`;
        const first = this.shortenPath(g.files[0]);
        const extra = g.files.length > 1 ? ` and ${g.files.length - 1} other file${g.files.length > 2 ? 's' : ''}` : '';
        return { badge, tooltip: `"${name}" spotted as unwikified text in ${first}${extra} — marked for potential auto-linking` };
      }
      case 'learn': {
        const g = journey.gates.learn;
        if (!g) return null;
        if (g.action === 'removed') {
          const file = this.shortenPath(g.file);
          return { badge: 'removed', tooltip: `"${name}" wikilink was removed from ${file} — recorded as negative feedback` };
        }
        // survived
        return {
          badge: `+${g.count}`,
          tooltip: `"${name}" survived ${g.count} edit${g.count === 1 ? '' : 's'} in ${this.shortenPath(g.file)} — positive retention signal`,
        };
      }
      case 'adapt': {
        const g = journey.gates.adapt;
        if (!g) return null;
        if (g.action === 'suppressed') return { badge: 'suppressed', tooltip: `"${name}" suppressed — too many rejections, will not be suggested until feedback improves (${g.detail})` };
        if (g.action === 'boosted') return { badge: 'boosted', tooltip: `"${name}" boosted: ${g.detail} — consistently accepted, gets priority in scoring` };
        return { badge: 'learning', tooltip: `"${name}" calibrating: ${g.detail} — not enough feedback yet to adjust trust` };
      }
      default: return null;
    }
  }

  private buildGateSummary(stageId: string, journeys: EntityJourney[], pipeline?: PipelineRecord): string {
    switch (stageId) {
      case 'discover': {
        const added = journeys.filter(j => j.gates.discover?.action === 'added').length;
        const removed = journeys.filter(j => j.gates.discover?.action === 'removed').length;
        const changed = journeys.filter(j => j.gates.discover?.action === 'category_changed').length;
        const moved = journeys.filter(j => j.gates.discover?.action === 'moved').length;
        // dead count is already filtered through looksLikeEntityName via deadLinkSubjects
        const dead = journeys.filter(j => j.isDead).length;
        const parts: string[] = [];
        if (added) parts.push(`+${added}`);
        if (removed) parts.push(`-${removed}`);
        if (changed) parts.push(`${changed} reclassified`);
        if (moved) parts.push(`${moved} moved`);
        if (dead) parts.push(`${dead} unresolved`);
        if (parts.length) return parts.join(' ');
        // Fallback: show total from step data (filter dead links through heuristic)
        const entityStep = pipeline?.steps.find(s => s.name === 'entity_scan');
        const flStep = pipeline?.steps.find(s => s.name === 'forward_links');
        const entityCount = (entityStep?.output?.entity_count as number) ?? 0;
        const flLinks = (flStep?.output?.links as Array<{ dead?: string[] }>) ?? [];
        const filteredDead = flLinks.reduce(
          (n, entry) => n + (entry.dead ?? []).filter(looksLikeEntityName).length, 0,
        );
        if (entityCount && filteredDead) return `${entityCount} indexed · ${filteredDead} unresolved`;
        if (entityCount) return `${entityCount} indexed`;
        return 'scanned';
      }
      case 'suggest': {
        const changed = journeys.filter(j => j.gates.suggest).length;
        if (!changed) return 'no changes';
        const up = journeys.filter(j => (j.gates.suggest?.delta ?? 0) > 0).length;
        const down = journeys.filter(j => (j.gates.suggest?.delta ?? 0) < 0).length;
        const parts: string[] = [];
        if (up) parts.push(`↑${up}`);
        if (down) parts.push(`↓${down}`);
        return parts.join(' ') || `${changed} changed`;
      }
      case 'apply': {
        const tracked = journeys.filter(j => j.gates.apply).length;
        if (tracked) return `${tracked} tracked`;
        const wlStep = pipeline?.steps.find(s => s.name === 'wikilink_check');
        const trackedArr = (wlStep?.output?.tracked as unknown[]) ?? [];
        if (!wlStep?.skipped) return `${trackedArr.length || 'no'} matches`;
        return 'checked';
      }
      case 'learn': {
        const survived = journeys.filter(j => j.gates.learn?.action === 'survived').length;
        const removed  = journeys.filter(j => j.gates.learn?.action === 'removed').length;
        if (survived || removed) {
          const parts: string[] = [];
          if (survived) parts.push(`${survived} survived`);
          if (removed) parts.push(`${removed} removed`);
          return parts.join(', ');
        }
        const fbStep = pipeline?.steps.find(s => s.name === 'implicit_feedback');
        if (fbStep && !fbStep.skipped) return 'no removals';
        return 'no signals';
      }
      case 'adapt': {
        const adapted = journeys.filter(j => j.gates.adapt).length;
        if (adapted) return `${adapted} adapted`;
        const d = this.dashboardData;
        if (d) {
          const suppressed = d.suppressed?.length ?? 0;
          const boosted = d.boost_tiers?.reduce((n, t) => n + t.entities.length, 0) ?? 0;
          const learning = d.learning?.length ?? 0;
          const total = suppressed + boosted + learning;
          if (total) return `${total} tracked`;
        }
        return 'calibrating';
      }
      default: return '';
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

  /**
   * Show pass-through entities as individual clickable items (dimmed) instead of
   * a count. Caps visible names at `maxShow`; remainder shown as "+N more" line.
   */
  private createPassthroughEntities(
    container: HTMLElement,
    entities: string[],
    suffix: string,
    maxShow = 12,
  ): void {
    if (entities.length === 0) return;
    const show = entities.slice(0, maxShow);
    const remaining = entities.length - show.length;

    const chipContainer = container.createDiv('flywheel-gate-chips');
    for (const name of show) {
      const chip = chipContainer.createSpan('flywheel-gate-chip flywheel-viz-entity-link');
      chip.setText(name);
      chip.dataset.entity = name;
      chip.setAttribute('aria-label', suffix);
      chip.title = name;
    }
    if (remaining > 0) {
      chipContainer.createSpan('flywheel-gate-chips-more').setText(`+${remaining}`);
    }
  }

  // =========================================================================
  // DISCOVER — @deprecated data extraction only, see renderWaterfall()
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
    const resolvedPT = passthrough.filter(s => !this.deadLinkSubjects.has(s));
    const deadPT = passthrough.filter(s => this.deadLinkSubjects.has(s));

    if (activeCount === 0 && passthrough.length === 0) {
      summaryEl.setText('scanned');
    } else if (activeCount === 0) {
      const parts: string[] = [];
      if (resolvedPT.length > 0) parts.push(`${resolvedPT.length} indexed`);
      if (deadPT.length > 0) parts.push(`${deadPT.length} dead`);
      summaryEl.setText(parts.join(', '));
    } else {
      const parts: string[] = [];
      if (added?.length) parts.push(`+${added.length}`);
      if (removed?.length) parts.push(`-${removed.length}`);
      if (deadPT.length > 0) parts.push(`${deadPT.length} dead`);
      summaryEl.setText(parts.join(', ') || `${activeCount} changes`);
    }
  }

  // =========================================================================
  // SUGGEST — @deprecated data extraction only, see renderWaterfall()
  // =========================================================================

  private renderSuggestGate(summaryEl: HTMLElement, itemsEl: HTMLElement): void {
    const pipeline = this.getActivePipeline();
    const hubStep = pipeline?.steps.find(s => s.name === 'hub_scores');

    if (!hubStep || hubStep.skipped) {
      summaryEl.setText('skipped');
      this.createPassthroughEntities(itemsEl, this.pipelineSubjects, 'Skipped');
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
    const unchanged = this.pipelineSubjects.filter(s => !diffMap.has(s));
    const unchangedResolved = unchanged.filter(s => !this.deadLinkSubjects.has(s));
    const unchangedDead = unchanged.filter(s => this.deadLinkSubjects.has(s));

    // Summary
    const totalActive = primaryDiffs.length + rippleDiffs.length;
    if (totalActive === 0) {
      const parts: string[] = ['no changes'];
      if (unchangedDead.length > 0) parts.push(`${unchangedDead.length} dead`);
      summaryEl.setText(parts.join(', '));
    } else {
      const parts: string[] = [];
      if (primaryDiffs.length > 0) parts.push(`${primaryDiffs.length} recalculated`);
      if (rippleDiffs.length > 0) parts.push(`${rippleDiffs.length} ripple`);
      if (unchangedDead.length > 0) parts.push(`${unchangedDead.length} dead`);
      summaryEl.setText(parts.join(', '));
    }
  }

  // =========================================================================
  // APPLY — @deprecated data extraction only, see renderWaterfall()
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
    const resolvedPT = passthrough.filter(s => !this.deadLinkSubjects.has(s));
    const deadPT = passthrough.filter(s => this.deadLinkSubjects.has(s));

    if (total > 0) {
      const parts = [`${total} tracked`];
      if (deadPT.length > 0) parts.push(`${deadPT.length} dead`);
      summaryEl.setText(parts.join(', '));
    } else if (passthrough.length > 0) {
      const parts = ['checked'];
      if (deadPT.length > 0) parts.push(`${deadPT.length} dead`);
      summaryEl.setText(parts.join(', '));
    } else {
      summaryEl.setText('pass');
    }
  }

  // =========================================================================
  // LEARN — @deprecated data extraction only, see renderWaterfall()
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
    const resolvedPT = passthrough.filter(s => !this.deadLinkSubjects.has(s));
    const deadPT = passthrough.filter(s => this.deadLinkSubjects.has(s));

    if (signalNames.size > 0) {
      const parts = [`${signalNames.size} signal${signalNames.size !== 1 ? 's' : ''}`];
      if (deadPT.length > 0) parts.push(`${deadPT.length} dead`);
      summaryEl.setText(parts.join(', '));
    } else if (passthrough.length > 0) {
      const parts = ['checked'];
      if (deadPT.length > 0) parts.push(`${deadPT.length} dead`);
      summaryEl.setText(parts.join(', '));
    } else {
      summaryEl.setText('no signals');
    }
  }

  // =========================================================================
  // ADAPT — @deprecated data extraction only, see renderWaterfall()
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
    let deadCount = 0;

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
        if (this.deadLinkSubjects.has(name)) deadCount++;
        else newCount++;
      }
    }

    if (shown === 0) {
      const parts: string[] = [];
      if (newCount > 0) parts.push(`${newCount} new`);
      if (deadCount > 0) parts.push(`${deadCount} dead`);
      summaryEl.setText(parts.join(', ') || 'no data');
    } else {
      const parts = [`${shown} adapted`];
      if (newCount > 0) parts.push(`${newCount} new`);
      if (deadCount > 0) parts.push(`${deadCount} dead`);
      summaryEl.setText(parts.join(', '));
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
      const accText = d.total_feedback > 0
        ? `${Math.round(d.overall_accuracy * 100)}%`
        : '—';
      const accStat = row.createSpan('flywheel-score-stat');
      accStat.title = d.total_feedback > 0
        ? `${d.total_correct} correct out of ${d.total_feedback} feedback events`
        : 'No feedback recorded yet — delete an auto-inserted [[wikilink]] to generate the first signal';
      accStat.createSpan('flywheel-score-stat-value').setText(accText);
      accStat.createSpan('flywheel-score-stat-label').setText('accuracy');
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
    await this.renderGraphDiff(panel, entityName);
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

  private async renderGraphDiff(panel: HTMLElement, entityName?: string): Promise<void> {
    const section = panel.createDiv('flywheel-viz-graph-diff-section');
    section.createDiv('flywheel-loop-section-title').setText('Graph changes (7 days)');
    try {
      const now = Date.now();
      const diffData = await this.mcpClient.snapshotDiff(now - 7 * 86400000, now);
      const diff = diffData.diff;

      let hubChanges = diff.hubScoreChanges ?? [];

      // When in entity drill-down, filter to just that entity
      if (entityName) {
        hubChanges = hubChanges.filter(h => h.entity === entityName);
        if (hubChanges.length === 0) {
          section.createDiv({ cls: 'flywheel-loop-detail-note' })
            .setText(`No hub score changes for ${entityName} in the last 7 days.`);
          return;
        }
      }

      if (hubChanges.length > 0) {
        const sorted = [...hubChanges].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
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

  private refreshAgoText(): void {
    const pipeline = this.getActivePipeline();
    if (!pipeline || !this.subtitleEl) return;
    const ago = this.formatTimestampAgo(pipeline.timestamp);
    const subjectCount = this.pipelineSubjects.length;
    const dur = Math.round(pipeline.duration_ms);
    const parts: string[] = [ago];
    if (subjectCount > 0) parts.push(`${subjectCount} entities`);
    parts.push(`${dur}ms`);
    this.subtitleEl.setText(parts.join(' \u00B7 '));
  }

  private stopAgoTimer(): void {
    if (this.agoTimerId) { clearInterval(this.agoTimerId); this.agoTimerId = null; }
  }

  async onClose(): Promise<void> {
    this.stopAgoTimer();
    if (this.healthUnsub) {
      this.healthUnsub();
      this.healthUnsub = null;
    }
  }
}
