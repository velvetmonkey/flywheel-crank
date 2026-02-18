/**
 * Entity Browser View
 *
 * Shows all extracted entities grouped by 17 categories
 * with search/filter, hub scores, and click-to-navigate.
 * Fetches data via MCP list_entities tool.
 */

import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type { EntityCategory, EntityWithAliases } from '../core/types';
import type { FlywheelMcpClient, McpEntityIndexResponse, McpEntityItem } from '../mcp/client';

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
  'people', 'technologies', 'projects', 'organizations',
  'concepts', 'locations', 'acronyms',
  'animals', 'media', 'events', 'documents', 'vehicles',
  'health', 'finance', 'food', 'hobbies',
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
  private entityData: McpEntityIndexResponse | null = null;
  private filterText = '';
  private totalEntities = 0;
  /** Categories the user has expanded (all start collapsed). */
  private expandedCategories = new Set<EntityCategory>();
  /** Active category picker element (if any). */
  private activePicker: HTMLElement | null = null;

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
    statsInfo.setAttribute('aria-label',
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
      const section = container.createDiv(`flywheel-entity-section${isCollapsed ? ' is-collapsed' : ''}`);

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

      headerEl.setAttribute('aria-label', CATEGORY_HINTS[category]);

      const iconEl = headerEl.createSpan('flywheel-entity-section-icon');
      setIcon(iconEl, CATEGORY_ICONS[category]);

      headerEl.createSpan('flywheel-entity-section-title').setText(CATEGORY_LABELS[category]);
      headerEl.createSpan('flywheel-entity-section-count').setText(`${filtered.length}`);

      const chevron = headerEl.createSpan('flywheel-entity-section-chevron');
      setIcon(chevron, 'chevron-down');

      // Entity items
      const listEl = section.createDiv('flywheel-entity-list');

      for (const entity of filtered) {
        const item = listEl.createDiv('flywheel-entity-item');
        item.setAttribute('aria-label', getEntityCategoryReason(entity.name, category));

        if (entity.path) {
          item.addEventListener('click', () => {
            this.app.workspace.openLinkText(entity.path, '', false);
          });
          item.addClass('flywheel-entity-clickable');
        }

        const nameRow = item.createDiv('flywheel-entity-name-row');
        const nameEl = nameRow.createDiv('flywheel-entity-name');
        nameEl.setText(entity.name);

        // Category action buttons (only for entities with a backing note)
        if (entity.path) {
          const actions = nameRow.createDiv('flywheel-entity-actions');

          // Move to "other" (uncategorize) — only shown if not already in "other"
          if (category !== 'other') {
            const otherBtn = actions.createSpan('flywheel-entity-correct-btn');
            setIcon(otherBtn, 'circle-dot');
            otherBtn.setAttribute('aria-label', 'Move to Other');
            otherBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              this.dismissPicker();
              this.correctEntityCategory(entity, category, 'other');
            });
          }

          const correctBtn = actions.createSpan('flywheel-entity-correct-btn');
          setIcon(correctBtn, 'arrow-left-right');
          correctBtn.setAttribute('aria-label', 'Change category');
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
          const hubIcon = hubEl.createSpan();
          setIcon(hubIcon, 'link');
          hubEl.createSpan().setText(`${entity.hubScore}`);
        }
      }
    }
  }

  private renderSplash(container: HTMLElement, message: string): void {
    const empty = container.createDiv('flywheel-entity-empty');
    const imgPath = `${this.app.vault.configDir}/plugins/flywheel-crank/flywheel.png`;
    const imgEl = empty.createEl('img', { cls: 'flywheel-splash-logo' });
    imgEl.src = this.app.vault.adapter.getResourcePath(imgPath);
    imgEl.alt = '';
    empty.createDiv('flywheel-splash-text').setText(message);
  }

  private showCategoryPicker(entity: McpEntityItem, currentCategory: EntityCategory, anchorEl: HTMLElement): void {
    // Dismiss any existing picker
    this.dismissPicker();

    const picker = createDiv('flywheel-entity-category-picker');
    this.activePicker = picker;

    for (const cat of ALL_CATEGORIES) {
      if (cat === currentCategory) continue;

      const option = picker.createDiv('flywheel-entity-category-option');
      const iconEl = option.createSpan('flywheel-entity-category-option-icon');
      setIcon(iconEl, CATEGORY_ICONS[cat]);
      option.createSpan().setText(CATEGORY_LABELS[cat]);

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
      // File watcher will pick up the change — re-fetch after a short delay
      // to get the server-authoritative data without triggering a full re-index
      setTimeout(() => this.fetchEntities(), 3000);
    } catch (err) {
      console.error('Flywheel Entities: failed to correct category', err);
      // Revert: re-fetch from server
      await this.fetchEntities();
    }
  }

  async onClose(): Promise<void> {
    this.dismissPicker();
  }
}
