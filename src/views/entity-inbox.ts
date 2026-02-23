/**
 * Entity Inbox: Review Queue for Pipeline Changes
 *
 * Card-based workflow presenting entities that need attention:
 * - Unlinked mentions: entities referenced in notes without [[wikilinks]]
 * - Merge candidates: similar entities that should be deduped
 */

import { ItemView, WorkspaceLeaf, TFile, setIcon, Notice } from 'obsidian';
import type { FlywheelMcpClient, McpUnlinkedMention } from '../mcp/client';

export const ENTITY_INBOX_VIEW_TYPE = 'flywheel-entity-inbox';

interface ReviewItem {
  type: 'unlinked' | 'merge';
  entity: string;
  entityPath?: string;
  category?: string;
  hubScore?: number;
  reason: string;
  /** For unlinked: notes where entity appears without [[]] */
  mentions?: McpUnlinkedMention[];
  /** For merge: the suggested merge target */
  mergeTarget?: { name: string; path: string; confidence: number };
}

export class EntityInboxView extends ItemView {
  private mcpClient: FlywheelMcpClient;
  onOpenEntityPage?: (name: string) => void;
  private queue: ReviewItem[] = [];
  private currentIndex = 0;

  constructor(leaf: WorkspaceLeaf, mcpClient: FlywheelMcpClient) {
    super(leaf);
    this.mcpClient = mcpClient;
  }

  getViewType(): string { return ENTITY_INBOX_VIEW_TYPE; }
  getDisplayText(): string { return 'Flywheel Inbox'; }
  getIcon(): string { return 'inbox'; }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('flywheel-entity-inbox');

    const loadingEl = container.createDiv('flywheel-inbox-loading');
    loadingEl.setText('Loading review items...');

    await this.buildQueue();
    loadingEl.remove();

    this.renderCurrentCard(container);
  }

  async onClose(): Promise<void> {}

  private async buildQueue(): Promise<void> {
    this.queue = [];

    // Source 1: Unlinked entities — get top entities by hub score, find unlinked mentions
    try {
      const entityIndex = await this.mcpClient.listEntities();
      // Flatten all categories into one list
      const allEntities = Object.entries(entityIndex)
        .filter(([key]) => key !== '_metadata')
        .flatMap(([, items]) => (items as Array<{ name: string; path: string; aliases: string[]; hubScore?: number }>));

      // Sort by hubScore descending, take top 15 candidates
      const candidates = allEntities
        .filter(e => e.name && e.path)
        .sort((a, b) => (b.hubScore ?? 0) - (a.hubScore ?? 0))
        .slice(0, 15);

      // Fetch unlinked mentions in parallel
      const mentionResults = await Promise.allSettled(
        candidates.map(e => this.mcpClient.getUnlinkedMentions(e.name, 5))
      );

      for (let i = 0; i < candidates.length; i++) {
        const result = mentionResults[i];
        if (result.status !== 'fulfilled') continue;
        const resp = result.value;
        if (!resp.mentions || resp.mention_count === 0) continue;

        const entity = candidates[i];
        this.queue.push({
          type: 'unlinked',
          entity: entity.name,
          entityPath: entity.path,
          reason: `Mentioned in ${resp.mention_count} note${resp.mention_count !== 1 ? 's' : ''} without [[wikilinks]]`,
          mentions: resp.mentions.slice(0, 5),
        });
      }
    } catch (err) {
      console.error('Flywheel Inbox: failed to fetch unlinked entities', err);
    }

    // Source 2: Merge candidates
    try {
      const merges = await this.mcpClient.suggestEntityMerges(10);
      for (const s of merges.suggestions ?? []) {
        this.queue.push({
          type: 'merge',
          entity: s.source.name,
          entityPath: s.source.path,
          category: s.source.category,
          hubScore: s.source.hubScore,
          reason: `Similar to "${s.target.name}" (${Math.round(s.confidence * 100)}% match) — ${s.reason}`,
          mergeTarget: { name: s.target.name, path: s.target.path, confidence: s.confidence },
        });
      }
    } catch (err) {
      console.error('Flywheel Inbox: failed to fetch merge suggestions', err);
    }

    this.currentIndex = 0;
  }

  private renderCurrentCard(container: HTMLElement): void {
    container.querySelector('.flywheel-inbox-card')?.remove();
    container.querySelector('.flywheel-inbox-empty')?.remove();

    if (this.currentIndex >= this.queue.length) {
      this.renderEmptyState(container);
      return;
    }

    const item = this.queue[this.currentIndex];

    // Progress indicator
    let progressEl = container.querySelector('.flywheel-inbox-progress') as HTMLElement | null;
    if (!progressEl) {
      progressEl = container.createDiv('flywheel-inbox-progress');
    }
    progressEl.setText(`${this.currentIndex + 1} of ${this.queue.length}`);

    const card = container.createDiv('flywheel-inbox-card');

    // Header: entity name + metadata badges
    const header = card.createDiv('flywheel-inbox-card-header');
    const nameEl = header.createDiv('flywheel-inbox-entity-name');
    nameEl.setText(item.entity);
    if (this.onOpenEntityPage) {
      nameEl.addClass('flywheel-inbox-entity-name-link');
      nameEl.addEventListener('click', () => this.onOpenEntityPage!(item.entity));
    }
    if (item.category) {
      header.createSpan('flywheel-inbox-category-badge').setText(item.category);
    }
    if (item.hubScore && item.hubScore > 0) {
      const hubEl = header.createSpan('flywheel-inbox-hub-badge');
      const iconSpan = hubEl.createSpan();
      setIcon(iconSpan, 'git-fork');
      hubEl.createSpan().setText(` ${item.hubScore}`);
    }
    const typeBadge = header.createSpan(`flywheel-inbox-type-badge flywheel-inbox-type-${item.type}`);
    typeBadge.setText(item.type === 'unlinked' ? 'unlinked' : 'merge');

    // Reason
    card.createDiv('flywheel-inbox-reason').setText(item.reason);

    // Context: mention list for unlinked items
    if (item.mentions && item.mentions.length > 0) {
      const mentionsEl = card.createDiv('flywheel-inbox-mentions');
      mentionsEl.createDiv('flywheel-inbox-mentions-label').setText('Found in:');
      for (const m of item.mentions) {
        const mentionRow = mentionsEl.createDiv('flywheel-inbox-mention');
        const noteLink = mentionRow.createSpan('flywheel-inbox-mention-path');
        noteLink.setText(m.path.replace(/\.md$/, '').split('/').pop() || m.path);
        noteLink.addEventListener('click', () => this.app.workspace.openLinkText(m.path, '', false));
        if (m.context) {
          mentionRow.createDiv('flywheel-inbox-mention-context').setText(m.context);
        }
      }
    }

    // Action buttons
    const actions = card.createDiv('flywheel-inbox-actions');

    if (item.type === 'unlinked') {
      const count = item.mentions?.length ?? 0;
      const linkBtn = actions.createEl('button', {
        cls: 'flywheel-inbox-action-primary',
        text: `Link in ${count} note${count !== 1 ? 's' : ''}`,
      });
      linkBtn.addEventListener('click', async () => {
        linkBtn.disabled = true;
        linkBtn.setText('Linking...');

        let linked = 0;
        for (const mention of item.mentions ?? []) {
          try {
            const file = this.app.vault.getAbstractFileByPath(mention.path);
            if (file instanceof TFile) {
              await this.app.vault.process(file, (content) => {
                const escaped = item.entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const pattern = new RegExp(`(?<!\\[\\[)\\b${escaped}\\b(?!\\]\\])`, 'i');
                const newContent = content.replace(pattern, `[[${item.entity}]]`);
                if (newContent !== content) { linked++; return newContent; }
                return content;
              });
            }
          } catch (err) {
            console.error(`Flywheel Inbox: failed to link in ${mention.path}`, err);
          }
        }

        new Notice(`Linked "${item.entity}" in ${linked} note${linked !== 1 ? 's' : ''}`);
        this.advance(container);
      });

      const skipBtn = actions.createEl('button', {
        cls: 'flywheel-inbox-action-skip',
        text: 'Skip',
      });
      skipBtn.addEventListener('click', () => this.advance(container));
    }

    if (item.type === 'merge' && item.mergeTarget) {
      const target = item.mergeTarget;

      const mergeBtn = actions.createEl('button', {
        cls: 'flywheel-inbox-action-primary',
        text: `Merge into "${target.name}"`,
      });
      mergeBtn.addEventListener('click', async () => {
        mergeBtn.disabled = true;
        mergeBtn.setText('Merging...');
        try {
          await this.mcpClient.mergeEntities(item.entityPath!, target.path);
          new Notice(`Merged "${item.entity}" into "${target.name}"`);
        } catch (err) {
          new Notice(`Merge failed: ${err instanceof Error ? err.message : 'unknown'}`);
          mergeBtn.disabled = false;
          mergeBtn.setText(`Merge into "${target.name}"`);
          return;
        }
        this.advance(container);
      });

      const dismissBtn = actions.createEl('button', {
        cls: 'flywheel-inbox-action-skip',
        text: 'Not the same',
      });
      dismissBtn.addEventListener('click', async () => {
        try {
          await this.mcpClient.dismissMergeSuggestion(
            item.entityPath!,
            target.path,
            item.entity,
            target.name,
            'user dismissed from inbox'
          );
        } catch { /* fire and forget */ }
        this.advance(container);
      });
    }
  }

  private renderEmptyState(container: HTMLElement): void {
    container.querySelector('.flywheel-inbox-progress')?.remove();

    const empty = container.createDiv('flywheel-inbox-empty');
    const iconEl = empty.createDiv('flywheel-inbox-empty-icon');
    setIcon(iconEl, 'check-circle');
    empty.createDiv('flywheel-inbox-empty-text').setText("You're caught up!");
    empty.createDiv('flywheel-inbox-empty-sub').setText('No entities need review right now.');
  }

  private advance(container: HTMLElement): void {
    this.currentIndex++;
    this.renderCurrentCard(container);
  }
}
