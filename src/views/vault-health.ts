/**
 * Vault Health Diagnostics View
 *
 * Shows orphan notes, dead links, hub notes, stale notes,
 * and entity coverage statistics.
 */

import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type { VaultIndex, EntityIndex } from '../core/types';
import {
  findOrphanNotes,
  findHubNotes,
  findDeadLinks,
  findStaleNotes,
} from '../index/vault-index';

export const VAULT_HEALTH_VIEW_TYPE = 'flywheel-vault-health';

export class VaultHealthView extends ItemView {
  private index: VaultIndex | null = null;
  private entityIndex: EntityIndex | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return VAULT_HEALTH_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Vault Health';
  }

  getIcon(): string {
    return 'heart-pulse';
  }

  setData(index: VaultIndex, entityIndex: EntityIndex | null): void {
    this.index = index;
    this.entityIndex = entityIndex;
    this.render();
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  private render(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('flywheel-vault-health');

    if (!this.index) {
      const empty = container.createDiv('flywheel-health-empty');
      setIcon(empty.createDiv(), 'loader');
      empty.createDiv().setText('Building index...');
      return;
    }

    // Overview stats
    const statsBar = container.createDiv('flywheel-health-stats-bar');
    this.renderStat(statsBar, 'file-text', `${this.index.notes.size}`, 'Notes');
    this.renderStat(statsBar, 'link', `${this.index.entities.size}`, 'Entities');
    this.renderStat(statsBar, 'tag', `${this.index.tags.size}`, 'Tags');
    if (this.entityIndex) {
      this.renderStat(statsBar, 'tags', `${this.entityIndex._metadata.total_entities}`, 'Indexed');
    }

    const content = container.createDiv('flywheel-health-content');

    // Orphan notes
    const orphans = findOrphanNotes(this.index);
    this.renderCollapsibleSection(content, 'Orphan Notes', 'unlink', orphans.length, (el) => {
      if (orphans.length === 0) {
        el.createDiv('flywheel-health-empty-msg').setText('No orphans found');
        return;
      }
      for (const orphan of orphans.slice(0, 30)) {
        const item = el.createDiv('flywheel-health-item flywheel-health-clickable');
        item.addEventListener('click', () => this.app.workspace.openLinkText(orphan.path, '', false));

        item.createDiv('flywheel-health-item-title').setText(orphan.title);
        const folder = orphan.path.split('/').slice(0, -1).join('/');
        if (folder) item.createDiv('flywheel-health-item-path').setText(folder);
      }
      if (orphans.length > 30) {
        el.createDiv('flywheel-health-more').setText(`+${orphans.length - 30} more`);
      }
    });

    // Dead links
    const deadLinks = findDeadLinks(this.index);
    this.renderCollapsibleSection(content, 'Dead Links', 'link-2-off', deadLinks.length, (el) => {
      if (deadLinks.length === 0) {
        el.createDiv('flywheel-health-empty-msg').setText('No dead links');
        return;
      }
      for (const dead of deadLinks.slice(0, 30)) {
        const item = el.createDiv('flywheel-health-item flywheel-health-clickable');
        item.addEventListener('click', () => this.app.workspace.openLinkText(dead.source, '', false));

        const row = item.createDiv('flywheel-health-dead-row');
        row.createSpan('flywheel-health-dead-source').setText(
          dead.source.replace(/\.md$/, '').split('/').pop() || dead.source
        );
        row.createSpan('flywheel-health-dead-arrow').setText(' → ');
        row.createSpan('flywheel-health-dead-target').setText(dead.target);
      }
      if (deadLinks.length > 30) {
        el.createDiv('flywheel-health-more').setText(`+${deadLinks.length - 30} more`);
      }
    });

    // Hub notes
    const hubs = findHubNotes(this.index, 5);
    this.renderCollapsibleSection(content, 'Hub Notes', 'network', hubs.length, (el) => {
      if (hubs.length === 0) {
        el.createDiv('flywheel-health-empty-msg').setText('No hub notes found');
        return;
      }
      for (const hub of hubs.slice(0, 20)) {
        const item = el.createDiv('flywheel-health-item flywheel-health-clickable');
        item.addEventListener('click', () => this.app.workspace.openLinkText(hub.path, '', false));

        const titleRow = item.createDiv('flywheel-health-hub-row');
        titleRow.createDiv('flywheel-health-item-title').setText(hub.title);

        const badges = titleRow.createDiv('flywheel-health-badges');
        const inBadge = badges.createSpan('flywheel-health-badge flywheel-health-badge-in');
        inBadge.setText(`← ${hub.backlink_count}`);
        const outBadge = badges.createSpan('flywheel-health-badge flywheel-health-badge-out');
        outBadge.setText(`→ ${hub.forward_link_count}`);
      }
    });

    // Stale notes
    const stale = findStaleNotes(this.index, 20);
    this.renderCollapsibleSection(content, 'Stale Notes', 'clock', stale.length, (el) => {
      if (stale.length === 0) {
        el.createDiv('flywheel-health-empty-msg').setText('No stale notes');
        return;
      }
      for (const note of stale) {
        const item = el.createDiv('flywheel-health-item flywheel-health-clickable');
        item.addEventListener('click', () => this.app.workspace.openLinkText(note.path, '', false));

        item.createDiv('flywheel-health-item-title').setText(note.title);
        item.createDiv('flywheel-health-item-age').setText(`${note.daysSinceModified} days ago`);
      }
    });
  }

  private renderStat(container: HTMLDivElement, icon: string, value: string, label: string): void {
    const stat = container.createDiv('flywheel-health-stat');
    const iconEl = stat.createDiv('flywheel-health-stat-icon');
    setIcon(iconEl, icon);
    stat.createDiv('flywheel-health-stat-value').setText(value);
    stat.createDiv('flywheel-health-stat-label').setText(label);
  }

  private renderCollapsibleSection(
    container: HTMLDivElement,
    title: string,
    icon: string,
    count: number,
    renderContent: (el: HTMLDivElement) => void
  ): void {
    const section = container.createDiv('flywheel-health-section');

    const header = section.createDiv('flywheel-health-section-header');
    header.addEventListener('click', () => {
      section.toggleClass('is-collapsed', !section.hasClass('is-collapsed'));
    });

    const iconEl = header.createSpan('flywheel-health-section-icon');
    setIcon(iconEl, icon);
    header.createSpan('flywheel-health-section-title').setText(title);

    const countBadge = header.createSpan('flywheel-health-section-count');
    countBadge.setText(`${count}`);
    if (count > 0 && (title === 'Dead Links' || title === 'Orphan Notes')) {
      countBadge.addClass('flywheel-health-count-warn');
    }

    const chevron = header.createSpan('flywheel-health-section-chevron');
    setIcon(chevron, 'chevron-down');

    const content = section.createDiv('flywheel-health-section-content');
    renderContent(content);
  }

  async onClose(): Promise<void> {
    // Cleanup
  }
}
