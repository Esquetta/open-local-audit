# Technical Architecture

## Goal

Build a reliable, small, testable CLI that audits public local-business websites and outputs actionable reports. The architecture should stay modular enough to support a future web UI, but the first product is CLI-first.

## Architecture overview

```text
CLI input
  -> URL normalization
  -> Fetch/render pipeline
  -> Rule engine
  -> Scoring model
  -> Report generators
  -> JSON/Markdown output
```

## Core modules

### CLI

Responsibilities:
- Parse arguments.
- Validate input URL.
- Select output format.
- Configure crawl depth and timeout.
- Return useful exit codes.

Initial command shape:

```bash
open-local-audit <url> --format json|markdown --out <path>
```

### Fetch and render pipeline

Responsibilities:
- Fetch the primary HTML document.
- Follow redirects safely.
- Capture status, final URL, headers, and timing.
- Use browser rendering only when static parsing is insufficient.

Default behavior:
- Static fetch first.
- Playwright only for checks that need rendered DOM.

### Rule engine

Responsibilities:
- Run independent checks against normalized page data.
- Return structured findings with severity, evidence, and recommendation.
- Keep checks deterministic and testable.

Initial rule groups:
- Technical basics.
- Local conversion.
- SEO metadata.
- Structured data.
- Performance hints.
- Accessibility basics.

### Scoring model

Responsibilities:
- Group findings into owner-readable categories.
- Avoid pretending to be a full SEO suite.
- Make scores explainable.

Recommended categories:
- Trust and contact readiness.
- Mobile and usability.
- Search basics.
- Technical health.

### Report generators

Responsibilities:
- Emit JSON for machines.
- Emit Markdown for mini-audit handoff.
- Keep report wording practical and non-alarmist.

### Discovery command

Implemented first slice:

```text
discover --input places.csv --provider manual-csv
  -> Manual CSV discovery provider
  -> Website resolver
  -> Existing batch audit for website-present rows
  -> Prospect CSV for local operator triage
```

Responsibilities:
- Read operator-prepared CSV input.
- Mark each candidate as website present, missing, invalid, skipped, or error.
- Reuse the existing audit pipeline for website-present rows.
- Export `leads.csv` with website status, priority, next action, and report path.
- Support `--dry-run` for CSV-only triage without website audits.
- Keep review and outreach decisions manual.

Out of scope for this slice:
- Google Maps scraping.
- `google-places` provider calls.
- Outreach sending.

## Data model

Report fields:
- `url`
- `finalUrl`
- `scannedAt`
- `summary`
- `scores`
- `findings`
- `recommendations`
- `evidence`

Finding fields:
- `id`
- `title`
- `severity`
- `category`
- `evidence`
- `recommendation`
- `source`

## Technology decisions

| Area | Choice | Rationale |
| --- | --- | --- |
| Language | TypeScript | Strong fit with CLI tooling and npm release path. |
| Runtime | Node.js | Fast CLI delivery and ecosystem fit. |
| Parser | Cheerio | Simple and fast HTML inspection. |
| Browser | Playwright | Needed for rendered DOM and screenshots later. |
| Validation | Zod | Keeps inputs and report schema explicit. |
| Tests | Vitest | Lightweight TypeScript test runner. |

## Non-goals for MVP

- No hosted SaaS.
- No login or accounts.
- No Google Maps scraping.
- No Google Business Profile automation.
- No backlink analysis.
- No full Core Web Vitals replacement.
- No customer data storage by default.

## Future extension points

- Batch audit from CSV.
- Manual CSV discovery via `discover --input places.csv --provider manual-csv`.
- Deferred official Google Places provider with strict field and storage limits.
- Screenshot capture.
- Web UI using the same rule engine.
- GitHub Action mode.
- Branded report templates.
- Vertical-specific scoring for clinics, salons, real estate, and education.
