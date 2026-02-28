/**
 * Inline Wikilink Suggestions — CM6 ViewPlugin
 *
 * Shows dotted underline decorations on high-confidence entity mentions.
 * Click to accept: replaces the text span with [[entity]].
 *
 * Prospects (dead link targets + implicit entities) are shown with an
 * amber dashed underline to distinguish them from known-entity suggestions.
 */

import {
  ViewPlugin,
  ViewUpdate,
  DecorationSet,
  Decoration,
  EditorView,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import type { FlywheelMcpClient } from '../mcp/client';

interface InlineSuggestion {
  from: number; // absolute position in document
  to: number;
  entity: string;
  target: string;
  confidence: string;
  isProspect?: boolean;
}

class InlineSuggestionPlugin {
  decorations: DecorationSet;
  private pending = false;
  private needsRefetch = false;
  private suggestions: InlineSuggestion[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private clickHandler: (e: MouseEvent) => void;
  private connectionUnsub: (() => void) | null = null;

  constructor(
    private view: EditorView,
    private mcpClient: FlywheelMcpClient,
    private getNotePath?: () => string | undefined,
  ) {
    this.decorations = Decoration.none;
    this.clickHandler = this.handleClick.bind(this);
    this.view.dom.addEventListener('click', this.clickHandler);
    // Re-fetch when MCP connects (handles editors open before connection)
    this.connectionUnsub = this.mcpClient.onConnectionStateChange(() => {
      if (this.mcpClient.connected) this.scheduleUpdate();
    });
    this.scheduleUpdate();
  }

  update(update: ViewUpdate): void {
    if (update.docChanged) {
      this.scheduleUpdate();
    } else if (update.viewportChanged && this.view.state.doc.length > 50_000) {
      // Only re-fetch on scroll for very large documents (viewport-only mode)
      this.scheduleUpdate();
    }
  }

  destroy(): void {
    this.view.dom.removeEventListener('click', this.clickHandler);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.connectionUnsub) { this.connectionUnsub(); this.connectionUnsub = null; }
  }

  private scheduleUpdate(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.fetchSuggestions(), 500);
  }

  private async fetchSuggestions(): Promise<void> {
    if (this.pending) {
      this.needsRefetch = true;
      return;
    }
    if (!this.mcpClient.connected) {
      return;
    }
    this.pending = true;

    try {
      // Scan the full document (up to 50k chars) so entities outside the
      // viewport are still decorated. For very large documents, fall back
      // to viewport-only scanning.
      const docLen = this.view.state.doc.length;
      const MAX_SCAN = 50_000;
      const from = docLen <= MAX_SCAN ? 0 : this.view.viewport.from;
      const to = docLen <= MAX_SCAN ? docLen : this.view.viewport.to;
      const text = this.view.state.doc.sliceString(from, to);
      if (text.length < 20) { this.pending = false; return; }

      const notePath = this.getNotePath?.();
      const resp = await this.mcpClient.suggestWikilinks(text, true, notePath);
      if (!resp) {
        console.warn('Flywheel inline suggestions: empty response from suggestWikilinks');
        return;
      }
      const scored = resp.scored_suggestions ?? [];
      const positioned = resp.suggestions ?? [];
      console.debug(`Flywheel inline: ${positioned.length} positioned, ${scored.length} scored, ${(resp.prospects ?? []).length} prospects`);

      // McpScoredSuggestion has confidence but no position.
      // McpSuggestWikilinksResponse.suggestions has position but no confidence.
      // Join by entity name to get both. Positioned entities that aren't in the
      // scored list are treated as high confidence — they're confirmed text matches
      // of real entities in the vault.
      const confidenceMap = new Map(scored.map(s => [s.entity.toLowerCase(), s.confidence]));

      const knownSuggestions: InlineSuggestion[] = positioned
        // Exclude only if explicitly scored as 'low'
        .filter(s => {
          const conf = confidenceMap.get(s.entity.toLowerCase());
          return conf !== 'low'; // keep high, medium, and unscored (not in map)
        })
        .map(s => ({
          from: from + s.start,
          to: from + s.end,
          entity: s.entity,
          target: s.target ?? s.entity,
          confidence: confidenceMap.get(s.entity.toLowerCase()) ?? 'high',
        }));

      // Prospects: dead link targets + implicit entities with positions (high confidence only)
      // Filter out common single words that aren't real entity names
      const looksLikeEntity = (name: string): boolean => {
        if (name.length < 4) return false;
        // Multi-word names are more likely real entities
        if (name.includes(' ') && name.length >= 6) return true;
        // Single words: reject if all lowercase (likely a common word, not a proper noun/entity)
        if (name === name.toLowerCase() && !name.includes(' ')) return false;
        return true;
      };

      const prospectSuggestions: InlineSuggestion[] = (resp.prospects ?? [])
        .filter(p => p.confidence === 'high' && looksLikeEntity(p.entity))
        .map(p => ({
          from: from + p.start,
          to: from + p.end,
          entity: p.entity,
          target: p.entity,
          confidence: p.confidence,
          isProspect: true,
        }));

      this.suggestions = [...knownSuggestions, ...prospectSuggestions]
        // Filter out positions already inside [[ ]]
        .filter(s => {
          const before = this.view.state.doc.sliceString(Math.max(0, s.from - 2), s.from);
          const after = this.view.state.doc.sliceString(s.to, Math.min(docLen, s.to + 2));
          return !before.endsWith('[[') && !after.startsWith(']]');
        })
        // Filter out positions in YAML frontmatter (before second ---)
        .filter(s => {
          const docStart = this.view.state.doc.sliceString(0, Math.min(4, this.view.state.doc.length));
          if (!docStart.startsWith('---')) return true;
          const header = this.view.state.doc.sliceString(0, Math.min(2000, this.view.state.doc.length));
          const secondDash = header.indexOf('\n---', 3);
          return secondDash === -1 || s.from > secondDash + 4;
        });

      this.buildDecorations();
    } catch (err) {
      console.error('Flywheel inline suggestions: fetch failed', err);
    } finally {
      this.pending = false;
      if (this.needsRefetch) {
        this.needsRefetch = false;
        this.scheduleUpdate();
      }
    }
  }

  private buildDecorations(): void {
    const builder = new RangeSetBuilder<Decoration>();

    // Sort by position (required by RangeSetBuilder)
    const sorted = [...this.suggestions].sort((a, b) => a.from - b.from);

    // Remove overlapping ranges (keep higher priority = earlier in sorted list)
    const filtered: InlineSuggestion[] = [];
    let lastEnd = -1;
    for (const s of sorted) {
      if (s.from >= lastEnd) {
        filtered.push(s);
        lastEnd = s.to;
      }
    }

    for (const s of filtered) {
      // Preview the actual wikilink that will be inserted
      const noteName = s.target
        ? s.target.replace(/\.md$/, '').split('/').pop() || s.entity
        : s.entity;
      const isAlias = noteName.toLowerCase() !== s.entity.toLowerCase();
      const linkPreview = isAlias ? `[[${noteName}|${s.entity}]]` : `[[${s.entity}]]`;

      builder.add(s.from, s.to, Decoration.mark({
        class: s.isProspect ? 'flywheel-inline-prospect' : 'flywheel-inline-suggestion',
        attributes: {
          'data-entity': s.entity,
          'data-target': s.target,
          title: s.isProspect
            ? `Prospect: ${linkPreview} — click to create link`
            : `${linkPreview} — click to accept`,
        },
      }));
    }

    this.decorations = builder.finish();
    // Force a re-render by requesting a measure
    this.view.requestMeasure();
  }

  private handleClick(e: MouseEvent): void {
    const targetEl = e.target as HTMLElement;
    if (!targetEl.classList.contains('flywheel-inline-suggestion') &&
        !targetEl.classList.contains('flywheel-inline-prospect')) return;

    const entity = targetEl.dataset.entity;
    const targetNote = targetEl.dataset.target;
    if (!entity) return;

    e.preventDefault();
    e.stopPropagation();

    // Find the decoration range for this click position
    const pos = this.view.posAtDOM(targetEl);
    const suggestion = this.suggestions.find(s => s.from <= pos && pos <= s.to);
    if (!suggestion) return;

    // Build the wikilink — use [[Target|alias]] when text differs from note name
    const noteName = targetNote
      ? targetNote.replace(/\.md$/, '').split('/').pop() || entity
      : entity;
    const wikilink = noteName.toLowerCase() !== entity.toLowerCase()
      ? `[[${noteName}|${entity}]]`
      : `[[${entity}]]`;

    const oldLen = suggestion.to - suggestion.from;
    const delta = wikilink.length - oldLen;

    // Apply the edit
    this.view.dispatch({
      changes: {
        from: suggestion.from,
        to: suggestion.to,
        insert: wikilink,
      },
    });

    // Immediately update remaining suggestions: remove the clicked one
    // and adjust positions for everything after the insertion point
    this.suggestions = this.suggestions
      .filter(s => s !== suggestion)
      .map(s => {
        if (s.from >= suggestion.to) {
          return { ...s, from: s.from + delta, to: s.to + delta };
        }
        return s;
      });
    this.buildDecorations();
  }
}

export function createInlineSuggestionPlugin(mcpClient: FlywheelMcpClient, getNotePath?: () => string | undefined) {
  return ViewPlugin.define(
    (view) => new InlineSuggestionPlugin(view, mcpClient, getNotePath),
    { decorations: (v) => v.decorations },
  );
}
