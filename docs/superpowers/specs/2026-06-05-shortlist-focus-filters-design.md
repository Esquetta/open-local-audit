# Shortlist Focus Filters Design

## Goal

Allow operators to narrow local shortlist reports by segment, profile, priority, and contact confidence without changing source lead or review files.

## Behavior

- Add `--segment`, `--profile`, `--priority`, and `--contact-confidence` to `shortlist`.
- Match values case-insensitively using exact normalized text.
- Combine supplied filters with `AND` semantics.
- Apply review suppression first, then opportunity and focus filters, then ranking and `--top`.
- Count all unsuppressed rows rejected by any opportunity or focus filter in `filteredRows`.
- Use the same selected result for Markdown, JSON, and CSV output.

## Boundaries

The feature reads local CSV files only. It does not mutate lead or review CSV files, call APIs, send outreach, or sync CRM records.

## Verification

Module and CLI tests cover combined filters, case-insensitive matching, filtered counts, and compatibility with existing shortlist behavior.
