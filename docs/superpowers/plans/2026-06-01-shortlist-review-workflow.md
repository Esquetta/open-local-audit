# Shortlist Review Workflow

## Goal

Add local review-state support to `open-local-audit shortlist` so repeated shortlist runs can skip already handled leads and carry review context into Markdown and JSON reports.

## Success Criteria

1. `shortlist --review-csv <path>` reads a local review CSV.
2. Leads marked `rejected`, `contacted`, `not-fit`, `not_a_fit`, `do-not-contact`, or `suppressed` are excluded before ranking.
3. Matching non-suppressed review metadata appears in Markdown and JSON shortlist output.
4. The workflow remains local-only and does not mutate the review CSV, call APIs, send outreach, or sync CRM records.
5. Targeted tests, lint, and release checks pass before release.

## Verification

```bash
npm test -- --run tests/shortlist.test.ts tests/cli-behavior.test.ts
npm run lint
npm run release-check
```
