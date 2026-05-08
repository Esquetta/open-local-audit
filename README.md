# Open Local Audit

Open Local Audit is an open-source website and local presence auditor for small businesses. It turns public website signals into practical reports for outreach, customer education, and implementation work.

## Current stage

Initial published CLI. The project can run a single URL audit and produce JSON, Markdown, or both report formats.

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

Write both report formats to a directory:

```bash
open-local-audit https://example.com --format all --out-dir reports
```

## First implementation milestone

The first implementation milestone is a CLI that accepts one URL and outputs:

- JSON report.
- Markdown report.
- Combined JSON and Markdown report output with `--format all --out-dir`.
- Score summary.
- Evidence table.
- Clear owner-readable recommendations.

Example target command:

```bash
open-local-audit https://example.com --format markdown --out report.md
```

Example report artifacts are available under [`examples/reports`](./examples/reports).

## GitHub and npm release intent

The project should be prepared for:

- Public GitHub repository.
- Clear README and examples.
- MIT license, unless maintainers choose a different license before the first public release.
- GitHub Actions for lint, tests, build, and release checks.
- npm package after the CLI has real tests and example reports.

Release work should follow the checklist in `docs/release/release-readiness.md`.
