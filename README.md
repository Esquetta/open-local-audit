# Open Local Audit

Open Local Audit is an open-source website and local presence auditor for small businesses. It turns public website signals into practical reports that TORUT can use for outreach, customer education, and implementation work.

## Current stage

Planning and release preparation. Implementation has not started yet.

## Business purpose

Open Local Audit supports TORUT Local Presence Kit by producing evidence-backed mini audits for local businesses. The tool should be useful as open-source software while keeping paid value in implementation, redesign, maintenance, and custom reporting.

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

## First implementation milestone

Build a CLI that accepts one URL and outputs:

- JSON report.
- Markdown report.
- Score summary.
- Evidence table.
- Clear owner-readable recommendations.

Example target command:

```bash
open-local-audit https://example.com --format markdown --out report.md
```

## GitHub and npm release intent

The project should be prepared for:

- Public GitHub repository.
- Clear README and examples.
- MIT license, unless TORUT changes this before the first public release.
- GitHub Actions for lint, tests, build, and release checks.
- npm package after the CLI has real tests and example reports.

No npm package should be published until the release checklist in `docs/release/release-readiness.md` is complete.
