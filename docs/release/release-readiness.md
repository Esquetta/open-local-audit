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

## CRM import quality gate readiness

Before releasing the CRM import validator:

- [x] `validate-export --input <path> --preset crm` validates local CRM CSV exports.
- [x] Markdown and JSON validation reports include row counts, errors, warnings, and issue details.
- [x] Validator catches missing CRM columns, missing company or website fields, and duplicate lead keys.
- [x] Validator flags low contact confidence and manual-review handoffs as warnings.
- [x] Docs state that validation is local-only and does not sync to a CRM or send outreach.

## Report pack readiness

Before releasing local report packaging:

- [x] `package-report --input <path> --out <path>` packages existing single-site report folders.
- [x] Package output includes `README.md`, `next-actions.md`, and `manifest.json`.
- [x] Available JSON, Markdown, HTML, and PDF report artifacts are copied into `reports/`.
- [x] CLI reports a clear error when `open-local-audit-report.json` is missing.
- [x] Docs state that report packaging is local-only and does not upload reports, send outreach, or sync to a CRM.

## Lead shortlist readiness

Before releasing local lead shortlist reports:

- [x] `shortlist --input <path> --out <path>` ranks local discovery and CRM CSV exports.
- [x] Markdown and JSON shortlist output are covered by tests.
- [x] Ranking is deterministic across opportunity score, priority, contact confidence, audit score, and company name.
- [x] Invalid CSV input and invalid top values fail clearly.
- [x] Docs state that shortlist generation is local-only and does not call APIs, send outreach, or sync to a CRM.

## Shortlist review workflow readiness

Before releasing shortlist review-state handling:

- [x] `shortlist --review-csv <path>` reads local review state.
- [x] Suppressed review statuses are excluded before ranking.
- [x] Matching active review status, reason, and last-reviewed date render in Markdown and JSON output.
- [x] CLI output reports suppressed row counts.
- [x] Docs state that review CSV handling is local-only and does not mutate review files, send outreach, or sync to a CRM.

## Shortlist CSV readiness

Before releasing spreadsheet-ready shortlist output:

- [x] `shortlist --format csv` writes local CSV output.
- [x] CSV output includes rank, scoring, contact handoff, review context, lead key, and report path columns.
- [x] CSV output uses formula-like cell hardening before spreadsheet review.
- [x] CLI tests cover CSV output with review-state suppression.
- [x] Docs state that CSV shortlist output is local-only and does not import, send outreach, or sync to a CRM.

## Shortlist opportunity filter readiness

Before releasing shortlist opportunity-score filtering:

- [x] `shortlist --min-opportunity-score <score>` filters local shortlist output.
- [x] Filtering runs after review-state suppression and before top-N ranking.
- [x] CLI, Markdown, and JSON output report filtered row counts.
- [x] Invalid minimum opportunity score values fail clearly.
- [x] Docs state that filtering does not mutate source lead files, send outreach, or sync to a CRM.

## Shortlist focus filter readiness

Before releasing shortlist focus filters:

- [x] `shortlist` supports segment, profile, priority, and contact-confidence filters.
- [x] Supplied filters use case-insensitive exact matching with `AND` semantics.
- [x] Filtering runs after review suppression and before ranking and top-N selection.
- [x] CLI and module tests cover combined filtering and filtered counts.
- [x] Docs state that filtering affects local output only.

Add project-specific commands once implementation starts.

Current project-specific verification:

```bash
npm audit
node dist/cli.js --help
npm pack
npx --yes --package ./open-local-audit-0.26.0.tgz open-local-audit --help
```

## Shortlist review-status filter readiness

Before releasing shortlist review-status filters:

- [x] `shortlist --review-status <status>` filters active local shortlist rows.
- [x] Review-status matching is case-insensitive and exact.
- [x] Filtering runs after review suppression and before ranking and top-N selection.
- [x] CLI and module tests cover suppressed rows, filtered rows, and JSON output.
- [x] Docs state that review-status filtering affects local output only.

Add project-specific commands once implementation starts.

Current project-specific verification:

```bash
npm audit
node dist/cli.js --help
npm pack
npx --yes --package ./open-local-audit-0.27.0.tgz open-local-audit --help
```

## Shortlist sort mode readiness

Before releasing shortlist sort modes:

- [x] `shortlist --sort <sort>` controls local shortlist ranking.
- [x] Sort modes include `opportunity-desc`, `score-desc`, `company-asc`, and `last-reviewed-asc`.
- [x] Sorting runs after review suppression and filters, before top-N selection.
- [x] CLI and module tests cover supported modes and invalid sort values.
- [x] Docs state that sorting affects local output only.

Add project-specific commands once implementation starts.

Current project-specific verification:

```bash
npm audit
node dist/cli.js shortlist --help
npm pack
npx --yes --package ./open-local-audit-0.28.0.tgz open-local-audit shortlist --help
```

## Shortlist automation summary readiness

Before releasing shortlist automation summaries:

- [x] `shortlist --summary-json <path>` writes a separate local summary JSON file.
- [x] Summary JSON includes shortlist counts and selected lead identifiers.
- [x] Package consumers can render summary JSON from `ShortlistResult`.
- [x] CLI and module tests cover summary output.
- [x] Docs state that summary output affects local files only.

Add project-specific commands once implementation starts.

Current project-specific verification:

```bash
npm audit
node dist/cli.js shortlist --help
npm pack
npx --yes --package ./open-local-audit-0.29.0.tgz open-local-audit shortlist --help
```

## Shortlist review-status exclusion readiness

Before releasing shortlist review-status exclusion:

- [x] `shortlist --exclude-review-status <status>` filters active local shortlist rows out.
- [x] Review-status exclusion is case-insensitive and exact.
- [x] Exclusion runs after review suppression and before sorting and top-N selection.
- [x] CLI and module tests cover suppressed rows, filtered rows, and JSON output.
- [x] Docs state that review-status exclusion affects local output only.

Add project-specific commands once implementation starts.

Current project-specific verification:

```bash
npm audit
node dist/cli.js shortlist --help
npm pack
npx --yes --package ./open-local-audit-0.30.0.tgz open-local-audit shortlist --help
```

## Shortlist website-required filter readiness

Before releasing shortlist website-required filtering:

- [x] `shortlist --require-website` filters out local shortlist rows without a website.
- [x] Filtering runs after review suppression and before sorting and top-N selection.
- [x] CLI and module tests cover filtered rows and JSON output.
- [x] Docs state that website-required filtering affects local output only.

Add project-specific commands once implementation starts.

Current project-specific verification:

```bash
npm audit
node dist/cli.js shortlist --help
npm pack
npx --yes --package ./open-local-audit-0.31.0.tgz open-local-audit shortlist --help
```

## Shortlist contact-required filter readiness

Before releasing shortlist contact-required filtering:

- [x] `shortlist --require-contact` filters out local shortlist rows with no contact confidence.
- [x] Filtering runs after review suppression and before sorting and top-N selection.
- [x] CLI and module tests cover filtered rows and JSON output.
- [x] Docs state that contact-required filtering affects local output only.

Add project-specific commands once implementation starts.

Current project-specific verification:

```bash
npm audit
node dist/cli.js shortlist --help
npm pack
npx --yes --package ./open-local-audit-0.32.0.tgz open-local-audit shortlist --help
```

## Shortlist report-required filtering readiness

Before releasing shortlist report-required filtering:

- [x] `shortlist --require-report` filters out local shortlist rows without a report path.
- [x] Filtering runs after review suppression and before sorting and top-N selection.
- [x] CLI and module tests cover filtered rows and JSON output.
- [x] Docs state that report-required filtering affects local output only.

Add project-specific commands once implementation starts.

Current project-specific verification:

```bash
npm audit
node dist/cli.js shortlist --help
npm pack
npx --yes --package ./open-local-audit-0.33.0.tgz open-local-audit shortlist --help
```

## Shortlist preferred contact channel readiness

Before releasing shortlist preferred-contact-channel filtering:

- [x] `shortlist --preferred-contact-channel <channel>` filters active local shortlist rows by preferred outreach channel.
- [x] Filtering runs after review suppression and before sorting and top-N selection.
- [x] CLI and module tests cover filtered rows and JSON output.
- [x] Docs state that preferred-contact-channel filtering affects local output only.

Add project-specific commands once implementation starts.

Current project-specific verification:

```bash
npm audit
node dist/cli.js shortlist --help
npm pack
npx --yes --package ./open-local-audit-0.34.0.tgz open-local-audit shortlist --help
```

## Shortlist missing-report filtering readiness

Before releasing shortlist missing-report filtering:

- [x] `shortlist --missing-report` filters local shortlist rows without a report path.
- [x] Filtering runs after review suppression and before sorting and top-N selection.
- [x] CLI and module tests cover filtered rows and JSON output.
- [x] Docs state that missing-report filtering affects local output only.

Add project-specific commands once implementation starts.

Current project-specific verification:

```bash
npm audit
node dist/cli.js shortlist --help
npm pack
npx --yes --package ./open-local-audit-0.35.0.tgz open-local-audit shortlist --help
```

## Shortlist missing-contact filtering readiness

Before releasing shortlist missing-contact filtering:

- [x] `shortlist --missing-contact` filters local shortlist rows with no contact confidence.
- [x] Filtering runs after review suppression and before sorting and top-N selection.
- [x] CLI and module tests cover filtered rows and JSON output.
- [x] Docs state that missing-contact filtering affects local output only.

Add project-specific commands once implementation starts.

Current project-specific verification:

```bash
npm audit
node dist/cli.js shortlist --help
npm pack
npx --yes --package ./open-local-audit-0.36.0.tgz open-local-audit shortlist --help
```

## Shortlist missing-website filtering readiness

Before releasing shortlist missing-website filtering:

- [x] `shortlist --missing-website` filters local shortlist rows without a website.
- [x] Filtering runs after review suppression and before sorting and top-N selection.
- [x] CLI and module tests cover filtered rows and JSON output.
- [x] Docs state that missing-website filtering affects local output only.

Add project-specific commands once implementation starts.

Current project-specific verification:

```bash
npm audit
node dist/cli.js shortlist --help
npm pack
npx --yes --package ./open-local-audit-0.37.0.tgz open-local-audit shortlist --help
```

## Shortlist unreviewed filtering readiness

Before releasing shortlist unreviewed filtering:

- [x] `shortlist --unreviewed` filters local shortlist rows whose normalized `lastReviewedAt` value is empty.
- [x] Filtering runs after review suppression and before sorting and top-N selection.
- [x] CLI and module tests cover suppressed counts, filtered counts, and local-only JSON output.
- [x] Docs state that unreviewed filtering affects local output only.

Add project-specific commands once implementation starts.

Current project-specific verification:

```bash
npm audit
node dist/cli.js shortlist --help
npm pack
npx --yes --package ./open-local-audit-0.38.0.tgz open-local-audit shortlist --help
```

## Current release recommendation

Use `v0.38.0` after:

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
- CRM import validation is verified for Markdown output, JSON output, clean exit code `0`, and issue exit code `1`,
- local report packaging is verified for generated summaries, manifest, copied report artifacts, and missing JSON report errors,
- local lead shortlist reports are verified for Markdown output, JSON output, deterministic ranking, and invalid input errors,
- local shortlist review-state suppression is verified for Markdown output, JSON output, suppressed-count reporting, and active review metadata,
- local shortlist CSV output is verified for spreadsheet-safe cells, review context, and suppressed-row handling,
- local shortlist opportunity filtering is verified for filtered-count reporting, invalid score handling, and local-only output,
- local shortlist focus filters are verified for combined matching, filtered counts, and compatibility with all output formats,
- local shortlist review-status filtering is verified for suppressed-count reporting, filtered-count reporting, and local-only output,
- local shortlist sort modes are verified for supported modes, invalid sort errors, and top-N ordering,
- local shortlist automation summaries are verified for separate JSON output and local-only behavior,
- local shortlist review-status exclusion is verified for suppressed-count reporting, filtered-count reporting, and local-only output,
- local shortlist website-required filtering is verified for filtered-count reporting and local-only output,
- local shortlist contact-required filtering is verified for filtered-count reporting and local-only output,
- local shortlist report-required filtering is verified for filtered-count reporting and local-only output,
- local shortlist preferred-contact-channel filtering is verified for suppressed-count reporting, filtered-count reporting, and local-only output,
- local shortlist missing-report filtering is verified for suppressed-count reporting, filtered-count reporting, and local-only output,
- local shortlist missing-contact filtering is verified for suppressed-count reporting, filtered-count reporting, and local-only output,
- local shortlist missing-website filtering is verified for suppressed-count reporting, filtered-count reporting, and local-only output,
- local shortlist unreviewed filtering is verified for suppressed-count reporting, filtered-count reporting, and local-only output,
- visual evidence sections render in Markdown and HTML,
- example reports are regenerated from the current build,
- GitHub Actions passes on the pushed commit,
- GitHub Release is created before npm publish.

Use patch releases for documentation, packaging, or narrow rule fixes that do not change CLI behavior.
