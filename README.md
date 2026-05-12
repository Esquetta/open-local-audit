# Open Local Audit

Open Local Audit is an open-source website and local presence auditor for small businesses. It turns public website signals into practical reports for outreach, customer education, and implementation work.

## Current stage

Published CLI. The project can run a single URL audit, an opt-in Playwright-rendered audit with screenshot evidence, a plain-text batch URL list, or a profile-aware CSV batch file, optionally check same-origin links, and produce JSON, Markdown, HTML, or all report formats. Batch runs can use controlled concurrency, write per-site reports, add aggregate insight sections to the top-level index, and optionally export prospect CSV data for triage.

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

## Documents

- [Product brief](./docs/product-brief.md)
- [Technical architecture](./docs/technical-architecture.md)
- [MVP roadmap](./docs/mvp-roadmap.md)
- [Security and ethics](./docs/security-and-ethics.md)
- [Go-to-market plan](./docs/go-to-market.md)
- [Audit checklist](./docs/research/audit-checklist.md)
- [Release readiness](./docs/release/release-readiness.md)
- [npm publishing plan](./docs/release/npm-publishing.md)
- [Project operating standard](./docs/operations/project-standard.md)
- [Decision log](./docs/operations/decision-log.md)

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

Write both report formats to a directory:

```bash
open-local-audit https://example.com --format all --out-dir reports
```

Write an HTML report:

```bash
open-local-audit https://example.com --format html --out report.html
```

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

Batch triage supports `--segment <segment>`, `--min-score <score>`, `--top <count>`, `--sort score-asc|severity-desc`, and `--concurrency <count>`. Batch runs can also write `--export-csv <path>` for prospect triage. Batch index reports include aggregate average score, profile breakdown, segment breakdown, and frequent finding sections.

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

The `google-places` provider is opt-in, uses the official Places Text Search API, and requests only `places.id`, `places.displayName`, and `places.websiteUri`. It does not scrape Google Maps, collect reviews/photos/ratings, send outreach, or store raw Places responses. Google Maps Platform billing and quota limits apply to API use.

Check same-origin links and fail CI when high-severity issues are found:

```bash
open-local-audit https://example.com --check-links --max-pages 10 --fail-on high --format all --out-dir reports
```

## First implementation milestone

The first implementation milestone is a CLI that accepts one URL and outputs:

- JSON report.
- Markdown report.
- HTML report.
- Combined JSON, Markdown, and HTML report output with `--format all --out-dir`.
- Batch input files with per-site report folders.
- CSV batch input with optional labels and segments.
- Aggregate batch index reports for prospect triage.
- Batch index filtering, sorting, and top-N triage controls.
- Controlled parallel batch audits with `--concurrency`.
- Batch index insights for average score, profile breakdown, segment breakdown, and frequent findings.
- Industry profiles for generic, dental, beauty, restaurant, and contractor audits.
- Profile-specific findings for dental, beauty, restaurant, and contractor conversion/trust signals.
- Prospect CSV export with profile, score, top finding, report path, and error columns.
- Optional rendered DOM audits with `--render`.
- Optional rendered screenshot evidence with `--screenshot`.
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
- Batch triage options apply to the aggregate batch index, not individual per-site report contents.
- `--export-csv` is only supported for batch audits.
- `discover --provider google-places` requires `GOOGLE_MAPS_API_KEY` and may incur Google Maps Platform billing.
- Batch input requires `--out-dir` and cannot be combined with a positional URL.
- Industry profiles are deterministic vertical heuristics, not a replacement for a human review of each business model.
- Higher `--concurrency` values can increase network load against audited sites; use conservative values for prospect batches.
- Rule checks are deterministic heuristics, so they can miss or over-flag site-specific markup.

## GitHub and npm release intent

The project should be prepared for:

- Public GitHub repository.
- Clear README and examples.
- MIT license, unless maintainers choose a different license before the first public release.
- GitHub Actions for lint, tests, build, and release checks.
- npm package after the CLI has real tests and example reports.

Release work should follow the checklist in `docs/release/release-readiness.md`.
