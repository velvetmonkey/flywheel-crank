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
  private scannedRanges: Array<{ from: number; to: number }> = [];
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
      // Content changed — clear stale suggestions and re-fetch
      this.suggestions = [];
      this.scannedRanges = [];
      this.scheduleUpdate();
    } else if (update.viewportChanged) {
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

  /** Check if the current viewport is already mostly covered by previous scans */
  private isViewportScanned(): boolean {
    const { from, to } = this.view.viewport;
    const mid = (from + to) / 2;
    return this.scannedRanges.some(r => r.from <= mid && mid <= r.to);
  }

  private async fetchSuggestions(): Promise<void> {
    if (this.pending) {
      this.needsRefetch = true;
      return;
    }
    if (!this.mcpClient.connected) {
      return;
    }
    // Skip if viewport midpoint is already scanned
    if (this.isViewportScanned()) return;

    this.pending = true;

    try {
      const docLen = this.view.state.doc.length;
      const { from: vpFrom, to: vpTo } = this.view.viewport;
      const from = vpFrom;
      const to = vpTo;
      const text = this.view.state.doc.sliceString(from, to);
      if (text.length < 20) { this.pending = false; return; }

      const notePath = this.getNotePath?.();
      // detail=false skips the expensive 11-layer scoring pipeline —
      // we only need positioned text matches for inline decorations
      const resp = await this.mcpClient.suggestWikilinks(text, false, notePath);
      if (!resp) return;
      const positioned = resp.suggestions ?? [];

      const knownSuggestions: InlineSuggestion[] = positioned
        .map(s => ({
          from: from + s.start,
          to: from + s.end,
          entity: s.entity,
          target: s.target ?? s.entity,
          confidence: 'high' as string,
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

      const newSuggestions = [...knownSuggestions, ...prospectSuggestions]
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

      // Remove old suggestions in the scanned range, keep ones outside it
      const existing = this.suggestions.filter(s => s.from < from || s.to > to);
      this.suggestions = [...existing, ...newSuggestions];
      this.scannedRanges.push({ from, to });

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
