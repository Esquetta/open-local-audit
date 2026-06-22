# Open Local Audit

Open Local Audit is an open-source website and local presence auditor for small businesses. It turns public website signals into practical reports for outreach, customer education, and implementation work.

## Current stage

Published CLI. The project can run a single URL audit, an opt-in Playwright-rendered audit with screenshot evidence, optional Lighthouse category scoring, branded customer-facing reports, public contact readiness extraction, a plain-text batch URL list, or a profile-aware CSV batch file, optionally check same-origin links, and produce JSON, Markdown, HTML, PDF, or all standard report formats. Batch runs can use controlled concurrency, write per-site reports, add aggregate insight sections and contact/outreach rollups to the top-level index, and optionally export prospect CSV data for triage. Discovery runs can control Google Places result counts, cap website audits, write summary JSON, merge local review CSVs, explain opportunity scores, enrich outreach and public-contact columns, select a preferred manual outreach channel, and report exact duplicate lead groups plus advisory fuzzy duplicate review candidates. CRM-ready CSV exports can be validated locally before import, lead CSVs can be ranked into local shortlist reports with optional local review-state suppression, and single-site report folders can be packaged for local customer sharing.

## Business purpose

Open Local Audit produces evidence-backed mini audits for local businesses. The tool should be useful as open-source software while keeping paid value in implementation, redesign, maintenance, and custom reporting.

## Product principles

- Evidence first: every recommendation should point to a concrete finding.
- Ethical scanning: only scan user-provided public URLs and avoid Google Maps scraping.
- Small-business language: reports should be readable by non-technical owners.
- Developer quality: deterministic checks, clear CLI output, tests, and release notes.
- Commercial clarity: the open-source scanner is useful; paid work is execution and support.

## Proposed first stack

- Runtime: Node.js with TypeScript.
- CLI framework: `commander` or `cac`.
- Validation: `zod`.
- HTML parsing: `cheerio`.
- Browser rendering: Playwright where static parsing is not enough.
- Storage: no persistence by default; optional JSON/Markdown outputs.
- Test runner: Vitest.
- Package manager: npm unless implementation chooses pnpm before first commit.

## Documentation

- [Technical architecture](./docs/technical-architecture.md)
- [Security and ethics](./docs/security-and-ethics.md)
- [Audit checklist](./docs/audit-checklist.md)
- [Google Maps API key setup](./docs/google-maps-api-key.md)

## Local development

Install dependencies and run the checks:

```bash
npm install
npm test
npm run lint
npm run build
npm run release-check
```

Run the CLI locally:

```bash
npm start -- https://example.com --format markdown
```

After building, run the compiled CLI:

```bash
node dist/cli.js https://example.com --format json --pretty
```

Run the published package:

```bash
npx open-local-audit https://example.com --format markdown
```

Run with an industry profile:

```bash
open-local-audit https://example.com --profile dental --format markdown
```

Supported profiles are `generic`, `dental`, `beauty`, `restaurant`, `contractor`, `lawyer`, `clinic`, `gym`, `hotel`, and `auto-service`.

Render the page before auditing when static HTML is not enough:

```bash
open-local-audit https://example.com --render --format markdown
```

Capture a rendered homepage screenshot and add it as visual evidence:

```bash
open-local-audit https://example.com --screenshot --format all --out-dir reports
```

`--render` loads Playwright from the current project. Install it alongside the CLI when needed:

```bash
npm install -D playwright
```

Run Lighthouse category scoring:

```bash
open-local-audit https://example.com --lighthouse --format html --out report.html
```

`--lighthouse` runs Chrome through Lighthouse and adds performance, accessibility, best-practices, and SEO category scores to the report. It requires a local Chrome or Chromium runtime that Lighthouse can launch.

Write standard report formats to a directory:

```bash
open-local-audit https://example.com --format all --out-dir reports
```

Write an HTML report:

```bash
open-local-audit https://example.com --format html --out report.html
```

Write a branded PDF report:

```bash
open-local-audit https://example.com --format pdf --out report.pdf
```

Apply report branding:

```bash
open-local-audit https://example.com --brand-config brand.json --format pdf --out report.pdf
```

Minimal `brand.json`:

```json
{
  "name": "Example Audit Studio",
  "primaryColor": "#123456",
  "accentColor": "#2f7d5f",
  "footerText": "Prepared for outreach review",
  "contact": "hello@example.com"
}
```

Brand colors must use six-digit hex values. Branding applies to Markdown, HTML, and PDF reports.

Run a batch audit from a text file:

```bash
open-local-audit --input sites.txt --format all --out-dir reports
```

Run a labeled CSV batch audit:

```bash
open-local-audit --input sites.csv --format all --out-dir reports
```

Run a profile-aware batch audit and write a prospect CSV export:

```bash
open-local-audit --input sites.csv --profile dental --export-csv prospects.csv --format all --out-dir reports
```

Run a focused batch triage index:

```bash
open-local-audit --input sites.csv --format all --out-dir reports --segment dental --sort score-asc --top 25
```

Run a controlled parallel batch audit:

```bash
open-local-audit --input sites.csv --format all --out-dir reports --concurrency 3
```

Capture screenshots during batch audits:

```bash
open-local-audit --input sites.csv --screenshot --format all --out-dir reports
```

Batch triage supports `--segment <segment>`, `--min-score <score>`, `--top <count>`, `--sort score-asc|severity-desc`, and `--concurrency <count>`. Batch runs can also write `--export-csv <path>` for prospect triage. Batch index reports include aggregate average score, profile breakdown, segment breakdown, frequent finding sections, contact rollups, and advisory outreach channel rollups. Batch CSV exports include contact confidence, preferred contact channel, and contactability reason when reports were audited successfully. Use `--export-preset crm` with `--export-csv` to write a CRM-ready local import CSV instead of the standard operator CSV.

Supported CSV columns:

```csv
url,label,segment,profile
example.com,Example Clinic,dental,dental
https://example.org/path,Example Salon,beauty,beauty
```

Manual CSV lead discovery:

```bash
open-local-audit discover --input places.csv --provider manual-csv --profile dental --out-dir reports/dental --export-csv leads.csv
```

The `manual-csv` provider reads an operator-prepared CSV, resolves supplied website URLs, audits website-present rows through the existing batch pipeline, and writes `leads.csv` with `hasWebsite`, `websiteUrl`, `priority`, and `nextAction`. Use `--dry-run` to create the prospect CSV without auditing websites.

Google Places lead discovery:

```bash
GOOGLE_MAPS_API_KEY=your-key open-local-audit discover "guzellik salonu Umraniye" --provider google-places --profile beauty --out-dir reports/umraniye-beauty --export-csv leads.csv
```

Control discovery cost and audit volume:

```bash
GOOGLE_MAPS_API_KEY=your-key open-local-audit discover "dis klinigi Kadikoy" --provider google-places --limit 20 --max-audits 5 --summary-json discovery-summary.json --out-dir reports/kadikoy-dental --export-csv leads.csv
```

Skip previously reviewed leads and keep only stronger opportunities:

```bash
open-local-audit discover --input places.csv --provider manual-csv --suppression-list reviewed-leads.csv --min-opportunity-score 90 --dry-run --export-csv leads.csv
```

Maintain a review queue and duplicate review report across reruns:

```bash
open-local-audit discover --input places.csv --provider manual-csv --review-csv review.csv --duplicates-json duplicates.json --dry-run --export-csv leads.csv
```

Write a CRM-ready local import CSV:

```bash
open-local-audit discover --input places.csv --provider manual-csv --dry-run --export-csv crm-leads.csv --export-preset crm
```

Validate a CRM-ready local import CSV:

```bash
open-local-audit validate-export --input crm-leads.csv --preset crm
open-local-audit validate-export --input crm-leads.csv --preset crm --format json
```

`validate-export` checks the local CSV shape before a manual import. It reports missing CRM columns, missing `companyName`, missing `website`, missing `leadKey`, duplicate `leadKey` values, low or empty contact confidence, and rows that still need manual contact review. Markdown output is the default; JSON is available for automation. Any issue returns exit code `1`, while a clean file returns exit code `0`.

Create a local lead shortlist from a discovery or CRM CSV export:

```bash
open-local-audit shortlist --input leads.csv --out shortlist.md --top 20
open-local-audit shortlist --input leads.csv --out shortlist.md --min-opportunity-score 80
open-local-audit shortlist --input leads.csv --sort score-desc --out shortlist.md
open-local-audit shortlist --input leads.csv --out shortlist.md --summary-json shortlist-summary.json
open-local-audit shortlist --input leads.csv --segment dental --priority high --contact-confidence High --out shortlist.csv --format csv
open-local-audit shortlist --input leads.csv --preferred-contact-channel email --out shortlist.json --format json
open-local-audit shortlist --input leads.csv --exclude-review-status deferred --out shortlist.json --format json
open-local-audit shortlist --input leads.csv --require-website --out shortlist.json --format json
open-local-audit shortlist --input leads.csv --missing-website --out shortlist.json --format json
open-local-audit shortlist --input leads.csv --unreviewed --out shortlist.json --format json
open-local-audit shortlist --input leads.csv --reviewed-before 2026-06-20 --out shortlist.json --format json
open-local-audit shortlist --input leads.csv --require-contact --out shortlist.json --format json
open-local-audit shortlist --input leads.csv --missing-contact --out shortlist.json --format json
open-local-audit shortlist --input leads.csv --require-report --out shortlist.json --format json
open-local-audit shortlist --input leads.csv --missing-report --out shortlist.json --format json
open-local-audit shortlist --input leads.csv --review-csv review.csv --review-status pending --out shortlist.json --format json
open-local-audit shortlist --input crm-leads.csv --out shortlist.json --format json
open-local-audit shortlist --input crm-leads.csv --out shortlist.csv --format csv
open-local-audit shortlist --input leads.csv --review-csv review.csv --out shortlist.md
```

`shortlist` ranks local CSV rows by `opportunityScore`, `priority`, `contactConfidence`, `score`, and company name. Use `--sort opportunity-desc|score-desc|company-asc|last-reviewed-asc` to change the ranking mode before top-N selection. Use `--summary-json` to write a separate automation summary with counts and selected lead identifiers. Use `--require-website` to keep only rows with a website, `--missing-website` to keep only rows without a website, `--unreviewed` to keep only rows whose normalized `lastReviewedAt` is empty, `--reviewed-before YYYY-MM-DD` to keep only valid date-only or explicit-zone ISO review timestamps strictly earlier than a valid calendar threshold, `--require-contact` to keep only rows with contact confidence above `None`, `--missing-contact` to keep only rows with contact confidence set to `None`, `--require-report` to keep only rows with a report path, and `--missing-report` to keep only rows without a report path. Equal, blank, invalid, and zone-less review timestamps do not match `--reviewed-before`. Use `--min-opportunity-score` to keep only stronger local opportunities. Use `--segment`, `--profile`, `--priority`, `--contact-confidence`, and `--preferred-contact-channel` for case-insensitive exact focus filters; supplied filters, including review-date filters, are combined with `AND` semantics. Use `--review-status` to keep only active leads with a matching review status after completed or suppressed review rows have been removed, or `--exclude-review-status` to remove a matching active review status from the local report. Filtering runs after review-state suppression and before sorting and top-N selection. With `--review-csv`, the command matches review rows by `leadKey`, normalized website, or company label; skips rows marked `rejected`, `contacted`, `not-fit`, `not_a_fit`, `do-not-contact`, or `suppressed`; and carries active `reviewStatus`, `reviewReason`, and `lastReviewedAt` values into Markdown, JSON, and CSV reports. Markdown output is the default; JSON is available for automation; CSV is available for spreadsheet review. The command only reads local CSV files and writes a local report. It does not mutate source files, call APIs, send outreach, or sync to a CRM.

Package an existing single-site report folder for local customer sharing:

```bash
open-local-audit package-report --input reports/example-com --out packages/example-com
```

`package-report` reads `open-local-audit-report.json` from the input folder, copies available JSON, Markdown, HTML, and PDF report artifacts into `reports/`, and writes `README.md`, `next-actions.md`, and `manifest.json`. It is local file packaging only; it does not upload reports, send outreach, or sync to a CRM.

The `google-places` provider is opt-in and requires `GOOGLE_MAPS_API_KEY`. It uses the official Places Text Search API and requests only `places.id`, `places.displayName`, and `places.websiteUri`. It does not scrape Google Maps, collect reviews/photos/ratings, send outreach, or store raw Places responses. Google Maps Platform billing and quota limits apply to API use, and the CLI prints a billing warning when this provider is selected.

Discovery CSV exports include `leadKey`, `opportunityScore`, `opportunityReasons`, `pitchAngle`, `recommendedOffer`, `estimatedNeed`, `outreachPriorityReason`, website-derived public contact columns, manual outreach handoff columns, and review columns for local triage. Contact columns are populated only from audited public website HTML and include `publicEmail`, `publicPhone`, `whatsappUrl`, `contactPageUrl`, `socialProfiles`, `contactConfidence`, and `contactSource`. Handoff columns include `preferredContactChannel`, `outreachAction`, and `contactabilityReason`; they are advisory only and do not send outreach. Duplicate review JSON includes exact `duplicateGroups` and advisory `fuzzyDuplicateGroups` with confidence and matching reasons for local operator review. Fuzzy duplicate candidates do not auto-suppress leads, change review status, send outreach, or sync to a CRM. The CRM export preset writes `companyName`, `website`, `segment`, `profile`, `priority`, `score`, `opportunityScore`, `topFinding`, `contactConfidence`, `preferredContactChannel`, `contactabilityReason`, `publicEmail`, `publicPhone`, `contactPageUrl`, `source`, `leadKey`, and `reportPath`; it is a local import file only and does not call CRM APIs. A suppression list can reuse a prior discovery CSV or a smaller CSV with `leadKey`, `sourceId`, `websiteUrl`, or `label` plus optional `reviewStatus`, `reviewReason`, and `lastReviewedAt` columns. Rows marked `rejected`, `contacted`, `not-fit`, `do-not-contact`, or `suppressed` are skipped before audits run. `--review-csv` preserves prior operator decisions and adds new leads as `pending`. Spreadsheet formula-like cell values are neutralized before export, so values such as phone numbers starting with `+` may be prefixed for spreadsheet safety.

See [Google Maps API key setup](./docs/google-maps-api-key.md) for local environment setup.

Check same-origin links and fail CI when high-severity issues are found:

```bash
open-local-audit https://example.com --check-links --max-pages 10 --fail-on high --format all --out-dir reports
```

## First implementation milestone

The first implementation milestone is a CLI that accepts one URL and outputs:

- JSON report.
- Markdown report.
- HTML report.
- PDF report.
- Executive Summary section in customer-facing reports.
- Contact Readiness section in customer-facing reports.
- Optional report branding with `--brand-config`.
- Combined JSON, Markdown, and HTML report output with `--format all --out-dir`.
- Batch input files with per-site report folders.
- CSV batch input with optional labels and segments.
- Aggregate batch index reports for prospect triage.
- Batch index filtering, sorting, and top-N triage controls.
- Controlled parallel batch audits with `--concurrency`.
- Batch index insights for average score, profile breakdown, segment breakdown, and frequent findings.
- Batch contact and outreach rollups for audited public website contact readiness.
- CRM-ready local CSV export preset for batch and discovery exports.
- Local CRM export validation with Markdown and JSON issue reports.
- Local lead shortlist reports from discovery and CRM CSV exports.
- Local shortlist sort modes with `--sort`.
- Local shortlist automation summaries with `--summary-json`.
- Local shortlist website-present filtering with `--require-website`.
- Local shortlist missing-website filtering with `--missing-website`.
- Local shortlist unreviewed filtering with `--unreviewed`.
- Local shortlist re-review filtering with `--reviewed-before`.
- Local shortlist contact-ready filtering with `--require-contact`.
- Local shortlist missing-contact filtering with `--missing-contact`.
- Local shortlist report-ready filtering with `--require-report`.
- Local shortlist missing-report filtering with `--missing-report`.
- Local shortlist preferred-contact-channel filtering with `--preferred-contact-channel`.
- Local shortlist review-state suppression with `--review-csv`.
- Local shortlist opportunity-score filtering with `--min-opportunity-score`.
- Local shortlist focus filtering by segment, profile, priority, and contact confidence.
- Local shortlist active review-status filtering with `--review-status`.
- Local shortlist active review-status exclusion with `--exclude-review-status`.
- Spreadsheet-ready local shortlist CSV output with `--format csv`.
- Local report packaging with shareable summaries and copied report artifacts.
- Industry profiles for generic, dental, beauty, restaurant, contractor, lawyer, clinic, gym, hotel, and auto-service audits.
- Profile-specific findings for dental, beauty, restaurant, and contractor conversion/trust signals.
- Prospect CSV export with profile, score, top finding, contact handoff, report path, and error columns.
- Discovery CSV contact enrichment from audited public website HTML.
- Discovery CSV outreach handoff fields for manual next-channel selection.
- Advisory fuzzy duplicate lead review candidates for discovery reruns.
- Duplicate review output remains local operator guidance and does not auto-suppress, send outreach, or sync to CRM systems.
- Optional rendered DOM audits with `--render`.
- Optional rendered screenshot evidence with `--screenshot`.
- Optional Lighthouse category scoring with `--lighthouse`.
- Score summary.
- Evidence table.
- Optional same-origin link checks.
- Terminal summary when reports are written to files.
- CI-friendly exit codes with `--fail-on`.
- Clear owner-readable recommendations.
- Structured-data quality, address, opening-hours, service-location, CTA, and placeholder-copy checks.
- Trust and conversion checks for current date signals, review cues, service detail depth, brand icons, and placeholder social links.

Example target command:

```bash
open-local-audit https://example.com --format markdown --out report.md
```

Example report artifacts are available under [`examples/reports`](./examples/reports).

## Known limits

- `--render` requires Playwright in the calling project and a working browser runtime.
- `--screenshot` uses the rendered audit path, requires `--out-dir`, and also requires Playwright.
- `--lighthouse` requires a local Chrome or Chromium runtime that Lighthouse can launch.
- `--format pdf` is supported for single URL audits and requires `--out` or `--out-dir`.
- `--brand-config` reads local JSON only; it does not fetch remote assets or upload report data.
- Batch triage options apply to the aggregate batch index, not individual per-site report contents.
- Batch contact and outreach rollups are advisory local triage metadata; they do not send outreach or sync to a CRM.
- `--export-preset crm` changes CSV columns only; it does not create, update, or sync CRM records.
- `validate-export` checks local CSV files only; it does not create, update, or sync CRM records.
- `shortlist` ranks local CSV files only; it does not call APIs, send outreach, or sync CRM records.
- `shortlist --sort` changes local report ordering only; it does not update source or review CSV files.
- `shortlist --summary-json` writes local automation metadata only; it does not update source or review CSV files.
- `shortlist --require-website` filters local report output only; it does not update source or review CSV files.
- `shortlist --missing-website` filters local report output only; it does not update source or review CSV files.
- `shortlist --unreviewed` filters local report output only; it does not update source or review CSV files.
- `shortlist --reviewed-before` requires an explicit date threshold and filters local report output only; it does not calculate relative review age or update source or review CSV files.
- `shortlist --require-contact` filters local report output only; it does not update source or review CSV files.
- `shortlist --missing-contact` filters local report output only; it does not update source or review CSV files.
- `shortlist --require-report` filters local report output only; it does not update source or review CSV files.
- `shortlist --missing-report` filters local report output only; it does not update source or review CSV files.
- `shortlist --preferred-contact-channel` filters local report output only; it does not update source or review CSV files.
- `shortlist --review-csv` reads review state for suppression and report context only; it does not mutate the review CSV.
- `shortlist --min-opportunity-score` filters local report output only; it does not update source lead files.
- Shortlist focus filters use case-insensitive exact matching and do not update source lead files.
- `shortlist --review-status` filters local report output only; it does not update source or review CSV files.
- `shortlist --exclude-review-status` filters local report output only; it does not update source or review CSV files.
- `shortlist --format csv` writes a local spreadsheet review file only; it does not import or sync records.
- `package-report` packages local files only; it does not upload reports, send outreach, or sync CRM records.
- `--export-csv` is supported for batch audits and discovery exports.
- `discover --provider google-places` requires `GOOGLE_MAPS_API_KEY` and may incur Google Maps Platform billing.
- `--limit` caps Google Places candidates at 50; it does not paginate beyond one Text Search request.
- `--max-audits` limits website audits only; all discovered candidates still appear in `leads.csv`.
- `--suppression-list` uses exact lead identity matching; source IDs are preferred, then normalized website URLs, then normalized labels.
- `--review-csv` is local operator state only; it does not send outreach or sync to a CRM.
- `--duplicates-json` reports exact duplicate lead groups and advisory fuzzy duplicate candidates for manual review; it does not auto-suppress rows or update review decisions.
- Batch input requires `--out-dir` and cannot be combined with a positional URL.
- Industry profiles are deterministic vertical heuristics, not a replacement for a human review of each business model.
- Higher `--concurrency` values can increase network load against audited sites; use conservative values for prospect batches.
- Rule checks are deterministic heuristics, so they can miss or over-flag site-specific markup.

## Releases

Open Local Audit is published under the MIT license on GitHub and npm. Release history is available in [CHANGELOG.md](./CHANGELOG.md) and GitHub Releases. Every release runs lint, tests, build, audit, and package-content checks through GitHub Actions.
