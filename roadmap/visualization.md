# Flywheel Loop Visualization Roadmap

**Goal:** Colonoscopy-level observability into the flywheel pipeline — from high-level stage health down to individual layer contributions per entity per suggestion.

**Status:** All 5 tiers implemented. The feedback dashboard now provides full pipeline drilling, score breakdowns, entity journey drill-downs, graph movement diffs, and layer contribution heatmaps.

---

## Tier 1: Pipeline Drilling — COMPLETE

Expanded accordion stages with interactive pipeline step views.

### 1.1 Step timing bars — DONE

- Horizontal timing bars (Gantt-style) inside each accordion stage
- `renderStepTimings()` method renders proportional bars per step
- Skipped steps shown with muted bar and skip reason text

### 1.2 Skip reason indicators — DONE

- Steps with `skipped: true` show muted bar with `skip_reason` text
- Integrated into `renderStepTimings()`

### 1.3 Step data flow — DONE

- `renderStepFlow()` shows input→output counts at top of each stage
- Format: "556 entities (+3/-0) → 2 hub changes → 12 embeddings"
- Extracts counts from known step output fields

### 1.4 Comparative timing — DONE

- Ghost bars from `recent_pipelines[]` shown below current run
- Up to 3 previous runs displayed with timestamp labels

### 1.5 Bug fixes — DONE

- **Arc SVG resize**: `ResizeObserver` added in `render()`, disconnected in `onClose()`
- **All stages expanded**: Changed `new Set(STAGES.map(s => s.id))` → `new Set<string>()` (all collapsed)
- **Hardcoded "11 layers"**: Dynamic count from `layerHealth` or `LAYER_LABELS` fallback
- **"active" label**: Changed to "tracked links"

---

## Tier 2: Scoring Layer Breakdown — COMPLETE

Shows what the suggestion engine is thinking per entity.

### 2.1 Per-suggestion score card — DONE

- `renderScoreCard()` renders horizontal stacked bar chart (CSS-only)
- One colored segment per scoring layer
- Color scheme: text (blue), graph (green), feedback (orange), semantic (purple)
- Hover shows layer name + exact contribution value
- Below bar: total score badge (green = passed, red = failed)

### 2.2 Top entities list — DONE

- `renderTopEntities()` shows top 10 entities from `dashboardData.topEntities`
- Each entity shows suggestion count, average score, pass rate
- Entity names are clickable (opens Tier 3 drill-down)

### 2.3 Dynamic suggest header — DONE

- Replaced hardcoded "11 layers" with dynamic count from `layerHealth` contributing status

---

## Tier 3: Entity Journey Deep Dive — COMPLETE

Traces an entity through all 5 flywheel stages.

### 3.1 Entity timeline view — DONE

- `openEntityDrilldown()` replaces dashboard with drill-down panel
- Calls `mcpClient.entityScoreTimeline(entityName)` for timeline data
- SVG line chart: X = time, Y = score (0-1 range)
- Green dots for passed, red dots for below threshold
- Dashed threshold line
- Score breakdown cards for each timeline data point

### 3.2 Entity journey visualization — DONE

- `renderEntityJourney()` shows vertical stage trace
- Discover → Suggest → Apply → Learn → Adapt
- Each stage shows relevant entity data from dashboard/feedback

### 3.3 Entity click delegation — DONE

- Event delegation on loop container via `flywheel-viz-entity-link` class
- Entity names throughout the dashboard are clickable
- Back navigation via breadcrumb at top of drill-down

### 3.4 Graceful degradation — DONE

- If Phase 4 APIs return empty/error, shows "No data yet" messages

---

## Tier 4: Graph Movement — COMPLETE

Visualizes how the knowledge graph evolves over time.

### 4.1 Graph diff view — DONE

- `renderGraphDiff()` in Adapt stage calls `mcpClient.snapshotDiff()`
- Metric changes table: metric, before, after, delta (green/red)
- Hub score changes: entity list with before→after badges

### 4.2 Snapshot picker — DONE

- Two preset ranges: "Last 7 days" and "Last 30 days"
- Buttons trigger diff load for selected time range
- Default: auto-loads 7-day diff

### 4.3 Hub evolution (simplified) — DONE

- Top 5 hub entities shown with before/after sparkline bars
- Color-coded: green for increase, red for decrease

---

## Tier 5: Layer Contribution Over Time — COMPLETE

Aggregate view of scoring layer behavior across the suggestion engine.

### 5.1 Layer contribution heatmap — DONE

- `renderLayerHeatmap()` calls `mcpClient.layerContributionTimeseries('day', 30)`
- CSS grid: rows = scoring layers, columns = time buckets (days)
- Cell opacity = contribution intensity relative to max
- Layer-specific colors from `LAYER_COLORS`

### 5.2 Layer health indicators — DONE

- `renderLayerHealthDots()` shows colored dots in dashboard header
- Green = contributing, yellow = dormant, gray = zero-data
- Hover tooltip: layer name, avg contribution, event count

### 5.3 Layer trend sparklines — DONE

- `renderLayerSparklines()` below heatmap
- Per-layer sparkline bars showing contribution trend over time
- Height proportional to contribution value

---

## MCP Client Extensions

Added to `src/mcp/client.ts`:

| Interface | Description |
|-----------|-------------|
| `McpEntityScoreTimelineEntry` | Single timeline data point with score breakdown |
| `McpEntityTimelineResponse` | Entity timeline API response |
| `McpLayerContributionBucket` | Time bucket with per-layer contributions |
| `McpLayerTimeseriesResponse` | Layer timeseries API response |
| `McpSnapshotDiff` | Graph snapshot diff data |
| `McpSnapshotDiffResponse` | Snapshot diff API response |

| Method | API Mode |
|--------|----------|
| `entityScoreTimeline(entity, daysBack, limit)` | `wikilink_feedback` mode `entity_timeline` |
| `layerContributionTimeseries(granularity, daysBack)` | `wikilink_feedback` mode `layer_timeseries` |
| `snapshotDiff(timestampBefore, timestampAfter)` | `wikilink_feedback` mode `snapshot_diff` |

Extended `McpFeedbackDashboardResponse.dashboard` with optional Phase 4.4 fields:
`layerHealth`, `topEntities`, `feedbackTrend`, `suppressionChanges`

---

## Files Modified

| File | Changes |
|------|---------|
| `src/mcp/client.ts` | +6 interfaces, +3 methods, extended dashboard interface |
| `src/views/feedback-dashboard.ts` | All 5 tiers + bug fixes (~1400 lines) |
| `styles.css` | ~250 lines `.flywheel-viz-*` visualization styles |
| `roadmap/visualization.md` | This file — marked complete |
