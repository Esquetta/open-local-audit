# Lead Discovery and Website Resolver Design

Date: 2026-05-12
Project: Open Local Audit
Status: Design approved for documentation only
Implementation status: Not started

## Summary

Open Local Audit should add a lead discovery layer that helps operators identify local businesses, determine whether they have an authoritative website, and feed discovered websites into the existing audit pipeline.

The feature should not become a Google Maps scraper or a persistent copy of Google Places data. It should use official APIs where available, keep caching and storage conservative, and store Open Local Audit's own derived audit results rather than raw third-party place data.

## Problem

The project needs a professional way to answer:

- Which local businesses exist in a target area and segment?
- Which ones have a website?
- Which websites are weak enough to justify outreach?
- Which prospects should be contacted first?

Manual Google Maps review works for early exploration, but it does not scale cleanly. The next step is a controlled discovery pipeline that can produce auditable CSV output for local outreach without turning the tool into a spam engine.

## Goals

- Discover candidate businesses for a text query and location.
- Resolve whether each candidate has a website.
- Feed resolved websites into the existing batch audit flow.
- Export a prospect CSV with website status, audit score, priority, and next action.
- Support official Google Places API integration behind an explicit provider option.
- Keep manual CSV input as a first-class fallback.
- Keep compliance and data minimization visible in the command behavior and docs.

## Non-goals

- No browser scraping of Google Maps.
- No automated Google Business Profile updates.
- No review scraping.
- No bulk outreach or email sending.
- No CRM replacement.
- No long-term storage of raw Google Places content.
- No hosted SaaS dashboard in this phase.

## Recommended approach

Build the feature inside the existing Open Local Audit CLI as a new `discover` command. Do not create a separate crawler repository yet.

Why:

- The current project already has URL audit, batch processing, profile-aware scoring, report outputs, and prospect CSV export.
- Lead discovery is a feeder into the existing audit engine.
- Keeping the workflow in one CLI reduces operational overhead.
- A separate package can be extracted later if discovery becomes broadly useful.

## Command shape

Primary command:

```bash
open-local-audit discover "guzellik salonu Umraniye" \
  --provider google-places \
  --profile beauty \
  --out-dir reports/umraniye-beauty \
  --export-csv leads.csv
```

Manual CSV enrichment:

```bash
open-local-audit discover --input places.csv \
  --provider manual-csv \
  --profile dental \
  --out-dir reports/dental \
  --export-csv leads.csv
```

Dry run:

```bash
open-local-audit discover "dis klinigi Atasehir" \
  --provider google-places \
  --dry-run
```

## Provider model

Discovery should use provider interfaces so the system can support official APIs, manual inputs, and future enrichment sources without coupling the audit engine to one data source.

```text
DiscoveryProvider
  -> search(query, options)
  -> returns PlaceCandidate[]

WebsiteResolver
  -> resolve(candidate)
  -> returns WebsiteResolution

AuditPipeline
  -> audits websiteUrl when available
  -> returns AuditReport

ProspectExporter
  -> writes leads.csv and batch reports
```

Initial providers:

- `manual-csv`: reads operator-provided businesses and optional website URLs.
- `google-places`: calls official Places API when `GOOGLE_MAPS_API_KEY` is present.

Deferred providers:

- `search-web`: manual-enrichment or search API provider.
- `local-directory-csv`: imports public sector directory exports prepared by an operator.

## Google Places API use

The Google Places API should be used only through official endpoints.

Relevant API behavior:

- Text Search supports text queries such as "coffee shops near me" and can return paginated place results.
- The Place resource includes `websiteUri`, described as the authoritative website for the place.
- `websiteUri` belongs to the higher-priced Places data field tiers, so cost controls and field masks matter.
- Places policies restrict pre-fetching, caching, and storing Places content beyond allowed exceptions. Place IDs have special treatment, but raw place content should not be treated as CRM data.

Required constraints:

- Use field masks to request only the fields needed for discovery.
- Do not request reviews or photos for this workflow.
- Store `place_id` when needed for de-duplication.
- Avoid persisting raw Google place name, address, rating, reviews, photos, or phone data as long-term application data unless legal/product review explicitly approves it.
- Derived Open Local Audit fields may be stored: `hasWebsite`, `websiteUrl`, `auditScore`, `topFinding`, `priority`, `nextAction`, `reportPath`, `source`.
- Include Google attribution requirements in any UI/report that displays Google-derived place content. For internal CSV triage, keep Google-derived fields minimal and clearly source-tagged.

## Data model

### PlaceCandidate

```ts
type PlaceCandidate = {
  source: "manual-csv" | "google-places";
  sourceId?: string;
  query?: string;
  label?: string;
  segment?: string;
  profile?: "generic" | "dental" | "beauty" | "restaurant" | "contractor";
  websiteUri?: string;
  sourceMetadata?: Record<string, unknown>;
};
```

Design note:
- `sourceMetadata` should be disabled or minimal by default for Google Places.
- If enabled for debugging, it should be written only to local debug output with a clear warning.

### WebsiteResolution

```ts
type WebsiteResolution = {
  hasWebsite: boolean;
  websiteUrl?: string;
  status: "resolved" | "missing" | "invalid" | "skipped" | "error";
  reason?: string;
};
```

### ProspectExportRow

```ts
type ProspectExportRow = {
  source: string;
  sourceId?: string;
  label?: string;
  segment?: string;
  profile: string;
  hasWebsite: "yes" | "no" | "unknown";
  websiteUrl?: string;
  auditStatus?: "success" | "failed" | "not-audited";
  score?: number;
  topFinding?: string;
  priority: "high" | "medium" | "low";
  nextAction: string;
  reportPath?: string;
};
```

## Priority model

High priority:

- No website found for a high-value segment.
- Website exists but has low audit score.
- Broken contact path.
- Missing mobile-first call action.
- Clinic, beauty, real estate, education, or local service category.

Medium priority:

- Website exists but has moderate weaknesses.
- Larger brand with weak local branch page.
- Good segment fit but unclear contact route.

Low priority:

- Strong website already exists.
- Large franchise with mature digital presence.
- Weak fit for Local Presence Kit.

## Workflow

1. Operator runs `discover` for a query and provider.
2. Provider returns candidates.
3. Website resolver marks each candidate as website present, missing, invalid, skipped, or error.
4. Candidates with websites are audited through existing `auditUrl`.
5. Candidates without websites receive a "website missing" priority reason.
6. CLI writes per-site reports for audited websites.
7. CLI writes `leads.csv`.
8. Operator manually reviews the top prospects before outreach.

## Error handling

- Missing API key: fail with a clear message for `google-places`; suggest `manual-csv`.
- API quota or billing error: fail gracefully and write partial results only if safe.
- Empty results: produce an empty CSV with headers and explain the query produced no candidates.
- Invalid website URL: mark candidate as `invalid`, do not audit.
- Audit failure: keep the prospect row with `auditStatus=failed` and an error reason.
- Rate limit: use conservative concurrency defaults and backoff for provider calls.

## Security and compliance

- `GOOGLE_MAPS_API_KEY` must be read from environment variables.
- Never print full API keys.
- Never write API keys into reports.
- Keep discovery network behavior explicit in CLI help.
- Keep `google-places` opt-in; do not run it implicitly.
- Do not send outreach from this tool.
- Keep do-not-contact management outside this feature for now, or add it only as a local CSV suppression list later.

## Documentation updates required before implementation

- README: add `discover` command examples and provider limitations.
- `docs/security-and-ethics.md`: update the Google Places boundary from "review trigger" to "allowed only through official provider with storage limits."
- `docs/technical-architecture.md`: add discovery provider diagram.
- `docs/mvp-roadmap.md`: add discovery milestone.
- `docs/release/release-readiness.md`: add API-key, attribution, and package-content checks.

## Testing strategy

Unit tests:

- Manual CSV candidate parsing.
- Website resolution from candidate website URI.
- Priority classification.
- Prospect CSV export.
- Google provider request construction with field masks.
- API key missing behavior.

Integration-style tests:

- Mock Google Places API response.
- Run discovery with two candidates: one website present, one missing.
- Verify only the website-present candidate is audited.
- Verify output CSV contains both rows.

No live Google API calls in CI.

## Release strategy

Recommended version:

- `v0.9.0` if the feature is added before a major release.

Release notes should clearly state:

- Google Places provider is opt-in.
- API key and billing are required for Google provider usage.
- The feature does not scrape Google Maps.
- The feature does not send outreach.
- Stored outputs are intended for local operator triage.

## Open questions

- Should the first implementation support only `manual-csv`, then add `google-places` in a second commit?
- Should the package keep a strict no-persistence default for Google provider results beyond generated CSV?
- Should `websiteUri` be audited immediately by default, or should `--audit` be explicit?
- Should a suppression list be included in the first version to avoid re-contacting declined businesses?

## Recommended first implementation slice

Do not start here until this design is reviewed.

When implementation is approved, start with:

1. `manual-csv` provider.
2. `discover --input places.csv --provider manual-csv`.
3. `leads.csv` export with `hasWebsite`, `websiteUrl`, `priority`, and `nextAction`.
4. Reuse existing audit pipeline for website-present rows.

Then add Google Places provider after the local flow is proven.

## References

- Google Places Text Search: https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places/searchText
- Google Place resource fields: https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places
- Google Places data fields: https://developers.google.com/maps/documentation/places/web-service/data-fields
- Google Places policies: https://developers.google.com/maps/documentation/places/web-service/policies
- Google Maps Platform service-specific terms: https://cloud.google.com/maps-platform/terms/maps-service-terms/index-20230203
