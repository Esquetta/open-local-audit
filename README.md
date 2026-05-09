# Open Local Audit

Open Local Audit is an open-source website and local presence auditor for small businesses. It turns public website signals into practical reports for outreach, customer education, and implementation work.

## Current stage

Published CLI. The project can run a single URL audit, an opt-in Playwright-rendered audit, a plain-text batch URL list, or a CSV batch file, optionally check same-origin links, and produce JSON, Markdown, HTML, or all report formats. Batch runs write per-site reports plus a filterable top-level batch index for prospect triage.

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

Render the page before auditing when static HTML is not enough:

```bash
open-local-audit https://example.com --render --format markdown
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

Run a focused batch triage index:

```bash
open-local-audit --input sites.csv --format all --out-dir reports --segment dental --sort score-asc --top 25
```

Batch triage supports `--segment <segment>`, `--min-score <score>`, `--top <count>`, and `--sort score-asc|severity-desc`.

Supported CSV columns:

```csv
url,label,segment
example.com,Example Clinic,dental
https://example.org/path,Example Salon,beauty
```

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
- Optional rendered DOM audits with `--render`.
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
- Batch triage options apply to the aggregate batch index, not individual per-site report contents.
- Batch input requires `--out-dir` and cannot be combined with a positional URL.
- Rule checks are deterministic heuristics, so they can miss or over-flag site-specific markup.

## GitHub and npm release intent

The project should be prepared for:

- Public GitHub repository.
- Clear README and examples.
- MIT license, unless maintainers choose a different license before the first public release.
- GitHub Actions for lint, tests, build, and release checks.
- npm package after the CLI has real tests and example reports.

Release work should follow the checklist in `docs/release/release-readiness.md`.
