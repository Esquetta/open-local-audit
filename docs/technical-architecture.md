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

Implemented provider and control extensions:

```text
discover "dentists in Boston" --provider google-places
  -> Official Google Places Text Search provider
  -> Website-only candidate extraction
  -> Operator-controlled candidate and audit caps
  -> Optional summary JSON for release evidence
  -> Local suppression and review-state fields
  -> Optional review CSV and exact/fuzzy duplicate JSON outputs
```

Responsibilities:
- Read operator-prepared CSV input.
- Fetch local candidates from the official Google Places API when `--provider google-places` is used.
- Warn operators that Google Maps Platform billing may apply before Google Places calls.
- Mark each candidate as website present, missing, invalid, skipped, or error.
- Reuse the existing audit pipeline for website-present rows.
- Export `leads.csv` with lead identity, website status, opportunity score, review status, priority, next action, and report path.
- Support `--limit`, `--max-audits`, `--min-opportunity-score`, `--suppression-list`, `--review-csv`, `--duplicates-json`, `--dry-run`, and `--summary-json` for controlled local triage.
- Filter suppressed candidates before running website audits.
- Preserve operator review decisions across reruns in a separate review CSV.
- Report exact stable lead-key duplicate groups and advisory fuzzy duplicate candidates when requested.
- Neutralize formula-like CSV cells before export.
- Keep review, suppression, outreach, and CRM decisions manual.

Out of scope for this slice:
- Google Maps scraping.
- Raw Google Places response storage beyond the mapped candidate fields.
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
- Google Places pagination and richer operator review queues.
- Screenshot capture.
- Web UI using the same rule engine.
- GitHub Action mode.
- Branded report templates.
- Vertical-specific scoring for clinics, salons, real estate, and education.
