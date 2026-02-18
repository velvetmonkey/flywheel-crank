/**
 * Task Dashboard View
 *
 * Shows vault-wide tasks (markdown checkboxes) from all notes,
 * with status filtering and direct toggle support via MCP.
 * Tasks are grouped by folder with collapsible sections.
 */

import { ItemView, MarkdownView, WorkspaceLeaf, setIcon } from 'obsidian';
import type { FlywheelMcpClient, McpTask } from '../mcp/client';

export const TASK_DASHBOARD_VIEW_TYPE = 'flywheel-task-dashboard';

type StatusFilter = 'open' | 'completed' | 'all';

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
  private counts = { open: 0, completed: 0, total: 0 };
  private loading = false;
  private collapsedFolders = new Map<string, boolean>();

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
    this.render();
    await this.fetchTasks();
  }

  async onClose(): Promise<void> {
    // Cleanup
  }

  private async fetchTasks(): Promise<void> {
    if (!this.mcpClient.connected) {
      this.renderLoading();
      // Poll until connected
      const poll = setInterval(async () => {
        if (this.mcpClient.connected) {
          clearInterval(poll);
          await this.fetchTasks();
        }
      }, 2000);
      return;
    }

    this.loading = true;
    this.renderLoading();

    try {
      const statusParam = this.filter === 'all' ? 'all' : this.filter;
      const limit = this.filter === 'completed' ? 100 : 200;
      const response = await this.mcpClient.queryTasks({
        status: statusParam,
        limit,
      });

      this.tasks = response.tasks;
      // Server returns open_count/completed_count/cancelled_count at top level
      const resp = response as any;
      if (resp.open_count != null) {
        this.counts = {
          open: resp.open_count,
          completed: resp.completed_count ?? 0,
          total: (resp.open_count ?? 0) + (resp.completed_count ?? 0) + (resp.cancelled_count ?? 0),
        };
      } else {
        this.counts = {
          open: response.tasks.filter(t => t.status === 'open').length,
          completed: response.tasks.filter(t => t.status === 'completed').length,
          total: response.total,
        };
      }
    } catch (err) {
      console.error('Flywheel Tasks: failed to fetch tasks', err);
      this.tasks = [];
      // Index may still be building — retry after a delay
      setTimeout(() => this.fetchTasks(), 5000);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private render(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('flywheel-task-dashboard');

    // Header with filter controls
    const header = container.createDiv('flywheel-task-header');
    const filters = header.createDiv('flywheel-task-filters');

    const filterOptions: { label: string; value: StatusFilter }[] = [
      { label: 'Open', value: 'open' },
      { label: 'Completed', value: 'completed' },
      { label: 'All', value: 'all' },
    ];

    for (const opt of filterOptions) {
      const btn = filters.createEl('button', {
        cls: `flywheel-task-filter-btn${opt.value === this.filter ? ' is-active' : ''}`,
        text: opt.label,
      });
      btn.addEventListener('click', () => {
        this.filter = opt.value;
        this.fetchTasks();
      });
    }

    if (this.loading) {
      this.renderSplashInto(container);
      return;
    }

    // Task list
    const list = container.createDiv('flywheel-task-list');

    if (this.tasks.length === 0) {
      const empty = list.createDiv('flywheel-task-empty');
      empty.setText('No tasks found');
      return;
    }

    const groups = groupTasksByFolder(this.tasks);
    for (const [folder, tasks] of groups) {
      this.renderFolder(list, folder, tasks);
    }

    // Summary bar
    const summary = container.createDiv('flywheel-task-summary');
    summary.createSpan().setText(
      `${this.counts.open} open \u00B7 ${this.counts.completed} completed \u00B7 ${this.counts.total} total`
    );
    const summaryInfo = summary.createSpan('flywheel-graph-section-info');
    setIcon(summaryInfo, 'info');
    summaryInfo.setAttribute('aria-label',
      'Tasks extracted from markdown checkboxes across all notes. ' +
      'Toggle status directly \u2014 changes are written back to the source note.');
    summaryInfo.addEventListener('click', (e) => e.stopPropagation());
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

    // Checkbox
    const checkbox = item.createEl('input', {
      type: 'checkbox',
      cls: 'flywheel-task-checkbox',
    });
    checkbox.checked = task.status === 'completed';
    checkbox.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        await this.mcpClient.toggleTask(task.path, task.text);
        await this.fetchTasks();
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
        const due = dueWrap.createSpan('flywheel-task-due');
        due.setText(task.due_date);
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

  private renderLoading(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('flywheel-task-dashboard');

    // Keep header
    const header = container.createDiv('flywheel-task-header');
    const filters = header.createDiv('flywheel-task-filters');
    const filterOptions: { label: string; value: StatusFilter }[] = [
      { label: 'Open', value: 'open' },
      { label: 'Completed', value: 'completed' },
      { label: 'All', value: 'all' },
    ];
    for (const opt of filterOptions) {
      filters.createEl('button', {
        cls: `flywheel-task-filter-btn${opt.value === this.filter ? ' is-active' : ''}`,
        text: opt.label,
      });
    }

    this.renderSplashInto(container);
  }

  private renderSplashInto(container: HTMLElement): void {
    const splash = container.createDiv('flywheel-splash');
    const imgPath = `${this.app.vault.configDir}/plugins/flywheel-crank/flywheel.png`;
    const imgEl = splash.createEl('img', { cls: 'flywheel-splash-logo' });
    imgEl.src = this.app.vault.adapter.getResourcePath(imgPath);
    imgEl.alt = '';
    splash.createDiv('flywheel-splash-text').setText(
      this.mcpClient.connected ? 'Loading tasks...' : 'Connecting to flywheel-memory...'
    );
  }
}
