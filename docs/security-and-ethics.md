# Security and Ethics

## Position

Open Local Audit must be useful without becoming a scraping or spam engine. The tool should audit public websites provided by the operator or user, not harvest Google Maps or build unauthorized business databases.

## Allowed behavior

- Scan a user-provided public URL.
- Follow normal redirects.
- Inspect public HTML, metadata, links, images, and structured data.
- Generate local JSON and Markdown reports.
- Run limited internal link checks when explicitly requested.

## Disallowed behavior

- Scraping Google Maps as a lead database.
- Automating Google Business Profile changes.
- Collecting review data at scale.
- Collecting personal data that is not needed for the report.
- Ignoring robots.txt for broad crawling.
- Sending automated bulk outreach from the tool.

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
- Google Maps data collection,
- Google Business Profile API automation,
- email sending,
- CRM sync,
- persistent lead storage,
- paid ads or retargeting,
- customer account/login features.
