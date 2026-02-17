/**
 * Connection Explorer Modal
 *
 * Lets the user pick two notes and shows how they're connected:
 * shortest link path, common neighbors, and connection strength.
 */

import { Modal, App, TFile } from 'obsidian';
import type {
  FlywheelMcpClient,
  McpLinkPathResponse,
  McpCommonNeighborsResponse,
  McpConnectionStrengthResponse,
} from '../mcp/client';

export class ConnectionExplorerModal extends Modal {
  private mcpClient: FlywheelMcpClient;
  private fromInput!: HTMLInputElement;
  private toInput!: HTMLInputElement;
  private resultsEl!: HTMLDivElement;
  private exploreBtn!: HTMLButtonElement;

  constructor(app: App, mcpClient: FlywheelMcpClient) {
    super(app);
    this.mcpClient = mcpClient;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('flywheel-connection-modal');

    // --- Input section ---
    const inputsEl = contentEl.createDiv('flywheel-connection-inputs');

    // From row
    const fromRow = inputsEl.createDiv('flywheel-connection-input-row');
    fromRow.createDiv({ cls: 'flywheel-connection-label', text: 'From' });
    const fromWrapper = fromRow.createDiv('flywheel-connection-input-wrapper');
    this.fromInput = fromWrapper.createEl('input', {
      type: 'text',
      placeholder: 'Start note...',
      cls: 'flywheel-connection-input',
    });

    // Pre-fill with active note
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile) {
      this.fromInput.value = activeFile.path;
    }

    this.setupAutocomplete(this.fromInput, fromWrapper);

    // To row
    const toRow = inputsEl.createDiv('flywheel-connection-input-row');
    toRow.createDiv({ cls: 'flywheel-connection-label', text: 'To' });
    const toWrapper = toRow.createDiv('flywheel-connection-input-wrapper');
    this.toInput = toWrapper.createEl('input', {
      type: 'text',
      placeholder: 'Target note...',
      cls: 'flywheel-connection-input',
    });
    this.setupAutocomplete(this.toInput, toWrapper);

    // Explore button
    this.exploreBtn = inputsEl.createEl('button', {
      text: 'Explore',
      cls: 'flywheel-connection-explore-btn',
    });
    this.exploreBtn.addEventListener('click', () => this.explore());

    // Allow Enter in inputs to trigger explore
    const onEnter = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.explore();
      }
    };
    this.fromInput.addEventListener('keydown', onEnter);
    this.toInput.addEventListener('keydown', onEnter);

    // --- Results section ---
    this.resultsEl = contentEl.createDiv('flywheel-connection-results');
    this.resultsEl.createDiv('flywheel-connection-empty').setText(
      'Select two notes and click Explore to see their connections.'
    );

    // Focus the "to" input if from is pre-filled, otherwise focus "from"
    if (activeFile) {
      this.toInput.focus();
    } else {
      this.fromInput.focus();
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }

  // ---------------------------------------------------------------------------
  // Autocomplete
  // ---------------------------------------------------------------------------

  private setupAutocomplete(input: HTMLInputElement, wrapper: HTMLDivElement): void {
    let suggestEl: HTMLDivElement | null = null;

    const hideSuggest = () => {
      if (suggestEl) {
        suggestEl.remove();
        suggestEl = null;
      }
    };

    const showSuggest = () => {
      hideSuggest();

      const query = input.value.trim().toLowerCase();
      if (!query) return;

      const files = this.app.vault.getMarkdownFiles();
      const matches = files
        .filter((f: TFile) => f.basename.toLowerCase().includes(query) || f.path.toLowerCase().includes(query))
        .slice(0, 8);

      if (matches.length === 0) return;

      suggestEl = wrapper.createDiv('flywheel-connection-suggest');
      for (const file of matches) {
        const item = suggestEl.createDiv('flywheel-connection-suggest-item');
        item.createDiv({ text: file.basename });
        if (file.path !== file.basename + '.md') {
          item.createDiv({ cls: 'flywheel-connection-suggest-path', text: file.path });
        }
        item.addEventListener('mousedown', (e) => {
          e.preventDefault(); // prevent input blur before we fill
          input.value = file.path;
          hideSuggest();
        });
      }
    };

    input.addEventListener('input', showSuggest);
    input.addEventListener('focus', showSuggest);
    input.addEventListener('blur', () => {
      // Small delay so mousedown on suggest item fires first
      setTimeout(hideSuggest, 150);
    });
  }

  // ---------------------------------------------------------------------------
  // Explore
  // ---------------------------------------------------------------------------

  private async explore(): Promise<void> {
    const from = this.fromInput.value.trim();
    const to = this.toInput.value.trim();

    if (!from || !to) return;

    if (!this.mcpClient.connected) {
      this.showError('MCP server not connected');
      return;
    }

    this.resultsEl.empty();
    this.resultsEl.createDiv('flywheel-connection-loading').setText('Analyzing connections...');
    this.exploreBtn.disabled = true;

    try {
      const [pathRes, neighborsRes, strengthRes] = await Promise.all([
        this.mcpClient.getLinkPath(from, to).catch(() => null),
        this.mcpClient.getCommonNeighbors(from, to).catch(() => null),
        this.mcpClient.getConnectionStrength(from, to).catch(() => null),
      ]);

      this.resultsEl.empty();
      this.renderPath(pathRes);
      this.renderNeighbors(neighborsRes);
      this.renderStrength(strengthRes);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection analysis failed';
      this.showError(msg);
    } finally {
      this.exploreBtn.disabled = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Render sections
  // ---------------------------------------------------------------------------

  private renderPath(res: McpLinkPathResponse | null): void {
    const section = this.resultsEl.createDiv('flywheel-connection-section');
    section.createDiv({ cls: 'flywheel-connection-section-title', text: 'Path' });

    if (!res) {
      section.createDiv({ cls: 'flywheel-connection-no-path', text: 'Could not determine link path.' });
      return;
    }

    if (!res.exists || res.path.length === 0) {
      section.createDiv({ cls: 'flywheel-connection-no-path', text: 'No link path found between these notes.' });
      return;
    }

    const pathEl = section.createDiv('flywheel-connection-path');
    res.path.forEach((note, i) => {
      if (i > 0) {
        pathEl.createSpan({ cls: 'flywheel-connection-path-arrow', text: '\u2192' });
      }
      const node = pathEl.createSpan({ cls: 'flywheel-connection-path-node' });
      node.setText(this.displayName(note));
      node.addEventListener('click', () => this.navigateTo(note));
    });

    const hops = res.path.length - 1;
    section.createDiv({
      cls: 'flywheel-connection-no-path', // reuse muted style for the count
      text: `${hops} hop${hops !== 1 ? 's' : ''}`,
    });
  }

  private renderNeighbors(res: McpCommonNeighborsResponse | null): void {
    const section = this.resultsEl.createDiv('flywheel-connection-section');
    section.createDiv({ cls: 'flywheel-connection-section-title', text: 'Common Neighbors' });

    if (!res) {
      section.createDiv({ cls: 'flywheel-connection-no-path', text: 'Could not determine common neighbors.' });
      return;
    }

    if (res.common_count === 0) {
      section.createDiv({ cls: 'flywheel-connection-no-path', text: 'No common neighbors found.' });
      return;
    }

    section.createDiv({
      cls: 'flywheel-connection-no-path',
      text: `${res.common_count} common neighbor${res.common_count !== 1 ? 's' : ''}`,
    });

    for (const neighbor of res.common_neighbors) {
      const el = section.createDiv('flywheel-connection-neighbor');
      el.setText(neighbor.title || this.displayName(neighbor.path));
      el.addEventListener('click', () => this.navigateTo(neighbor.path));
    }
  }

  private renderStrength(res: McpConnectionStrengthResponse | null): void {
    const section = this.resultsEl.createDiv('flywheel-connection-section');
    section.createDiv({ cls: 'flywheel-connection-section-title', text: 'Connection Strength' });

    if (!res) {
      section.createDiv({ cls: 'flywheel-connection-no-path', text: 'Could not determine connection strength.' });
      return;
    }

    section.createDiv({ cls: 'flywheel-connection-strength-score', text: String(res.score) });

    const factors = section.createDiv('flywheel-connection-factors');

    this.addFactor(factors, res.factors.mutual_link ? 'check' : 'x',
      `Mutual link: ${res.factors.mutual_link ? 'yes' : 'no'}`);

    if (res.factors.shared_tags.length > 0) {
      this.addFactor(factors, 'tag', `Shared tags: ${res.factors.shared_tags.join(', ')}`);
    } else {
      this.addFactor(factors, 'tag', 'Shared tags: none');
    }

    this.addFactor(factors, 'link', `Shared outlinks: ${res.factors.shared_outlinks}`);
    this.addFactor(factors, res.factors.same_folder ? 'folder' : 'folder-x',
      `Same folder: ${res.factors.same_folder ? 'yes' : 'no'}`);
  }

  private addFactor(container: HTMLDivElement, icon: string, text: string): void {
    const row = container.createDiv('flywheel-connection-factor');
    // Use a simple text icon instead of setIcon to avoid import issues
    const iconEl = row.createDiv('flywheel-connection-factor-icon');
    // Map to simple text indicators
    const iconMap: Record<string, string> = {
      'check': '\u2713',
      'x': '\u2717',
      'tag': '#',
      'link': '\u21c4',
      'folder': '\u{1F4C1}',
      'folder-x': '\u{1F4C2}',
    };
    iconEl.setText(iconMap[icon] ?? icon);
    row.createSpan({ text });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private showError(message: string): void {
    this.resultsEl.empty();
    this.resultsEl.createDiv({ cls: 'flywheel-connection-no-path', text: message });
  }

  private displayName(path: string): string {
    return path.replace(/\.md$/, '').split('/').pop() ?? path;
  }

  private navigateTo(path: string): void {
    this.close();
    this.app.workspace.openLinkText(path.replace(/\.md$/, ''), '', false);
  }
}
