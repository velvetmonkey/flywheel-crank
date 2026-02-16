/**
 * Search Modal — powered by flywheel-memory MCP
 *
 * Sends search queries to the MCP server which handles FTS5 keyword
 * search, hybrid semantic ranking, and entity matching. Results show
 * match-source badges (keyword / semantic) and RRF scores.
 */

import { App, Modal, setIcon } from 'obsidian';
import type { FlywheelMcpClient, McpSearchResult, McpSearchResponse } from '../mcp/client';

export class SearchModal extends Modal {
  private mcpClient: FlywheelMcpClient;
  private results: McpSearchResult[] = [];
  private searchMethod = '';
  private selectedIndex = 0;
  private inputEl!: HTMLInputElement;
  private resultsEl!: HTMLDivElement;
  private statusEl!: HTMLDivElement;
  private debounceTimer: number | null = null;

  constructor(app: App, mcpClient: FlywheelMcpClient) {
    super(app);
    this.mcpClient = mcpClient;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('flywheel-search-modal');

    // Search input
    const inputContainer = contentEl.createDiv('flywheel-search-input-container');
    const iconEl = inputContainer.createDiv('flywheel-search-icon');
    setIcon(iconEl, 'search');

    this.inputEl = inputContainer.createEl('input', {
      type: 'text',
      placeholder: 'Search vault content...',
      cls: 'flywheel-search-input',
    });

    this.statusEl = contentEl.createDiv('flywheel-search-status');
    this.resultsEl = contentEl.createDiv('flywheel-search-results');

    // Check MCP connection
    if (!this.mcpClient.connected) {
      this.statusEl.setText('MCP server not connected');
      this.statusEl.addClass('flywheel-search-status-warning');
    }

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
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.openSelected();
      }
    });

    this.inputEl.focus();
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

    try {
      const response = await this.mcpClient.search(query, 20);
      const elapsed = Math.round(performance.now() - start);

      this.results = response.results;
      this.searchMethod = response.method;
      this.selectedIndex = 0;

      const count = this.results.length;
      this.statusEl.setText(`${count} result${count !== 1 ? 's' : ''} (${response.method}) ${elapsed}ms`);
      this.statusEl.removeClass('flywheel-search-status-warning');

      console.log(`[Flywheel Search] query="${query}" method=${response.method} results=${count} ${elapsed}ms`);

      this.renderResults();
    } catch (err) {
      this.statusEl.setText(err instanceof Error ? err.message : 'Search error');
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

    this.results.forEach((result, i) => {
      const item = this.resultsEl.createDiv({
        cls: `flywheel-search-result-item ${i === this.selectedIndex ? 'is-selected' : ''}`,
      });

      item.addEventListener('click', () => {
        this.selectedIndex = i;
        this.openSelected();
      });

      item.addEventListener('mouseenter', () => {
        this.selectedIndex = i;
        this.renderResults();
      });

      // Title row
      const titleRow = item.createDiv('flywheel-search-result-title-row');

      const titleEl = titleRow.createDiv('flywheel-search-result-title');
      titleEl.setText(result.title);

      // Match source badges
      if (result.in_fts5 || result.in_semantic) {
        const badgeContainer = titleRow.createDiv('flywheel-search-source-badges');
        if (result.in_fts5) {
          const badge = badgeContainer.createSpan('flywheel-search-source-badge flywheel-search-source-keyword');
          badge.setText('keyword');
        }
        if (result.in_semantic) {
          const badge = badgeContainer.createSpan('flywheel-search-source-badge flywheel-search-source-semantic');
          badge.setText('semantic');
        }
      }

      // Score badge
      if (result.rrf_score != null) {
        const pct = Math.round(result.rrf_score * 100);
        const badge = titleRow.createDiv('flywheel-search-score-badge');
        badge.setText(`${pct}%`);
        badge.style.opacity = String(0.4 + result.rrf_score * 0.6);
      }

      // Folder path
      const folder = result.path.split('/').slice(0, -1).join('/');
      if (folder) {
        const folderEl = titleRow.createDiv('flywheel-search-result-folder');
        folderEl.setText(folder);
      }

      // Snippet
      if (result.snippet) {
        const snippetEl = item.createDiv('flywheel-search-result-snippet');
        snippetEl.innerHTML = result.snippet;
      }
    });
  }

  private selectNext(): void {
    if (this.results.length === 0) return;
    this.selectedIndex = (this.selectedIndex + 1) % this.results.length;
    this.renderResults();
    this.scrollToSelected();
  }

  private selectPrev(): void {
    if (this.results.length === 0) return;
    this.selectedIndex = (this.selectedIndex - 1 + this.results.length) % this.results.length;
    this.renderResults();
    this.scrollToSelected();
  }

  private scrollToSelected(): void {
    const selected = this.resultsEl.querySelector('.is-selected');
    selected?.scrollIntoView({ block: 'nearest' });
  }

  private openSelected(): void {
    if (this.results.length === 0) return;
    const result = this.results[this.selectedIndex];
    if (result) {
      this.close();
      this.app.workspace.openLinkText(result.path, '', false);
    }
  }

  onClose(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.contentEl.empty();
  }
}
