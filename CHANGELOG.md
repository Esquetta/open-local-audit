# Changelog

All notable changes to Open Local Audit will be documented here.

## Unreleased

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
