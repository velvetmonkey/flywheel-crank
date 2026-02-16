/**
 * Graph Sidebar View — powered by flywheel-memory MCP
 *
 * Collapsible sections: Vault Info (always), Backlinks, Forward Links,
 * Related Notes (when a note is active). All data from MCP tool calls.
 */

import { ItemView, WorkspaceLeaf, TFile, setIcon } from 'obsidian';
import type {
  FlywheelMcpClient,
  McpHealthCheckResponse,
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
    this.refresh();
  }

  refresh(): void {
    this.contentContainer.empty();

    if (!this.mcpClient.connected) {
      const empty = this.contentContainer.createDiv('flywheel-graph-empty');
      const icon = empty.createDiv('flywheel-graph-empty-icon');
      setIcon(icon, 'file-text');
      empty.createDiv('flywheel-graph-empty-text').setText('MCP server not connected');
      return;
    }

    // Always render vault info
    this.renderVaultInfo();

    // Render note sections if a note is active
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile) {
      this.renderNoteHeader(activeFile);
      this.renderNoteSections(activeFile);
    }
  }

  // ---------------------------------------------------------------------------
  // Vault Info section
  // ---------------------------------------------------------------------------

  private async renderVaultInfo(): Promise<void> {
    const section = this.renderSection('Vault Info', 'info', undefined, (container) => {
      // Show loading state
      const loadingEl = container.createDiv('flywheel-graph-info-row');
      loadingEl.createSpan('flywheel-graph-info-label').setText('Status');
      loadingEl.createSpan('flywheel-graph-info-value').setText('loading...');
    });

    // Fetch health data and replace section content
    try {
      const health = await this.mcpClient.healthCheck();
      const content = section.querySelector('.flywheel-graph-section-content') as HTMLDivElement;
      if (!content) return;
      content.empty();

      this.renderInfoRow(content, 'Status', health.status);
      this.renderInfoRow(content, 'Vault', health.vault_path);
      this.renderInfoRow(content, 'Notes', String(health.note_count));
      this.renderInfoRow(content, 'Entities', String(health.entity_count));
      this.renderInfoRow(content, 'Tags', String(health.tag_count));
      this.renderInfoRow(content, 'Index', health.index_state);

      if (health.last_rebuild) {
        const ago = health.last_rebuild.ago_seconds;
        const agoText = ago < 60 ? `${ago}s ago` : `${Math.floor(ago / 60)}m ago`;
        this.renderInfoRow(content, 'Last rebuild', `${agoText} (${health.last_rebuild.trigger})`);
      }

      // StateDb path
      this.renderInfoRow(content, 'StateDb', `${health.vault_path}/.flywheel/state.db`);

      // MCP server
      this.renderInfoRow(content, 'MCP server', 'connected');

      // Config values (if any)
      if (health.config && Object.keys(health.config).length > 0) {
        const configSection = content.createDiv('flywheel-graph-info-group');
        configSection.createDiv('flywheel-graph-info-group-label').setText('Config');
        for (const [key, value] of Object.entries(health.config)) {
          if (value != null) {
            this.renderInfoRow(configSection, key, String(value));
          }
        }
      }

      // Recommendations
      if (health.recommendations.length > 0) {
        const recSection = content.createDiv('flywheel-graph-info-group');
        recSection.createDiv('flywheel-graph-info-group-label').setText('Recommendations');
        for (const rec of health.recommendations) {
          const row = recSection.createDiv('flywheel-graph-info-row');
          row.createSpan('flywheel-graph-info-value flywheel-graph-info-warn').setText(rec);
        }
      }

      // Update section count badge with note count
      const countEl = section.querySelector('.flywheel-graph-section-count') as HTMLElement;
      if (countEl) {
        countEl.setText(`${health.note_count}`);
      }
    } catch (err) {
      const content = section.querySelector('.flywheel-graph-section-content') as HTMLDivElement;
      if (content) {
        content.empty();
        this.renderInfoRow(content, 'Error', err instanceof Error ? err.message : 'Failed to load');
      }
    }
  }

  private renderInfoRow(container: HTMLDivElement, label: string, value: string): void {
    const row = container.createDiv('flywheel-graph-info-row');
    row.createSpan('flywheel-graph-info-label').setText(label);
    row.createSpan('flywheel-graph-info-value').setText(value);
  }

  // ---------------------------------------------------------------------------
  // Note header + sections
  // ---------------------------------------------------------------------------

  private renderNoteHeader(file: TFile): void {
    const header = this.contentContainer.createDiv('flywheel-graph-header');
    header.createDiv('flywheel-graph-note-title').setText(file.basename);
  }

  private async renderNoteSections(file: TFile): Promise<void> {
    const notePath = file.path;

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
    }
  }

  // ---------------------------------------------------------------------------
  // Related notes
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Shared section renderer
  // ---------------------------------------------------------------------------

  private renderSection(
    title: string,
    icon: string,
    count: number | undefined,
    renderContent: (container: HTMLDivElement) => void
  ): HTMLDivElement {
    const section = this.contentContainer.createDiv('flywheel-graph-section');

    const headerEl = section.createDiv('flywheel-graph-section-header');
    headerEl.addEventListener('click', () => {
      section.toggleClass('is-collapsed', !section.hasClass('is-collapsed'));
    });

    const iconEl = headerEl.createSpan('flywheel-graph-section-icon');
    setIcon(iconEl, icon);
    headerEl.createSpan('flywheel-graph-section-title').setText(title);
    if (count !== undefined) {
      headerEl.createSpan('flywheel-graph-section-count').setText(`${count}`);
    }

    const chevron = headerEl.createSpan('flywheel-graph-section-chevron');
    setIcon(chevron, 'chevron-down');

    const content = section.createDiv('flywheel-graph-section-content');
    renderContent(content);

    return section;
  }

  async onClose(): Promise<void> {
    this.contentContainer?.empty();
  }
}
