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

## Discovery review workflow readiness

Before releasing suppression and review workflow controls:

- [x] CLI help documents `--suppression-list` and `--min-opportunity-score`.
- [x] Discovery exports include stable `leadKey` values and local review columns.
- [x] Suppression-list parsing supports prior discovery CSVs and compact review CSVs.
- [x] Suppressed candidates are filtered before website audits run.
- [x] Summary output includes suppressed candidate counts.
- [x] Opportunity-score filtering is covered by CLI tests.
- [x] Review CSV output preserves prior operator decisions and adds new leads as pending.
- [x] Duplicate JSON output groups exact stable lead-key matches.
- [x] Expanded industry profiles are covered by profile regression tests.
- [x] HTML report polish is covered by renderer tests.

## Sales-ready reporting readiness

Before releasing Lighthouse, PDF, and score explanation features:

- [x] CLI help documents `--lighthouse` and `--format pdf`.
- [x] Lighthouse execution is opt-in and does not slow normal CLI startup.
- [x] Lighthouse category scores render in JSON, Markdown, HTML, and PDF reports.
- [x] PDF output writes a real PDF artifact and requires `--out` or `--out-dir`.
- [x] Discovery CSV exports include `opportunityReasons`.
- [x] Score explanations are covered by prospect-row and CSV tests.

## Branded sales output readiness

Before releasing branded report and lead enrichment features:

- [x] CLI help documents `--brand-config`.
- [x] Brand config parsing validates local JSON and rejects invalid colors.
- [x] Markdown, HTML, and PDF outputs accept report branding.
- [x] Executive Summary sections render before detailed findings.
- [x] Discovery CSV exports include pitch, offer, need, and outreach reason columns.
- [x] CSV formula hardening still applies to enriched export fields.

## Contact-ready discovery readiness

Before releasing website-derived contact enrichment:

- [x] Public contact extraction covers mailto, tel, WhatsApp, contact-page, social-profile, and visible-text email signals.
- [x] Audit reports expose Contact Readiness sections in customer-facing formats.
- [x] Discovery CSV exports include public contact columns only after website audits run.
- [x] Google Places field masks remain limited to place ID, display name, and website URI.
- [x] CSV formula hardening applies to public contact columns.
- [x] Security and ethics docs state that contact enrichment is public website-derived and does not send outreach.

## Outreach handoff readiness

Before releasing discovery handoff guidance:

- [x] Discovery exports include `preferredContactChannel`, `outreachAction`, and `contactabilityReason`.
- [x] Channel selection prefers public email, then WhatsApp, then phone, then contact page, then manual review.
- [x] Dry-run and unaudited rows do not invent contact data.
- [x] CSV formula hardening applies to handoff fields.
- [x] Docs state that handoff fields are advisory only and do not send outreach.

## Fuzzy duplicate review readiness

Before releasing fuzzy duplicate lead review:

- [x] `--duplicates-json` preserves exact duplicate lead-key groups.
- [x] Fuzzy duplicate candidates include clear matching reasons and confidence.
- [x] Tests cover label and website/domain duplicate candidates.
- [x] Docs state fuzzy matching is advisory only.
- [x] Docs state fuzzy matching does not auto-suppress leads, send outreach, or sync to a CRM.

## Batch contact rollup readiness

Before releasing batch contact and outreach rollups:

- [x] Batch JSON indexes include public contact and outreach rollup summaries.
- [x] Batch Markdown and HTML indexes include contact and outreach rollup sections.
- [x] Batch entries include contact and outreach metadata only for successful audits.
- [x] Batch CSV exports include contact confidence, preferred channel, and contactability reason.
- [x] Docs state that batch rollups are advisory only and do not send outreach or sync to a CRM.

## CRM export preset readiness

Before releasing the CRM-ready CSV preset:

- [x] Default batch and discovery CSV export behavior remains unchanged.
- [x] Batch and discovery exports support `--export-preset crm`.
- [x] CLI rejects unknown export preset values.
- [x] CRM preset cells use the existing CSV formula hardening.
- [x] Docs state that the CRM preset is local CSV only and does not sync to a CRM or send outreach.

Add project-specific commands once implementation starts.

Current project-specific verification:

```bash
npm audit
node dist/cli.js --help
npm pack
npx --yes --package ./open-local-audit-0.19.0.tgz open-local-audit --help
```

## Current release recommendation

Use `v0.19.0` after:

- single URL, rendered URL, screenshot metadata, profile metadata, and CSV batch paths are covered by tests or smoke checks,
- JSON, Markdown, HTML, and `--format all` outputs build from current code,
- batch index filtering and sorting are verified,
- profile-aware batch input, controlled concurrency, aggregate batch insights, and prospect CSV export are verified,
- dental, beauty, restaurant, contractor, lawyer, clinic, gym, hotel, and auto-service profile-specific findings are covered by regression tests,
- manual CSV discovery, official Google Places discovery, and local prospect CSV export are verified,
- Google Places missing-key behavior, strict field masks, mocked candidate mapping, dry-run, and audit handoff are verified,
- discovery limits, audit caps, summary JSON, opportunity scoring, and CSV formula hardening are verified,
- discovery review CSV, duplicate JSON, suppression, and opportunity filters are verified,
- Lighthouse scoring, PDF output, and opportunity score explanations are verified,
- report branding, Executive Summary output, and enriched lead export columns are verified,
- public contact extraction, report Contact Readiness output, and discovery contact CSV columns are verified,
- discovery outreach handoff fields and channel selection are verified,
- fuzzy duplicate lead review candidates are verified with deterministic fixtures,
- duplicate JSON output is confirmed advisory-only and does not change suppression, review CSV, outreach, or CRM behavior,
- batch contact and outreach rollups are verified in JSON, Markdown, HTML, and CSV exports,
- CRM-ready local CSV preset is verified for batch and discovery exports,
- visual evidence sections render in Markdown and HTML,
- example reports are regenerated from the current build,
- GitHub Actions passes on the pushed commit,
- GitHub Release is created before npm publish.

Use patch releases for documentation, packaging, or narrow rule fixes that do not change CLI behavior.
