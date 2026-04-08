/**
 * Search Modal — powered by flywheel-memory MCP
 *
 * Sends search queries to the MCP server which handles FTS5 keyword
 * search, hybrid semantic ranking, and entity matching. Results show
 * match-source badges (keyword / semantic / entity) and RRF scores.
 */

import { App, Modal, setIcon } from 'obsidian';
import type { FlywheelMcpClient, McpSearchResult, McpSearchResponse, McpHealthCheckResponse } from '../mcp/client';

const CATEGORY_ICONS: Record<string, string> = {
  technologies: 'cpu',
  acronyms: 'hash',
  people: 'user',
  projects: 'folder-kanban',
  organizations: 'building',
  locations: 'map-pin',
  concepts: 'lightbulb',
  animals: 'bug',
  media: 'film',
  events: 'calendar',
  documents: 'file-text',
  vehicles: 'car',
  health: 'heart-pulse',
  finance: 'banknote',
  food: 'utensils',
  hobbies: 'palette',
  periodical: 'newspaper',
  other: 'circle-dot',
};

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export class SearchModal extends Modal {
  private mcpClient: FlywheelMcpClient;
  private results: McpSearchResult[] = [];
  private searchMethod = '';
  private selectedIndex = 0;
  private inputEl!: HTMLInputElement;
  private resultsEl!: HTMLDivElement;
  private statusEl!: HTMLDivElement;
  private indexBarEl!: HTMLDivElement;
  private debounceTimer: number | null = null;
  private healthUnsub: (() => void) | null = null;
  private connectionUnsub: (() => void) | null = null;

  constructor(app: App, mcpClient: FlywheelMcpClient) {
    super(app);
    this.mcpClient = mcpClient;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('flywheel-search-modal');
    this.modalEl.addClass('flywheel-search-modal-container');

    // Search input
    const inputContainer = contentEl.createDiv('flywheel-search-input-container');
    const iconEl = inputContainer.createDiv('flywheel-search-icon');
    setIcon(iconEl, 'search');

    this.inputEl = inputContainer.createEl('input', {
      type: 'text',
      placeholder: 'Search vault content...',
      cls: 'flywheel-search-input',
    });

    this.indexBarEl = contentEl.createDiv('flywheel-search-index-bar');
    this.statusEl = contentEl.createDiv('flywheel-search-status');
    this.resultsEl = contentEl.createDiv('flywheel-search-results');

    // Shortcut hints
    const hintsEl = contentEl.createDiv('flywheel-search-hints');
    const mod = navigator.platform.includes('Mac') ? '\u2318' : 'Ctrl';
    const hints = [
      { keys: '\u21B5', label: 'open' },
      { keys: `${mod}+\u21B5`, label: 'new tab' },
      { keys: `${mod}+Alt+\u21B5`, label: 'split right' },
      { keys: '\u2191\u2193', label: 'navigate' },
      { keys: 'Esc', label: 'dismiss' },
    ];
    for (const hint of hints) {
      const item = hintsEl.createSpan('flywheel-search-hint');
      item.createEl('kbd', { text: hint.keys });
      item.createSpan({ text: hint.label });
    }

    // Show index status via centralized health subscription.
    // Also watch for connection state changes so the modal recovers if MCP
    // connects after the modal was opened (e.g. still starting up).
    const setupHealthSub = () => {
      if (this.healthUnsub) { this.healthUnsub(); this.healthUnsub = null; }
      this.healthUnsub = this.mcpClient.onHealthUpdate(health => {
        this.renderIndexBar(health);
      });
    };

    if (!this.mcpClient.connected) {
      this.statusEl.setText('MCP server not connected');
      this.statusEl.addClass('flywheel-search-status-warning');
      this.renderIndexBar(null);
    } else {
      setupHealthSub();
    }

    this.connectionUnsub = this.mcpClient.onConnectionStateChange(() => {
      if (this.mcpClient.connected) {
        this.statusEl.setText('');
        this.statusEl.removeClass('flywheel-search-status-warning');
        setupHealthSub();
        // Re-run any pending search now that we're connected
        if (this.inputEl.value.trim()) this.performSearch();
      } else {
        this.statusEl.setText('MCP server not connected');
        this.statusEl.addClass('flywheel-search-status-warning');
        this.renderIndexBar(null);
      }
    });

    // Event handlers
    this.inputEl.addEventListener('input', () => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = window.setTimeout(() => this.performSearch(), 200);
    });

    this.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.selectNext();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.selectPrev();
      }
    });

    // Register Enter via Obsidian scope (modal scopes can swallow raw keydown)
    this.scope.register([], 'Enter', (e) => { e.preventDefault(); this.openSelected('current'); return false; });
    this.scope.register(['Mod'], 'Enter', (e) => { e.preventDefault(); this.openSelected('new-tab'); return false; });
    this.scope.register(['Mod', 'Alt'], 'Enter', (e) => { e.preventDefault(); this.openSelected('split-right'); return false; });

    this.inputEl.focus();
  }

  private renderIndexBar(health: McpHealthCheckResponse | null): void {
    this.indexBarEl.empty();

    if (!health) {
      // Disconnected state
      this.addIndexIndicator('off', 'disconnected');
      return;
    }

    // FTS5 / keyword status
    if (health.fts5_building) {
      this.addIndexIndicator('building', `keyword: building...`);
    } else if (health.fts5_ready) {
      this.addIndexIndicator('ok', `keyword: ${health.note_count} notes`);
    } else {
      this.addIndexIndicator('off', 'keyword: off');
    }

    // Separator
    this.indexBarEl.createSpan({ cls: 'flywheel-search-index-sep', text: '\u00b7' });

    // Semantic status
    if (health.embeddings_building) {
      this.addIndexIndicator('building', 'semantic: building...');
    } else if (health.embeddings_ready && health.embeddings_count) {
      this.addIndexIndicator('ok', `semantic: ${health.embeddings_count} embeddings`);
    } else {
      this.addIndexIndicator('off', 'semantic: off');
    }
  }

  private addIndexIndicator(state: 'ok' | 'building' | 'off', label: string): void {
    const wrapper = this.indexBarEl.createSpan({ cls: 'flywheel-search-index-label' });
    wrapper.style.display = 'inline-flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.gap = '5px';
    wrapper.createSpan({ cls: `flywheel-search-index-dot flywheel-search-index-dot-${state}` });
    wrapper.appendText(label);
  }

  private async performSearch(): Promise<void> {
    const query = this.inputEl.value.trim();
    if (!query) {
      this.results = [];
      this.searchMethod = '';
      this.renderResults();
      this.statusEl.setText('');
      return;
    }

    if (!this.mcpClient.connected) {
      this.statusEl.setText('MCP server not connected');
      this.statusEl.addClass('flywheel-search-status-warning');
      return;
    }

    const start = performance.now();

    this.statusEl.setText('Searching...');
    this.statusEl.removeClass('flywheel-search-status-warning');

    try {
      const response = await this.mcpClient.search(query);
      const elapsed = Math.round(performance.now() - start);

      // Handle building state — FTS5 index not ready yet
      if (response.building) {
        this.statusEl.setText('Building search index — try again shortly...');
        this.statusEl.addClass('flywheel-search-status-warning');
        this.results = [];
        this.renderResults();
        // Auto-retry after 3 seconds
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = window.setTimeout(() => this.performSearch(), 3000);
        return;
      }

      // Filter: skip stale paths (moved/deleted files) + deduplicate
      const seen = new Set<string>();
      this.results = response.results.filter((r: McpSearchResult) => {
        const key = r.path?.toLowerCase();
        if (!key || seen.has(key)) return false;
        // Skip results whose file no longer exists in the vault
        if (!this.app.vault.getAbstractFileByPath(r.path)) return false;
        seen.add(key);
        return true;
      });
      this.searchMethod = response.method;
      this.selectedIndex = 0;

      const count = this.results.length;
      const methodLabel = response.method === 'hybrid'
        ? 'keyword + semantic'
        : 'keyword only';
      this.statusEl.setText(`${count} result${count !== 1 ? 's' : ''} via ${methodLabel} \u00b7 ${elapsed}ms`);
      this.statusEl.removeClass('flywheel-search-status-warning');

      console.log(`[Flywheel Search] query="${query}" method=${response.method} results=${count} ${elapsed}ms`);

      this.renderResults();
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Search error';
      const msg = raw.length > 120 ? raw.slice(0, 120) + '...' : raw;
      this.statusEl.setText(msg);
      this.statusEl.addClass('flywheel-search-status-warning');
    }
  }

  private renderResults(): void {
    this.resultsEl.empty();

    if (this.results.length === 0) {
      if (this.inputEl.value.trim()) {
        this.resultsEl.createDiv('flywheel-search-empty').setText('No results found');
      }
      return;
    }

    // Results arrive score-sorted (consumer: 'human' preserves order)
    const topScore = this.results[0]?.rrf_score || 1;
    let prevPct = 100;

    this.results.forEach((result, i) => {
      const pct = topScore > 0 && result.rrf_score != null
        ? Math.round((result.rrf_score / topScore) * 100)
        : 0;

      // Tier separator when score drops significantly
      if (prevPct - pct > 25 && i > 0) {
        this.resultsEl.createDiv('flywheel-search-tier-separator');
      }
      prevPct = pct;

      const item = this.resultsEl.createDiv({
        cls: `flywheel-search-result-item ${i === this.selectedIndex ? 'is-selected' : ''}`,
      });

      item.addEventListener('click', (e: MouseEvent) => {
        this.selectedIndex = i;
        if (e.metaKey || e.ctrlKey) {
          if (e.altKey) {
            this.openSelected('split-right');
          } else {
            this.openSelected('new-tab');
          }
        } else {
          this.openSelected('current');
        }
      });

      item.addEventListener('mouseenter', () => {
        this.selectedIndex = i;
        this.resultsEl.querySelectorAll('.is-selected').forEach(el => el.removeClass('is-selected'));
        item.addClass('is-selected');
      });

      // Title row: [icon] Title [source] [graph] [folder · time] [score]
      const titleRow = item.createDiv('flywheel-search-result-title-row');

      if (result.category) {
        const iconName = CATEGORY_ICONS[result.category] || 'circle-dot';
        const iconEl = titleRow.createDiv('flywheel-search-result-category-icon');
        iconEl.dataset.category = result.category;
        setIcon(iconEl, iconName);
      }

      const titleEl = titleRow.createDiv('flywheel-search-result-title');
      titleEl.setText(result.title);

      // Source label — color-coded by confidence
      const sources: string[] = [];
      if (result.in_fts5) sources.push('keyword');
      if (result.in_semantic) sources.push('semantic');
      if (result.in_entity) sources.push('entity');
      if (sources.length === 0) sources.push('metadata');
      const sourceEl = titleRow.createSpan('flywheel-search-result-source');
      sourceEl.setText(sources.join('+'));
      if (sources.length > 1) sourceEl.addClass('flywheel-search-result-source-multi');

      // Graph boost indicator
      if (result.graph_boost && result.graph_boost > 0) {
        const graphEl = titleRow.createSpan('flywheel-search-result-graph-boost');
        setIcon(graphEl, 'git-fork');
        graphEl.setAttribute('aria-label', `Graph boost: +${Math.round(result.graph_boost)}`);
      }

      // Inline metadata: folder · time · backlinks
      const metaParts: string[] = [];
      const folder = result.path.split('/').slice(0, -1).join('/');
      if (folder) metaParts.push(folder);
      if (result.modified) metaParts.push(formatRelativeTime(result.modified));
      if (result.backlink_count && result.backlink_count > 0) {
        metaParts.push(`${result.backlink_count}\u2190`);
      }
      if (metaParts.length > 0) {
        const metaEl = titleRow.createSpan('flywheel-search-result-meta');
        metaEl.setText(metaParts.join(' \u00b7 '));
      }

      // Score badge
      if (pct > 0) {
        const badge = titleRow.createDiv('flywheel-search-score-badge');
        badge.setText(`${pct}%`);
        badge.style.opacity = String(0.4 + (pct / 100) * 0.6);
      }

      // Snippet (1-line clamp, keyword matches only)
      if (result.snippet) {
        const snippetEl = item.createDiv('flywheel-search-result-snippet');
        snippetEl.innerHTML = result.snippet;
      }

      // Score bar — thin line showing relative relevance
      if (pct > 0) {
        const bar = item.createDiv('flywheel-search-result-score-bar');
        bar.style.width = `${pct}%`;
      }
    });
  }

  private selectNext(): void {
    if (this.results.length === 0) return;
    const items = this.resultsEl.querySelectorAll('.flywheel-search-result-item');
    items[this.selectedIndex]?.removeClass('is-selected');
    this.selectedIndex = (this.selectedIndex + 1) % this.results.length;
    items[this.selectedIndex]?.addClass('is-selected');
    this.scrollToSelected();
  }

  private selectPrev(): void {
    if (this.results.length === 0) return;
    const items = this.resultsEl.querySelectorAll('.flywheel-search-result-item');
    items[this.selectedIndex]?.removeClass('is-selected');
    this.selectedIndex = (this.selectedIndex - 1 + this.results.length) % this.results.length;
    items[this.selectedIndex]?.addClass('is-selected');
    this.scrollToSelected();
  }

  private scrollToSelected(): void {
    const selected = this.resultsEl.querySelector('.is-selected');
    selected?.scrollIntoView({ block: 'nearest' });
  }

  private openSelected(mode: 'current' | 'new-tab' | 'split-right' = 'current'): void {
    if (this.results.length === 0) return;
    const result = this.results[this.selectedIndex];
    if (!result) return;
    this.close();
    const path = result.path.replace(/\.md$/, '');
    if (mode === 'split-right') {
      this.app.workspace.getLeaf('split').openFile(
        this.app.vault.getAbstractFileByPath(result.path) as any
      );
    } else {
      this.app.workspace.openLinkText(path, '', mode === 'new-tab');
    }
  }

  onClose(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.healthUnsub) { this.healthUnsub(); this.healthUnsub = null; }
    if (this.connectionUnsub) { this.connectionUnsub(); this.connectionUnsub = null; }
    this.contentEl.empty();
  }
}
