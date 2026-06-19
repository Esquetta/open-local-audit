# Shortlist Unreviewed Filter Design

## Goal

Allow operators to build a local first-review queue containing only active shortlist leads that have no review date.

## Behavior

- Add `--unreviewed` to `shortlist`.
- Treat an empty or whitespace-only `lastReviewedAt` value as unreviewed.
- Apply review-state suppression first so completed or suppressed leads never re-enter the queue.
- Apply `--unreviewed` with existing filters using `AND` semantics before sorting and `--top` selection.
- Count unsuppressed rows rejected by the filter in `filteredRows`.
- Use the same filtered result for Markdown, JSON, CSV, and summary JSON output.

## Data Flow

1. Read and normalize the source CSV.
2. Merge optional local review CSV state.
3. Suppress completed review statuses.
4. Keep only rows with an empty normalized `lastReviewedAt` when `--unreviewed` is enabled.
5. Apply existing sorting and top-N selection.
6. Render the requested local output.

## Error Handling

`--unreviewed` is a boolean option and introduces no new input parsing errors. Existing shortlist validation and file errors remain unchanged.

## Boundaries

The feature does not parse review dates or define a review-age threshold. It does not mutate source or review CSV files, call APIs, send outreach, or sync CRM records.

## Verification

- Module tests cover filtering after review suppression and whitespace-only review dates.
- CLI tests cover JSON output and `filteredRows`.
- Existing filters, sorting, top-N selection, Markdown, JSON, CSV, and summary JSON behavior remain compatible.

## Release

Ship the feature as `v0.38.0` with changelog, roadmap, release-readiness, README, package version, GitHub Release, and npm package updates.
