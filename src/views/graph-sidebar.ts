/**
 * Graph Sidebar View — powered by flywheel-memory MCP
 *
 * Shows backlinks, forward links, related notes, and hub score
 * for the currently active note. All data comes from MCP tool calls.
 */

import { ItemView, WorkspaceLeaf, TFile, setIcon } from 'obsidian';
import type {
  FlywheelMcpClient,
  McpBacklink,
  McpForwardLink,
  McpSimilarNote,
} from '../mcp/client';

export const GRAPH_VIEW_TYPE = 'flywheel-graph';

export class GraphSidebarView extends ItemView {
  private mcpClient: FlywheelMcpClient;
  private contentContainer!: HTMLDivElement;

  constructor(leaf: WorkspaceLeaf, mcpClient: FlywheelMcpClient) {
    super(leaf);
    this.mcpClient = mcpClient;
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

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('flywheel-graph-sidebar');

    this.contentContainer = container.createDiv('flywheel-graph-content');
    this.renderEmpty();
  }

  refresh(): void {
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile && this.mcpClient.connected) {
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

    if (!this.mcpClient.connected) {
      empty.createDiv('flywheel-graph-empty-text').setText('MCP server not connected');
    } else {
      empty.createDiv('flywheel-graph-empty-text').setText('Open a note to see its graph data');
    }
  }

  private async renderForNote(file: TFile): Promise<void> {
    if (!this.mcpClient.connected) {
      this.renderEmpty();
      return;
    }

    this.contentContainer.empty();
    const notePath = file.path;

    // Header with loading state
    const header = this.contentContainer.createDiv('flywheel-graph-header');
    header.createDiv('flywheel-graph-note-title').setText(file.basename);

    const scoreEl = header.createDiv('flywheel-graph-hub-score');
    const scoreIcon = scoreEl.createSpan('flywheel-graph-hub-icon');
    setIcon(scoreIcon, 'link');
    const connectionText = scoreEl.createSpan();
    connectionText.setText('loading...');

    // Fetch backlinks and forward links in parallel
    try {
      const [backlinksResp, forwardLinksResp] = await Promise.all([
        this.mcpClient.getBacklinks(notePath),
        this.mcpClient.getForwardLinks(notePath),
      ]);

      // Deduplicate forward links by resolved path (or target for dead links)
      const seen = new Set<string>();
      const uniqueLinks = forwardLinksResp.forward_links.filter(link => {
        const key = link.resolved_path ?? link.target;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      const totalConnections = backlinksResp.backlink_count + uniqueLinks.length;
      connectionText.setText(`${totalConnections} connections`);

      // Backlinks section
      this.renderSection('Backlinks', 'arrow-left', backlinksResp.backlink_count, (container) => {
        if (backlinksResp.backlinks.length === 0) {
          container.createDiv('flywheel-graph-section-empty').setText('No backlinks');
          return;
        }

        for (const bl of backlinksResp.backlinks.slice(0, 20)) {
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

        if (backlinksResp.backlink_count > 20) {
          container.createDiv('flywheel-graph-more').setText(`+${backlinksResp.backlink_count - 20} more`);
        }
      });

      // Forward links section
      this.renderSection('Forward Links', 'arrow-right', uniqueLinks.length, (container) => {
        if (uniqueLinks.length === 0) {
          container.createDiv('flywheel-graph-section-empty').setText('No outgoing links');
          return;
        }

        for (const link of uniqueLinks.slice(0, 20)) {
          const item = container.createDiv('flywheel-graph-link-item');
          if (link.exists && link.resolved_path) {
            item.addEventListener('click', () => {
              this.app.workspace.openLinkText(link.resolved_path!, '', false);
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

      // Related notes via find_similar
      await this.renderRelatedNotes(notePath);
    } catch (err) {
      console.error('Flywheel Crank: graph sidebar error', err);
      connectionText.setText('error loading');
    }
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
    try {
      const response = await this.mcpClient.findSimilar(notePath, 10);

      if (response.similar.length === 0) return;

      this.renderSection('Related Notes', 'sparkles', response.similar.length, (container) => {
        for (const result of response.similar) {
          const item = container.createDiv('flywheel-graph-link-item');
          item.addEventListener('click', () => {
            this.app.workspace.openLinkText(result.path, '', false);
          });

          const nameEl = item.createDiv('flywheel-graph-link-name');
          nameEl.setText(result.title);

          if (result.snippet) {
            const snippetEl = item.createDiv('flywheel-graph-link-snippet');
            snippetEl.innerHTML = result.snippet;
          } else {
            const scoreEl = item.createDiv('flywheel-graph-link-path');
            scoreEl.setText(`similarity: ${result.score}`);
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
