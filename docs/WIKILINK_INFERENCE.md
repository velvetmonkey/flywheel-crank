# Wikilink Inference Algorithm

How Flywheel-Crank suggests contextual wikilinks for your content.

---

## Table of Contents

- [Overview](#overview)
- [The 9-Layer Scoring Pipeline](#the-9-layer-scoring-pipeline)
- [Quality Filters (Layers 1a-1b)](#quality-filters-layers-1a-1b)
- [Word Matching (Layers 2-3)](#word-matching-layers-2-3)
- [Co-occurrence Boost (Layer 4)](#co-occurrence-boost-layer-4)
- [Type Boost (Layer 5)](#type-boost-layer-5)
- [Context Boost (Layer 6)](#context-boost-layer-6)
- [Recency Boost (Layer 7)](#recency-boost-layer-7)
- [Cross-Folder Boost (Layer 8)](#cross-folder-boost-layer-8)
- [Hub Score Boost (Layer 9)](#hub-score-boost-layer-9)
- [Strictness Modes](#strictness-modes)
- [Adaptive Thresholds](#adaptive-thresholds)
- [Worked Example](#worked-example)

---

## Overview

When you add content to your vault with tools like `vault_add_to_section`, Crank can automatically suggest related wikilinks. This document explains the scoring algorithm that powers these suggestions.

**Key insight:** Instead of AI-driven heuristics, Crank uses a deterministic, multi-layer scoring system that combines:
- **Word matching** - Does the entity name appear in your content?
- **Graph intelligence** - Are related entities mentioned together in your vault?
- **Entity types** - People and projects are more valuable than common terms
- **Context awareness** - What type of note is this?
- **Recency** - What entities have you mentioned recently?

The result: suggestions that feel intelligent but are fully deterministic and reproducible.

---

## The 9-Layer Scoring Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│  Input: Content text, vault entity index, note path             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Layer 1a: Length Filter                                        │
│  └── Skip entities > 25 chars (article titles)                  │
│                                                                 │
│  Layer 1b: Article Pattern Filter                               │
│  └── Skip "Guide to", "How to", >3 words                       │
│                                                                 │
│  Layer 2: Exact Match                                          │
│  └── +10 points per word that matches exactly                   │
│                                                                 │
│  Layer 3: Stem Match                                           │
│  └── +3-6 points per word with matching stem                    │
│                                                                 │
│  Layer 4: Co-occurrence Boost                                  │
│  └── +3 points per related entity in content                    │
│                                                                 │
│  Layer 5: Type Boost                                           │
│  └── People +5, Projects +3, Organizations +2                  │
│                                                                 │
│  Layer 6: Context Boost                                        │
│  └── Boost types relevant to note type                          │
│                                                                 │
│  Layer 7: Recency Boost                                        │
│  └── Boost recently-mentioned entities                          │
│                                                                 │
│  Layer 8: Cross-Folder Boost                 [NEW]              │
│  └── +3 for entities from different folder                      │
│                                                                 │
│  Layer 9: Hub Score Boost                    [NEW]              │
│  └── +3 for well-connected entities (5+ backlinks)              │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  Output: Top N entities sorted by score                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Quality Filters (Layers 1a-1b)

Before scoring, entities are filtered to ensure quality suggestions.

### Layer 1a: Length Filter

Entities longer than 25 characters are skipped. These are typically:
- Article titles ("The Complete Guide to...")
- Clippings from external sources
- Long phrases that aren't true concepts

```
MAX_ENTITY_LENGTH = 25

✓ "React" (5 chars)
✓ "Project Alpha" (13 chars)
✓ "Machine Learning" (16 chars)
✗ "Complete Guide to React Hooks" (29 chars)
```

### Layer 1b: Article Pattern Filter

Entities matching these patterns are skipped:

| Pattern | Example |
|---------|---------|
| `guide to` | "The Guide to Markdown" |
| `how to` | "How to Write Tests" |
| `complete` | "Complete JavaScript Course" |
| `ultimate` | "Ultimate React Guide" |
| `checklist` | "Deployment Checklist" |
| `cheatsheet` | "Vim Cheatsheet" |
| `best practices` | "Testing Best Practices" |
| `introduction to` | "Introduction to Python" |
| `tutorial` | "React Tutorial" |
| `worksheet` | "Budget Worksheet" |

Additionally, entities with more than 3 words are filtered:

```
MAX_ENTITY_WORDS = 3

✓ "Machine Learning" (2 words)
✓ "Natural Language Processing" (3 words)
✗ "How to Build a React App" (6 words)
```

---

## Word Matching (Layers 2-3)

### Layer 2: Exact Match (+10 points)

When a word from an entity name appears exactly in the content:

```
Content: "I discussed TypeScript with the team"
Entity: "TypeScript"
Score: +10 (exact match)
```

### Layer 3: Stem Match (+3-6 points)

When the stemmed form matches (using Porter stemmer):

```
Content: "We're migrating to a new platform"
Entity: "Migration"

Stemming:
- "migrating" → "migrat"
- "Migration" → "migrat"
- Match! Score: +5 (balanced mode)
```

**Stem match bonus varies by strictness mode:**
- Conservative: +3 (lower confidence)
- Balanced: +5 (standard)
- Aggressive: +6 (higher confidence)

### Multi-Word Entity Matching

For entities with multiple words, a minimum match ratio applies:

```
Entity: "Machine Learning"
Content: "Applied machine techniques to the data"

Tokens: ["machine", "learning"]
Matches: "machine" = exact (+10)
Total matched: 1/2 = 50%

Threshold by mode:
- Conservative: 60% required → REJECTED
- Balanced: 40% required → ACCEPTED
- Aggressive: 30% required → ACCEPTED
```

### Alias Matching

Entities can have aliases. The best score between name and aliases is used:

```
Entity: "TypeScript" (aliases: ["TS"])
Content: "We use TS for all new projects"

Name "TypeScript": no match (0)
Alias "TS": exact match (+10), plus full alias bonus (+8)
Final score: 18
```

---

## Co-occurrence Boost (Layer 4)

Entities that frequently appear together in your vault get boosted when one appears in content.

```
If your vault often mentions "React" and "TypeScript" together:

Content: "Building new React components"
Direct match: "React" (+10)
Co-occurrence boost: "TypeScript" (+3 per related entity)

TypeScript gets suggested even without being in the content.
```

**How it works:**
1. During vault scan, Crank mines which entities co-occur in the same notes
2. When content mentions "React", entities that frequently appear with React get +3
3. This surfaces conceptually related entities

---

## Type Boost (Layer 5)

Different entity types have different inherent value for linking.

| Category | Boost | Rationale |
|----------|-------|-----------|
| **People** | +5 | Names are high value for connections |
| **Projects** | +3 | Projects provide context |
| **Organizations** | +2 | Companies/teams relevant |
| **Locations** | +1 | Geographic context |
| **Concepts** | +1 | Abstract concepts |
| **Technologies** | +0 | Common, avoid over-suggesting |
| **Acronyms** | +0 | May be ambiguous |

**Example:**
```
Content: "Met with John about the API"

Entity "John" (person): base score 15 + type boost 5 = 20
Entity "API" (technology): base score 10 + type boost 0 = 10

John scores higher despite similar word match.
```

---

## Context Boost (Layer 6)

Boost entity types that are relevant to the note's context, detected from path.

### Context Detection

| Path Contains | Context | Description |
|---------------|---------|-------------|
| `daily-notes`, `journal`, `logs` | `daily` | Personal logging |
| `projects`, `systems`, `initiatives` | `project` | Project documentation |
| `tech`, `code`, `engineering`, `docs` | `tech` | Technical documentation |
| Other | `general` | No special boost |

### Context-Specific Boosts

**Daily notes context:**
| Category | Boost |
|----------|-------|
| People | +5 |
| Projects | +2 |

**Project context:**
| Category | Boost |
|----------|-------|
| Projects | +5 |
| Technologies | +2 |

**Tech context:**
| Category | Boost |
|----------|-------|
| Technologies | +5 |
| Acronyms | +3 |

**Example:**
```
Path: "daily-notes/2026-01-31.md"
Context: daily

Entity "Sarah" (person):
- Base score: 10
- Type boost: +5 (people)
- Context boost: +5 (people in daily context)
- Total: 20

Entity "React" (technology):
- Base score: 10
- Type boost: +0 (technologies)
- Context boost: +0 (technologies not boosted in daily)
- Total: 10
```

---

## Recency Boost (Layer 7)

Entities mentioned recently in your vault get a boost.

**How it works:**
1. During vault scan, Crank tracks when each entity was last mentioned
2. Entities mentioned in the last 7 days get a recency boost
3. The boost decays over time

**Boost calculation:**
```
Days since mention | Boost
-------------------|------
0-1 days           | +5
2-3 days           | +3
4-7 days           | +1
>7 days            | +0
```

**Rationale:** If you've been working on "Project Alpha" this week, it's more likely to be relevant to today's notes.

---

## Cross-Folder Boost (Layer 8)

Entities from different top-level folders get a boost to encourage cross-cutting connections.

**Boost value:** +3 points

**How it works:**
1. Compare the top-level folder of the entity (`entity.path`) with the current note (`notePath`)
2. If they differ, apply the boost

**Example:**
```
Editing: "daily-notes/2026-01-31.md"
Entity: "Project Alpha" in "projects/Project Alpha.md"

Top-level folders:
- Note: "daily-notes"
- Entity: "projects"

Different folders → +3 cross-folder boost
```

**Rationale:** Cross-cutting connections are more valuable for knowledge graphs. A person note linking to a project creates a richer network than project notes only linking to other projects.

**No boost cases:**
- Same folder (e.g., both in `projects/`)
- Entity has no path
- Note path not provided

---

## Hub Score Boost (Layer 9)

Well-connected entities (hub notes) get a boost based on their backlink count.

**Threshold:** 5 backlinks minimum
**Boost value:** +3 points

**How it works:**
1. Flywheel computes backlink counts during graph build
2. Entities with 5+ backlinks are marked as hub notes
3. Hub notes get boosted in suggestions

**Example:**
```
Entity: "TypeScript" (hubScore: 15 backlinks)
Entity: "New Framework" (hubScore: 1 backlink)

For content "TypeScript and New Framework discussion":
- TypeScript: base score + hub boost (+3) = higher rank
- New Framework: base score only
```

**Rationale:** Hub notes are central to your knowledge graph. They're well-established concepts that many other notes reference, making them more valuable to link to.

**Requirements:**
- Flywheel must be running and have built the vault index
- Hub scores are exported to the entity cache after each graph build
- Entities without hubScore or with hubScore < 5 receive no boost

---

## Strictness Modes

Three predefined configurations trade off precision vs. recall.

### Conservative (Default)

High precision, fewer false positives.

| Parameter | Value |
|-----------|-------|
| Min word length | 5 |
| Min score | 15 |
| Min match ratio | 60% |
| Require multiple matches | Yes |
| Stem match bonus | +3 |
| Exact match bonus | +10 |

**Best for:** Avoiding noise, professional contexts

### Balanced

Moderate precision, matches v0.7 behavior.

| Parameter | Value |
|-----------|-------|
| Min word length | 4 |
| Min score | 8 |
| Min match ratio | 40% |
| Require multiple matches | No |
| Stem match bonus | +5 |
| Exact match bonus | +10 |

**Best for:** General use, exploring connections

### Aggressive

Maximum recall, may include loose matches.

| Parameter | Value |
|-----------|-------|
| Min word length | 4 |
| Min score | 5 |
| Min match ratio | 30% |
| Require multiple matches | No |
| Stem match bonus | +6 |
| Exact match bonus | +10 |

**Best for:** Discovery, brainstorming

---

## Adaptive Thresholds

The minimum score threshold adapts to content length.

| Content Length | Threshold Adjustment |
|----------------|---------------------|
| < 50 chars | × 0.6 (lower, get any suggestions) |
| 50-200 chars | × 1.0 (standard) |
| > 200 chars | × 1.2 (higher, avoid noise) |

**Rationale:** Short content has fewer words to match, so we lower the bar. Long content should require stronger matches to avoid irrelevant suggestions.

---

## Worked Example

**Input:**
```
Content: "Discussed migration strategy with Sarah for Project Alpha"
Path: "projects/alpha/meeting-notes.md"
Mode: conservative
```

**Step 1: Tokenize content**
```
Tokens: ["discussed", "migration", "strategy", "sarah", "project", "alpha"]
Stems: ["discuss", "migrat", "strategi", "sarah", "project", "alpha"]
```

**Step 2: Detect context**
```
Path contains "projects/" → context = "project"
```

**Step 3: Score entities**

| Entity | Category | Word Match | Type | Context | Cross-Folder | Hub | Total |
|--------|----------|------------|------|---------|--------------|-----|-------|
| Sarah | person | +10 (exact) | +5 | +0 | +3 (from people/) | +3 (10 backlinks) | 21 |
| Project Alpha | project | +20 (2 exact) | +3 | +5 | +0 (same folder) | +0 (new project) | 28 |
| Migration | concept | +3 (stem) | +1 | +0 | +3 (from concepts/) | +0 (2 backlinks) | 7 |
| React | technology | +0 (no match) | +0 | +2 | +3 (from tech/) | +3 (8 backlinks) | 8 |

**Step 4: Apply threshold (conservative = 15)**
```
✓ Project Alpha (28) - above threshold
✓ Sarah (21) - above threshold (boosted by cross-folder + hub)
✗ React (8) - below threshold (even with cross-folder + hub)
✗ Migration (7) - below threshold
```

**Step 5: Sort and limit (max 3)**
```
1. Project Alpha (28)
2. Sarah (21)
```

**Output:**
```
→ [[Project Alpha]] [[Sarah]]
```

---

## Summary

The wikilink inference algorithm uses 9 deterministic layers:

1. **Quality filters** - Remove article titles and long names
2. **Exact matching** - Core word overlap
3. **Stem matching** - Morphological variants
4. **Co-occurrence** - Graph-based conceptual links
5. **Type boost** - Prioritize valuable entity types
6. **Context boost** - Match note type to entity type
7. **Recency boost** - Favor recently-mentioned entities
8. **Cross-folder boost** - Prioritize cross-cutting connections
9. **Hub score boost** - Favor well-connected notes (5+ backlinks)

Each layer adds confidence to the final score. Only entities above the strictness-dependent threshold become suggestions.

**New in this version:** Layers 8 and 9 add graph-aware intelligence:
- **Cross-folder** encourages linking between different areas of your vault
- **Hub score** surfaces your most connected and central notes

---

## See Also

- [wikilinks.md](wikilinks.md) - User-facing wikilink documentation
- [PERFORMANCE.md](PERFORMANCE.md) - Scoring performance benchmarks
- Source: `packages/mcp-server/src/core/wikilinks.ts`
