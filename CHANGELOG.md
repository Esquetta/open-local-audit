# Changelog

All notable changes to Open Local Audit will be documented here.

## Unreleased

## v0.39.0 - 2026-06-20

- Added `shortlist --reviewed-before <date>` for local re-review shortlist queues.
- Added strict `YYYY-MM-DD` threshold validation and strictly-earlier review-date filtering.
- Kept reviewed-before filtering local-only with no source CSV mutation, review CSV mutation, API calls, outreach sending, or CRM sync.

## v0.38.0 - 2026-06-19

- Added `shortlist --unreviewed` for local first-review shortlist queues.
- Applied unreviewed filtering after review suppression and before sorting and top-N selection.
- Kept unreviewed filtering local-only with no source CSV mutation, review CSV mutation, API calls, outreach sending, or CRM sync.

## v0.37.0 - 2026-06-17

- Added `shortlist --missing-website` for local website-backlog shortlist filtering.
- Applied missing-website filtering after review suppression and before sorting and top-N selection.
- Kept missing-website filtering local-only with no source CSV mutation, review CSV mutation, API calls, outreach sending, or CRM sync.

## v0.36.0 - 2026-06-16

- Added `shortlist --missing-contact` for local contact-backlog shortlist filtering.
- Applied missing-contact filtering after review suppression and before sorting and top-N selection.
- Kept missing-contact filtering local-only with no source CSV mutation, review CSV mutation, API calls, outreach sending, or CRM sync.

## v0.35.0 - 2026-06-15

- Added `shortlist --missing-report` for local report-backlog shortlist filtering.
- Applied missing-report filtering after review suppression and before sorting and top-N selection.
- Kept missing-report filtering local-only with no source CSV mutation, review CSV mutation, API calls, outreach sending, or CRM sync.

## v0.34.0 - 2026-06-14

- Added `shortlist --preferred-contact-channel <channel>` for local outreach-channel shortlist filtering.
- Applied preferred-contact-channel filtering after review suppression and before sorting and top-N selection.
- Kept preferred-contact-channel filtering local-only with no source CSV mutation, review CSV mutation, API calls, outreach sending, or CRM sync.

## v0.33.0 - 2026-06-13

- Added `shortlist --require-report` for local report-ready shortlist filtering.
- Applied report-required filtering after review suppression and before sorting and top-N selection.
- Kept report-required filtering local-only with no source CSV mutation, review CSV mutation, API calls, outreach sending, or CRM sync.

## v0.32.0 - 2026-06-12

- Added `shortlist --require-contact` for local contact-ready shortlist filtering.
- Applied contact-required filtering after review suppression and before sorting and top-N selection.
- Kept contact-required filtering local-only with no source CSV mutation, review CSV mutation, API calls, outreach sending, or CRM sync.

## v0.31.0 - 2026-06-11

- Added `shortlist --require-website` for local website-present shortlist filtering.
- Applied website-required filtering after review suppression and before sorting and top-N selection.
- Kept website-required filtering local-only with no source CSV mutation, review CSV mutation, API calls, outreach sending, or CRM sync.

## v0.30.0 - 2026-06-09

- Added `shortlist --exclude-review-status <status>` for local active-review-status exclusion.
- Applied review-status exclusion after review suppression and before sorting and top-N selection.
- Kept exclusion filtering local-only with no source CSV mutation, review CSV mutation, API calls, outreach sending, or CRM sync.

## v0.29.0 - 2026-06-08

- Added `shortlist --summary-json <path>` for separate local automation summary output.
- Added `renderShortlistSummaryJson` for package consumers.
- Kept summary output local-only with no source CSV mutation, review CSV mutation, API calls, outreach sending, or CRM sync.

## v0.28.0 - 2026-06-07

- Added `shortlist --sort <sort>` for local shortlist ranking control.
- Supported `opportunity-desc`, `score-desc`, `company-asc`, and `last-reviewed-asc` sort modes.
- Kept sorting local-only with no source CSV mutation, review CSV mutation, API calls, outreach sending, or CRM sync.

## v0.27.0 - 2026-06-06

- Added `shortlist --review-status <status>` for active review-state filtering.
- Applied review-status filtering after review-state suppression and before ranking and top-N selection.
- Kept review-status filtering local-only with no review CSV mutation, source CSV mutation, API calls, outreach sending, or CRM sync.

## v0.26.0 - 2026-06-05

- Added `shortlist` focus filters for segment, profile, priority, and contact confidence.
- Combined supplied focus filters with case-insensitive `AND` matching.
- Applied focus filters after review suppression and before ranking and top-N selection.
- Kept focus filtering local-only with no source CSV mutation, API calls, outreach sending, or CRM sync.

## v0.25.0 - 2026-06-04

- Added `shortlist --min-opportunity-score <score>` for local shortlist filtering.
- Filtered low-opportunity shortlist leads after review-state suppression and before top-N ranking.
- Reported filtered row counts in CLI output, Markdown summaries, and JSON results.
- Kept shortlist filtering local-only with no API calls, outreach sending, review CSV mutation, or CRM sync.

## v0.24.0 - 2026-06-03

- Added `shortlist --format csv` for spreadsheet-ready local shortlist output.
- Included rank, scoring, contact handoff, review context, lead key, and report path columns in CSV shortlist reports.
- Reused existing CSV cell hardening so formula-like shortlist values are neutralized before spreadsheet review.
- Kept CSV shortlist generation local-only with no API calls, outreach sending, review CSV mutation, or CRM sync.

## v0.23.0 - 2026-06-01

- Added `shortlist --review-csv <path>` for local review-state aware shortlist runs.
- Suppressed already handled shortlist leads marked `rejected`, `contacted`, `not-fit`, `not_a_fit`, `do-not-contact`, or `suppressed`.
- Carried active review status, review reason, and last-reviewed date into Markdown and JSON shortlist reports.
- Kept shortlist review handling local-only with no review CSV mutation, API calls, outreach sending, or CRM sync.

## v0.22.0 - 2026-05-31

- Added `shortlist --input <path> --out <path>` for local lead shortlist reports.
- Added Markdown and JSON shortlist output for discovery and CRM CSV exports.
- Ranked leads by opportunity score, priority, contact confidence, audit score, and company name.
- Kept shortlist generation local-only with no API calls, outreach sending, or CRM sync.

## v0.21.0 - 2026-05-28

- Added `package-report --input <path> --out <path>` for local customer-shareable report packs.
- Added report-pack `README.md`, `next-actions.md`, and `manifest.json` generation from existing single-site JSON reports.
- Copied available JSON, Markdown, HTML, and PDF report artifacts into the local package.
- Kept report packaging local-only with no uploads, outreach sending, or CRM sync.

## v0.20.0 - 2026-05-27

- Added `validate-export --input <path> --preset crm` for local CRM CSV import checks.
- Added Markdown and JSON validation reports with row counts, errors, warnings, and issue details.
- Flagged missing CRM columns, missing company or website fields, duplicate lead keys, low contact confidence, and manual-review handoffs.
- Kept validation local-only with no CRM API sync, remote import, or outreach sending.

## v0.19.0 - 2026-05-26

- Added `--export-preset standard|crm` for batch and discovery CSV exports.
- Added CRM-ready local import columns for company identity, website, scoring, contact handoff, source, lead key, and report path.
- Preserved existing standard CSV export behavior as the default.
- Kept CRM export local-only with no CRM API sync or outreach sending.

## v0.18.0 - 2026-05-23

- Added batch index contact rollups for public contact coverage and confidence.
- Added batch outreach rollups for preferred manual contact channels.
- Added per-entry batch index contact and outreach metadata for successful audits.
- Added batch CSV export columns for contact confidence, preferred contact channel, and contactability reason.

## v0.17.0 - 2026-05-22

- Added advisory fuzzy duplicate candidate groups to discovery duplicate JSON output.
- Added duplicate review reasons for likely business-label and website-domain similarity.
- Preserved exact duplicate reporting while keeping fuzzy matching manual-review only.
- Confirmed fuzzy duplicate review does not auto-suppress leads, send outreach, or sync to a CRM.

## v0.16.0 - 2026-05-20

- Added discovery outreach handoff fields: `preferredContactChannel`, `outreachAction`, and `contactabilityReason`.
- Added deterministic channel selection for email, WhatsApp, phone, contact-page, and manual-review discovery leads.
- Preserved CSV formula hardening for the new outreach handoff fields.

## v0.15.0 - 2026-05-19

- Added public contact extraction for audited pages, including email, phone, WhatsApp, contact-page, and social-profile signals.
- Added Contact Readiness sections to Markdown, HTML, and PDF reports.
- Added contact enrichment columns to discovery CSV exports while preserving CSV formula hardening.

## v0.14.0 - 2026-05-16

- Added `--brand-config` for JSON-driven report branding across Markdown, HTML, and PDF outputs.
- Added Executive Summary sections with business impact, top issues, and a recommended first fix.
- Added lead export enrichment columns: `pitchAngle`, `recommendedOffer`, `estimatedNeed`, and `outreachPriorityReason`.

## v0.13.0 - 2026-05-15

- Added opt-in Lighthouse category scoring with `--lighthouse`.
- Added branded PDF report output with `--format pdf`.
- Added `opportunityReasons` to discovery CSV exports so operators can explain lead scores.
- Added Lighthouse sections to JSON, Markdown, HTML, and PDF reports.

## v0.12.0 - 2026-05-14

- Added discovery suppression lists with `--suppression-list` to skip previously reviewed leads.
- Added `leadKey`, `reviewStatus`, `reviewReason`, and `lastReviewedAt` columns to discovery CSV exports for local review workflows.
- Added `--min-opportunity-score` for filtering discovery exports to higher-value opportunities.
- Added `--review-csv` for merging local operator review decisions across discovery reruns.
- Added `--duplicates-json` for reporting duplicate lead groups.
- Added lawyer, clinic, gym, hotel, and auto-service industry profiles.
- Polished HTML reports with a branded shell, summary cards, and stronger visual hierarchy.
- Added Windows user-environment fallback for `GOOGLE_MAPS_API_KEY`.

## v0.11.0 - 2026-05-13

- Added discovery controls: `--limit`, `--max-audits`, and `--summary-json`.
- Added terminal discovery summary output for website, audit, priority, and average-score counts.
- Added `opportunityScore` to discovery prospect CSV exports.
- Added CSV formula-injection hardening for exported CSV cells.
- Added a Google Maps Platform billing warning when `--provider google-places` is used.

## v0.10.0 - 2026-05-12

- Added an opt-in `google-places` provider for `discover`.
- Added `GOOGLE_MAPS_API_KEY` support for official Google Places Text Search requests.
- Resolved official place website URLs through `websiteUri` where available.
- Kept Google Places storage conservative: no Google Maps scraping, no reviews/photos/ratings collection, and no long-term raw Places data store.
- Fed resolved Google Places websites into the existing audit pipeline and prospect CSV export.

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
