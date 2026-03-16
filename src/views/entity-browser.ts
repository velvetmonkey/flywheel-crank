/**
 * Entity Browser View
 *
 * Shows all extracted entities grouped by 17 categories
 * with search/filter, hub scores, and click-to-navigate.
 * Fetches data via MCP list_entities tool.
 *
 * Features:
 * - Bulk re-categorize (select multiple entities, move to another category)
 * - Merge suggestions (find duplicate entities and merge them)
 */

import { ItemView, WorkspaceLeaf, setIcon, setTooltip, Notice } from 'obsidian';
import type { EntityCategory, EntityWithAliases } from '../core/types';
import type { FlywheelMcpClient, McpEntityIndexResponse, McpEntityItem, McpMergeSuggestion } from '../mcp/client';

export const ENTITY_BROWSER_VIEW_TYPE = 'flywheel-entity-browser';

const CATEGORY_ICONS: Record<EntityCategory, string> = {
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
  animals: 'Animals',
  media: 'Media',
  events: 'Events',
  documents: 'Documents',
  vehicles: 'Vehicles',
  health: 'Health',
  finance: 'Finance',
  food: 'Food',
  hobbies: 'Hobbies',
  other: 'Other',
};

const ALL_CATEGORIES: EntityCategory[] = [
  'acronyms', 'animals', 'concepts', 'documents', 'events',
  'finance', 'food', 'health', 'hobbies', 'locations',
  'media', 'organizations', 'people', 'projects', 'technologies',
  'vehicles',
  'other',
];

const CATEGORY_HINTS: Record<EntityCategory, string> = {
  people: 'Exactly two capitalized words (name pattern), or frontmatter type: person/contact/friend/colleague/family',
  technologies: 'Name contains a tech keyword (react, python, docker, etc.), or frontmatter type: tool/technology/framework',
  acronyms: 'All uppercase, 2-6 characters',
  organizations: 'Ends with org suffix (inc, corp, llc, ltd, team, group, co, company), or frontmatter type: company/org/team',
  locations: 'Contains location keyword (city, county, region) or region pattern (eu, apac, emea), or frontmatter type: place/location/city/country',
  concepts: 'Multi-word, all lowercase, or frontmatter type: concept/idea/topic',
  projects: 'Multi-word name (fallback after other checks), or frontmatter type: project',
  animals: 'Frontmatter type: animal/pet/horse/dog/cat/bird/fish',
  media: 'Frontmatter type: movie/book/show/game/music/album/podcast/series',
  events: 'Frontmatter type: event/meeting/conference/trip/holiday/milestone',
  documents: 'Frontmatter type: document/report/guide/reference/template/note',
  vehicles: 'Frontmatter type: vehicle/car/bike/boat/motorcycle',
  health: 'Frontmatter type: health/medical/fitness/condition/wellness',
  finance: 'Frontmatter type: finance/account/investment/budget/bank',
  food: 'Frontmatter type: food/recipe/restaurant/meal/ingredient/drink',
  hobbies: 'Frontmatter type: hobby/sport/craft/activity/collection',
  other: 'Single word, no pattern matched — default fallback',
};

const TECH_KEYWORDS = new Set([
  'databricks', 'api', 'code', 'azure', 'sql', 'git',
  'node', 'react', 'powerbi', 'excel', 'copilot',
  'fabric', 'apim', 'endpoint', 'synology', 'tailscale',
  'obsidian', 'claude', 'powershell', 'mcp', 'typescript',
  'javascript', 'python', 'docker', 'kubernetes',
  'adf', 'adb', 'net', 'aws', 'gcp', 'terraform',
  'chatgpt', 'langchain', 'openai', 'huggingface', 'pytorch', 'tensorflow',
  'anthropic', 'llm', 'embedding', 'vector', 'rag', 'prompt', 'agent',
  'transformer', 'ollama', 'gemini',
  'swift', 'kotlin', 'rust', 'golang', 'elixir', 'scala', 'julia',
  'ruby', 'php', 'csharp',
  'ansible', 'nginx', 'redis', 'postgres', 'mongodb', 'graphql', 'grpc', 'kafka',
]);

const ORG_SUFFIXES = ['inc', 'corp', 'llc', 'ltd', 'team', 'group', 'co', 'company'];
const LOCATION_KEYWORDS = ['city', 'county', 'region', 'district', 'province'];
const REGION_PATTERNS = ['eu', 'apac', 'emea', 'latam', 'amer'];

function getEntityCategoryReason(name: string, category: EntityCategory): string {
  const nameLower = name.toLowerCase();
  const words = name.split(/\s+/);

  switch (category) {
    case 'technologies': {
      const matched = nameLower.split(/[\s\-_./]+/).find(w => TECH_KEYWORDS.has(w));
      return matched ? `Tech keyword: "${matched}"` : 'Tech keyword match';
    }
    case 'acronyms':
      return `All uppercase, ${name.length} chars`;
    case 'organizations': {
      const lastWord = words[words.length - 1].toLowerCase();
      return ORG_SUFFIXES.includes(lastWord)
        ? `Org suffix: "${lastWord}"`
        : 'Frontmatter type declaration';
    }
    case 'locations': {
      const lastWord = words[words.length - 1].toLowerCase();
      if (LOCATION_KEYWORDS.includes(lastWord)) return `Location keyword: "${lastWord}"`;
      if (REGION_PATTERNS.includes(nameLower)) return `Region pattern: "${nameLower}"`;
      return 'Frontmatter type declaration';
    }
    case 'people':
      return words.length === 2 ? 'Two capitalized words' : 'Frontmatter type declaration';
    case 'concepts':
      return words.length >= 2 && name === nameLower ? 'Multi-word lowercase' : 'Frontmatter type declaration';
    case 'projects':
      return words.length >= 2 ? 'Multi-word (fallback)' : 'Frontmatter type declaration';
    case 'animals':
    case 'media':
    case 'events':
    case 'documents':
    case 'vehicles':
    case 'health':
    case 'finance':
    case 'food':
    case 'hobbies':
      return 'Frontmatter type declaration';
    case 'other':
      return 'Single word, no pattern match';
    default:
      return '';
  }
}

/**
 * Map from EntityCategory → canonical frontmatter `type` value.
 * Used when correcting a miscategorized entity.
 */
const CATEGORY_TO_FRONTMATTER_TYPE: Record<EntityCategory, string> = {
  technologies: 'technology',
  acronyms: 'acronym',
  people: 'person',
  projects: 'project',
  organizations: 'organization',
  locations: 'location',
  concepts: 'concept',
  animals: 'animal',
  media: 'media',
  events: 'event',
  documents: 'document',
  vehicles: 'vehicle',
  health: 'health',
  finance: 'finance',
  food: 'food',
  hobbies: 'hobby',
  other: 'other',
};

export class EntityBrowserView extends ItemView {
  private mcpClient: FlywheelMcpClient;
  onOpenEntityPage?: (name: string) => void;
  private entityData: McpEntityIndexResponse | null = null;
  private filterText = '';
  private totalEntities = 0;
  /** Categories the user has expanded (all start collapsed). */
  private expandedCategories = new Set<EntityCategory>();
  /** Active category picker element (if any). */
  private activePicker: HTMLElement | null = null;

  // Bulk selection state — cross-category (no explicit mode, checkboxes always visible)
  private selectedEntities = new Map<string, { entity: McpEntityItem; fromCategory: EntityCategory }>();
  private bulkProgress: { total: number; done: number } | null = null;

  // Merge suggestions state
  private mergeSuggestions: McpMergeSuggestion[] | null = null;
  private mergeExpanded = false;
  private mergeLoading = false;

  constructor(leaf: WorkspaceLeaf, mcpClient: FlywheelMcpClient) {
    super(leaf);
    this.mcpClient = mcpClient;
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

  async onOpen(): Promise<void> {
    this.register(this.mcpClient.onConnectionStateChange(() => this.render()));
    this.register(this.mcpClient.onPipelineComplete(() => this.fetchEntities()));
    this.render();
    await this.fetchEntities();
  }

  private async fetchEntities(): Promise<void> {
    if (!this.mcpClient.connected) {
      this.render();
      const poll = setInterval(async () => {
        if (this.mcpClient.connected) {
          clearInterval(poll);
          await this.fetchEntities();
        }
      }, 2000);
      return;
    }

    try {
      this.entityData = await this.mcpClient.listEntities();
      this.totalEntities = this.entityData._metadata?.total_entities ?? 0;
    } catch (err) {
      console.error('Flywheel Entities: failed to fetch entities', err);
      this.entityData = null;
      // Retry after delay (index may still be building)
      setTimeout(() => this.fetchEntities(), 5000);
    }

    this.render();
  }

  private render(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('flywheel-entity-browser');

    if (!this.entityData) {
      this.renderSplash(container,
        this.mcpClient.connected ? 'Loading entities...' : 'Connecting to flywheel-memory...'
      );
      return;
    }

    // Header with stats and filter
    const header = container.createDiv('flywheel-entity-header');
    const statsEl = header.createDiv('flywheel-entity-stats');
    statsEl.setText(`${this.totalEntities} entities`);

    const statsInfo = header.createSpan('flywheel-graph-section-info');
    setIcon(statsInfo, 'info');
    setTooltip(statsInfo,
      'Entities are people, technologies, organizations, and other named concepts extracted from your notes. ' +
      'They\'re grouped by category with hub scores showing how connected each entity is.');
    statsInfo.addEventListener('click', (e) => e.stopPropagation());

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
    if (!this.entityData) return;

    // Global selection action bar (sticky at top when entities selected)
    if (this.selectedEntities.size > 0 || this.bulkProgress) {
      this.renderGlobalActionBar(container);
    }

    // Merge suggestions section (at the top)
    this.renderMergeSuggestions(container);

    const filterLower = this.filterText.toLowerCase();

    for (const category of ALL_CATEGORIES) {
      const entities = (this.entityData as any)[category] as McpEntityItem[] | undefined;
      if (!entities?.length) continue;

      // Filter entities
      const filtered = filterLower
        ? entities.filter(e => {
            return e.name.toLowerCase().includes(filterLower) ||
                   (e.aliases ?? []).some(a => a.toLowerCase().includes(filterLower));
          })
        : entities;

      if (filtered.length === 0) continue;

      const isCollapsed = !this.expandedCategories.has(category);
      const hasSelection = this.selectedEntities.size > 0;
      // Count how many from this category are selected
      const categorySelectedCount = filtered.filter(e => e.path && this.selectedEntities.has(e.path)).length;
      const section = container.createDiv(`flywheel-entity-section${isCollapsed ? ' is-collapsed' : ''}`);
      section.dataset.category = category;

      // Section header
      const headerEl = section.createDiv('flywheel-entity-section-header');
      headerEl.addEventListener('click', () => {
        const nowCollapsed = !section.hasClass('is-collapsed');
        section.toggleClass('is-collapsed', nowCollapsed);
        if (nowCollapsed) {
          this.expandedCategories.delete(category);
        } else {
          this.expandedCategories.add(category);
        }
      });

      setTooltip(headerEl, CATEGORY_HINTS[category]);

      const iconEl = headerEl.createSpan('flywheel-entity-section-icon');
      setIcon(iconEl, CATEGORY_ICONS[category]);

      headerEl.createSpan('flywheel-entity-section-title').setText(CATEGORY_LABELS[category]);
      headerEl.createSpan('flywheel-entity-section-count').setText(`${filtered.length}`);

      // Select-all toggle for this category (shown when any selection exists)
      if (hasSelection) {
        const selectAllBtn = headerEl.createSpan('flywheel-entity-select-btn flywheel-entity-select-btn-active');
        const allInCatSelected = filtered.every(e => !e.path || this.selectedEntities.has(e.path));
        setIcon(selectAllBtn, allInCatSelected ? 'check-square' : 'square');
        setTooltip(selectAllBtn, allInCatSelected ? 'Deselect all in this category' : 'Select all in this category');
        if (categorySelectedCount > 0) {
          selectAllBtn.createSpan('flywheel-entity-select-btn-count').setText(`${categorySelectedCount}`);
        }
        selectAllBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (allInCatSelected) {
            for (const ent of filtered) {
              if (ent.path) this.selectedEntities.delete(ent.path);
            }
          } else {
            for (const ent of filtered) {
              if (ent.path) this.selectedEntities.set(ent.path, { entity: ent, fromCategory: category });
            }
          }
          this.render();
        });
      }

      const chevron = headerEl.createSpan('flywheel-entity-section-chevron');
      setIcon(chevron, 'chevron-down');

      // Entity items — always show checkboxes, keep column layout
      const listEl = section.createDiv('flywheel-entity-list');

      for (const entity of filtered) {
        const isSelected = !!(entity.path && this.selectedEntities.has(entity.path));
        const item = listEl.createDiv('flywheel-entity-item');
        if (isSelected) item.addClass('is-selected');
        setTooltip(item, getEntityCategoryReason(entity.name, category));

        if (entity.path) {
          item.addEventListener('click', () => {
            if (this.onOpenEntityPage) {
              this.onOpenEntityPage(entity.name);
            } else {
              this.app.workspace.openLinkText(entity.path, '', false);
            }
          });
          item.addClass('flywheel-entity-clickable');
        }

        const nameRow = item.createDiv('flywheel-entity-name-row');

        // Checkbox — always visible on every entity with a path
        if (entity.path) {
          const checkbox = nameRow.createDiv('flywheel-entity-checkbox');
          if (isSelected) {
            checkbox.addClass('is-checked');
            const checkIcon = checkbox.createSpan();
            setIcon(checkIcon, 'check');
          }
          checkbox.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!entity.path) return;
            if (this.selectedEntities.has(entity.path)) {
              this.selectedEntities.delete(entity.path);
            } else {
              this.selectedEntities.set(entity.path, { entity, fromCategory: category });
            }
            this.render();
          });
        }

        const nameEl = nameRow.createDiv('flywheel-entity-name');
        nameEl.setText(entity.name);

        // Category action buttons (hidden when entities are selected to reduce clutter)
        if (entity.path && !hasSelection) {
          const actions = nameRow.createDiv('flywheel-entity-actions');

          // Move to "other" (uncategorize) — only shown if not already in "other"
          if (category !== 'other') {
            const otherBtn = actions.createSpan('flywheel-entity-correct-btn');
            setIcon(otherBtn, 'circle-dot');
            setTooltip(otherBtn, 'Move to "Other" — uncategorize this entity');
            otherBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              this.dismissPicker();
              this.correctEntityCategory(entity, category, 'other');
            });
          }

          const correctBtn = actions.createSpan('flywheel-entity-correct-btn');
          setIcon(correctBtn, 'arrow-left-right');
          setTooltip(correctBtn, 'Change this entity\'s category');
          correctBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showCategoryPicker(entity, category, correctBtn);
          });
        }

        const meta = item.createDiv('flywheel-entity-meta');

        if (entity.aliases && entity.aliases.length > 0) {
          const aliasEl = meta.createSpan('flywheel-entity-aliases');
          aliasEl.setText(entity.aliases.join(', '));
        }

        if (entity.hubScore && entity.hubScore > 0) {
          const hubEl = meta.createSpan('flywheel-entity-hub-badge');
          setTooltip(hubEl, `${entity.hubScore} connections (incoming + outgoing links)`);
          hubEl.dataset.category = category;
          const hubIcon = hubEl.createSpan();
          setIcon(hubIcon, 'link');
          hubEl.createSpan().setText(`${entity.hubScore}`);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Merge Suggestions
  // ---------------------------------------------------------------------------

  private renderMergeSuggestions(container: HTMLDivElement): void {
    const section = container.createDiv(`flywheel-merge-section${this.mergeExpanded ? '' : ' is-collapsed'}`);

    const headerEl = section.createDiv('flywheel-merge-header');
    headerEl.addEventListener('click', () => {
      this.mergeExpanded = !this.mergeExpanded;
      section.toggleClass('is-collapsed', !this.mergeExpanded);
      // Load suggestions on first expand
      if (this.mergeExpanded && this.mergeSuggestions === null && !this.mergeLoading) {
        this.loadMergeSuggestions(section);
      }
    });

    const iconEl = headerEl.createSpan('flywheel-merge-icon');
    setIcon(iconEl, 'git-merge');

    headerEl.createSpan('flywheel-merge-title').setText('Merge Suggestions');

    if (this.mergeSuggestions !== null) {
      headerEl.createSpan('flywheel-merge-count').setText(`${this.mergeSuggestions.length}`);
    }

    const chevron = headerEl.createSpan('flywheel-merge-chevron');
    setIcon(chevron, 'chevron-down');

    const listEl = section.createDiv('flywheel-merge-list');

    if (this.mergeLoading) {
      listEl.createDiv('flywheel-merge-loading').setText('Loading suggestions...');
    } else if (this.mergeSuggestions !== null && this.mergeSuggestions.length === 0) {
      listEl.createDiv('flywheel-merge-empty').setText('No duplicate entities found');
    } else if (this.mergeSuggestions) {
      for (const suggestion of this.mergeSuggestions) {
        this.renderMergeSuggestionItem(listEl, suggestion, container);
      }
    }
  }

  private renderMergeSuggestionItem(
    listEl: HTMLElement,
    suggestion: McpMergeSuggestion,
    rootContainer: HTMLDivElement
  ): void {
    const item = listEl.createDiv('flywheel-merge-item');

    const pair = item.createDiv('flywheel-merge-pair');

    // Source entity
    const sourceEl = pair.createDiv('flywheel-merge-entity');
    const sourceIcon = sourceEl.createSpan('flywheel-merge-entity-icon');
    const sourceCat = suggestion.source.category as EntityCategory;
    setIcon(sourceIcon, CATEGORY_ICONS[sourceCat] || 'circle-dot');
    sourceEl.createSpan('flywheel-merge-entity-name').setText(suggestion.source.name);

    pair.createSpan('flywheel-merge-arrow').setText('\u2192');

    // Target entity
    const targetEl = pair.createDiv('flywheel-merge-entity');
    const targetIcon = targetEl.createSpan('flywheel-merge-entity-icon');
    const targetCat = suggestion.target.category as EntityCategory;
    setIcon(targetIcon, CATEGORY_ICONS[targetCat] || 'circle-dot');
    targetEl.createSpan('flywheel-merge-entity-name').setText(suggestion.target.name);

    const meta = item.createDiv('flywheel-merge-meta');

    const infoEl = meta.createDiv();
    infoEl.createSpan('flywheel-merge-reason').setText(suggestion.reason);
    infoEl.createSpan('flywheel-merge-confidence')
      .setText(`${Math.round(suggestion.confidence * 100)}%`);

    const actions = meta.createDiv('flywheel-merge-actions');

    const mergeBtn = actions.createEl('button', { cls: 'flywheel-merge-btn flywheel-merge-btn-merge' });
    mergeBtn.setText('Merge');
    mergeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      mergeBtn.setText('Merging\u2026');
      mergeBtn.disabled = true;
      this.executeMerge(suggestion, rootContainer);
    });

    const dismissBtn = actions.createEl('button', { cls: 'flywheel-merge-btn flywheel-merge-btn-dismiss' });
    dismissBtn.setText('Dismiss');
    dismissBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.mergeSuggestions) {
        // Optimistic removal from UI
        this.mergeSuggestions = this.mergeSuggestions.filter(s => s !== suggestion);
        this.renderCategories(rootContainer);
        // Persist dismissal (fire-and-forget)
        this.mcpClient.dismissMergeSuggestion(
          suggestion.source.path,
          suggestion.target.path,
          suggestion.source.name,
          suggestion.target.name,
          suggestion.reason
        ).catch(err => {
          console.error('Flywheel Entities: failed to persist merge dismissal', err);
        });
        new Notice(`Dismissed merge: "${suggestion.source.name}" / "${suggestion.target.name}"`);
      }
    });
  }

  private async loadMergeSuggestions(sectionEl: HTMLElement): Promise<void> {
    this.mergeLoading = true;
    // Re-render the list area
    const listEl = sectionEl.querySelector('.flywheel-merge-list');
    if (listEl) {
      listEl.innerHTML = '';
      (listEl as HTMLElement).createDiv('flywheel-merge-loading').setText('Loading suggestions...');
    }

    try {
      const response = await this.mcpClient.suggestEntityMerges(50);
      this.mergeSuggestions = response.suggestions;
    } catch (err) {
      console.error('Flywheel Entities: failed to load merge suggestions', err);
      this.mergeSuggestions = [];
    }

    this.mergeLoading = false;
    // Re-render entire categories to update the section
    const content = this.containerEl.querySelector('.flywheel-entity-content') as HTMLDivElement;
    if (content) this.renderCategories(content);
  }

  private async executeMerge(
    suggestion: McpMergeSuggestion,
    rootContainer: HTMLDivElement
  ): Promise<void> {
    // Optimistic removal from suggestions list
    if (this.mergeSuggestions) {
      this.mergeSuggestions = this.mergeSuggestions.filter(s => s !== suggestion);
      this.renderCategories(rootContainer);
    }

    try {
      const result = await this.mcpClient.mergeEntities(
        suggestion.source.path,
        suggestion.target.path
      );

      if (result.success) {
        new Notice(`Merged "${suggestion.source.name}" into "${suggestion.target.name}"`);
        // Pipeline completion listener will re-fetch when the server is done reprocessing
      } else {
        new Notice(`Merge failed: ${result.message}`);
        await this.fetchEntities();
      }
    } catch (err) {
      new Notice(`Merge failed: ${err instanceof Error ? err.message : String(err)}`);
      await this.fetchEntities();
    }
  }

  // ---------------------------------------------------------------------------
  // Bulk Selection
  // ---------------------------------------------------------------------------

  private exitSelectionMode(): void {
    this.selectedEntities.clear();
    this.bulkProgress = null;
    this.render();
  }

  private renderGlobalActionBar(container: HTMLDivElement): void {
    if (this.bulkProgress) {
      // Progress bar
      const progressEl = container.createDiv('flywheel-entity-progress flywheel-entity-global-bar');
      const barOuter = progressEl.createDiv('flywheel-entity-progress-bar');
      const barFill = barOuter.createDiv('flywheel-entity-progress-fill');
      const pct = this.bulkProgress.total > 0
        ? (this.bulkProgress.done / this.bulkProgress.total) * 100
        : 0;
      barFill.style.width = `${pct}%`;
      progressEl.createDiv('flywheel-entity-progress-text')
        .setText(`Moving ${this.bulkProgress.done}/${this.bulkProgress.total}...`);
      return;
    }

    const actionBar = container.createDiv('flywheel-entity-action-bar flywheel-entity-global-bar');

    // Summary of selection across categories
    const summary = this.getSelectionSummary();
    actionBar.createSpan('flywheel-entity-action-bar-count')
      .setText(summary);

    const moveBtn = actionBar.createEl('button', { cls: 'flywheel-entity-action-bar-move' });
    moveBtn.setText('Move to...');
    moveBtn.disabled = this.selectedEntities.size === 0;
    moveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.selectedEntities.size > 0) {
        this.showBulkCategoryPicker(moveBtn);
      }
    });

    const clearBtn = actionBar.createEl('button', { cls: 'flywheel-entity-action-bar-cancel' });
    clearBtn.setText('Clear');
    clearBtn.disabled = this.selectedEntities.size === 0;
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.selectedEntities.clear();
      this.render();
    });

    const cancelBtn = actionBar.createEl('button', { cls: 'flywheel-entity-action-bar-cancel' });
    cancelBtn.setText('Done');
    cancelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.exitSelectionMode();
    });
  }

  private getSelectionSummary(): string {
    const count = this.selectedEntities.size;
    if (count === 0) return 'Select entities from any category';

    // Group by source category
    const byCat = new Map<EntityCategory, number>();
    for (const { fromCategory } of this.selectedEntities.values()) {
      byCat.set(fromCategory, (byCat.get(fromCategory) ?? 0) + 1);
    }

    if (byCat.size === 1) {
      const [cat, n] = [...byCat.entries()][0];
      return `${n} selected from ${CATEGORY_LABELS[cat]}`;
    }

    const parts = [...byCat.entries()]
      .map(([cat, n]) => `${n} ${CATEGORY_LABELS[cat]}`)
      .join(', ');
    return `${count} selected (${parts})`;
  }

  private showBulkCategoryPicker(anchorEl: HTMLElement): void {
    this.dismissPicker();

    // Determine which categories are being moved FROM (to exclude from target list)
    const sourceCategories = new Set<EntityCategory>();
    for (const { fromCategory } of this.selectedEntities.values()) {
      sourceCategories.add(fromCategory);
    }

    const picker = createDiv('flywheel-entity-category-picker');
    this.activePicker = picker;

    const sortedCategories = ALL_CATEGORIES
      .sort((a, b) => CATEGORY_LABELS[a].localeCompare(CATEGORY_LABELS[b]));

    for (const cat of sortedCategories) {
      const option = picker.createDiv('flywheel-entity-category-option');
      option.dataset.category = cat;
      const iconEl = option.createSpan('flywheel-entity-category-option-icon');
      setIcon(iconEl, CATEGORY_ICONS[cat]);
      option.createSpan().setText(CATEGORY_LABELS[cat]);
      const catEntities = (this.entityData as any)?.[cat] as McpEntityItem[] | undefined;
      if (catEntities?.length) {
        option.createSpan('flywheel-entity-category-option-count').setText(`${catEntities.length}`);
      }

      option.addEventListener('click', (e) => {
        e.stopPropagation();
        this.dismissPicker();
        this.bulkMoveEntities(cat);
      });
    }

    // Position fixed relative to the button's screen position
    const rect = anchorEl.getBoundingClientRect();
    picker.style.position = 'fixed';
    picker.style.top = `${rect.bottom + 4}px`;
    picker.style.left = `${rect.left}px`;
    document.body.appendChild(picker);

    setTimeout(() => {
      const dismiss = (e: MouseEvent) => {
        if (!picker.contains(e.target as Node)) {
          this.dismissPicker();
          document.removeEventListener('click', dismiss, true);
        }
      };
      document.addEventListener('click', dismiss, true);
    }, 0);
  }

  private async bulkMoveEntities(toCategory: EntityCategory): Promise<void> {
    const entries = Array.from(this.selectedEntities.entries());
    // Filter out entities already in the target category
    const toMove = entries.filter(([, { fromCategory }]) => fromCategory !== toCategory);
    if (toMove.length === 0) {
      new Notice(`All selected entities are already in ${CATEGORY_LABELS[toCategory]}`);
      return;
    }

    const frontmatterType = CATEGORY_TO_FRONTMATTER_TYPE[toCategory];
    const total = toMove.length;

    // Optimistic: splice from source lists, push to destination, clear selection, render once
    if (this.entityData) {
      const dstList = ((this.entityData as any)[toCategory] ??= []) as McpEntityItem[];
      for (const [path, { fromCategory }] of toMove) {
        const srcList = (this.entityData as any)[fromCategory] as McpEntityItem[] | undefined;
        if (srcList) {
          const idx = srcList.findIndex(e => e.path === path);
          if (idx !== -1) {
            const [entity] = srcList.splice(idx, 1);
            dstList.push(entity);
          }
        }
      }
      dstList.sort((a, b) => a.name.localeCompare(b.name));
    }

    // Clear selection and render the moved state immediately
    this.selectedEntities.clear();
    this.render();

    // Fire all MCP calls in background — UI already reflects the move
    const errors: string[] = [];
    for (const [path] of toMove) {
      try {
        await this.mcpClient.updateFrontmatter(path, { type: frontmatterType }, false);
      } catch (err) {
        errors.push(path);
        console.error(`Flywheel Entities: failed to move ${path}`, err);
      }
    }

    if (errors.length > 0) {
      new Notice(`Moved ${total - errors.length}/${total} entities to ${CATEGORY_LABELS[toCategory]}. ${errors.length} failed.`);
      // Re-fetch to revert failed ones
      await this.fetchEntities();
    } else {
      new Notice(`Moved ${total} entities to ${CATEGORY_LABELS[toCategory]}`);
      // Pipeline completion listener will re-fetch when the server is done reprocessing
    }
  }

  // ---------------------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------------------

  private renderSplash(container: HTMLElement, message: string): void {
    const isError = this.mcpClient.connectionState === 'error';
    const empty = container.createDiv('flywheel-splash');
    const imgPath = `${this.app.vault.configDir}/plugins/flywheel-crank/flywheel.png`;
    const imgEl = empty.createEl('img', { cls: isError ? 'flywheel-splash-logo flywheel-splash-logo-static' : 'flywheel-splash-logo' });
    imgEl.src = this.app.vault.adapter.getResourcePath(imgPath);
    imgEl.alt = '';
    if (isError) {
      empty.createDiv('flywheel-splash-error').setText(this.mcpClient.lastError ?? 'Connection failed');
      const retryBtn = empty.createEl('button', { cls: 'flywheel-splash-retry' });
      retryBtn.setText('Retry');
      retryBtn.addEventListener('click', () => this.mcpClient.requestRetry());
    } else {
      empty.createDiv('flywheel-splash-text').setText(message);
    }
  }

  private showCategoryPicker(entity: McpEntityItem, currentCategory: EntityCategory, anchorEl: HTMLElement): void {
    // Dismiss any existing picker
    this.dismissPicker();

    const picker = createDiv('flywheel-entity-category-picker');
    this.activePicker = picker;

    const sortedCategories = ALL_CATEGORIES
      .filter(cat => cat !== currentCategory)
      .sort((a, b) => CATEGORY_LABELS[a].localeCompare(CATEGORY_LABELS[b]));

    for (const cat of sortedCategories) {
      const option = picker.createDiv('flywheel-entity-category-option');
      option.dataset.category = cat;
      const iconEl = option.createSpan('flywheel-entity-category-option-icon');
      setIcon(iconEl, CATEGORY_ICONS[cat]);
      option.createSpan().setText(CATEGORY_LABELS[cat]);
      const catEntities = (this.entityData as any)?.[cat] as McpEntityItem[] | undefined;
      if (catEntities?.length) {
        option.createSpan('flywheel-entity-category-option-count').setText(`${catEntities.length}`);
      }

      option.addEventListener('click', (e) => {
        e.stopPropagation();
        this.dismissPicker();
        this.correctEntityCategory(entity, currentCategory, cat);
      });
    }

    // Position relative to the entity item
    const itemEl = anchorEl.closest('.flywheel-entity-item') as HTMLElement;
    if (itemEl) {
      itemEl.style.position = 'relative';
      itemEl.appendChild(picker);
    }

    // Dismiss on outside click (next tick so the current click doesn't trigger it)
    setTimeout(() => {
      const dismiss = (e: MouseEvent) => {
        if (!picker.contains(e.target as Node)) {
          this.dismissPicker();
          document.removeEventListener('click', dismiss, true);
        }
      };
      document.addEventListener('click', dismiss, true);
    }, 0);
  }

  private dismissPicker(): void {
    if (this.activePicker) {
      this.activePicker.remove();
      this.activePicker = null;
    }
  }

  private async correctEntityCategory(entity: McpEntityItem, fromCategory: EntityCategory, newCategory: EntityCategory): Promise<void> {
    const frontmatterType = CATEGORY_TO_FRONTMATTER_TYPE[newCategory];

    // Optimistically move in local data so the UI updates immediately
    if (this.entityData) {
      const srcList = (this.entityData as any)[fromCategory] as McpEntityItem[] | undefined;
      if (srcList) {
        const idx = srcList.findIndex(e => e.path === entity.path);
        if (idx !== -1) srcList.splice(idx, 1);
      }
      const dstList = ((this.entityData as any)[newCategory] ??= []) as McpEntityItem[];
      dstList.push(entity);
      dstList.sort((a, b) => a.name.localeCompare(b.name));
      this.render();
    }

    try {
      await this.mcpClient.updateFrontmatter(entity.path, { type: frontmatterType }, false);
      new Notice(`Moved "${entity.name}" to ${CATEGORY_LABELS[newCategory]}`);
      // Pipeline completion listener will re-fetch when the server is done reprocessing
    } catch (err) {
      new Notice(`Failed to move "${entity.name}": ${err instanceof Error ? err.message : String(err)}`);
      console.error('Flywheel Entities: failed to correct category', err);
      // Revert: re-fetch from server
      await this.fetchEntities();
    }
  }

  async onClose(): Promise<void> {
    this.dismissPicker();
  }
}
