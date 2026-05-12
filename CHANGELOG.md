# Changelog

All notable changes to Open Local Audit will be documented here.

## Unreleased

## v0.9.0 - 2026-05-12

- Added `discover --input places.csv --provider manual-csv` for operator-prepared lead discovery.
- Added `leads.csv` prospect exports with website presence, audit status, priority, next action, report path, and error columns.
- Reused the existing batch audit pipeline for website-present discovery rows.
- Added `--dry-run` discovery mode for local prospect triage without website audits.
- Documented the discovery boundary: no Google Maps scraping, no `google-places` provider calls, and no outreach sending in this release.

## v0.8.0 - 2026-05-12

- Added `--concurrency` for controlled parallel batch audits.
- Added batch index insights with average score, profile breakdown, segment breakdown, and frequent findings.
- Added profile-specific findings for dental, beauty, restaurant, and contractor audits.
- Expanded profile tests to cover missing and satisfied vertical conversion/trust signals.

## v0.7.0 - 2026-05-11

- Added industry profiles with `--profile generic|dental|beauty|restaurant|contractor`.
- Added optional `profile` CSV input column for batch audits.
- Added profile metadata to JSON, Markdown, HTML, and batch index outputs.
- Added `--export-csv` for batch prospect exports with score, top finding, report path, and error columns.

## v0.6.0 - 2026-05-10

- Added `--screenshot` for rendered homepage screenshot capture.
- Added visual evidence metadata to JSON reports.
- Added Visual Evidence sections to Markdown and HTML reports.
- Added batch screenshot artifact paths for per-site report folders.

## v0.5.0 - 2026-05-09

- Added opt-in Playwright-rendered audits with `--render`.
- Added batch triage controls with `--segment`, `--min-score`, `--top`, and `--sort`.
- Added trust and conversion checks for current date signals, review cues, service detail depth, brand icons, and placeholder social profile links.

## v0.4.0 - 2026-05-09

- Added resilient batch runs that keep auditing after individual URL failures.
- Added aggregate batch index reports in JSON, Markdown, and HTML.
- Added CSV batch input with `url`, `label`, and `segment` columns.
- Added `@graph` JSON-LD support for structured-data checks.
- Added LocalBusiness contact-field, Organization schema, visible address, opening-hours, service-location copy, primary CTA, and placeholder-copy checks.

## v0.3.0 - 2026-05-09

- Added standalone HTML report rendering.
- Added `--format html`.
- Expanded `--format all` to write JSON, Markdown, and HTML reports.
- Added `--input <path>` for batch audits from text files.
- Added safe per-site output folders for batch reports.

## v0.2.0 - 2026-05-08

- Added optional same-origin internal link scanning with `--check-links` and `--max-pages`.
- Added a high-severity finding for broken internal links.
- Added `--fail-on none|high|medium|low` for CI-friendly exit codes.
- Added compact terminal summaries when reports are written to files.
- Added integration tests for link scanning and CLI behavior helpers.

## v0.1.1 - 2026-05-08

- Added `robots.txt`, `sitemap.xml`, Open Graph, and invalid JSON-LD checks.
- Added `--format all --out-dir <path>` for writing JSON and Markdown reports together.
- Added fixture-based rule tests and report output tests.
- Added `npm run release-check` for local and CI release verification.

## v0.1.0 - 2026-05-08

- Project documentation and release planning created.
- Initial TypeScript CLI scaffold added.
- JSON and Markdown report generation added.
- Initial audit rule set and Vitest coverage added.
- Example report artifacts added.
