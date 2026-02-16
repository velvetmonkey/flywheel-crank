/**
 * Wikilink EditorSuggest
 *
 * Triggers on [[ and provides fuzzy-matched entity suggestions
 * with category badges and hub scores.
 */

import {
  Editor,
  EditorPosition,
  EditorSuggest,
  EditorSuggestContext,
  EditorSuggestTriggerInfo,
  TFile,
} from 'obsidian';
import type { EntityIndex, EntityWithAliases, EntityCategory, Entity } from '../core/types';

interface WikilinkSuggestion {
  entity: EntityWithAliases;
  category: EntityCategory;
  score: number;
}

const CATEGORY_EMOJI: Record<EntityCategory, string> = {
  technologies: 'cpu',
  acronyms: '#',
  people: 'person',
  projects: 'folder',
  organizations: 'building',
  locations: 'pin',
  concepts: 'bulb',
  other: 'dot',
};

export class WikilinkSuggest extends EditorSuggest<WikilinkSuggestion> {
  private entityIndex: EntityIndex | null = null;

  setEntityIndex(index: EntityIndex): void {
    this.entityIndex = index;
  }

  onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile | null): EditorSuggestTriggerInfo | null {
    const line = editor.getLine(cursor.line);
    const sub = line.substring(0, cursor.ch);

    // Find the last [[ that doesn't have a closing ]]
    const lastOpen = sub.lastIndexOf('[[');
    if (lastOpen === -1) return null;

    // Check there's no ]] after the [[
    const afterOpen = sub.substring(lastOpen + 2);
    if (afterOpen.includes(']]')) return null;

    // Get the query text after [[
    const query = afterOpen;

    return {
      start: { line: cursor.line, ch: lastOpen + 2 },
      end: cursor,
      query,
    };
  }

  getSuggestions(context: EditorSuggestContext): WikilinkSuggestion[] {
    if (!this.entityIndex) return [];

    const query = context.query.toLowerCase();
    const suggestions: WikilinkSuggestion[] = [];

    const categories: EntityCategory[] = [
      'technologies', 'acronyms', 'people', 'projects',
      'organizations', 'locations', 'concepts', 'other',
    ];

    for (const category of categories) {
      const entities = this.entityIndex[category] as Entity[];
      if (!entities?.length) continue;

      for (const entity of entities) {
        const obj: EntityWithAliases = typeof entity === 'string'
          ? { name: entity, path: '', aliases: [] }
          : entity;

        const score = this.fuzzyScore(query, obj);
        if (score > 0) {
          suggestions.push({ entity: obj, category, score });
        }
      }
    }

    // Sort by score descending, then alphabetically
    suggestions.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.entity.name.localeCompare(b.entity.name);
    });

    return suggestions.slice(0, 15);
  }

  renderSuggestion(suggestion: WikilinkSuggestion, el: HTMLElement): void {
    el.addClass('flywheel-suggest-item');

    const mainRow = el.createDiv('flywheel-suggest-main');

    // Category badge
    const badge = mainRow.createSpan('flywheel-suggest-category');
    badge.setText(suggestion.category.substring(0, 4));
    badge.addClass(`flywheel-suggest-cat-${suggestion.category}`);

    // Name
    mainRow.createSpan('flywheel-suggest-name').setText(suggestion.entity.name);

    // Hub score
    if (suggestion.entity.hubScore && suggestion.entity.hubScore > 0) {
      const hub = mainRow.createSpan('flywheel-suggest-hub');
      hub.setText(`${suggestion.entity.hubScore}`);
    }

    // Aliases
    if (suggestion.entity.aliases.length > 0) {
      const aliasEl = el.createDiv('flywheel-suggest-aliases');
      aliasEl.setText(suggestion.entity.aliases.join(', '));
    }
  }

  selectSuggestion(suggestion: WikilinkSuggestion, evt: MouseEvent | KeyboardEvent): void {
    if (!this.context) return;

    const editor = this.context.editor;
    const start = this.context.start;
    const end = this.context.end;

    // Replace the query with the entity name and close the wikilink
    const replacement = `${suggestion.entity.name}]]`;
    editor.replaceRange(replacement, start, end);
  }

  /**
   * Fuzzy matching score - returns 0 for no match
   */
  private fuzzyScore(query: string, entity: EntityWithAliases): number {
    if (!query) return 1; // Show all entities when query is empty

    const nameLower = entity.name.toLowerCase();

    // Exact prefix match (highest score)
    if (nameLower.startsWith(query)) {
      return 100 + (100 - nameLower.length); // Shorter names rank higher
    }

    // Contains match
    if (nameLower.includes(query)) {
      return 50 + (100 - nameLower.length);
    }

    // Check aliases
    for (const alias of entity.aliases) {
      const aliasLower = alias.toLowerCase();
      if (aliasLower.startsWith(query)) return 80 + (100 - aliasLower.length);
      if (aliasLower.includes(query)) return 40 + (100 - aliasLower.length);
    }

    // Fuzzy: check if all query chars appear in order
    let qi = 0;
    for (let i = 0; i < nameLower.length && qi < query.length; i++) {
      if (nameLower[i] === query[qi]) qi++;
    }
    if (qi === query.length) {
      return 20 + (100 - nameLower.length);
    }

    return 0;
  }
}
