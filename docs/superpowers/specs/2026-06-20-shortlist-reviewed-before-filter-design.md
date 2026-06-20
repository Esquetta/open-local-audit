# Shortlist Reviewed-Before Filter Design

## Goal

Allow operators to build a local re-review queue containing active shortlist leads reviewed before a specified calendar date.

## Behavior

- Add `--reviewed-before <date>` to `shortlist`.
- Require the threshold to use the exact `YYYY-MM-DD` format and represent a valid calendar date.
- Include a lead only when its normalized `lastReviewedAt` is a valid date strictly earlier than the threshold.
- Exclude leads whose review date equals the threshold.
- Exclude blank or unparseable lead review dates without failing the entire shortlist run.
- Apply review-state suppression first so completed or suppressed leads never re-enter the queue.
- Combine `--reviewed-before` with existing filters using `AND` semantics before sorting and `--top` selection.
- Count unsuppressed rows rejected by the filter in `filteredRows`.
- Use the same filtered result for Markdown, JSON, CSV, and summary JSON output.

## Date Handling

The CLI threshold is parsed as a UTC calendar date after strict format and calendar validation. Lead review values may be date-only values or parseable ISO timestamps. Comparisons use their parsed timestamps against the threshold at `00:00:00.000Z`.

Examples for `--reviewed-before 2026-06-20`:

- `2026-06-19` is included.
- `2026-06-20` is excluded.
- `2026-06-20T00:00:00.000Z` is excluded.
- An empty or invalid `lastReviewedAt` value is excluded.

## Data Flow

1. Validate and parse the `--reviewed-before` threshold.
2. Read and normalize the source CSV.
3. Merge optional local review CSV state.
4. Suppress completed review statuses.
5. Keep only rows with a valid `lastReviewedAt` timestamp earlier than the threshold.
6. Apply other active filters using `AND` semantics.
7. Apply existing sorting and top-N selection.
8. Render the requested local output.

## Error Handling

Invalid threshold values fail the command with:

```text
shortlist --reviewed-before must be a valid date in YYYY-MM-DD format
```

Examples rejected as invalid include `2026/06/20`, `2026-6-20`, `2026-02-30`, and arbitrary text. Invalid dates inside lead rows are treated as non-matches rather than command errors.

## Interactions

`--reviewed-before` can be combined with every existing shortlist filter. Combining it with `--unreviewed` is allowed under normal `AND` semantics and therefore produces no selected rows, because a row cannot simultaneously have a valid prior review date and an empty review date.

## Boundaries

The feature does not update review dates, infer a default threshold, calculate relative durations, mutate source or review CSV files, call APIs, send outreach, or sync CRM records.

## Verification

- Module tests cover strict threshold validation, strictly-before comparison, equal-date exclusion, ISO timestamp handling, blank and malformed row dates, suppression order, filtered counts, and combination with existing filters.
- CLI tests cover successful JSON output and invalid-threshold errors.
- Existing filters, sorting, top-N selection, Markdown, JSON, CSV, and summary JSON behavior remain compatible.

## Release

Ship the feature as `v0.39.0` with changelog, roadmap, release-readiness, README, package version, GitHub Release, and npm package updates.
