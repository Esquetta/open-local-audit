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
- Suppression counts in terminal and summary JSON output.

Exit criteria:
- Suppression matching prefers provider source IDs, then normalized website URLs, then normalized labels.
- Suppressed candidates are excluded before website audits run.
- Rows with `reviewStatus=new` remain eligible for future discovery runs.
- Opportunity-score filtering is covered by CLI tests.

## Deferred work

- Web UI.
- Broader profile-specific rule packs.
- Lighthouse integration.
- Branded PDF reports.
- SaaS dashboard.
- Search API or manual enrichment provider beyond Google Places.
