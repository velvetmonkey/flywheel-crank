/**
 * Task Dashboard View
 *
 * Shows vault-wide tasks (markdown checkboxes) from all notes,
 * with status filtering and direct toggle support via MCP.
 * Tasks are grouped by folder with collapsible sections.
 */

import { ItemView, MarkdownView, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import type { FlywheelMcpClient, McpTask } from '../mcp/client';

export const TASK_DASHBOARD_VIEW_TYPE = 'flywheel-task-dashboard';

type StatusFilter = 'open' | 'upcoming' | 'completed' | 'all';
type SortMode = 'due_date' | 'file' | 'recent';
type SortDir = 'asc' | 'desc';

/** Get today's date as YYYY-MM-DD for due date comparisons. */
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Number of days from now to a YYYY-MM-DD date. Positive = future, negative = past. */
function dueDaysFromNow(dateStr: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(dateStr + 'T00:00:00');
  return Math.round((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

/** Group tasks by their parent folder path. Root-level notes go under "Notes". */
function groupTasksByFolder(tasks: McpTask[]): Map<string, McpTask[]> {
  const groups = new Map<string, McpTask[]>();
  for (const task of tasks) {
    const lastSlash = task.path.lastIndexOf('/');
    const folder = lastSlash > 0 ? task.path.substring(0, lastSlash) : 'Notes';
    const list = groups.get(folder);
    if (list) list.push(task);
    else groups.set(folder, [task]);
  }
  // Sort by folder name (Notes first, then alphabetical)
  return new Map(
    [...groups.entries()].sort((a, b) => {
      if (a[0] === 'Notes') return -1;
      if (b[0] === 'Notes') return 1;
      return a[0].localeCompare(b[0]);
    })
  );
}

export class TaskDashboardView extends ItemView {
  private mcpClient: FlywheelMcpClient;
  private tasks: McpTask[] = [];
  private filter: StatusFilter = 'open';
  private sort: SortMode = 'due_date';
  private sortDir: SortDir = 'asc';
  private counts = { open: 0, upcoming: 0, completed: 0, total: 0 };
  private cacheReady = false;
  private healthUnsub: (() => void) | null = null;
  private collapsedFolders = new Map<string, boolean>();
  private showUndated = false;

  constructor(leaf: WorkspaceLeaf, mcpClient: FlywheelMcpClient) {
    super(leaf);
    this.mcpClient = mcpClient;
  }

  getViewType(): string {
    return TASK_DASHBOARD_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Flywheel Tasks';
  }

  getIcon(): string {
    return 'check-square';
  }

  async onOpen(): Promise<void> {
    this.register(this.mcpClient.onConnectionStateChange(() => this.renderSplash()));
    this.renderSplash();
    this.waitForReady();
  }

  async onClose(): Promise<void> {
    if (this.healthUnsub) {
      this.healthUnsub();
      this.healthUnsub = null;
    }
  }

  /**
   * Subscribe to health updates. Wait for both index ready AND task cache ready
   * before fetching tasks, to avoid querying an empty cache mid-rebuild.
   */
  private waitForReady(): void {
    // If already ready from a previous open, just fetch
    if (this.cacheReady) {
      this.fetchTasks();
      return;
    }

    this.healthUnsub = this.mcpClient.onHealthUpdate(async (health) => {
      if (this.cacheReady) return;

      if (health.index_state === 'ready' && health.tasks_ready) {
        this.cacheReady = true;
        if (this.healthUnsub) { this.healthUnsub(); this.healthUnsub = null; }
        await this.fetchTasks();
      } else if (health.index_state === 'ready' && !health.tasks_ready) {
        // Index is ready but task cache still building — update splash text
        this.renderSplash('Building task index\u2026');
      }
    });
  }

  private async fetchTasks(): Promise<void> {
    try {
      // Open and Upcoming both need all open tasks; split client-side
      const isOpenish = this.filter === 'open' || this.filter === 'upcoming';
      const statusParam = isOpenish ? 'open' : this.filter === 'all' ? 'all' : this.filter;
      const limit = this.filter === 'completed' ? 100 : 200;
      const response = await this.mcpClient.queryTasks({
        status: statusParam,
        limit,
      });

      const allTasks = response.tasks;
      const resp = response as any;
      const today = todayStr();

      // Compute open/upcoming split when we have open tasks
      if (this.filter !== 'completed') {
        const openTasks = allTasks.filter(t => t.status === 'open');
        const currentOpen = openTasks.filter(t => !t.due_date || t.due_date <= today);
        const upcomingTasks = openTasks.filter(t => t.due_date != null && t.due_date > today);
        this.counts.open = currentOpen.length;
        this.counts.upcoming = upcomingTasks.length;
      }

      // Always update completed count from server
      this.counts.completed = resp.completed_count ?? allTasks.filter(t => t.status === 'completed').length;
      this.counts.total = this.counts.open + this.counts.upcoming + this.counts.completed +
        (resp.cancelled_count ?? 0);

      // Set displayed tasks based on filter
      switch (this.filter) {
        case 'open':
          this.tasks = allTasks.filter(t => !t.due_date || t.due_date <= today);
          break;
        case 'upcoming':
          this.tasks = allTasks.filter(t => t.due_date != null && t.due_date > today);
          break;
        default:
          this.tasks = allTasks;
      }
    } catch (err) {
      console.error('Flywheel Tasks: failed to fetch tasks', err);
      // Keep existing tasks on error rather than showing empty state
    }
    this.render();
  }

  private render(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('flywheel-task-dashboard');

    // Header with filter controls
    const header = container.createDiv('flywheel-task-header');
    const filters = header.createDiv('flywheel-task-filters');

    const openCount = (!this.showUndated && this.filter === 'open')
      ? this.tasks.filter(t => t.due_date != null).length
      : this.counts.open;
    const filterOptions: { label: string; value: StatusFilter; count?: number }[] = [
      { label: 'Open', value: 'open', count: openCount },
      { label: 'Upcoming', value: 'upcoming', count: this.counts.upcoming },
      { label: 'Done', value: 'completed', count: this.counts.completed },
      { label: 'All', value: 'all' },
    ];

    for (const opt of filterOptions) {
      const btn = filters.createEl('button', {
        cls: `flywheel-task-filter-btn${opt.value === this.filter ? ' is-active' : ''}`,
      });
      btn.createSpan().setText(opt.label);
      if (opt.count != null && opt.count > 0) {
        btn.createSpan('flywheel-task-filter-count').setText(`${opt.count}`);
      }
      btn.addEventListener('click', () => {
        this.filter = opt.value;
        // Default to 'recent' sort for All/Done views, 'due_date' for Open/Upcoming
        if (opt.value === 'all' || opt.value === 'completed') {
          this.sort = 'recent';
          this.sortDir = 'desc';
        } else if (this.sort === 'recent') {
          this.sort = 'due_date';
          this.sortDir = 'asc';
        }
        this.fetchTasks();
      });
    }

    // Sort controls
    const sorts = header.createDiv('flywheel-task-sorts');
    const sortIcon = sorts.createSpan('flywheel-task-sort-icon');
    setIcon(sortIcon, 'arrow-up-down');

    const sortOptions: { label: string; value: SortMode }[] = [
      { label: 'Due', value: 'due_date' },
      { label: 'Recent', value: 'recent' },
      { label: 'File', value: 'file' },
    ];

    for (const opt of sortOptions) {
      const isActive = opt.value === this.sort;
      const btn = sorts.createEl('button', {
        cls: `flywheel-task-sort-btn${isActive ? ' is-active' : ''}`,
      });
      btn.createSpan().setText(opt.label);
      if (isActive) {
        const dirIcon = btn.createSpan('flywheel-task-sort-dir');
        setIcon(dirIcon, this.sortDir === 'asc' ? 'arrow-up' : 'arrow-down');
      }
      btn.addEventListener('click', () => {
        if (this.sort === opt.value) {
          // Toggle direction
          this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          this.sort = opt.value;
          // Sensible defaults: due_date/file asc, recent desc
          this.sortDir = opt.value === 'recent' ? 'desc' : 'asc';
        }
        this.render();
      });
    }

    // Undated toggle (only relevant for Open view)
    if (this.filter === 'open') {
      const undatedBtn = sorts.createEl('button', {
        cls: `flywheel-task-sort-btn${this.showUndated ? ' is-active' : ''}`,
      });
      const undatedIcon = undatedBtn.createSpan('flywheel-task-sort-dir');
      setIcon(undatedIcon, 'calendar-off');
      undatedBtn.setAttribute('aria-label', this.showUndated ? 'Hide undated tasks' : 'Show undated tasks');
      undatedBtn.addEventListener('click', () => {
        this.showUndated = !this.showUndated;
        this.render();
      });
    }

    // Task list
    const list = container.createDiv('flywheel-task-list');

    // Apply undated filter for open view
    let displayTasks = this.tasks;
    if (this.filter === 'open' && !this.showUndated) {
      displayTasks = displayTasks.filter(t => t.due_date != null);
    }

    if (displayTasks.length === 0) {
      const empty = list.createDiv('flywheel-task-empty');
      empty.setText(this.filter === 'open' && !this.showUndated ? 'No dated tasks' : 'No tasks found');
      return;
    }

    const sortedTasks = this.sortTasks(displayTasks);
    const groups = groupTasksByFolder(sortedTasks);
    for (const [folder, tasks] of groups) {
      this.renderFolder(list, folder, tasks);
    }

    // Summary bar
    const summary = container.createDiv('flywheel-task-summary');
    const parts = [`${this.counts.open} open`];
    if (this.counts.upcoming > 0) parts.push(`${this.counts.upcoming} upcoming`);
    parts.push(`${this.counts.completed} done`);
    parts.push(`${this.counts.total} total`);
    summary.createSpan().setText(parts.join(' \u00B7 '));
    const summaryInfo = summary.createSpan('flywheel-graph-section-info');
    setIcon(summaryInfo, 'info');
    const sortDesc = this.sort === 'due_date'
      ? `Sorted by due date (${this.sortDir === 'asc' ? 'soonest' : 'latest'} first), then by file path.`
      : this.sort === 'recent'
      ? `Sorted by file modification time (${this.sortDir === 'desc' ? 'newest' : 'oldest'} first).`
      : `Sorted alphabetically by file path (${this.sortDir === 'asc' ? 'A\u2013Z' : 'Z\u2013A'}).`;
    summaryInfo.setAttribute('aria-label',
      'Tasks extracted from markdown checkboxes across all notes. ' +
      'Toggle status directly \u2014 changes are written back to the source note. ' +
      sortDesc);
    summaryInfo.addEventListener('click', (e) => e.stopPropagation());
  }

  /** Get file modification time via Obsidian API (0 if not found). */
  private getFileMtime(filePath: string): number {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) return file.stat.mtime;
    return 0;
  }

  private sortTasks(tasks: McpTask[]): McpTask[] {
    const sorted = [...tasks];
    const dir = this.sortDir === 'asc' ? 1 : -1;
    switch (this.sort) {
      case 'due_date':
        sorted.sort((a, b) => {
          // Tasks with due dates first (regardless of direction)
          if (a.due_date && !b.due_date) return -1;
          if (!a.due_date && b.due_date) return 1;
          if (a.due_date && b.due_date) return dir * a.due_date.localeCompare(b.due_date);
          return a.path.localeCompare(b.path);
        });
        break;
      case 'recent':
        sorted.sort((a, b) => {
          const mtimeA = this.getFileMtime(a.path);
          const mtimeB = this.getFileMtime(b.path);
          // Default desc = most recent first, asc = oldest first
          if (mtimeA !== mtimeB) return dir * (mtimeA - mtimeB);
          return a.path.localeCompare(b.path);
        });
        break;
      case 'file':
        sorted.sort((a, b) => dir * a.path.localeCompare(b.path));
        break;
    }
    return sorted;
  }

  private renderFolder(container: HTMLElement, folder: string, tasks: McpTask[]): void {
    const isCollapsed = this.collapsedFolders.get(folder) ?? false;
    const section = container.createDiv(`flywheel-task-folder${isCollapsed ? ' is-collapsed' : ''}`);

    // Header
    const header = section.createDiv('flywheel-task-folder-header');
    header.addEventListener('click', () => {
      const nowCollapsed = !this.collapsedFolders.get(folder);
      this.collapsedFolders.set(folder, nowCollapsed);
      section.toggleClass('is-collapsed', nowCollapsed);
    });

    const iconEl = header.createDiv('flywheel-task-folder-icon');
    setIcon(iconEl, 'folder');

    const nameEl = header.createDiv('flywheel-task-folder-name');
    nameEl.setText(folder);

    const countEl = header.createDiv('flywheel-task-folder-count');
    countEl.setText(String(tasks.length));

    const chevron = header.createDiv('flywheel-task-folder-chevron');
    setIcon(chevron, 'chevron-down');

    // Content
    const content = section.createDiv('flywheel-task-folder-content');
    for (const task of tasks) {
      this.renderTask(content, task);
    }
  }

  private renderTask(container: HTMLElement, task: McpTask): void {
    const item = container.createDiv('flywheel-task-item');
    item.style.cursor = 'pointer';
    item.addEventListener('click', async () => {
      await this.app.workspace.openLinkText(task.path, '', false);
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (view) {
        const line = Math.max(0, task.line - 1);
        view.editor.setCursor({ line, ch: 0 });
        view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
      }
    });

    // Checkbox
    const checkbox = item.createEl('input', {
      type: 'checkbox',
      cls: 'flywheel-task-checkbox',
    });
    checkbox.checked = task.status === 'completed';
    checkbox.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        // Fire-and-forget the server toggle
        this.mcpClient.toggleTask(task.path, task.text).catch(err => {
          console.error('Flywheel Tasks: toggle failed', err);
        });

        // Optimistic UI update — flip status locally and re-render immediately
        task.status = task.status === 'completed' ? 'open' : 'completed';
        const today = todayStr();
        const isUpcoming = task.due_date != null && task.due_date > today;
        if (task.status === 'completed') {
          if (isUpcoming) {
            this.counts.upcoming = Math.max(0, this.counts.upcoming - 1);
          } else {
            this.counts.open = Math.max(0, this.counts.open - 1);
          }
          this.counts.completed++;
        } else {
          if (isUpcoming) {
            this.counts.upcoming++;
          } else {
            this.counts.open++;
          }
          this.counts.completed = Math.max(0, this.counts.completed - 1);
        }
        // Re-filter: remove task if it no longer matches the current filter
        if (this.filter === 'open') {
          this.tasks = this.tasks.filter(t => t.status === 'open' && (!t.due_date || t.due_date <= today));
        } else if (this.filter === 'upcoming') {
          this.tasks = this.tasks.filter(t => t.status === 'open' && t.due_date != null && t.due_date > today);
        } else if (this.filter === 'completed') {
          this.tasks = this.tasks.filter(t => t.status === 'completed');
        }
        this.render();
      } catch (err) {
        console.error('Flywheel Tasks: toggle failed', err);
      }
    });

    // Content wrapper
    const content = item.createDiv('flywheel-task-content');

    // Line 1: task text with wikilinks rendered as clickable links
    const textEl = content.createDiv(
      `flywheel-task-text${task.status === 'completed' ? ' is-completed' : ''}`
    );
    this.renderTextWithWikilinks(textEl, task.text);

    // Line 2 (meta): note link + due date + tags — only if any exist
    const noteName = task.path.replace(/\.md$/, '').split('/').pop() || task.path;
    const hasMeta = noteName || task.due_date || task.tags.length > 0;

    if (hasMeta) {
      const meta = content.createDiv('flywheel-task-meta');

      const noteWrap = meta.createSpan('flywheel-task-meta-item');
      const noteIcon = noteWrap.createSpan('flywheel-task-meta-icon');
      setIcon(noteIcon, 'file-text');
      const noteLink = noteWrap.createSpan('flywheel-task-note');
      noteLink.setText(noteName);
      noteLink.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.app.workspace.openLinkText(task.path, '', false);
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view) {
          const line = Math.max(0, task.line - 1);
          view.editor.setCursor({ line, ch: 0 });
          view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
        }
      });

      if (task.due_date) {
        const dueWrap = meta.createSpan('flywheel-task-meta-item');
        const dueIcon = dueWrap.createSpan('flywheel-task-meta-icon');
        setIcon(dueIcon, 'calendar');
        const days = dueDaysFromNow(task.due_date);
        const relative = days === 0 ? 'today' : days === 1 ? 'tomorrow' : days === -1 ? 'yesterday'
          : days > 0 ? `in ${days}d` : `${-days}d ago`;
        const due = dueWrap.createSpan('flywheel-task-due');
        if (days < 0) due.addClass('flywheel-task-due-overdue');
        else if (days === 0) due.addClass('flywheel-task-due-today');
        due.setText(relative);
        due.setAttribute('aria-label', task.due_date);
      }

      for (const tag of task.tags) {
        const tagEl = meta.createSpan('flywheel-task-tag');
        tagEl.setText(tag);
      }
    }
  }

  /** Render task text, converting [[wikilinks]] into clickable spans. */
  private renderTextWithWikilinks(el: HTMLElement, text: string): void {
    const wikiRe = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = wikiRe.exec(text)) !== null) {
      // Text before the link
      if (match.index > lastIndex) {
        el.appendText(text.slice(lastIndex, match.index));
      }

      const target = match[1];
      const display = match[2] || target.split('/').pop() || target;

      const link = el.createSpan('flywheel-task-wikilink');
      link.setText(display);
      link.addEventListener('click', (e) => {
        e.stopPropagation();
        this.app.workspace.openLinkText(target, '', false);
      });

      lastIndex = match.index + match[0].length;
    }

    // Remaining text after last link
    if (lastIndex < text.length) {
      el.appendText(text.slice(lastIndex));
    }

    // No wikilinks at all — just set plain text
    if (lastIndex === 0) {
      el.setText(text);
    }
  }

  /** Full-panel splash shown while waiting for task cache to build. */
  private renderSplash(message?: string): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('flywheel-task-dashboard');

    const isError = this.mcpClient.connectionState === 'error';
    const splash = container.createDiv('flywheel-splash');
    const imgPath = `${this.app.vault.configDir}/plugins/flywheel-crank/flywheel.png`;
    const imgEl = splash.createEl('img', { cls: isError ? 'flywheel-splash-logo flywheel-splash-logo-static' : 'flywheel-splash-logo' });
    imgEl.src = this.app.vault.adapter.getResourcePath(imgPath);
    imgEl.alt = '';
    if (isError) {
      splash.createDiv('flywheel-splash-error').setText(this.mcpClient.lastError ?? 'Connection failed');
      const retryBtn = splash.createEl('button', { cls: 'flywheel-splash-retry' });
      retryBtn.setText('Retry');
      retryBtn.addEventListener('click', () => this.mcpClient.requestRetry());
    } else {
      const text = message
        ?? (this.mcpClient.connected ? 'Building vault index\u2026' : 'Connecting to flywheel-memory\u2026');
      splash.createDiv('flywheel-splash-text').setText(text);
    }
  }
}
