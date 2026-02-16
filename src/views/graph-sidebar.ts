/**
 * Graph Sidebar View
 *
 * Shows backlinks, forward links, related notes, and hub score
 * for the currently active note. Auto-updates on note switch.
 */

import { ItemView, WorkspaceLeaf, TFile, setIcon } from 'obsidian';
import type { VaultIndex, Backlink } from '../core/types';
import {
  getBacklinksForNote,
  getForwardLinksForNote,
  resolveTarget,
} from '../index/vault-index';
import { extractKeyTerms } from '../core/similarity';
import { searchFTS5, escapeFts5Query, getFTS5State } from '../index/fts5';
import { hasEmbeddingsIndex, findSemanticallySimilar } from '../index/embeddings';

export const GRAPH_VIEW_TYPE = 'flywheel-graph';

export class GraphSidebarView extends ItemView {
  private index: VaultIndex | null = null;
  private contentContainer!: HTMLDivElement;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return GRAPH_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Flywheel Graph';
  }

  getIcon(): string {
    return 'git-fork';
  }

  setIndex(index: VaultIndex): void {
    this.index = index;
    this.refresh();
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('flywheel-graph-sidebar');

    this.contentContainer = container.createDiv('flywheel-graph-content');
    this.renderEmpty();
  }

  refresh(): void {
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile && this.index) {
      this.renderForNote(activeFile);
    } else {
      this.renderEmpty();
    }
  }

  private renderEmpty(): void {
    this.contentContainer.empty();
    const empty = this.contentContainer.createDiv('flywheel-graph-empty');
    const icon = empty.createDiv('flywheel-graph-empty-icon');
    setIcon(icon, 'file-text');
    empty.createDiv('flywheel-graph-empty-text').setText('Open a note to see its graph data');
  }

  private renderForNote(file: TFile): void {
    if (!this.index) return;

    this.contentContainer.empty();
    const notePath = file.path;

    // Header
    const header = this.contentContainer.createDiv('flywheel-graph-header');
    header.createDiv('flywheel-graph-note-title').setText(file.basename);

    // Hub score
    const backlinks = getBacklinksForNote(this.index, notePath);
    const forwardLinks = getForwardLinksForNote(this.index, notePath);
    const totalConnections = backlinks.length + forwardLinks.length;

    const scoreEl = header.createDiv('flywheel-graph-hub-score');
    const scoreIcon = scoreEl.createSpan('flywheel-graph-hub-icon');
    setIcon(scoreIcon, 'link');
    scoreEl.createSpan().setText(`${totalConnections} connections`);

    // Backlinks section
    this.renderSection('Backlinks', 'arrow-left', backlinks.length, (container) => {
      if (backlinks.length === 0) {
        container.createDiv('flywheel-graph-section-empty').setText('No backlinks');
        return;
      }

      for (const bl of backlinks.slice(0, 20)) {
        const item = container.createDiv('flywheel-graph-link-item');
        item.addEventListener('click', () => {
          this.app.workspace.openLinkText(bl.source, '', false);
        });

        const title = bl.source.replace(/\.md$/, '').split('/').pop() || bl.source;
        const nameEl = item.createDiv('flywheel-graph-link-name');
        nameEl.setText(title);

        const pathEl = item.createDiv('flywheel-graph-link-path');
        const folder = bl.source.split('/').slice(0, -1).join('/');
        if (folder) pathEl.setText(folder);
      }

      if (backlinks.length > 20) {
        container.createDiv('flywheel-graph-more').setText(`+${backlinks.length - 20} more`);
      }
    });

    // Forward links section
    this.renderSection('Forward Links', 'arrow-right', forwardLinks.length, (container) => {
      if (forwardLinks.length === 0) {
        container.createDiv('flywheel-graph-section-empty').setText('No outgoing links');
        return;
      }

      for (const link of forwardLinks.slice(0, 20)) {
        const item = container.createDiv('flywheel-graph-link-item');
        if (link.exists) {
          item.addEventListener('click', () => {
            this.app.workspace.openLinkText(link.resolvedPath!, '', false);
          });
        } else {
          item.addClass('flywheel-graph-dead-link');
        }

        const nameEl = item.createDiv('flywheel-graph-link-name');
        nameEl.setText(link.target);

        if (!link.exists) {
          const badge = item.createDiv('flywheel-graph-badge flywheel-graph-badge-dead');
          badge.setText('deleted');
        }
      }
    });

    // Related notes section (via FTS5)
    this.renderRelatedNotes(notePath);
  }

  private renderSection(
    title: string,
    icon: string,
    count: number,
    renderContent: (container: HTMLDivElement) => void
  ): void {
    const section = this.contentContainer.createDiv('flywheel-graph-section');

    const headerEl = section.createDiv('flywheel-graph-section-header');
    headerEl.addEventListener('click', () => {
      section.toggleClass('is-collapsed', !section.hasClass('is-collapsed'));
    });

    const iconEl = headerEl.createSpan('flywheel-graph-section-icon');
    setIcon(iconEl, icon);
    headerEl.createSpan('flywheel-graph-section-title').setText(title);
    headerEl.createSpan('flywheel-graph-section-count').setText(`${count}`);

    const chevron = headerEl.createSpan('flywheel-graph-section-chevron');
    setIcon(chevron, 'chevron-down');

    const content = section.createDiv('flywheel-graph-section-content');
    renderContent(content);
  }

  private async renderRelatedNotes(notePath: string): Promise<void> {
    // Try semantic similarity first (better results), fall back to FTS5
    if (hasEmbeddingsIndex()) {
      try {
        const results = await findSemanticallySimilar(notePath, 10);
        if (results.length > 0) {
          this.renderSection('Related Notes', 'sparkles', results.length, (container) => {
            for (const result of results) {
              const item = container.createDiv('flywheel-graph-link-item');
              item.addEventListener('click', () => {
                this.app.workspace.openLinkText(result.path, '', false);
              });
              const nameEl = item.createDiv('flywheel-graph-link-name');
              nameEl.setText(result.title);
              const scoreEl = item.createDiv('flywheel-graph-link-path');
              scoreEl.setText(`similarity: ${result.score}`);
            }
          });
          return;
        }
      } catch {
        // Fall through to FTS5
      }
    }

    // FTS5 fallback
    const ftsState = getFTS5State();
    if (!ftsState.ready) return;

    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (!file || !(file instanceof TFile)) return;

    try {
      const content = await this.app.vault.cachedRead(file);
      const terms = extractKeyTerms(content, 10);
      if (terms.length === 0) return;

      const query = terms.map(t => escapeFts5Query(t)).filter(t => t).join(' OR ');
      if (!query) return;

      const results = searchFTS5(query, 10)
        .filter(r => r.path !== notePath);

      if (results.length === 0) return;

      this.renderSection('Related Notes', 'sparkles', results.length, (container) => {
        for (const result of results.slice(0, 10)) {
          const item = container.createDiv('flywheel-graph-link-item');
          item.addEventListener('click', () => {
            this.app.workspace.openLinkText(result.path, '', false);
          });
          const nameEl = item.createDiv('flywheel-graph-link-name');
          nameEl.setText(result.title);
          if (result.snippet) {
            const snippetEl = item.createDiv('flywheel-graph-link-snippet');
            snippetEl.innerHTML = result.snippet;
          }
        }
      });
    } catch {
      // Skip related notes on error
    }
  }

  async onClose(): Promise<void> {
    this.contentContainer?.empty();
  }
}
