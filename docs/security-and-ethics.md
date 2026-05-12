# Security and Ethics

## Position

Open Local Audit must be useful without becoming a scraping or spam engine. The tool should audit public websites provided by the operator or user, not harvest Google Maps or build unauthorized business databases.

## Allowed behavior

- Scan a user-provided public URL.
- Follow normal redirects.
- Inspect public HTML, metadata, links, images, and structured data.
- Generate local JSON and Markdown reports.
- Run limited internal link checks when explicitly requested.
- Import operator-prepared business CSVs for local `manual-csv` discovery triage.
- Audit website URLs supplied by the operator or resolved from the local CSV.

## Disallowed behavior

- Scraping Google Maps as a lead database.
- Browser-automating Google Maps or copying Google Maps results into a local lead database.
- Automating Google Business Profile changes.
- Collecting review data at scale.
- Collecting personal data that is not needed for the report.
- Ignoring robots.txt for broad crawling.
- Sending automated bulk outreach from the tool.

## Discovery provider boundary

The first discovery slice is `manual-csv` only. It should support local operator triage, produce local prospect CSV output, and leave contact decisions outside the tool.

A Google provider is deferred. If added later, it must be explicit, use official Google Places API endpoints only, read credentials from environment variables, request only necessary fields, avoid reviews and photos, keep raw place data storage minimal, and source-tag any derived CSV output. Google Maps scraping remains disallowed.

## Data minimization

Default behavior:
- Do not store scan history.
- Write reports only when the operator passes an output path.
- Do not send scan data to maintainers or third-party services.

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

The MVP should not require secrets. If later integrations need tokens:
- use environment variables,
- never write secrets into reports,
- include secret scanning in release checks.

## Legal review triggers

Pause and review before adding:
- any Google provider beyond the deferred official-provider boundary above,
- Google Business Profile API automation,
- email sending,
- CRM sync,
- persistent lead storage,
- paid ads or retargeting,
- customer account/login features.
