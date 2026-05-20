# Security and Ethics

## Position

Open Local Audit must be useful without becoming a scraping or spam engine. The tool should audit public websites provided by the operator or user, not harvest Google Maps or build unauthorized business databases.

## Allowed behavior

- Scan a user-provided public URL.
- Follow normal redirects.
- Inspect public HTML, metadata, links, images, and structured data.
- Extract contact channels that are visibly published in the audited website HTML.
- Generate local JSON and Markdown reports.
- Run limited internal link checks when explicitly requested.
- Import operator-prepared business CSVs for local `manual-csv` discovery triage.
- Audit website URLs supplied by the operator or resolved from the local CSV.
- Use the official Google Places Text Search API when the operator explicitly selects `--provider google-places`.
- Request only Google Places discovery fields needed for website resolution: place ID, display name, and website URI.

## Disallowed behavior

- Scraping Google Maps as a lead database.
- Browser-automating Google Maps or copying Google Maps results into a local lead database.
- Automating Google Business Profile changes.
- Collecting review data at scale.
- Collecting personal data that is not needed for the report.
- Ignoring robots.txt for broad crawling.
- Sending automated bulk outreach from the tool.

## Discovery provider boundary

Discovery providers should support local operator triage, produce local prospect CSV output, and leave contact decisions outside the tool.

The Google Places provider is explicit and opt-in. It uses official Google Places API endpoints only, reads credentials from `GOOGLE_MAPS_API_KEY`, requests only necessary fields, avoids reviews/photos/ratings, does not store raw place responses, and source-tags derived CSV output. Google Maps scraping remains disallowed.

Discovery operators should use `--limit` and `--max-audits` to control Google API usage and downstream site-audit volume. The CLI warns that Google Maps Platform billing may apply when `google-places` is selected.

Public contact enrichment is website-derived only. Google Places still supplies only identity and website-resolution fields; email, phone, WhatsApp, contact-page, and social-profile columns come from the audited public website HTML. Dry-run discovery does not invent or enrich contact data because no website audit has run.

Outreach handoff fields are advisory local triage metadata. They can suggest a preferred manual channel and next action, but the CLI does not send messages, verify inbox ownership, dial phones, or sync contacts to external systems.

Operators should use `--suppression-list` to avoid repeatedly auditing or reviewing leads already marked as rejected, contacted, not-fit, do-not-contact, or suppressed. `--review-csv` can preserve local operator decisions across reruns, and `--duplicates-json` can expose exact duplicate lead keys for manual cleanup. These files are local state only; the tool does not send outreach or sync review decisions to a remote service.

## Data minimization

Default behavior:
- Do not store scan history.
- Write reports only when the operator passes an output path.
- Do not send scan data to maintainers or third-party services.
- Neutralize formula-like CSV cells before export.
- Keep discovery review and suppression state in operator-managed local CSV files.

If future telemetry is added:
- Make it opt-in.
- Document exactly what is collected.
- Provide a disable flag.

## Network safety

The CLI should include:
- Timeout controls.
- User-agent string identifying the tool.
- Crawl depth limit.
- Max page limit.
- Clear error handling for blocked or unavailable sites.

## Outreach ethics

Reports can support manual outreach, but outreach should be:
- personalized,
- low volume,
- clear about the sender identity,
- easy to decline,
- logged with do-not-contact status when requested.

## Secret handling

Most commands do not require secrets. If integrations need tokens:
- use environment variables,
- never write secrets into reports,
- include secret scanning in release checks.

## Legal review triggers

Pause and review before adding:
- any Google provider behavior beyond the official Text Search website resolver boundary above,
- Google Business Profile API automation,
- email sending,
- CRM sync,
- persistent lead storage,
- paid ads or retargeting,
- customer account/login features.
