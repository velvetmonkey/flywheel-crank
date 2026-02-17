/**
 * Task Dashboard View
 *
 * Shows vault-wide tasks (markdown checkboxes) from all notes,
 * with status filtering and direct toggle support via MCP.
 */

import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type { FlywheelMcpClient, McpTask } from '../mcp/client';

export const TASK_DASHBOARD_VIEW_TYPE = 'flywheel-task-dashboard';

type StatusFilter = 'open' | 'completed' | 'all';

export class TaskDashboardView extends ItemView {
  private mcpClient: FlywheelMcpClient;
  private tasks: McpTask[] = [];
  private filter: StatusFilter = 'open';
  private counts = { open: 0, completed: 0, total: 0 };
  private loading = false;

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
      const response = await this.mcpClient.queryTasks({
        status: statusParam,
        limit: 200,
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
      this.renderLoadingInto(container);
      return;
    }

    // Task list
    const list = container.createDiv('flywheel-task-list');

    if (this.tasks.length === 0) {
      const empty = list.createDiv('flywheel-task-empty');
      empty.setText('No tasks found');
      return;
    }

    for (const task of this.tasks) {
      this.renderTask(list, task);
    }

    // Summary bar
    const summary = container.createDiv('flywheel-task-summary');
    summary.setText(
      `${this.counts.open} open \u00B7 ${this.counts.completed} completed \u00B7 ${this.counts.total} total`
    );
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

    // Task text
    const textEl = content.createDiv(
      `flywheel-task-text${task.status === 'completed' ? ' is-completed' : ''}`
    );
    textEl.setText(task.text);

    // Meta row
    const meta = content.createDiv('flywheel-task-meta');

    // Source note link
    const noteName = task.path.replace(/\.md$/, '').split('/').pop() || task.path;
    const noteLink = meta.createSpan('flywheel-task-note');
    noteLink.setText(noteName);
    noteLink.addEventListener('click', (e) => {
      e.stopPropagation();
      this.app.workspace.openLinkText(task.path, '', false);
    });

    // Due date badge
    if (task.due_date) {
      const due = meta.createSpan('flywheel-task-due');
      due.setText(task.due_date);
    }

    // Tags
    for (const tag of task.tags) {
      const tagEl = meta.createSpan('flywheel-task-tag');
      tagEl.setText(tag);
    }

    // Context
    if (task.context) {
      const ctx = content.createDiv('flywheel-task-context');
      ctx.setText(task.context);
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

    this.renderLoadingInto(container);
  }

  private renderLoadingInto(container: HTMLElement): void {
    const loading = container.createDiv('flywheel-task-loading');
    const iconEl = loading.createDiv();
    setIcon(iconEl, 'loader');
    loading.createDiv().setText(
      this.mcpClient.connected ? 'Loading tasks...' : 'Waiting for connection...'
    );
  }
}
