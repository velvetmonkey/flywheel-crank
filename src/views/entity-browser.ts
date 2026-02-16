/**
 * Entity Browser View
 *
 * Shows all extracted entities grouped by 8 categories
 * with search/filter, hub scores, and click-to-navigate.
 */

import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type { EntityIndex, EntityCategory, EntityWithAliases, Entity } from '../core/types';

export const ENTITY_BROWSER_VIEW_TYPE = 'flywheel-entity-browser';

const CATEGORY_ICONS: Record<EntityCategory, string> = {
  technologies: 'cpu',
  acronyms: 'hash',
  people: 'user',
  projects: 'folder-kanban',
  organizations: 'building',
  locations: 'map-pin',
  concepts: 'lightbulb',
  other: 'circle-dot',
};

const CATEGORY_LABELS: Record<EntityCategory, string> = {
  technologies: 'Technologies',
  acronyms: 'Acronyms',
  people: 'People',
  projects: 'Projects',
  organizations: 'Organizations',
  locations: 'Locations',
  concepts: 'Concepts',
  other: 'Other',
};

export class EntityBrowserView extends ItemView {
  private entityIndex: EntityIndex | null = null;
  private filterText = '';

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return ENTITY_BROWSER_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Flywheel Entities';
  }

  getIcon(): string {
    return 'tags';
  }

  setEntityIndex(index: EntityIndex): void {
    this.entityIndex = index;
    this.render();
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  private render(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('flywheel-entity-browser');

    if (!this.entityIndex) {
      const empty = container.createDiv('flywheel-entity-empty');
      setIcon(empty.createDiv(), 'loader');
      empty.createDiv().setText('Building entity index...');
      return;
    }

    // Header with stats and filter
    const header = container.createDiv('flywheel-entity-header');
    const statsEl = header.createDiv('flywheel-entity-stats');
    statsEl.setText(`${this.entityIndex._metadata.total_entities} entities`);

    const filterInput = header.createEl('input', {
      type: 'text',
      placeholder: 'Filter entities...',
      cls: 'flywheel-entity-filter',
      value: this.filterText,
    });

    filterInput.addEventListener('input', () => {
      this.filterText = filterInput.value;
      this.renderCategories(content);
    });

    const content = container.createDiv('flywheel-entity-content');
    this.renderCategories(content);
  }

  private renderCategories(container: HTMLDivElement): void {
    container.empty();
    if (!this.entityIndex) return;

    const categories: EntityCategory[] = [
      'technologies', 'acronyms', 'people', 'projects',
      'organizations', 'locations', 'concepts', 'other',
    ];

    const filterLower = this.filterText.toLowerCase();

    for (const category of categories) {
      const entities = this.entityIndex[category] as Entity[];
      if (!entities?.length) continue;

      // Filter entities
      const filtered = filterLower
        ? entities.filter(e => {
            const name = typeof e === 'string' ? e : e.name;
            const aliases = typeof e === 'string' ? [] : e.aliases;
            return name.toLowerCase().includes(filterLower) ||
                   aliases.some(a => a.toLowerCase().includes(filterLower));
          })
        : entities;

      if (filtered.length === 0) continue;

      const section = container.createDiv('flywheel-entity-section');

      // Section header
      const headerEl = section.createDiv('flywheel-entity-section-header');
      headerEl.addEventListener('click', () => {
        section.toggleClass('is-collapsed', !section.hasClass('is-collapsed'));
      });

      const iconEl = headerEl.createSpan('flywheel-entity-section-icon');
      setIcon(iconEl, CATEGORY_ICONS[category]);

      headerEl.createSpan('flywheel-entity-section-title').setText(CATEGORY_LABELS[category]);
      headerEl.createSpan('flywheel-entity-section-count').setText(`${filtered.length}`);

      const chevron = headerEl.createSpan('flywheel-entity-section-chevron');
      setIcon(chevron, 'chevron-down');

      // Entity items
      const listEl = section.createDiv('flywheel-entity-list');

      for (const entity of filtered) {
        const obj: EntityWithAliases = typeof entity === 'string'
          ? { name: entity, path: '', aliases: [] }
          : entity;

        const item = listEl.createDiv('flywheel-entity-item');

        if (obj.path) {
          item.addEventListener('click', () => {
            this.app.workspace.openLinkText(obj.path, '', false);
          });
          item.addClass('flywheel-entity-clickable');
        }

        const nameEl = item.createDiv('flywheel-entity-name');
        nameEl.setText(obj.name);

        const meta = item.createDiv('flywheel-entity-meta');

        if (obj.aliases.length > 0) {
          const aliasEl = meta.createSpan('flywheel-entity-aliases');
          aliasEl.setText(obj.aliases.join(', '));
        }

        if (obj.hubScore && obj.hubScore > 0) {
          const hubEl = meta.createSpan('flywheel-entity-hub-badge');
          const hubIcon = hubEl.createSpan();
          setIcon(hubIcon, 'link');
          hubEl.createSpan().setText(`${obj.hubScore}`);
        }
      }
    }
  }

  async onClose(): Promise<void> {
    // Cleanup
  }
}
