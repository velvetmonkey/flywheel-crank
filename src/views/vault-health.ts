/**
 * Graph Health Dashboard View
 *
 * Shows vault health diagnostics powered by MCP: orphans, dead ends,
 * stale hubs, immature notes, emerging hubs, and growth trends.
 */

import { ItemView, WorkspaceLeaf, TFile, setIcon, setTooltip } from 'obsidian';
import type { FlywheelMcpClient, McpHealthCheckResponse, McpCompactStep } from '../mcp/client';

export const VAULT_HEALTH_VIEW_TYPE = 'flywheel-vault-health';

export class VaultHealthView extends ItemView {
  private mcpClient: FlywheelMcpClient;
  private pluginVersion: string;
  /** Track which sections have been loaded to avoid re-fetching */
  private loadedSections = new Set<string>();
  /** Remember collapsed state per section title across re-renders */
  private sectionCollapsed = new Map<string, boolean>();
  /** Auto-refresh interval for the activity log section */
  private activityLogInterval: ReturnType<typeof setInterval> | null = null;
  /** Whether the server index is confirmed ready */
  private indexReady = false;
  /** Unsubscribe from health updates */
  private healthUnsub: (() => void) | null = null;
  private _connStateUnsub: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, mcpClient: FlywheelMcpClient, pluginVersion: string) {
    super(leaf);
    this.mcpClient = mcpClient;
    this.pluginVersion = pluginVersion;
  }

  getViewType(): string {
    return VAULT_HEALTH_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Flywheel Health';
  }

  getIcon(): string {
    return 'heart-pulse';
  }

  async onOpen(): Promise<void> {
    await this.render();
  }

  private async render(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('flywheel-vault-health');

    if (!this.mcpClient.connected || !this.indexReady) {
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
        splash.createDiv('flywheel-splash-text').setText(
          this.mcpClient.connected ? 'Building vault index...' : 'Connecting to flywheel-memory...'
        );
      }
      // Subscribe to health updates — re-render when index is ready
      if (!this.healthUnsub) {
        this.healthUnsub = this.mcpClient.onHealthUpdate(health => {
          if (health.index_state === 'ready' && !this.indexReady) {
            this.indexReady = true;
            this.render();
          }
        });
      }
      if (!this._connStateUnsub) {
        this._connStateUnsub = this.mcpClient.onConnectionStateChange(() => {
          if (this.mcpClient.connectionState === 'error' || this.mcpClient.connectionState === 'connected') {
            this.render();
          }
        });
        this.register(this._connStateUnsub);
      }
      return;
    }

    // Stats bar — render placeholders immediately, populate async
    const statsBar = container.createDiv('flywheel-health-stats-bar');
    const notesStat = this.renderStat(statsBar, 'file-text', '...', 'Notes');
    setTooltip(notesStat, 'Total markdown files in the vault');
    const entitiesStat = this.renderStat(statsBar, 'link', '...', 'Entities');
    setTooltip(entitiesStat, 'Distinct people, tools, topics, etc. detected across all notes');
    const tagsStat = this.renderStat(statsBar, 'tag', '...', 'Tags');
    setTooltip(tagsStat, 'Unique #tags used across the vault');
    const linksStat = this.renderStat(statsBar, 'arrow-right-left', '...', 'Links');
    setTooltip(linksStat, 'Total [[wikilinks]] across all notes');

    // Populate stats in background (don't block section rendering)
    this.loadStatsBar(notesStat, entitiesStat, tagsStat, linksStat);

    const content = container.createDiv('flywheel-health-content');

    // Vault Config section — lazy-loaded via flywheel_config tool
    this.renderLazySection(content, 'Vault Config', 'settings', async (el) => {
      try {
        const cfg = await this.mcpClient.getFlywheelConfig() as Record<string, any> | undefined;
        if (!cfg || Object.keys(cfg).length === 0) {
          el.createDiv('flywheel-health-empty-msg').setText('No config detected yet');
          return 0;
        }
        return this.renderVaultConfig(el, cfg);
      } catch {
        el.createDiv('flywheel-health-empty-msg').setText('Could not load config');
        return 0;
      }
    }, 'Auto-detected folder paths and templates for periodic notes (daily, weekly, monthly, etc.).');

    // Vault Stats section — lazy-loaded
    this.renderLazySection(content, 'Vault Stats', 'bar-chart', async (el) => {
      await this.mcpClient.waitForIndex();
      const stats = await this.mcpClient.vaultStats();
      let count = 0;

      this.renderInfoRow(el, 'Avg links/note', stats.average_links_per_note.toFixed(1));
      count++;
      if (stats.orphan_notes.total > 0) {
        this.renderInfoRow(el, 'Orphans', `${stats.orphan_notes.content} content, ${stats.orphan_notes.periodic} periodic`);
        count++;
      }

      if (stats.most_linked_notes.length > 0) {
        const hubGroup = el.createDiv('flywheel-health-info-group');
        hubGroup.createDiv('flywheel-health-info-group-label').setText('Most Linked');
        for (const note of stats.most_linked_notes.slice(0, 5)) {
          const name = note.path.replace(/\.md$/, '').split('/').pop() || note.path;
          this.renderInfoRow(hubGroup, name, `${note.backlinks}`);
          count++;
        }
      }

      if (stats.top_tags.length > 0) {
        const tagGroup = el.createDiv('flywheel-health-info-group');
        tagGroup.createDiv('flywheel-health-info-group-label').setText('Top Tags');
        for (const tag of stats.top_tags.slice(0, 5)) {
          this.renderInfoRow(tagGroup, tag.tag, String(tag.count));
          count++;
        }
      }

      return count;
    }, 'Aggregate statistics about your vault\'s link structure, most connected notes, and popular tags.');

    // System Diagnostics section — flywheel_doctor
    this.renderLazySection(content, 'System Diagnostics', 'stethoscope', async (el) => {
      this.renderInfoRow(el, 'Crank', `v${this.pluginVersion}`);
      this.renderInfoRow(el, 'Server', `flywheel-memory v${this.mcpClient.serverVersion ?? 'unknown'}`);

      const doctor = await this.mcpClient.runDoctor();
      const checks = doctor.checks ?? [];
      let issueCount = 0;

      for (const check of checks) {
        if (check.status !== 'ok') issueCount++;
        const row = el.createDiv('flywheel-health-check-row');
        const dot = row.createSpan('flywheel-health-check-dot');
        dot.addClass(
          check.status === 'ok' ? 'flywheel-health-check-ok'
            : check.status === 'warning' ? 'flywheel-health-check-warn'
              : 'flywheel-health-check-error'
        );
        const label = check.name.replace(/_/g, ' ');
        row.createSpan('flywheel-health-check-label').setText(label);
        row.createSpan('flywheel-health-check-detail').setText(check.detail);
        if (check.fix) {
          row.createDiv('flywheel-health-check-fix').setText(check.fix);
        }
      }

      return issueCount;
    }, 'Comprehensive vault diagnostics — schema, index, embeddings, watcher, suppression, and disk health.');

    // Activity Log section — lazy-loaded with auto-refresh
    this.renderActivityLogSection(content);

    // Orphans section — lazy-loaded
    this.renderLazySection(content, 'Orphan Notes', 'unlink', async (el) => {
      el.addClass('flywheel-health-grid-2col');
      const resp = await this.mcpClient.graphAnalysis('orphans', { limit: 30 });
      const items = (resp as any).orphans ?? (resp as any).results ?? [];
      if (items.length === 0) {
        el.createDiv('flywheel-health-empty-msg').setText('No orphans found');
        return items.length;
      }
      for (const orphan of items.slice(0, 30)) {
        const item = el.createDiv('flywheel-health-item');

        const row = item.createDiv('flywheel-health-action-row');
        const titleEl = row.createDiv('flywheel-health-item-title flywheel-health-clickable');
        titleEl.setText(orphan.title || orphan.path);
        titleEl.addEventListener('click', () => this.app.workspace.openLinkText(orphan.path, '', false));

        const findBtn = row.createEl('button', { cls: 'flywheel-health-action-btn', text: 'Find links' });
        setTooltip(findBtn, 'Scan this note for mentions of known entities, then show suggestions below. Clicking a suggestion wraps the first bare mention of that name in [[wikilinks]] inside the note file.');
        findBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          findBtn.disabled = true;
          findBtn.setText('...');

          try {
            const file = this.app.vault.getAbstractFileByPath(orphan.path);
            if (!(file instanceof TFile)) throw new Error('Not a file');

            const content = await this.app.vault.cachedRead(file);
            const resp = await this.mcpClient.suggestWikilinks(content.slice(0, 5000), true);
            const suggestions = (resp.scored_suggestions ?? [])
              .filter((s: any) => s.confidence === 'high' || s.confidence === 'medium')
              .slice(0, 4);

            if (suggestions.length === 0) {
              findBtn.setText('No suggestions');
              setTooltip(findBtn, 'No known entities were found mentioned in this note\'s text.');
              return;
            }

            findBtn.remove();

            const chipsEl = item.createDiv('flywheel-health-suggestion-chips');
            for (const s of suggestions) {
              const chip = chipsEl.createEl('button', {
                cls: 'flywheel-health-suggestion-chip',
                text: `+ [[${s.entity}]]`,
              });
              setTooltip(chip, `Wrap the first bare mention of '${s.entity}' in this note with [[wikilinks]]. The note file is edited in place.`);
              chip.addEventListener('click', async () => {
                chip.disabled = true;
                try {
                  const escaped = s.entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                  await this.app.vault.process(file, (c: string) => {
                    const pattern = new RegExp(`(?<!\\[\\[)\\b${escaped}\\b(?!\\]\\])`, 'i');
                    return c.replace(pattern, `[[${s.entity}]]`);
                  });
                  chip.setText(`\u2713 ${s.entity}`);
                  chip.addClass('flywheel-health-suggestion-done');
                } catch {
                  chip.setText('Failed');
                }
              });
            }
          } catch (err) {
            findBtn.setText('Failed');
            console.error('Flywheel: failed to find links for orphan', err);
          }
        });

        const folder = orphan.path.split('/').slice(0, -1).join('/');
        if (folder) item.createDiv('flywheel-health-item-path').setText(folder);
      }
      const total = (resp as any).total ?? items.length;
      if (total > 30) {
        el.createDiv('flywheel-health-more').setText(`+${total - 30} more`);
      }
      return total;
    }, 'Notes with no backlinks \u2014 nothing else in the vault links to them. Consider linking them or archiving if obsolete.');

    // Dead Ends section — lazy-loaded
    this.renderLazySection(content, 'Dead Ends', 'arrow-down-to-line', async (el) => {
      el.addClass('flywheel-health-grid-3col');
      const resp = await this.mcpClient.graphAnalysis('dead_ends', { limit: 30 });
      const items = (resp as any).dead_ends ?? (resp as any).results ?? [];
      if (items.length === 0) {
        el.createDiv('flywheel-health-empty-msg').setText('No dead ends \u2014 all linked-to notes have outgoing connections.');
        return items.length;
      }
      for (const note of items.slice(0, 30)) {
        const item = el.createDiv('flywheel-health-item flywheel-health-clickable');
        item.addEventListener('click', () => this.app.workspace.openLinkText(note.path, '', false));

        const row = item.createDiv('flywheel-health-hub-row');
        row.createDiv('flywheel-health-item-title').setText(note.title || note.path);
        if (note.backlinks != null || note.backlink_count != null) {
          const bl = note.backlinks ?? note.backlink_count;
          const badges = row.createDiv('flywheel-health-badges');
          const inBadge = badges.createSpan('flywheel-health-badge flywheel-health-badge-in');
          inBadge.setText(`\u2190 ${bl}`);
          setTooltip(inBadge, `${bl} notes link here, but this note links to nothing — it's a dead end in the graph`);
        }
      }
      const total = (resp as any).total ?? items.length;
      if (total > 30) {
        el.createDiv('flywheel-health-more').setText(`+${total - 30} more`);
      }
      return total;
    }, 'Notes that other notes link to, but that contain no outgoing [[wikilinks]] themselves. They receive attention but don\'t connect readers forward. Add outgoing links to strengthen the graph.');

    // Broken Links section — lazy-loaded, grouped by target with frequency weighting
    this.renderLazySection(content, 'Broken Links', 'unlink', async (el) => {
      el.addClass('flywheel-health-grid-2col');
      const resp = await this.mcpClient.validateLinks(false, 30, true);

      // group_by_target returns targets[]; fall back to broken[] if server returned flat list
      const grouped = resp.targets;
      if (grouped) {
        // Already sorted by mention_count desc from the server, but ensure it
        const items = [...grouped].sort((a, b) => (b.mention_count ?? 0) - (a.mention_count ?? 0));
        if (items.length === 0) {
          el.createDiv('flywheel-health-empty-msg').setText('No broken links found');
          return 0;
        }

        const renderBrokenItems = async (container: HTMLElement, itemList: typeof items) => {
          for (const item of itemList) {
            const row = container.createDiv('flywheel-health-item');
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.gap = '6px';

            // Frequency-weighted entity name
            const count = item.mention_count ?? 1;
            const nameEl = row.createSpan('flywheel-health-broken-target');
            nameEl.setText(item.target);
            if (count >= 6) {
              nameEl.style.fontWeight = '700';
              nameEl.style.fontSize = '14px';
            } else if (count >= 3) {
              nameEl.style.fontWeight = '600';
              nameEl.style.fontSize = '13px';
            } else {
              nameEl.style.fontWeight = '400';
              nameEl.style.fontSize = '12px';
            }

            // Frequency badge
            const badge = row.createSpan('flywheel-health-broken-badge');
            badge.setText(`${count}`);
            setTooltip(badge, `[[${item.target}]] appears ${count} time${count !== 1 ? 's' : ''} across the vault but no note called '${item.target}' exists`);

            // Create button
            const createBtn = row.createEl('button', { cls: 'flywheel-health-create-btn' });
            createBtn.setText('+');
            setTooltip(createBtn, `Create a new empty note called '${item.target}'. This resolves all ${count} broken [[${item.target}]] references across the vault.`);
            createBtn.addEventListener('click', async (e) => {
              e.stopPropagation();
              try {
                await this.mcpClient.createNote(item.target, `# ${item.target}\n\n`);
                row.remove();
              } catch (err) {
                console.error('Flywheel Crank: failed to create note', err);
              }
            });
          }
        };

        await renderBrokenItems(el, items);
        const total = resp.total_dead_targets ?? items.length;
        if (total > 30) {
          el.createDiv('flywheel-health-more').setText(`+${total - 30} more`);
        }
        return total;
      }

      // Fallback: flat broken[] list (old server version)
      const flatItems = resp.broken ?? [];
      if (flatItems.length === 0) {
        el.createDiv('flywheel-health-empty-msg').setText('No broken links found');
        return 0;
      }
      for (const broken of flatItems) {
        const item = el.createDiv('flywheel-health-item flywheel-health-clickable');
        item.addEventListener('click', () => this.app.workspace.openLinkText(broken.source, '', false));

        const row = item.createDiv('flywheel-health-broken-row');

        const sourceEl = row.createSpan('flywheel-health-broken-source flywheel-health-clickable');
        const sourceTitle = broken.source.replace(/\.md$/, '').split('/').pop() || broken.source;
        sourceEl.setText(sourceTitle);
        sourceEl.addEventListener('click', (e) => { e.stopPropagation(); this.app.workspace.openLinkText(broken.source, '', false); });

        row.createSpan('flywheel-health-broken-arrow').setText('\u2192');
        row.createSpan('flywheel-health-broken-target').setText(broken.target);

        const pathEl = item.createDiv('flywheel-health-item-path');
        pathEl.setText(broken.source.replace(/\.md$/, ''));

        if (broken.suggestion) {
          const suggestionName = broken.suggestion.replace(/\.md$/, '').split('/').pop() || broken.suggestion;
          const fixRow = item.createDiv('flywheel-health-broken-fix-row');
          const badge = fixRow.createSpan('flywheel-health-broken-suggestion');
          badge.setText(`\u2192 ${suggestionName}`);
          const fixBtn = fixRow.createSpan('flywheel-health-fix-btn');
          setIcon(fixBtn, 'pencil');
          fixBtn.createSpan({ cls: 'flywheel-health-fix-btn-label', text: 'Fix' });
          setTooltip(fixBtn, `Fix: replace [[${broken.target}]] with [[${suggestionName}]]`);
          fixBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
              const file = this.app.vault.getAbstractFileByPath(broken.source);
              if (file instanceof TFile) {
                const content = await this.app.vault.cachedRead(file);
                const newContent = content.replace(`[[${broken.target}]]`, `[[${suggestionName}]]`);
                if (newContent !== content) {
                  await this.app.vault.modify(file, newContent);
                  fixBtn.empty();
                  setIcon(fixBtn, 'check');
                  fixBtn.addClass('flywheel-health-fix-btn-done');
                }
              }
            } catch (err) {
              console.error('Flywheel Crank: failed to fix broken link', err);
            }
          });
        }
      }
      const total = resp.broken_links ?? flatItems.length;
      if (total > 30) {
        el.createDiv('flywheel-health-more').setText(`+${total - 30} more`);
      }
      return total;
    }, '[[Wikilinks]] pointing to notes that don\'t exist in the vault. Sorted by frequency — bolder = more references. Click + to create the missing note.');

    // Stale Notes section — predict_stale_notes
    this.renderLazySection(content, 'Stale Notes', 'clock', async (el) => {
      const resp = await this.mcpClient.predictStaleNotes(30, 10, 20);
      const notes = resp.notes ?? [];
      if (notes.length === 0) {
        el.createDiv('flywheel-health-empty-msg').setText('No stale notes found \u2014 important notes are up to date.');
        return 0;
      }
      const recColors: Record<string, string> = {
        archive: 'flywheel-health-badge-stale-archive',
        update: 'flywheel-health-badge-stale-update',
        review: 'flywheel-health-badge-stale-review',
        low_priority: 'flywheel-health-badge-stale-low',
      };
      for (const note of notes) {
        const item = el.createDiv('flywheel-health-item flywheel-health-clickable');
        item.addEventListener('click', () => this.app.workspace.openLinkText(note.path, '', false));

        const row = item.createDiv('flywheel-health-hub-row flywheel-health-action-row');
        row.createDiv('flywheel-health-item-title').setText(note.title || note.path);

        const badges = row.createDiv('flywheel-health-badges');

        // Recommendation badge
        const recBadge = badges.createSpan(`flywheel-health-badge ${recColors[note.recommendation] ?? ''}`);
        recBadge.setText(note.recommendation.replace('_', ' '));

        // Days stale
        const ageBadge = badges.createSpan('flywheel-health-badge flywheel-health-badge-out');
        ageBadge.setText(`${note.days_stale}d`);

        // Tooltip with signal breakdown
        const sig = note.signals;
        setTooltip(item, [
          `Importance: ${note.importance} \u2022 Staleness risk: ${note.staleness_risk}`,
          `Backlinks: ${sig.backlink_count} \u2022 Hub score: ${sig.hub_score}`,
          `Outlinks: ${sig.outlink_count} \u2022 Active entity ratio: ${Math.round(sig.active_entity_ratio * 100)}%`,
          sig.has_open_tasks ? 'Has open tasks' : '',
          sig.status_active ? 'Status: active' : '',
        ].filter(Boolean).join('\n'));

        const reviewBtn = row.createEl('button', { cls: 'flywheel-health-action-btn', text: 'Review' });
        reviewBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.app.workspace.openLinkText(note.path, '', false);
        });
      }
      if (resp.total_count > notes.length) {
        el.createDiv('flywheel-health-more').setText(`+${resp.total_count - notes.length} more`);
      }
      return resp.total_count;
    }, 'Notes predicted to be stale based on multiple signals: age, backlink importance, hub score, open tasks, and entity activity. Recommendations: update (high-value, needs refresh), review (has open tasks or active status), archive (low-value, very old).');

    // Immature Notes section — lazy-loaded
    this.renderLazySection(content, 'Immature Notes', 'sprout', async (el) => {
      el.addClass('flywheel-health-grid-2col');
      const resp = await this.mcpClient.graphAnalysis('immature', { limit: 20 });
      const items = (resp as any).notes ?? (resp as any).immature_notes ?? [];
      if (items.length === 0) {
        el.createDiv('flywheel-health-empty-msg').setText('No immature notes found');
        return items.length;
      }
      for (const note of items.slice(0, 20)) {
        const item = el.createDiv('flywheel-health-item flywheel-health-clickable');
        item.addEventListener('click', () => this.app.workspace.openLinkText(note.path, '', false));

        const row = item.createDiv('flywheel-health-hub-row flywheel-health-action-row');
        row.createDiv('flywheel-health-item-title').setText(note.title || note.path);

        const badges = row.createDiv('flywheel-health-badges');
        // Immature notes have components: { word_count: { value, score }, outlinks: { value, score }, ... }
        const wc = note.components?.word_count?.value ?? note.word_count;
        if (wc != null) {
          const wcBadge = badges.createSpan('flywheel-health-badge flywheel-health-badge-out');
          wcBadge.setText(`${wc}w`);
          setTooltip(wcBadge, `${wc} words`);
        }
        const outlinks = note.components?.outlinks?.value ?? note.forward_links ?? note.outlinks ?? 0;
        if (outlinks > 0) {
          const linkBadge = badges.createSpan('flywheel-health-badge flywheel-health-badge-out');
          linkBadge.setText(`${outlinks} links`);
          setTooltip(linkBadge, `${outlinks} outgoing [[wikilinks]]`);
        }
        if (note.maturity_score != null) {
          const pct = Math.round(note.maturity_score * 100);
          const scoreBadge = badges.createSpan('flywheel-health-badge flywheel-health-badge-in');
          scoreBadge.setText(`${pct}%`);
          setTooltip(scoreBadge, `Maturity: ${pct}%. Scored on word count, outgoing links, and frontmatter completeness vs other notes in the same folder. 100% = fully developed.`);
        }

        const enrichBtn = row.createEl('button', { cls: 'flywheel-health-action-btn', text: 'Enrich' });
        setTooltip(enrichBtn, 'Check what frontmatter fields other notes in the same folder have (e.g. type, status, tags). If ≥50% of peers have a field this note is missing, add it with the most common value.');
        enrichBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          enrichBtn.disabled = true;
          enrichBtn.setText('...');

          try {
            const folder = note.path.split('/').slice(0, -1).join('/') || '/';
            const conventions = await this.mcpClient.folderConventions(folder);
            const missingFields: Record<string, string> = {};

            for (const field of (conventions as any).inferred_fields ?? []) {
              if (field.frequency >= 0.5 && field.suggested_value) {
                missingFields[field.name] = field.suggested_value;
              }
            }

            if (Object.keys(missingFields).length === 0) {
              enrichBtn.setText('No fields');
              setTooltip(enrichBtn, 'All frontmatter fields that ≥50% of folder peers have are already present in this note.');
              return;
            }

            await this.mcpClient.updateFrontmatter(note.path, missingFields, true);
            enrichBtn.setText('\u2713 Updated');
            enrichBtn.addClass('flywheel-health-action-done');
          } catch (err) {
            enrichBtn.setText('Failed');
            console.error('Flywheel: failed to enrich note', err);
          }
        });
      }
      const total = (resp as any).total ?? items.length;
      if (total > 20) {
        el.createDiv('flywheel-health-more').setText(`+${total - 20} more`);
      }
      return total;
    }, 'Notes scored by maturity: word count, outgoing links, frontmatter completeness vs folder peers, and backlinks. Low scores indicate stub or underdeveloped notes that would benefit from expansion.');

    // Emerging Hubs section — lazy-loaded
    this.renderLazySection(content, 'Emerging Hubs', 'trending-up', async (el) => {
      el.addClass('flywheel-health-grid-2col');
      const resp = await this.mcpClient.graphAnalysis('emerging_hubs', { limit: 15 });
      const items = (resp as any).hubs ?? (resp as any).emerging_hubs ?? [];
      if (items.length === 0) {
        el.createDiv('flywheel-health-empty-msg').setText('No emerging hubs found');
        return items.length;
      }
      for (const hub of items.slice(0, 15)) {
        const item = el.createDiv('flywheel-health-item flywheel-health-clickable');
        const path = hub.path || hub.entity || '';
        if (path) {
          item.addEventListener('click', () => this.app.workspace.openLinkText(path, '', false));
        }

        const row = item.createDiv('flywheel-health-hub-row');
        row.createDiv('flywheel-health-item-title').setText(hub.title || hub.entity || path);

        const badges = row.createDiv('flywheel-health-badges');
        if (hub.growth != null || hub.growth_rate != null) {
          const val = hub.growth ?? hub.growth_rate;
          const growthBadge = badges.createSpan('flywheel-health-badge flywheel-health-badge-growth');
          growthBadge.setText(`+${val}`);
          setTooltip(growthBadge, `Gained ${val} new backlinks in the measurement window`);
        }
        if (hub.backlinks != null || hub.backlink_count != null) {
          const bl = hub.backlinks ?? hub.backlink_count;
          const inBadge = badges.createSpan('flywheel-health-badge flywheel-health-badge-in');
          inBadge.setText(`\u2190 ${bl}`);
          setTooltip(inBadge, `${bl} notes contain a [[link]] to this note`);
        }
      }
      const total = (resp as any).total ?? items.length;
      if (total > 15) {
        el.createDiv('flywheel-health-more').setText(`+${total - 15} more`);
      }
      return total;
    }, 'Notes gaining backlinks recently \u2014 these are becoming central topics in your vault.');

    // Knowledge Gaps — co-occurrence gaps
    this.renderLazySection(content, 'Knowledge Gaps', 'puzzle', async (el) => {
      const resp = await this.mcpClient.discoverCooccurrenceGaps(5, 20);
      const gaps = resp.gaps ?? [];
      if (gaps.length === 0) {
        el.createDiv('flywheel-health-empty-msg').setText('No knowledge gaps found \u2014 all frequently co-occurring entity pairs have backing notes.');
        return 0;
      }
      for (const gap of gaps) {
        const row = el.createDiv('flywheel-health-item');
        const inner = row.createDiv('flywheel-health-gap-row');

        const aEl = inner.createSpan(gap.a_has_note ? 'flywheel-health-gap-entity' : 'flywheel-health-gap-entity flywheel-health-gap-missing');
        aEl.setText(gap.entity_a);
        if (gap.a_has_note) {
          aEl.addClass('flywheel-health-clickable');
          aEl.addEventListener('click', () => this.app.workspace.openLinkText(gap.entity_a + '.md', '', false));
        }

        inner.createSpan('flywheel-health-gap-arrow').setText('\u2194');

        const bEl = inner.createSpan(gap.b_has_note ? 'flywheel-health-gap-entity' : 'flywheel-health-gap-entity flywheel-health-gap-missing');
        bEl.setText(gap.entity_b);
        if (gap.b_has_note) {
          bEl.addClass('flywheel-health-clickable');
          bEl.addEventListener('click', () => this.app.workspace.openLinkText(gap.entity_b + '.md', '', false));
        }

        const countBadge = inner.createSpan('flywheel-health-badge');
        countBadge.setText(`${gap.cooccurrence_count}x`);
        setTooltip(countBadge, `Co-occur in ${gap.cooccurrence_count} notes`);

        // Create button for the entity missing a note
        const missingEntity = !gap.a_has_note ? gap.entity_a : !gap.b_has_note ? gap.entity_b : null;
        if (missingEntity) {
          const createBtn = inner.createEl('button', { cls: 'flywheel-health-action-btn', text: 'Create' });
          setTooltip(createBtn, `Create a note for "${missingEntity}"`);
          createBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            createBtn.disabled = true;
            createBtn.setText('...');
            try {
              await this.mcpClient.createNote(missingEntity, '');
              this.app.workspace.openLinkText(missingEntity + '.md', '', false);
              createBtn.setText('\u2713');
              createBtn.addClass('flywheel-health-fix-btn-done');
            } catch (err) {
              createBtn.setText('Failed');
              createBtn.disabled = false;
            }
          });
        }
      }
      if (resp.total_gaps > gaps.length) {
        el.createDiv('flywheel-health-more').setText(`+${resp.total_gaps - gaps.length} more`);
      }
      return resp.total_gaps;
    }, 'Entity pairs that frequently appear together in your notes but where one or both lack a dedicated note. Creating the missing note strengthens the knowledge graph.');

    // Growth section — lazy-loaded
    this.renderLazySection(content, 'Growth', 'bar-chart-3', async (el) => {
      let itemCount = 0;

      // Recent activity from vaultStats
      try {
        const stats = await this.mcpClient.vaultStats();
        const activity = stats.recent_activity;
        if (activity) {
          const activityDiv = el.createDiv('flywheel-health-growth-block');
          activityDiv.createDiv('flywheel-health-growth-label').setText(`Last ${activity.period_days} days`);

          const row = activityDiv.createDiv('flywheel-health-growth-stats');
          this.renderGrowthStat(row, 'file-plus', `${activity.notes_created}`, 'created');
          this.renderGrowthStat(row, 'file-edit', `${activity.notes_modified}`, 'modified');
          if (activity.most_active_day) {
            this.renderGrowthStat(row, 'calendar', activity.most_active_day, 'most active');
          }
          itemCount++;
        }
      } catch { /* ignore */ }

      // Trends from vaultGrowth
      try {
        const growth = await this.mcpClient.vaultGrowth('trends');
        const trends = growth.trends ?? [];
        if (trends.length > 0) {
          const trendsDiv = el.createDiv('flywheel-health-growth-block');
          trendsDiv.createDiv('flywheel-health-growth-label').setText('Trends');

          const trendTooltips: Record<string, string> = {
            'note_count': 'Total notes in the vault',
            'link_count': 'Total [[wikilinks]] across all notes',
            'orphan_count': 'Notes with zero backlinks',
            'tag_count': 'Unique #tags used',
            'entity_count': 'People, tools, topics detected',
            'avg_links_per_note': 'Average outgoing [[wikilinks]] per note',
            'link_density': 'Links ÷ (notes × entities) — how interconnected the vault is. Higher = denser graph.',
            'connected_ratio': 'Fraction of notes that have at least one backlink. 1.0 = no orphans.',
            'wikilink_accuracy': '% of auto-suggested wikilinks that were accepted by the user',
            'wikilink_feedback_volume': 'Total accept/reject feedback events recorded',
            'wikilink_suppressed_count': 'Entities blocked from future wikilink suggestions due to low accuracy',
          };

          const trendsGrid = trendsDiv.createDiv('flywheel-health-trends-grid');
          for (const trend of trends) {
            const trendRow = trendsGrid.createDiv('flywheel-health-trend-row');
            const label = trendRow.createSpan('flywheel-health-trend-metric');
            label.setText(trend.metric.replace(/_/g, ' '));

            const tooltip = trendTooltips[trend.metric];
            if (tooltip) setTooltip(trendRow, tooltip);

            const value = trendRow.createSpan('flywheel-health-trend-value');
            value.setText(`${trend.current}`);

            const delta = trendRow.createSpan('flywheel-health-trend-delta');
            delta.setText(this.formatDelta(trend.delta));
            if (trend.delta > 0) delta.addClass('flywheel-health-trend-up');
            else if (trend.delta < 0) delta.addClass('flywheel-health-trend-down');
          }
          itemCount += trends.length;
        }
      } catch { /* ignore */ }

      if (itemCount === 0) {
        el.createDiv('flywheel-health-empty-msg').setText('No growth data available');
      }
      return itemCount;
    }, 'Vault activity trends: notes created/modified recently and how key metrics are changing over time.');

    // Wikilink Feedback section — lazy-loaded
    this.renderLazySection(content, 'Wikilink Feedback', 'message-square', async (el) => {
      const resp = await this.mcpClient.wikilinkFeedback('stats');
      const stats = resp.stats ?? [];
      const totalFeedback = resp.total_feedback ?? 0;
      const totalSuppressed = resp.total_suppressed ?? 0;

      if (totalFeedback === 0) {
        el.createDiv('flywheel-health-empty-msg').setText('No wikilink feedback yet.');
        return 0;
      }

      // Summary
      const totalCorrect = stats.reduce((sum, s) => sum + s.correct, 0);
      const overallAccuracy = totalFeedback > 0 ? Math.round((totalCorrect / totalFeedback) * 100) : 0;
      this.renderInfoRow(el, 'Total feedback', `${totalFeedback}`);
      this.renderInfoRow(el, 'Overall accuracy', `${overallAccuracy}%`);
      if (totalSuppressed > 0) {
        this.renderInfoRow(el, 'Suppressed entities', `${totalSuppressed}`);
      }

      // Per-entity accuracy table (top 15)
      if (stats.length > 0) {
        const feedbackGrid = el.createDiv('flywheel-health-feedback-grid');
        for (const entity of stats.slice(0, 15)) {
          const row = feedbackGrid.createDiv('flywheel-health-feedback-entity-row');
          const nameEl = row.createSpan('flywheel-health-feedback-entity-name');
          nameEl.setText(entity.entity);
          const acc_ = Math.round(entity.accuracy * 100);
          const kept_ = Math.round(entity.accuracy * entity.total);
          setTooltip(nameEl, `[[${entity.entity}]] — ${acc_}% accuracy (${kept_} kept of ${entity.total})${entity.suppressed ? ' · suppressed from future suggestions' : ''}`);
          if (entity.suppressed) {
            nameEl.addClass('flywheel-health-feedback-suppressed');
          }

          const badges = row.createDiv('flywheel-health-badges');
          const accBadge = badges.createSpan('flywheel-health-badge');
          const acc = Math.round(entity.accuracy * 100);
          const kept = Math.round(entity.accuracy * entity.total);
          accBadge.setText(`${acc}%`);
          setTooltip(accBadge, `${acc}% of [[${entity.entity}]] wikilink insertions were kept by the user (${kept} of ${entity.total})`);
          if (acc >= 70) {
            accBadge.addClass('flywheel-health-badge-growth');
          } else if (acc <= 30) {
            accBadge.addClass('flywheel-health-badge-in');
          } else {
            accBadge.addClass('flywheel-health-badge-out');
          }

          const countBadge = badges.createSpan('flywheel-health-badge flywheel-health-badge-out');
          countBadge.setText(`n=${entity.total}`);
          setTooltip(countBadge, `${entity.total} total observations — each time a [[${entity.entity}]] wikilink was inserted and then kept or removed`);
        }
      }

      return totalFeedback;
    }, 'Tracks how often wikilink suggestions from the suggest_wikilinks tool were accepted vs rejected. Feedback accumulates as you use the wikilink suggestion feature in your notes.');

    // Suppressed & Boosted section — lazy-loaded from dashboard
    this.renderLazySection(content, 'Suppressed & Boosted', 'shield', async (el) => {
      const resp = await this.mcpClient.wikilinkFeedbackDashboard();
      const d = resp.dashboard;
      const suppressed = d.suppressed ?? [];
      const boostTiers = d.boost_tiers ?? [];
      const allBoosted = boostTiers.flatMap(t => t.entities.map(e => ({ ...e, boost: t.boost, label: t.label })));
      let count = 0;

      // Suppressed entities
      if (suppressed.length > 0) {
        const group = el.createDiv('flywheel-health-info-group');
        group.createDiv('flywheel-health-info-group-label').setText('Suppressed');
        const grid = group.createDiv('flywheel-health-sb-grid');
        for (const s of suppressed) {
          const row = grid.createDiv('flywheel-health-sb-row flywheel-health-sb-suppressed');
          const nameEl = row.createSpan('flywheel-health-sb-name');
          nameEl.setText(s.entity);
          const fpr = Math.round(s.false_positive_rate * 100);
          const badge = row.createSpan('flywheel-health-badge flywheel-health-badge-in');
          badge.setText(`${fpr}% rejected`);

          const unBtn = row.createEl('button', { cls: 'flywheel-health-action-btn', text: 'Unsuppress' });
          setTooltip(unBtn, `Remove [[${s.entity}]] from the suppression list so it can be suggested as a wikilink again. It may get re-suppressed if users keep removing it.`);
          unBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            unBtn.disabled = true;
            unBtn.setText('...');
            try {
              await this.mcpClient.unsuppressEntity(s.entity);
              row.remove();
            } catch (err) {
              unBtn.setText('Failed');
              console.error('Flywheel: failed to unsuppress entity', err);
            }
          });

          setTooltip(nameEl, `[[${s.entity}]] is blocked from wikilink suggestions — ${fpr}% of insertions were removed. Click Unsuppress to re-enable.`);
          count++;
        }
      }

      // Boosted entities
      if (allBoosted.length > 0) {
        const group = el.createDiv('flywheel-health-info-group');
        group.createDiv('flywheel-health-info-group-label').setText('Boosted');
        const grid = group.createDiv('flywheel-health-sb-grid');
        for (const b of allBoosted) {
          const row = grid.createDiv('flywheel-health-sb-row');
          const nameEl = row.createSpan('flywheel-health-sb-name');
          nameEl.setText(b.entity);
          const badge = row.createSpan('flywheel-health-badge flywheel-health-badge-growth');
          badge.setText(`+${b.boost}`);
          const accBadge = row.createSpan('flywheel-health-badge flywheel-health-badge-out');
          const acc = Math.round(b.accuracy * 100);
          accBadge.setText(`${acc}%`);
          setTooltip(row, `[[${b.entity}]] gets a +${b.boost} score boost (${b.label}) — ${acc}% accuracy over ${b.total} observations.`);
          count++;
        }
      }

      if (count === 0) {
        el.createDiv('flywheel-health-empty-msg').setText('No suppressed or boosted entities yet — needs more feedback data.');
      }

      return count;
    }, 'Suppressed entities are blocked from wikilink suggestions because users kept removing them. Click Unsuppress to give one another chance. Boosted entities get a score bonus because their wikilinks are consistently kept.');
  }

  private renderStat(container: HTMLDivElement, icon: string, value: string, label: string): HTMLDivElement {
    const stat = container.createDiv('flywheel-health-stat');
    const iconEl = stat.createDiv('flywheel-health-stat-icon');
    setIcon(iconEl, icon);
    stat.createDiv('flywheel-health-stat-value').setText(value);
    stat.createDiv('flywheel-health-stat-label').setText(label);
    return stat;
  }

  /** Populate the stats bar from cached health data (no MCP calls). */
  private loadStatsBar(
    notesStat: HTMLDivElement,
    entitiesStat: HTMLDivElement,
    tagsStat: HTMLDivElement,
    linksStat: HTMLDivElement,
  ): void {
    const health = this.mcpClient.lastHealth;
    if (!health) return;

    const setStatValue = (el: HTMLDivElement, value: string) => {
      const valueEl = el.querySelector('.flywheel-health-stat-value');
      if (valueEl) valueEl.setText(value);
    };

    setStatValue(notesStat, `${health.note_count}`);
    setStatValue(entitiesStat, `${health.entity_count}`);
    setStatValue(tagsStat, `${health.tag_count}`);
    setStatValue(linksStat, `${health.link_count ?? '—'}`);
  }

  private renderGrowthStat(container: HTMLDivElement, icon: string, value: string, label: string): void {
    const stat = container.createDiv('flywheel-health-growth-stat');
    const iconEl = stat.createDiv('flywheel-health-growth-stat-icon');
    setIcon(iconEl, icon);
    stat.createDiv('flywheel-health-growth-stat-value').setText(value);
    stat.createDiv('flywheel-health-growth-stat-label').setText(label);
  }

  /** Render vault config into a container. Returns item count. */
  private renderVaultConfig(el: HTMLDivElement, cfg: Record<string, any>): number {
    let count = 0;

    // General config fields
    const scalarLabels: Record<string, string> = {
      vault_name: 'Vault name',
      wikilink_strictness: 'Wikilink strictness',
      implicit_detection: 'Implicit detection',
      adaptive_strictness: 'Adaptive strictness',
      proactive_linking: 'Proactive linking',
      proactive_min_score: 'Proactive min score',
      proactive_max_per_file: 'Proactive max/file',
      proactive_max_per_day: 'Proactive max/day',
      tool_tier_override: 'Tool tier override',
    };
    const skipKeys = new Set(['paths', 'templates', 'exclude', 'exclude_entity_folders', 'custom_categories',
      'exclude_task_tags', 'exclude_analysis_tags', 'exclude_entities']);
    for (const [key, label] of Object.entries(scalarLabels)) {
      if (cfg[key] != null) {
        this.renderInfoRow(el, label, String(cfg[key]));
        count++;
      }
    }
    // Remaining scalar keys not in the label map or skip list
    for (const [key, value] of Object.entries(cfg)) {
      if (scalarLabels[key] || skipKeys.has(key) || value == null) continue;
      if (typeof value !== 'object') {
        this.renderInfoRow(el, key, String(value));
        count++;
      }
    }

    // Exclusions
    const exclude = cfg.exclude as string[] | undefined;
    if (exclude && exclude.length > 0) {
      this.renderInfoRow(el, 'Exclusions', exclude.join(', '));
      count++;
    }
    const excludeFolders = cfg.exclude_entity_folders as string[] | undefined;
    if (excludeFolders && excludeFolders.length > 0) {
      this.renderInfoRow(el, 'Excluded folders', excludeFolders.join(', '));
      count++;
    }

    // Periodic note paths
    const paths = cfg.paths as Record<string, string> | undefined;
    if (paths && Object.keys(paths).length > 0) {
      const labels: Record<string, string> = {
        daily_notes: 'Daily', weekly_notes: 'Weekly', monthly_notes: 'Monthly',
        quarterly_notes: 'Quarterly', yearly_notes: 'Yearly', templates: 'Templates',
      };
      for (const [key, path] of Object.entries(paths)) {
        if (path) { this.renderInfoRow(el, labels[key] ?? key, path); count++; }
      }
    }

    // Templates
    const templates = cfg.templates as Record<string, string> | undefined;
    if (templates && Object.keys(templates).length > 0) {
      const tplLabels: Record<string, string> = {
        daily: 'Daily tpl', weekly: 'Weekly tpl', monthly: 'Monthly tpl',
        quarterly: 'Quarterly tpl', yearly: 'Yearly tpl',
      };
      for (const [key, path] of Object.entries(templates)) {
        if (path) { this.renderInfoRow(el, tplLabels[key] ?? key, path); count++; }
      }
    }

    return count;
  }

  private renderInfoRow(container: HTMLDivElement, label: string, value: string): void {
    const row = container.createDiv('flywheel-health-info-row');
    row.createSpan('flywheel-health-info-label').setText(label);
    row.createSpan('flywheel-health-info-value').setText(value);
  }

  /** Format seconds into a human-readable age string. */
  private formatAge(seconds: number): string {
    if (seconds < 0) return 'unknown';
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  /** Format a numeric delta for display — avoids floating point artifacts. */
  private formatDelta(value: number): string {
    const sign = value >= 0 ? '+' : '';
    if (Number.isInteger(value)) return `${sign}${value}`;
    const abs = Math.abs(value);
    if (abs < 1) return `${sign}${value.toPrecision(3)}`;
    return `${sign}${value.toFixed(2)}`;
  }

  /**
   * Render a collapsible section that lazy-loads data on first expand.
   * Starts collapsed. On first click, calls loadContent to populate.
   */
  private renderLazySection(
    container: HTMLDivElement,
    title: string,
    icon: string,
    loadContent: (el: HTMLDivElement) => Promise<number>,
    info?: string,
  ): void {
    const isCollapsed = this.sectionCollapsed.get(title) ?? true;
    const section = container.createDiv(`flywheel-health-section${isCollapsed ? ' is-collapsed' : ''}`);

    const header = section.createDiv('flywheel-health-section-header');

    const iconEl = header.createSpan('flywheel-health-section-icon');
    setIcon(iconEl, icon);
    header.createSpan('flywheel-health-section-title').setText(title);

    if (info) {
      const infoIcon = header.createSpan('flywheel-health-section-info');
      setIcon(infoIcon, 'info');
      setTooltip(infoIcon, info);
      infoIcon.addEventListener('click', (e) => e.stopPropagation());
    }

    const countBadge = header.createSpan('flywheel-health-section-count');
    countBadge.setText('...');

    const chevron = header.createSpan('flywheel-health-section-chevron');
    setIcon(chevron, 'chevron-down');

    const contentEl = section.createDiv('flywheel-health-section-content');

    // Auto-load if section starts expanded (remembered from previous interaction)
    if (!isCollapsed && !this.loadedSections.has(title)) {
      this.loadedSections.add(title);
      const loadingDiv = contentEl.createDiv('flywheel-health-empty-msg');
      loadingDiv.setText('Loading...');
      loadContent(contentEl).then((count) => {
        loadingDiv.remove();
        countBadge.setText(`${count}`);
        if (count > 0 && (title === 'Orphan Notes' || title === 'Dead Ends' || title === 'Broken Links')) {
          countBadge.addClass('flywheel-health-count-warn');
        }
      }).catch((err) => {
        loadingDiv.setText(`Failed to load: ${err instanceof Error ? err.message : 'unknown error'}`);
        countBadge.setText('!');
        countBadge.addClass('flywheel-health-count-warn');
        this.loadedSections.delete(title);
      });
    }

    header.addEventListener('click', async () => {
      const wasCollapsed = section.hasClass('is-collapsed');
      section.toggleClass('is-collapsed', !wasCollapsed);
      this.sectionCollapsed.set(title, !wasCollapsed);

      // Lazy-load on first expand
      if (wasCollapsed && !this.loadedSections.has(title)) {
        this.loadedSections.add(title);
        contentEl.empty();
        const loadingDiv = contentEl.createDiv('flywheel-health-empty-msg');
        loadingDiv.setText('Loading...');

        try {
          const count = await loadContent(contentEl);
          loadingDiv.remove();
          countBadge.setText(`${count}`);
          if (count > 0 && (title === 'Orphan Notes' || title === 'Dead Ends' || title === 'Broken Links')) {
            countBadge.addClass('flywheel-health-count-warn');
          }
        } catch (err) {
          loadingDiv.setText(`Failed to load: ${err instanceof Error ? err.message : 'unknown error'}`);
          countBadge.setText('!');
          countBadge.addClass('flywheel-health-count-warn');
          // Allow retry
          this.loadedSections.delete(title);
        }
      }
    });
  }

  /**
   * Render the Activity Log section showing recent pipeline runs from health data.
   */
  private renderActivityLogSection(container: HTMLDivElement): void {
    const title = 'Activity Log';
    const isCollapsed = this.sectionCollapsed.get(title) ?? true;
    const section = container.createDiv(`flywheel-health-section${isCollapsed ? ' is-collapsed' : ''}`);

    const header = section.createDiv('flywheel-health-section-header');
    const iconEl = header.createSpan('flywheel-health-section-icon');
    setIcon(iconEl, 'activity');
    header.createSpan('flywheel-health-section-title').setText(title);

    const infoIcon = header.createSpan('flywheel-health-section-info');
    setIcon(infoIcon, 'info');
    setTooltip(infoIcon, 'Recent pipeline runs showing what changed in your vault — entities discovered, wikilinks applied, and feedback learned.');
    infoIcon.addEventListener('click', (e) => e.stopPropagation());

    const countBadge = header.createSpan('flywheel-health-section-count');
    countBadge.setText('...');

    const chevron = header.createSpan('flywheel-health-section-chevron');
    setIcon(chevron, 'chevron-down');

    const contentEl = section.createDiv('flywheel-health-section-content');

    let lastPipelineTs = 0;

    const populateLog = async () => {
      // Try pipeline_status first (new tool), fall back to health data
      let pipelines: Array<{
        timestamp: number; trigger: string; duration_ms: number;
        files_changed: number | null;
        step_count?: number;
        steps?: import('../mcp/client').McpCompactStep[];
      }> = [];

      try {
        const ps = await this.mcpClient.pipelineStatus(true);
        if (ps.recent_runs && ps.recent_runs.length > 0) {
          pipelines = ps.recent_runs;
        }
      } catch {
        // Fall back to health data (older server without pipeline_status)
        const health = this.mcpClient.lastHealth;
        if (health) {
          pipelines = health.recent_pipelines?.length
            ? health.recent_pipelines
            : health.last_pipeline ? [{ ...health.last_pipeline }] : [];
        }
      }

      if (pipelines.length === 0) {
        if (lastPipelineTs === 0) {
          contentEl.empty();
          contentEl.createDiv('flywheel-health-empty-msg').setText('No pipeline runs yet.');
        }
        countBadge.setText('0');
        return;
      }

      // Only re-render if there are new pipelines
      const newestTs = pipelines[0]?.timestamp ?? 0;
      if (newestTs <= lastPipelineTs) return;
      lastPipelineTs = newestTs;

      contentEl.empty();
      const logContainer = contentEl.createDiv('flywheel-activity-log');
      countBadge.setText(`${pipelines.length}`);

      for (const pipeline of pipelines) {
        this.renderPipelineEntry(logContainer, pipeline);
      }
    };

    const startAutoRefresh = () => {
      if (this.activityLogInterval) return;
      this.activityLogInterval = setInterval(populateLog, 3000);
    };

    const stopAutoRefresh = () => {
      if (this.activityLogInterval) {
        clearInterval(this.activityLogInterval);
        this.activityLogInterval = null;
      }
    };

    // Auto-load if section starts expanded
    if (!isCollapsed) {
      populateLog();
      startAutoRefresh();
    }

    header.addEventListener('click', () => {
      const wasCollapsed = section.hasClass('is-collapsed');
      section.toggleClass('is-collapsed', !wasCollapsed);
      this.sectionCollapsed.set(title, !wasCollapsed);

      if (wasCollapsed) {
        populateLog();
        startAutoRefresh();
      } else {
        stopAutoRefresh();
      }
    });
  }

  /** Render a single pipeline run entry. */
  private renderPipelineEntry(
    container: HTMLDivElement,
    pipeline: { timestamp: number; trigger: string; duration_ms: number; files_changed: number | null; step_count?: number; steps?: McpCompactStep[] },
  ): void {
    const row = container.createDiv('flywheel-activity-entry');

    // Timestamp
    const tsEl = row.createSpan('flywheel-activity-ts');
    tsEl.setText(this.formatRelativeTime(pipeline.timestamp));

    // Trigger badge
    const badge = row.createSpan(`flywheel-activity-badge flywheel-activity-badge-${pipeline.trigger}`);
    badge.setText(pipeline.trigger);

    // Summary: files changed + duration
    const fileCount = pipeline.files_changed ?? 0;
    const summary = fileCount === 1
      ? `1 file`
      : fileCount > 0 ? `${fileCount} files` : 'no changes';
    row.createSpan('flywheel-activity-msg').setText(`${summary} \u00B7 ${pipeline.duration_ms}ms`);

    // Step details (collapsible)
    const steps = pipeline.steps ?? [];
    if (steps.length > 0) {
      const stepsEl = row.createDiv('flywheel-pipeline-steps');
      for (const step of steps) {
        if (step.skipped) continue;
        const stepRow = stepsEl.createDiv('flywheel-pipeline-step');
        stepRow.createSpan('flywheel-pipeline-step-name').setText(step.name);
        const durationSec = step.duration_ms >= 1000
          ? `${(step.duration_ms / 1000).toFixed(1)}s`
          : `${step.duration_ms}ms`;
        stepRow.createSpan('flywheel-pipeline-step-duration').setText(durationSec);

        // Render meaningful output summaries per step
        const outputSummary = this.summarizeStepOutput(step);
        if (outputSummary) {
          stepRow.createSpan('flywheel-pipeline-step-detail').setText(outputSummary);
        }
      }
    }
  }

  /** Summarize a compact pipeline step into a human-readable string. */
  private summarizeStepOutput(step: McpCompactStep): string | null {
    const s = step.summary;
    switch (step.name) {
      case 'entity_scan': {
        const parts: string[] = [];
        if (s.added_count) parts.push(`+${s.added_count} entities`);
        if (s.removed_count) parts.push(`-${s.removed_count} entities`);
        return parts.length > 0 ? parts.join(', ') : null;
      }
      case 'hub_scores':
        return s.diff_count ? `${s.diff_count} hub score${s.diff_count !== 1 ? 's' : ''} changed` : null;
      case 'entity_embeddings':
        return s.updated ? `${s.updated} embeddings updated` : null;
      case 'prospect_scan': {
        const parts: string[] = [];
        if (s.implicit_count) parts.push(`${s.implicit_count} implicit`);
        if (s.dead_match_count) parts.push(`${s.dead_match_count} prospects`);
        return parts.length > 0 ? parts.join(', ') : null;
      }
      case 'suggestion_scoring':
        return s.scored_files ? `${s.scored_files} files scored` : null;
      case 'forward_links': {
        const parts: string[] = [];
        if (s.total_resolved) parts.push(`${s.total_resolved} resolved`);
        if (s.total_dead) parts.push(`${s.total_dead} dead`);
        if (s.new_dead_count) parts.push(`${s.new_dead_count} new dead`);
        return parts.length > 0 ? parts.join(', ') : null;
      }
      case 'implicit_feedback': {
        const parts: string[] = [];
        if (s.removal_count) parts.push(`${s.removal_count} negative`);
        if (s.addition_count) parts.push(`${s.addition_count} positive`);
        if (s.suppressed_count) parts.push(`${s.suppressed_count} suppressed`);
        return parts.length > 0 ? parts.join(', ') : null;
      }
      case 'wikilink_check':
        return s.tracked_count ? `${s.tracked_count} tracked, ${s.mention_count ?? 0} mentions` : null;
      default:
        return null;
    }
  }

  /** Shorten a file path to just the note name. */
  private shortenPath(p: string): string {
    return p.replace(/\.md$/, '').split('/').pop() || p;
  }

  /** Format a timestamp as relative time (e.g., "2s ago", "1m ago"). */
  private formatRelativeTime(ts: number): string {
    const delta = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (delta < 60) return `${delta}s ago`;
    if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
    const h = Math.floor(delta / 3600);
    const m = Math.floor((delta % 3600) / 60);
    return m > 0 ? `${h}h ${m}m ago` : `${h}h ago`;
  }

  async onClose(): Promise<void> {
    this.loadedSections.clear();
    if (this.activityLogInterval) {
      clearInterval(this.activityLogInterval);
      this.activityLogInterval = null;
    }
    if (this.healthUnsub) {
      this.healthUnsub();
      this.healthUnsub = null;
    }
  }
}
