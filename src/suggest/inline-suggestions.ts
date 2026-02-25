/**
 * Inline Wikilink Suggestions — CM6 ViewPlugin
 *
 * Shows dotted underline decorations on high-confidence entity mentions.
 * Click to accept: replaces the text span with [[entity]].
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
}

class InlineSuggestionPlugin {
  decorations: DecorationSet;
  private pending = false;
  private suggestions: InlineSuggestion[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private clickHandler: (e: MouseEvent) => void;

  constructor(
    private view: EditorView,
    private mcpClient: FlywheelMcpClient,
  ) {
    this.decorations = Decoration.none;
    this.clickHandler = this.handleClick.bind(this);
    this.view.dom.addEventListener('click', this.clickHandler);
    this.scheduleUpdate();
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged) {
      this.scheduleUpdate();
    }
  }

  destroy(): void {
    this.view.dom.removeEventListener('click', this.clickHandler);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  private scheduleUpdate(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.fetchSuggestions(), 500);
  }

  private async fetchSuggestions(): Promise<void> {
    if (this.pending || !this.mcpClient.connected) return;
    this.pending = true;

    try {
      const { from, to } = this.view.viewport;
      const text = this.view.state.doc.sliceString(from, to);
      if (text.length < 20) { this.pending = false; return; }

      const resp = await this.mcpClient.suggestWikilinks(text, true);
      const scored = resp.scored_suggestions ?? [];
      const positioned = resp.suggestions ?? [];

      // McpScoredSuggestion has confidence but no position.
      // McpSuggestWikilinksResponse.suggestions has position but no confidence.
      // Join by entity name to get both.
      const confidenceMap = new Map(scored.map(s => [s.entity, s.confidence]));
      const docLen = this.view.state.doc.length;

      this.suggestions = positioned
        // Only high-confidence (medium is too noisy for inline decoration)
        .filter(s => confidenceMap.get(s.entity) === 'high')
        .map(s => ({
          from: from + s.start,
          to: from + s.end,
          entity: s.entity,
          target: s.target ?? s.entity,
          confidence: confidenceMap.get(s.entity) ?? 'high',
        }))
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
      builder.add(s.from, s.to, Decoration.mark({
        class: 'flywheel-inline-suggestion',
        attributes: {
          'data-entity': s.entity,
          'data-target': s.target,
          title: `Link as [[${s.entity}]] — click to accept`,
        },
      }));
    }

    this.decorations = builder.finish();
    // Force a re-render by requesting a measure
    this.view.requestMeasure();
  }

  private handleClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    if (!target.classList.contains('flywheel-inline-suggestion')) return;

    const entity = target.dataset.entity;
    if (!entity) return;

    e.preventDefault();
    e.stopPropagation();

    // Find the decoration range for this click position
    const pos = this.view.posAtDOM(target);
    const suggestion = this.suggestions.find(s => s.from <= pos && pos <= s.to);
    if (!suggestion) return;

    // Replace the text span with [[entity]]
    this.view.dispatch({
      changes: {
        from: suggestion.from,
        to: suggestion.to,
        insert: `[[${entity}]]`,
      },
    });
    // docChanged will trigger re-scan, clearing the stale decoration
  }
}

export function createInlineSuggestionPlugin(mcpClient: FlywheelMcpClient) {
  return ViewPlugin.define(
    (view) => new InlineSuggestionPlugin(view, mcpClient),
    { decorations: (v) => v.decorations },
  );
}
