# MVP Roadmap

## MVP definition

The MVP is a CLI that audits one public website and generates JSON and Markdown reports with evidence-backed recommendations.

## Milestone 0: Project setup

Deliverables:
- Git repository.
- `package.json`.
- TypeScript config.
- Lint and test setup.
- Basic CLI entrypoint.
- License decision.
- GitHub Actions skeleton.

Exit criteria:
- `npm test` runs.
- CLI help command works.
- README explains the project honestly.

## Milestone 1: Single URL audit

Deliverables:
- URL normalization.
- HTTP fetch.
- Redirect handling.
- HTML parser.
- Initial report schema.

Checks:
- HTTPS.
- Status code.
- Redirect chain.
- Title.
- Meta description.
- Viewport.
- H1.

Exit criteria:
- CLI can scan a simple static site.
- JSON report is valid against schema.
- Unit tests cover parser and report model.

## Milestone 2: Local business checks

Deliverables:
- Contact signal checks.
- LocalBusiness schema check.
- Address/map signal checks.
- Social link detection.

Checks:
- `tel:` link.
- `mailto:` link.
- WhatsApp link.
- Address-like text.
- Google Maps or directions link.
- LocalBusiness schema.

Exit criteria:
- Markdown report is owner-readable.
- Example local-business report exists.

## Milestone 3: Quality and release candidate

Deliverables:
- CLI flags.
- Error handling.
- Timeouts.
- Basic docs.
- Changelog.
- Release checklist completed.

Exit criteria:
- Tests pass.
- Example reports are committed.
- Package dry-run succeeds.
- First GitHub release candidate can be created.

## Milestone 4: npm release

Deliverables:
- Package metadata.
- Public package name check.
- `npm pack --dry-run` review.
- Versioned release notes.
- npm publish.

Exit criteria:
- npm package installs.
- CLI runs through `npx`.
- GitHub release and npm version match.

## Milestone 5: Manual CSV discovery

Deliverables:
- `discover --input places.csv --provider manual-csv`.
- Operator-prepared candidate CSV input.
- Website-present rows reused by the existing audit pipeline.
- `leads.csv` export with `hasWebsite`, `websiteUrl`, `priority`, and `nextAction`.
- Local operator triage workflow before any outreach decision.

Exit criteria:
- Manual CSV parsing is covered by tests.
- Website-present and website-missing candidates both appear in the prospect CSV.
- Discovery docs and CLI help state that Google Maps scraping, Google provider calls, and outreach sending are not part of this slice.

## Milestone 6: Google Places website resolver

Target release:
- `v0.10.0`.

Deliverables:
- `discover "<query>" --provider google-places`.
- `GOOGLE_MAPS_API_KEY` environment variable support.
- Official Places Text Search integration with strict field masks.
- Website resolution from `websiteUri` when available.
- Conservative Google Places data handling: store only required source identifiers and derived audit fields by default.
- Clear CLI help explaining API key, billing, provider limits, and no Google Maps scraping.
- Tests using mocked Google Places responses only.

Exit criteria:
- Missing API key fails with a clear message.
- Mocked Google Places candidate with `websiteUri` flows into the existing audit pipeline.
- Mocked candidate without `websiteUri` appears in `leads.csv` with `hasWebsite=no`.
- Prospect CSV identifies provider source and website resolution status.
- Docs explain data retention and attribution boundaries before release.

## Milestone 7: Discovery controls and triage safety

Target release:
- `v0.11.0`.

Deliverables:
- `--limit <count>` for Google Places result control.
- `--max-audits <count>` for limiting website audits while preserving all leads in CSV output.
- Terminal discovery summary and optional `--summary-json`.
- `opportunityScore` in `leads.csv`.
- CSV formula-injection hardening.
- Google Maps Platform billing warning for `google-places`.

Exit criteria:
- Google Places requests include `maxResultCount` and clamp to a documented maximum.
- `--max-audits` leaves excess website-present leads as `not-audited`.
- Summary JSON is covered by CLI tests.
- Formula-like CSV cells are neutralized before export.

## Milestone 8: Discovery review workflow

Target release:
- `v0.12.0`.

Deliverables:
- Stable `leadKey` values in discovery CSV exports.
- Review columns for local operator decisions: `reviewStatus`, `reviewReason`, and `lastReviewedAt`.
- `--suppression-list <path>` for skipping previously rejected, contacted, not-fit, do-not-contact, or suppressed leads.
- `--min-opportunity-score <score>` for exporting only higher-value discovery candidates.
- `--review-csv <path>` for merging local operator review state across discovery reruns.
- `--duplicates-json <path>` for reporting exact duplicate lead groups.
- Lawyer, clinic, gym, hotel, and auto-service industry profiles.
- Polished standalone HTML reports with branded summary cards.
- Suppression counts in terminal and summary JSON output.

Exit criteria:
- Suppression matching prefers provider source IDs, then normalized website URLs, then normalized labels.
- Suppressed candidates are excluded before website audits run.
- Rows with `reviewStatus=new` remain eligible for future discovery runs.
- Opportunity-score filtering is covered by CLI tests.
- Existing review decisions survive reruns in the review CSV.
- Duplicate reports group exact stable lead-key matches.

## Milestone 9: Sales-ready report polish

Target release:
- `v0.13.0`.

Deliverables:
- `--lighthouse` for opt-in Lighthouse performance, accessibility, best-practices, and SEO category scoring.
- Lighthouse scores in JSON, Markdown, HTML, and PDF reports.
- `--format pdf` for branded single-site PDF reports.
- `opportunityReasons` in discovery CSV exports to explain lead scores.
- CLI and README guidance for local Chrome requirements and PDF destination requirements.

Exit criteria:
- Lighthouse behavior is covered by a runner-injection regression test.
- PDF output is validated as a real PDF artifact in tests.
- Discovery score explanations are covered in prospect-row and CSV tests.
- Full release check passes before npm publish.

## Milestone 10: Branded sales output

Target release:
- `v0.14.0`.

Deliverables:
- `--brand-config <path>` for local JSON report branding.
- Executive Summary sections in Markdown, HTML, and PDF reports.
- Lead export enrichment columns for outreach positioning: `pitchAngle`, `recommendedOffer`, `estimatedNeed`, and `outreachPriorityReason`.
- Validation for brand color values before report rendering.

Exit criteria:
- Brand config parsing and invalid-color behavior are covered by tests.
- HTML/PDF/Markdown renderers accept branding without changing JSON report data.
- Executive Summary output is covered by renderer tests.
- Enriched lead export columns are covered by discovery CSV tests.

## Milestone 11: Contact-ready discovery output

Target release:
- `v0.15.0`.

Deliverables:
- Public contact extraction from audited website HTML.
- Contact Readiness sections in Markdown, HTML, and PDF reports.
- Discovery CSV columns for `publicEmail`, `publicPhone`, `whatsappUrl`, `contactPageUrl`, `socialProfiles`, `contactConfidence`, and `contactSource`.
- Clear docs that Google Places does not provide contact enrichment and dry-run discovery leaves contact fields empty.

Exit criteria:
- Contact extraction is covered by unit tests.
- Audit reports include contact readiness without changing provider boundaries.
- Discovery CSV contact fields are covered by prospect-row and CLI tests.
- CSV formula hardening applies to contact enrichment columns.

## Milestone 12: Outreach handoff guidance

Target release:
- `v0.16.0`.

Deliverables:
- Discovery CSV fields for `preferredContactChannel`, `outreachAction`, and `contactabilityReason`.
- Deterministic channel preference from audited public contact fields: email, WhatsApp, phone, contact page, then manual review.
- Dry-run and unaudited rows that keep advisory manual-review guidance without inventing contact data.
- CSV formula hardening for all new handoff fields.

Exit criteria:
- Prospect-row tests cover email, WhatsApp, phone, contact-page, no-contact, and dry-run handoff behavior.
- CLI discovery tests confirm handoff fields appear in real CSV output.
- Docs state that handoff fields are advisory and do not send outreach.

## Milestone 13: Fuzzy duplicate lead review

Target release:
- `v0.17.0`.

Deliverables:
- Advisory fuzzy duplicate candidate groups in discovery duplicate JSON output.
- Matching signals based on normalized business labels, website domains, public email, and public phone where available.
- Clear duplicate confidence and reason fields for operator review.
- No automatic suppression, review-status mutation, outreach sending, or CRM sync.

Exit criteria:
- Exact duplicate reporting remains unchanged.
- Fuzzy duplicate candidates are deterministic and covered by unit and CLI tests.
- Docs state that fuzzy matching is advisory only.
- Discovery exports and review CSV behavior remain manual operator state.

## Milestone 14: Batch contact and outreach rollups

Target release:
- `v0.18.0`.

Deliverables:
- Batch index summary rollups for public contact coverage, contact confidence, and preferred manual outreach channels.
- Per-entry batch index contact and outreach metadata for successful audits.
- Batch prospect CSV columns for contact confidence, preferred contact channel, and contactability reason.
- Clear docs that rollups are advisory local triage metadata only.

Exit criteria:
- JSON, Markdown, and HTML batch indexes include contact and outreach rollups.
- Failed batch entries do not invent contact or outreach metadata.
- CSV exports retain formula hardening for the new advisory fields.
- Docs state that batch rollups do not send outreach or sync to a CRM.

## Milestone 15: CRM-ready local CSV preset

Target release:
- `v0.19.0`.

Deliverables:
- `--export-preset standard|crm` for batch and discovery CSV exports.
- CRM-ready local import columns for company identity, website, segment, profile, scoring, contact handoff, source, lead key, and report path.
- Default CSV behavior remains unchanged.
- Clear docs that the CRM preset is a local CSV only and does not sync to CRM APIs.

Exit criteria:
- Batch and discovery tests cover the CRM preset.
- CLI tests cover the preset flag and invalid preset rejection.
- CSV formula hardening applies to CRM preset cells.
- Release docs state that CRM sync and outreach sending remain out of scope.

## Milestone 16: CRM import quality gate

Target release:
- `v0.20.0`.

Deliverables:
- `validate-export --input <path> --preset crm` for local CRM CSV checks.
- Markdown and JSON validation reports with row counts, errors, warnings, and issue details.
- Checks for missing CRM columns, missing company or website fields, missing or duplicate lead keys, low contact confidence, and manual-review contact handoffs.
- Clear docs that validation is local-only and does not sync to CRM APIs.

Exit criteria:
- Validator tests cover clean files, missing columns, row-level blockers, duplicate lead keys, and warning-only contact review cases.
- CLI tests cover Markdown output, JSON output, clean exit code `0`, and issue exit code `1`.
- Release docs state that the validator does not create CRM records or send outreach.

## Deferred work

- Web UI.
- SaaS dashboard.
- Search API or manual enrichment provider beyond Google Places.
