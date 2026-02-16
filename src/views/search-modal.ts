/**
 * Hybrid Search Modal
 *
 * Full-text search with BM25 ranking, highlighted snippets,
 * keyboard navigation, and score badges.
 */

import { App, Modal, setIcon } from 'obsidian';
import { searchFTS5, escapeFts5Query, getFTS5State } from '../index/fts5';
import { hybridSearch, hasEmbeddingsIndex } from '../index/embeddings';
import type { FTS5Result } from '../core/types';

export class SearchModal extends Modal {
  private results: FTS5Result[] = [];
  private selectedIndex = 0;
  private inputEl!: HTMLInputElement;
  private resultsEl!: HTMLDivElement;
  private statusEl!: HTMLDivElement;
  private debounceTimer: number | null = null;

  constructor(app: App) {
    super(app);
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

    // Check if FTS5 is ready
    const ftsState = getFTS5State();
    if (!ftsState.ready) {
      this.statusEl.setText('Index not ready. Building...');
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
      this.renderResults();
      return;
    }

    try {
      const escaped = escapeFts5Query(query);
      if (!escaped) return;

      // FTS5 keyword search with prefix matching
      const searchQuery = escaped.split(' ')
        .filter(t => t.length > 0)
        .map(t => `${t}*`)
        .join(' ');

      const fts5Results = searchFTS5(searchQuery, 20);

      // Hybrid merge with semantic results if embeddings exist
      const hasEmb = hasEmbeddingsIndex();
      if (hasEmb) {
        try {
          this.results = await hybridSearch(fts5Results, query, 20);
          this.statusEl.setText(`${this.results.length} result${this.results.length !== 1 ? 's' : ''} (hybrid)`);
        } catch {
          this.results = fts5Results;
          this.statusEl.setText(`${this.results.length} result${this.results.length !== 1 ? 's' : ''}`);
        }
      } else {
        this.results = fts5Results;
        this.statusEl.setText(`${this.results.length} result${this.results.length !== 1 ? 's' : ''}`);
      }

      this.selectedIndex = 0;
      this.statusEl.removeClass('flywheel-search-status-warning');
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

      // Score badge
      if (result.score != null) {
        const pct = Math.round(result.score * 100);
        const badge = titleRow.createDiv('flywheel-search-score-badge');
        badge.setText(`${pct}%`);
        badge.style.opacity = String(0.4 + result.score * 0.6);
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
