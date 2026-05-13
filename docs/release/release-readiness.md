# Release Readiness

## Purpose

Prepare Open Local Audit for a professional GitHub and npm release. Do not publish until the CLI has real behavior, tests, examples, and reviewed package contents.

## GitHub readiness checklist

- [x] Repository created.
- [x] README is accurate and not overstated.
- [x] Product brief is current.
- [x] License selected.
- [x] Contributing guide added.
- [x] Security policy added.
- [x] Code of conduct decision made.
- [x] GitHub Actions runs tests.
- [x] Example reports committed.
- [x] Changelog started.
- [x] First release notes drafted.

## npm readiness checklist

- [x] Package name confirmed available.
- [x] `package.json` metadata complete.
- [x] `bin` entry points to compiled CLI.
- [x] Package exports are intentional.
- [x] `files` list prevents accidental publishing.
- [x] `npm pack --dry-run` reviewed.
- [x] Install test from packed tarball passes.
- [x] CLI smoke test passes through `npx`.
- [x] Version matches planned GitHub release tag.

## Quality gates

Before release:

```bash
npm test
npm run lint
npm run build
npm pack --dry-run
```

The preferred single command is:

```bash
npm run release-check
```

## Discovery slice readiness

Before releasing the first `discover` implementation:

- [x] README and CLI help document `discover --input places.csv --provider manual-csv`.
- [x] Manual CSV parsing, website-present audit handoff, website-missing rows, and `leads.csv` columns are covered by tests.
- [x] Output is local operator triage only and does not include outreach sending.
- [x] Docs and help state that Google Maps scraping is not supported.
- [x] Docs and help state that Google Places support uses the official API only.
- [x] Package review confirms no API keys, fixtures, or generated lead files are included accidentally.

## Google Places discovery readiness

Before releasing the first `google-places` provider:

- [x] CLI requires `GOOGLE_MAPS_API_KEY` for `--provider google-places`.
- [x] Google Places requests use a strict field mask for `places.id`, `places.displayName`, and `places.websiteUri`.
- [x] Tests use mocked Google responses only; CI does not call Google APIs.
- [x] Website-present Google candidates feed into the existing audit pipeline.
- [x] Website-missing Google candidates stay in `leads.csv` with `hasWebsite=no`.
- [x] Local setup docs explain `GOOGLE_MAPS_API_KEY` usage.
- [x] Docs state no Google Maps scraping, no reviews/photos/ratings collection, no outreach sending, and no raw Places response storage.
- [x] Package review confirms no API keys, fixtures, or generated lead files are included accidentally.

## Discovery controls readiness

Before releasing discovery cost and triage controls:

- [x] CLI help documents `--limit`, `--max-audits`, and `--summary-json`.
- [x] Google Places requests include the bounded `maxResultCount` value and clamp oversized limits.
- [x] `--max-audits` limits website audits while preserving unaudited candidates in `leads.csv`.
- [x] Terminal and JSON summaries include website status, audit status, average score, and priority counts.
- [x] `leads.csv` includes `opportunityScore` for operator triage.
- [x] CSV export neutralizes formula-like cells before local spreadsheet review.
- [x] Google Places runs warn that Google Maps Platform billing may apply.
- [x] Tests cover mocked Google responses, audit caps, summary JSON, opportunity scoring, and CSV hardening.

Add project-specific commands once implementation starts.

Current project-specific verification:

```bash
npm audit
node dist/cli.js --help
npm pack
npx --yes --package ./open-local-audit-0.11.0.tgz open-local-audit --help
```

## Current release recommendation

Use `v0.11.0` after:

- single URL, rendered URL, screenshot metadata, profile metadata, and CSV batch paths are covered by tests or smoke checks,
- JSON, Markdown, HTML, and `--format all` outputs build from current code,
- batch index filtering and sorting are verified,
- profile-aware batch input, controlled concurrency, aggregate batch insights, and prospect CSV export are verified,
- dental, beauty, restaurant, and contractor profile-specific findings are covered by regression tests,
- manual CSV discovery, official Google Places discovery, and local prospect CSV export are verified,
- Google Places missing-key behavior, strict field masks, mocked candidate mapping, dry-run, and audit handoff are verified,
- discovery limits, audit caps, summary JSON, opportunity scoring, and CSV formula hardening are verified,
- visual evidence sections render in Markdown and HTML,
- example reports are regenerated from the current build,
- GitHub Actions passes on the pushed commit,
- GitHub Release is created before npm publish.

Use patch releases for documentation, packaging, or narrow rule fixes that do not change CLI behavior.
