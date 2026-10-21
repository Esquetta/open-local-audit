# Changelog

All notable changes to Open Local Audit will be documented here.

## v0.87.0 - 2026-10-21

- `monitor` writes `client-email.eml` next to every `client-email.md`: the same email as an unsent draft (`X-Unsent: 1`) with the client PDF attached (`comparison.pdf`, or the report PDF on a first run). Outlook for Windows opens it as a new message ready to send; other mail programs may show it as a received message to edit as new or forward. Nothing is sent. A new optional `client_email` column in the client list addresses it; several addresses are separated by semicolons, and anything other than plain ASCII addresses is rejected (also by `batch`, which reads the same client list format). Long subjects and recipient lists are folded onto short header lines. If the draft cannot be written, the run still counts and the site note says why. The summary JSON gains `emlPath` and the client overview a "Mail (.eml)" link.
- The report PDF that `monitor` writes now includes the "Availability" and "Work Done" sections too, so a client's first monthly report lists the work and daily checks before there is a comparison.
- Exported `clientEmailParts`, `renderClientEml`, and the `ClientEmlInput` type. `BatchInputEntry` gains an optional `clientEmail`, `MonitorSiteResult` an optional `emlPath`, and `ReportRenderOptions` an optional `service` (which `ComparisonRenderOptions` now inherits).

## v0.86.0 - 2026-10-20

- `monitor --quick` adds one line per check to `quick-history.jsonl` in `--out-dir`, recording whether each site was up. A site counts as down when it did not load, returned a non-2xx status, or showed a placeholder page; certificate and domain warnings do not count.
- Monthly `monitor` runs report the daily checks since the previous run (or the last 30 days on a first run): `client-email.md`, `comparison.md`, `comparison.html`, and `comparison.pdf` get an "Availability" section with the number of checks the site loaded on and the days it did not.
- Added a work log: `work-log.csv` in `--out-dir`, with `date`, `site`, `minutes`, and optional `description` columns. Monthly runs list the work dated from the previous run's day up to the day before their own run in a "Work done" section of the same files, with the total time. A new optional `included_minutes` column in the client list reports the time used against the minutes included in the client's plan. A row that cannot be read stops the monthly run before any audit, naming its line.
- The monitoring summary gains Uptime and Work columns, and `MonitorSiteResult` gains `serviceSince`, `availability`, `work`, and `includedMinutes`. The client overview gains "Uptime, 30 days" and "Work since report" columns, an alert when logged work goes over the included minutes, and a warning when `work-log.csv` has unreadable rows.
- Exported `readWorkLog`, `serviceSections`, and the `ServiceSection`, `SiteAvailability`, `SiteWork`, and `WorkLogEntry` types. `BatchInputEntry` and `QuickCheckSite` gain an optional `includedMinutes`, and `ComparisonRenderOptions` an optional `service`.

## v0.85.0 - 2026-10-19

- Scheduled runs now show a desktop notification when they end with a non-zero exit code: alerts with `--fail-on-alerts`, or an error such as `npx` not being found. Windows scripts show a toast through Windows PowerShell's own notification identity, so no setup is needed; shell scripts use `osascript` on macOS and `notify-send` on Linux when available, passing the text as an argument. The notification shows up to four lines from the run's output: the `ALERT` lines of a daily check, or the attention summary of a monthly run. Each run's output is now written to the log when the run finishes. Regenerate your scripts with `--print-schedule` to get notifications.
- `monitor` and `monitor --quick` rebuild `index.html` in `--out-dir`, a client overview for the operator: one row per client with the latest monthly score and change, the latest daily check (status and response time), open alerts, and links to the history page, client PDF, and email draft, with clients that need attention first. For a client with a daily result, certificate, domain, and loading alerts come from that newer check instead of the monthly run. Links only point to relative files inside the output folder. Both commands print its path as "Overview", and library calls to `runMonitor` and `runQuickCheck` (with the new `outDir` option) write it too. A failure to write it, or `quick-status.json`, never fails a run.
- `monitor --quick` now keeps its latest result in `quick-status.json` in `--out-dir` for the overview. It still writes no reports or history.
- Exported `renderDashboard`, `writeDashboard`, and the `DashboardInput` type from the public API. `MonitorSummary` and `QuickCheckSummary` gain an optional `dashboardPath`, and `QuickCheckOptions` gains optional `outDir` and `brand`.

## v0.84.0 - 2026-10-18

- Added `monitor --quick`, a daily check between monthly runs. It fetches only each homepage (no robots.txt, sitemap, link checks, or Lighthouse), reads the HTTPS certificate and, unless `--no-check-domain` is set, the domain registration, and prints one line per site: `OK` with the HTTP status and response time, or `ALERT` when the site does not load, returns a non-2xx status, shows a maintenance, parked, or for-sale page, or fails the certificate or domain checks. It writes no reports or history. The new alerts use a new `down` kind in `MonitorAlert`. `--fail-on-alerts` exits with code 1 when any site needs attention. `--lighthouse` cannot be combined with it.
- `monitor --quick --print-schedule` writes `run-monitor-quick.ps1` or `run-monitor-quick.sh` and prints a daily task ("Open Local Audit quick check", every day at 08:00) that logs to `quick.log`. Monthly schedules are unchanged.
- Brand configs accept an optional `signature`. When it is set, `monitor` ends each `client-email.md` draft with it, trimmed and with Windows line endings normalized, instead of the brand name and contact.
- Comparison reports (Markdown, HTML, PDF, and the monthly `comparison` files) show readable dates such as "1 September 2026" instead of timestamps, with times added when both checks fall on the same day. JSON output still uses ISO timestamps.
- Exported `quickCheckUrl`, `runQuickCheck`, `renderQuickCheck`, `comparisonDates`, and the `QuickCheckOptions`, `QuickCheckSite`, and `QuickCheckSummary` types from the public API.

## v0.83.1 - 2026-10-17

- `service-location-copy-present` no longer flags local business pages outside Turkey. It used to know only a few Turkish cities, so pages such as "Family dentist in Leeds" were reported as "Service and location copy is unclear". It now also accepts a service named next to a capitalized place ("in Leeds", "near Austin", "serving Greater Manchester"), a visible UK postcode, US state and ZIP code, five-digit postal code before a town ("80331 München"), street address, or LocalBusiness `addressLocality` that the page shows, and it recognizes more services, such as dentist, solicitor, lawyer, plumber, gym, hotel, hair, beauty, physio, Zahnarzt, and klinik. Pages that only say "Near Me", "Get in Touch", or name a schema town that is not visible are still flagged. The finding can disappear for many non-Turkish sites, so `compare` against reports from earlier versions shows it as fixed even though the page did not change.

## v0.83.0 - 2026-10-16

- `monitor` writes `history.html` in each site folder on every run: a branded, self-contained page that charts the overall score, and the Lighthouse performance score when runs have one, across every readable run in the output folder, with a table of each check's score, speed, response time, open issues by severity, fixed and new issues, and HTTPS certificate and domain registration problems. Runs that could not be compared with the one before them, such as after a profile or host change, are marked "New baseline", using the same rules as the monitoring comparison; older run files without a summary or Lighthouse categories are still read. The chart has a hover readout, a light and dark theme, and scrolls sideways on narrow screens. The summary gains a "History" column and the JSON summary a `historyPath` field. If the page cannot be written, the run still counts and the summary note says why.
- Static audits now record how long the page HTML took to load, from the first request to the last byte of the final page including redirects, as `responseTimeMs` in the JSON report and a "Response time" evidence row. Rendered audits leave it out. The monitoring summary shows it in a Response column with the change since the last run (`responseTimeMs` and `previousResponseTimeMs` in JSON); it does not raise alerts, because one measurement can vary.
- Exported `renderSiteHistory` and the `SiteHistoryRun` and `SiteHistoryOptions` types from the public API.

## v0.82.0 - 2026-10-15

- `monitor` writes `client-email.md` in every run folder: a plain-text draft for the client with a subject line, the overall score and its change since the last check, fixed and new issues, HTTPS certificate and domain registration findings, the top three next steps from the report, the PDF to attach, and a sign-off from `--brand-config` `name` and `contact`. Dates use the computer's local time. It contains only facts from the audit, says when monitoring restarted from a new baseline, starts with an HTML comment saying it is a draft, and is never sent. The summary gains an "Email draft" column and the JSON summary an `emailPath` field.
- Added `monitor --lighthouse`. It runs Lighthouse for each site after its audit and adds the scores to the reports. The summary gains a Speed column with the performance score and its change since the previous run (`performance` and `previousPerformance` in JSON), and the email draft reports the page speed. If Lighthouse fails, the site is still monitored and its summary note says why.
- Added `monitor --print-schedule`. Instead of monitoring, it writes a run script into `--out-dir` that repeats the given options with absolute paths and the installed version pinned, and prints the command that schedules it for the 1st of every month at 09:00 with output appended to `monitor.log`. On Windows it writes `run-monitor.ps1`, which the task starts with PowerShell so that paths with spaces, `&`, `%`, apostrophes, or non-English letters work, and prints `schtasks` lines for Command Prompt and PowerShell, with a warning when the task command would pass Task Scheduler's 261-character limit. If `npx` is not on the task's PATH, the script logs that and exits with code 1. Elsewhere it writes `run-monitor.sh` and prints a `crontab` line. It does not create the scheduled task.
- A compared site's summary status now also shows its note, such as a Lighthouse failure.
- Exported `renderClientEmail` and the `ClientEmailInput` type from the public API.

## v0.81.0 - 2026-10-14

- `monitor` now writes PDFs to send clients: `comparison.pdf` next to the Markdown and HTML comparison, and `open-local-audit-report.pdf` in every run folder, both branded with `--brand-config`. The summary gains a "Client PDF" column and the JSON summary a `pdfPath` field, pointing to the comparison PDF, or to the report PDF on a first run.
- `monitor` run folders are now named to the millisecond, such as `2026-10-14T08-00-00-123Z`, so a retried run in the same second no longer overwrites the earlier run or records a second baseline. Run folders written by v0.80.0 are still read and compared.
- When a certificate starts failing, the monitoring summary now shows one alert for it instead of a "New high issue" line as well.
- Added the `robots-txt-allows-page` audit rule (search-basics, high). It reads the site's `robots.txt`, keeping the first 500 KiB (counted in characters), and flags the audited page when the Googlebot group, or the `*` group when there is none, disallows it, quoting the matching line, for example "robots.txt blocks Googlebot from https://clinic.test/ (line 2: Disallow: /)". Pitch briefs explain it right after `page-indexable`. The rule can add a high finding to sites whose robots.txt blocks the page, so `compare` shows it as new against earlier reports.
- The `domain-expiry` finding title is now "Domain registration is expiring or has lapsed", and its pitch brief reason says the same, since the rule also covers expired domains and domains being deleted.

## v0.80.0 - 2026-10-13

- Added the `monitor` command for monthly client monitoring. It reads a URL list or a CSV with `url`, `label`, and `profile` columns, audits each site, and keeps each run under `<out-dir>/<site>/<run time>/` with JSON, Markdown, and HTML reports. Site folders are named after the host, such as `clinic.co.uk`, with a short hash added for a path or query, and the same site listed twice is rejected. When a site has an earlier run in the same `--out-dir`, it writes `comparison.md` and `comparison.html` against the latest one that still has a readable report; a first run, or a changed profile or final host, records a new baseline. `monitor-summary-<run time>.md` and `.json` list each site's score, score change, and new and fixed findings, and flag sites with new high-severity findings, a failing HTTPS certificate or domain registration, or a failed audit. `--fail-on-alerts` exits with code 1 when any site needs attention. A site that fails to audit or save does not stop the run, and nothing is sent.
- Added the `domain-expiry` audit rule (technical-health, medium) and the `--check-domain` audit option, which is on by default in `monitor`. It reads the domain's expiry date, status, and registrar from the registry's RDAP server listed in IANA's bootstrap file, and flags domains with fewer than 30 days left, expired domains, and domains in `redemption period` or `pending delete`, for example "clinic.co.uk expires 2026-11-02 (20 days); registrar Krystal Hosting Ltd". Registries without RDAP, such as `.tr` and `.de`, are skipped. Pitch briefs explain the finding right after certificate problems.
- `cookie-consent-present` now counts trackers in scripts that optimisers run later under their own types, such as Cloudflare Rocket Loader (`<hash>-text/javascript`), LiteSpeed (`litespeed/javascript`), WP Rocket (`rocketlazyloadscript`), and Partytown (`text/partytown`). Only `text/plain` scripts (with or without parameters such as `; charset=utf-8`), as used by consent tools, and JSON or template blocks are ignored. Sites using these optimisers can now get consent findings they did not get in v0.79.0, and `privacy-policy-link-present` evidence now names their trackers.
- Exported `runMonitor`, `renderMonitorMarkdown`, `renderMonitorJson`, `monitorRunId`, and the `MonitorOptions`, `MonitorSummary`, `MonitorSiteResult`, and `MonitorAlert` types from the public API.

## v0.79.0 - 2026-10-12

- Added the `privacy-policy-link-present` audit rule (trust-contact, medium). It flags pages with no link to a privacy policy: a same-site link whose text or path mentions the privacy policy in English, Turkish (including KVKK), German, French, Spanish, or Dutch, a `rel="privacy-policy"` link, or a policy hosted by iubenda, Termly, PrivacyPolicies.com, or FreePrivacyPolicy. Another company's policy, such as Google's reCAPTCHA notice, does not count. The evidence says when the page also has an enquiry form or loads trackers, for example "No privacy policy link found; the page has an enquiry form and loads Google Analytics or Ads".
- Added the `cookie-consent-present` audit rule (trust-contact, medium). It flags pages that load the Google tag (Google Analytics or Ads), Google Tag Manager, Meta Pixel, Hotjar, Microsoft Clarity, the LinkedIn Insight Tag, the TikTok Pixel, or Microsoft Advertising, or whose response sets tracking cookies such as `_ga` or `_fbp`, with no sign of a consent tool, for example "Google Analytics or Ads, Meta Pixel load with no consent tool found". Scripts held back as `type="text/plain"` do not count as loaded. Known consent platforms, IAB TCF, Google consent mode defaults, website builders' consent code, and cookie banner markup all count as a consent tool; the rule does not test whether the banner is switched on or actually blocks the tags.
- Added the `html-lang-present` (mobile-usability, low), `form-labels-present` (mobile-usability, low), and `link-text-descriptive` (search-basics, low) audit rules. They flag an `<html>` element without a valid `lang` code, visible form fields with no label, `aria-label`, `aria-labelledby` text, `title`, or `placeholder` (fields under `aria-hidden`, such as the Mailchimp spam trap, are skipped), and visible links whose only text is generic, such as "Read more", "Click here", "Devamını oku", or "Mehr erfahren", listing up to five fields or links as evidence.
- Pitch briefs (`shortlist --pitch-brief`) now explain cookie consent and privacy policy findings in plain language, ranked after broken links and before search basics such as a missing title.
- The new rules can lower trust-contact, mobile-usability, and search-basics scores, so `compare` shows them as new issues against reports from earlier versions.
- `localbusiness-schema-contact-fields` applies the `@context` scoped to the `openingHoursSpecification` term when it resolves an hours reference such as `{"@id": "h:weekly"}`, so a business whose hours prefix is defined there no longer gets a false missing-fields finding.
- `localbusiness-schema-nap-consistency` reads the telephone and street address from every JSON-LD node that shares the business's `@id`, as the contact-fields rule does, so a mismatching phone or address on a separate fragment is now reported.
- `website-placeholder` matches the page title and visible text separately, so "Site is temporarily offline." after an unpunctuated title is detected, and it ignores conditional copy such as "If our site is offline, call us".

## v0.78.0 - 2026-10-11

- The `localbusiness-schema-present`, `localbusiness-schema-contact-fields`, and `localbusiness-schema-nap-consistency` rules now recognise schema.org LocalBusiness subtypes such as `Dentist`, `Attorney`, `MedicalClinic`, `Ophthalmology`, `Restaurant`, and `Plumber` (every LocalBusiness descendant in schema.org 30.1). Types are expanded through the page's JSON-LD `@context` (`@vocab`, including a compact `@vocab`, prefixes with JSON-LD 1.1 prefix rules, term definitions, including ones that take their IRI from `@vocab`, `null` resets, and `@propagate`), so `Dentist` under the schema.org context, `schema:Dentist`, and `https://schema.org/Dentist` match, while types that expand to another vocabulary do not. Pages without any `@context` still read bare and `schema:` types as schema.org types. Pages that use only a subtype no longer get a false "LocalBusiness structured data is missing" finding, and their schema telephone, address, and opening hours are now checked.
- `localbusiness-schema-contact-fields` accepts `openingHoursSpecification` (one object or a list, each with a non-empty `dayOfWeek`, `opens`, or `closes` value, or an `@id` reference to one in the page's JSON-LD, including `@included` and embedded nodes, with compact `@id` values expanded through the context, relative ones resolved against the context `@base` or the page URL, and blank node labels kept local to their script block) and a list of `openingHours` strings as opening hours. It also reads telephone, address, and opening hours from every JSON-LD node that shares the business's `@id`.
- These changes can remove `localbusiness-schema-present` findings and add contact-field or NAP findings on pages with subtype schema, so `compare` against earlier reports may show them as fixed or new.

## v0.77.0 - 2026-10-10

- Discovery now flags leads that look like a chain branch or public body, such as `mydentist.co.uk` branch pages, Rodericks practice pages, and `nhs.uk` listings: a public-sector website domain, a website host shared by two or more differently named leads in the same search, or a branch page URL with two or more path segments. Social, link-in-bio, directory, site-builder, and booking-platform pages such as `facebook.com`, `linktr.ee`, `sites.google.com`, Treatwell, and Fresha are never treated as chains. Flagged leads stay in the export with the reason in `opportunityReasons` and a new standard CSV `chainReason` column, low priority, an opportunity score of at most 20, and a "Skip unless you are targeting the head office" next action. This applies to every discovery source; the CRM preset is unchanged.
- Added the `contact-form-present` audit rule (trust-contact, medium). It flags pages with no enquiry form, no same-site contact or booking page link, no off-site booking link, and no `mailto:` link, and says when the only form is a newsletter signup. Off-site links count when their text or path mentions booking, appointments, or reservations, or when they point to a known booking platform such as Dentally, Calendly, Setmore, Fresha, Treatwell, Booksy, SimplyBook, Acuity, Mindbody, ResDiary, or OpenTable. An off-site link that only says "contact", such as a web agency footer credit, does not count.
- Public contact extraction now returns `contactFormUrl` when the audited page has an enquiry form: a form with a message box, or at least two contact-detail fields, or an embedded Google Forms, Typeform, Jotform, Formstack, HubSpot, Wufoo, Cognito Forms, or Tally form. Search forms and newsletter signups are not counted. Contact confidence is unchanged. Markdown, HTML, and PDF Contact Readiness sections and the report pack's `next-actions.md` show the contact form. Website enrichment keeps the first fetched page with an enquiry form, including on sites whose only contact path is a form.
- For `contact-form-present`, same-site contact links also match `get-in-touch`, `enquire`/`enquiry`/`enquiries`, `book`, and `appointments` paths, paths with a file extension such as `/contact.html`, and "Get in touch", "Enquire", and "Book" link text. Contact extraction, contact confidence, and the preferred outreach channel keep their previous contact page patterns, so a booking link is never offered as an outreach channel.
- Added the `tls-certificate-valid` audit rule. Audits whose final URL is HTTPS open one extra TLS connection to read the site's certificate and flag it when it is not trusted, has expired, or has fewer than 14 days left, with evidence such as "Certificate expires 2026-10-19 (9 days); issuer R11". Discovery reads the homepage certificate during website enrichment, connecting to an address that passed enrichment's public-address check. The rule is skipped for HTTP pages and when the connection fails. Static audits and discovery stop earlier on a certificate that is already invalid (see below), so in practice they report certificates that are about to expire, while rendered audits also report untrusted or expired ones.
- Static audits of a site with an invalid certificate now fail with a clear message such as "TLS certificate error (CERT_HAS_EXPIRED) for https://example.com/" instead of "fetch failed".
- `compare` now writes PDF progress reports (`--format pdf --out <path>`). When the compared audits include homepage screenshots (`--screenshot`), the HTML and PDF outputs show them side by side under "Before and After", with the HTML embedding the images; Markdown says whether each screenshot was captured and JSON lists the paths. Screenshot paths are resolved relative to each report's directory, and files outside that directory are ignored.
- Exported `loadComparisonScreenshots`, `renderComparisonPdf`, and the `ComparisonRenderOptions` and `ComparisonScreenshot` types from the public API.
- Added `shortlist --pitch-brief <path>` with an optional `--reports-dir` (by default the `reports` folder next to `--input`, or the input's own folder for `start` output). It writes Markdown pitch notes for each shortlisted lead from its JSON audit report: up to three owner-visible findings in a fixed priority order, one per reason, each with a plain-language explanation, evidence, and fix; a suggested offer; the lead's shortlist reasons and contact channel; and a pre-contact checklist covering live re-checks, identity and chain or location flags, local email rules such as UK PECR, and an opt-out. Nothing is sent.
- Exported `buildPitchBrief`, `readLeadReport`, `renderPitchBriefsMarkdown`, and the `PitchBrief`, `PitchPoint`, and `PitchReportStatus` types from the public API.
- The new `contact-form-present` and `tls-certificate-valid` rules can lower trust-contact and technical-health scores for affected pages, so `compare` shows them as new issues against reports from earlier versions.
- The CLI starts faster for `--help`, option errors, `workflow --status`, and other commands that do not audit or discover sites. The audit, discovery, report output, and workflow run modules, along with cheerio, libphonenumber-js metadata, and pdfkit, now load only when a command needs them.

## v0.76.0 - 2026-10-09

- `discover --provider overture` now accepts `lawyer`, `solicitor`, and `attorney` (Overture `attorney_or_law_firm`, including practice-area subcategories) and `legal` (`legal_service`). The older category names `legal_services` and `attorney_and_law_services`, which matched nothing in the current Overture taxonomy, now map to the same identifiers.
- Overture discovery in the UK now flags leads that list the same locality as most leads with the search's common landline area code but have a different landline area code, such as a Weston-super-Mare `01934` clinic listed in Leeds. The lead gets a location reason, a "Confirm the business location" next action, and at most medium priority; it is never removed.

## v0.75.0 - 2026-10-09

- Added an operator-only `dotnetStack` field to JSON audit reports. It fingerprints ASP.NET Web Forms, MVC, .NET Framework, ASP.NET Core, and Blazor from the response headers, `Set-Cookie` names, and page HTML the audit already fetched, with a `legacyFramework` flag, confidence, optional .NET Framework version from `X-AspNet-Version`, and matched evidence. IIS or `X-Powered-By: ASP.NET` alone stays `aspnet-unknown` with low confidence. Standard batch and discovery CSV exports gain `dotnetStack` and `dotnetLegacyFramework` columns. Findings, scores, and Markdown, HTML, and PDF reports are unchanged.
- Exported `detectDotnetStack` and the `DotnetStack` and `DotnetStackEvidence` types from the public API.
- Static audits now keep every `Set-Cookie` response header instead of only the last one.
- The `single-h1` finding now says when the only H1 has no text, for example when it wraps just a logo image, instead of reporting "1 H1 elements".
- Maintenance and parked or for-sale pages now produce a single `website-placeholder` finding with all scores at 0 instead of a full SEO audit of the placeholder. Discovery ranks those leads as website-build opportunities with opportunity score 95 and high priority. Only pages with at most 600 characters of title and visible text, whose copy says the website itself is down or opens with a maintenance notice, are treated as placeholders.

## v0.74.0 - 2026-10-08

- Added the `compare` command. It reads an earlier and a later JSON report for the same site, from files or report directories, and writes a progress report listing fixed, still open, and new findings with category and overall score changes, as Markdown, JSON, or HTML with optional report branding. Reports for different sites or profiles, or given in reverse order, are rejected.
- Exported `compareReports`, `readComparisonReport`, and the comparison renderers from the public API.
- Added the `mixed-content-absent` audit rule. On pages served over HTTPS it flags scripts, stylesheets, icons, images (including `srcset` candidates), media, iframes, and embeds loaded over plain HTTP, listing up to five URLs as evidence. Plain HTTP links are not flagged.

## v0.73.0 - 2026-10-07

- Added the `page-indexable` audit rule. It flags pages that tell search engines not to index them through a `noindex` or `none` directive in a `robots` or `googlebot` meta tag or in the `X-Robots-Tag` response header, listing each directive as evidence. Directives aimed only at other crawlers are ignored.
- Updated the locked `source-map-js` development dependency to a patched release after the release audit reported a high-severity event-loop denial-of-service advisory.

## v0.72.0 - 2026-10-05

- Added the `redirect-chain-short` audit rule. It records each redirect hop (URL and status) while fetching the audited page and flags pages reached through more than one redirect, showing the full chain as evidence. A single redirect, such as plain HTTP to HTTPS, is not flagged, and rendered audits without redirect data are left unchecked.

## v0.71.0 - 2026-10-04

- Added the `localbusiness-schema-nap-consistency` audit rule. It flags LocalBusiness structured data whose `telephone` or `streetAddress` does not match the phone numbers or address visible on the page, comparing phones as parsed international numbers and street addresses within the page element that shows them, while tolerating formatting differences, national trunk prefixes, common street abbreviations, and diacritics. Pages without a visible phone or address are left to the existing presence rules.

## v0.70.0 - 2026-10-03

- Added evidence-based Overture business-to-website identity checks using structured names, valid phone numbers, and addresses. Missing or mixed evidence remains uncertain; conflicting sites cannot supply business contacts or audit scores.
- Added identity status, reasons, and field evidence to standard CSV and JSON/Markdown/HTML/PDF reports. Uncertain identity requires manual review and caps contact confidence at Low.
- Added `--audit-priority missing-contact`, guided priority selection in `start`, and optional workflow `auditPriority`. Source order remains the default; selected candidates fill missing source email first, then phone, while exports retain their original order.
- Preserved candidate identity when businesses share a website and added regression coverage for branch differences and conflicting identities across fetched pages.
- Added a bounded comparison script using frozen candidate pools and shared website observations. Small live samples do not establish a contact-yield or identity-accuracy improvement.

## v0.69.0 - 2026-10-02

- Added a seven-day local cache for repeated Overture searches in `discover` and `start`, keyed by source release, category, bounds, and result limit while preserving the original retrieval time.
- Added `--cache-dir`, `--refresh-cache`, and `--no-cache`; cache failures fall back to fresh discovery and website audits are always rerun.
- Added interactive `start` prompts with input validation, a confirmation summary, cancellation, and protection against overwriting existing output directories.
- Added explicit cache controls and cache-state reporting to the benchmark, including discovery-only measurements with `--max-audits 0`.
- Added cache integrity, filesystem safety, guided-input, and packaged CLI coverage. Existing programmatic discovery remains uncached unless a cache directory is provided.

## v0.68.0 - 2026-09-29

- Added keyless worldwide business discovery using Overture Places, with GeoNames city/country lookup and bounded geographic queries.
- Added source business details and provenance to standard prospect exports, preserving unknown website availability instead of assuming a website-build opportunity.
- Added bounded, robots-aware website contact enrichment with public-address validation; social profiles and known short links are not audited as business websites.
- Integrated Overture with workflow configuration, offline preflight, and plan output while preserving manual CSV and explicit Google Places discovery.
- Added a reproducible benchmark for Türkiye, the USA, Germany, and the UK across eight cities and three categories.
- Updated Lighthouse and affected dependencies to patched versions. **Compatibility: Node.js 22.19 or newer is now required** by Lighthouse 13; Node.js 20 is no longer supported.

## v0.67.0 - 2026-08-09

- Added an atomic workflow-state lifecycle manifest with trusted stage visibility.
- Added read-only `workflow --status` terminal and JSON modes with defined exit semantics.
- Added checkpoint hash correlation, legacy v1 compatibility, and conservative resume guidance.
- Added independent package-source integrity markers and lead packaging isolation.
- Added public API, fresh-install, and documentation coverage.
- Patched transitive audit resolutions.

## v0.66.0 - 2026-08-02

- Added all 21 shortlist filter fields to the workflow configuration schema, including `minScore`, `segment`, `profile`, `priority`, `contactConfidence`, `minContactConfidence`, `preferredContactChannel`, `source`, `auditStatus`, `hasWebsite`, `topFinding`, `reviewStatus`, `excludeReviewStatus`, `unreviewed`, `reviewedBefore`, `requireWebsite`, `missingWebsite`, `requireContact`, `missingContact`, `requireReport`, and `missingReport`.
- Added new shortlist settings to workflow plan output for operator visibility.
- Kept workflow configuration local-only with no source CSV mutation, API calls, outreach sending, or CRM sync.

## v0.65.0 - 2026-07-30

- Added explicit `workflow --config <path> --resume` recovery from the latest verified stage checkpoint.
- Added strict configuration fingerprint, managed artifact, report source, and checkpoint state validation before resumed work begins.
- Kept existing workflow summary, preflight, and plan output contracts stable while rerunning incomplete packaging as a complete stage.
- Updated the locked PostCSS development dependency to a patched release after the release audit reported a high-severity source map path traversal advisory.

## v0.64.0 - 2026-07-21

- Added `workflow --config <path> --plan` for a read-only explanation of readiness, execution order, effective settings, network capability, and managed artifacts.
- Added stable terminal output and a versioned JSON workflow plan for operators and automation.
- Kept planning free of network calls and output mutation while preserving existing preflight and workflow execution behavior.

## v0.63.0 - 2026-07-19

- Added `workflow --config <path> --check` to validate workflow readiness before execution.
- Added stable terminal output and a versioned JSON preflight report for operator and automation use.
- Kept preflight read-only and local: no network calls or output mutation, with advisory filesystem readiness checks and managed-path safety validation.

## v0.62.0 - 2026-07-16

- Added `workflow --config <path>` to run versioned discovery, shortlist, optional review summary, and optional report packaging from one strict JSON configuration.
- Added deterministic managed workflow outputs with fail-fast stage summaries and independent package failure reporting.
- Kept workflows operator-controlled and local-only, with no outreach sending or CRM synchronization; Google Places remains opt-in and requires its existing API key and billing acknowledgement.

## v0.61.0 - 2026-07-14

- Added batch `--summary-json <path>` output using the existing aggregate batch index JSON contract independently of report format.
- Kept explicit batch summary output local-only and additive to standard batch index files.

## v0.60.0 - 2026-07-12

- Added `source`, `auditStatus`, and `hasWebsite` columns to batch standard and CRM prospect CSV exports.
- Kept batch CSV rendering local-only with no source CSV mutation, API calls, outreach sending, or CRM sync.

## v0.59.0 - 2026-07-11

- Added `--source`, `--audit-status`, and `--has-website` batch index filters to the main audit command.
- Applied batch index filtering before sorting and top-N selection.
- Kept batch filtering local-only with no source CSV mutation, review CSV mutation, API calls, outreach sending, or CRM sync.

## v0.58.0 - 2026-07-10

- Added `actionableLeads` to `review --summary-json` output with deduplicated lead keys and their `unreviewed`, `invalid-reviewed-at`, or `stale` reasons.
- Preserved `actionableLeadKeys` for existing consumers and kept review summaries read-only.

## v0.57.0 - 2026-07-09

- Added `actionableLeadKeys` to `review --summary-json` output as a deduplicated unreviewed, invalid-date, and stale review queue.
- Kept actionable review summaries read-only with no source CSV mutation, review CSV mutation, API calls, outreach sending, or CRM sync.

## v0.56.0 - 2026-07-08

- Added `unreviewedLeadKeys` to `review --summary-json` output when unreviewed rows have lead keys.
- Kept unreviewed queue summaries read-only with no source CSV mutation, review CSV mutation, API calls, outreach sending, or CRM sync.

## v0.55.0 - 2026-07-07

- Added `invalidReviewedAtLeadKeys` to `review --summary-json` output when invalid review date rows have lead keys.
- Kept invalid review date summaries read-only with no source CSV mutation, review CSV mutation, API calls, outreach sending, or CRM sync.

## v0.54.0 - 2026-07-06

- Added `staleLeadKeys` to `review --summary-json` output when stale review rows have lead keys.
- Kept stale review summaries read-only with no source CSV mutation, review CSV mutation, API calls, outreach sending, or CRM sync.

## v0.53.0 - 2026-07-05

- Added `contact-confidence-desc`, `priority-desc`, and `source-asc` sort modes to `shortlist --sort`.
- Kept shortlist sorting local-only with no source CSV mutation, review CSV mutation, API calls, outreach sending, or CRM sync.

## v0.52.0 - 2026-07-04

- Added a fresh consumer install audit to `npm run release-check`.
- Verified release tarballs install as the current package version before publish.
- Kept the release gate local and dependency-free by using npm and Node standard library only.

## v0.51.0 - 2026-07-03

- Added `review --stale-before YYYY-MM-DD` for read-only stale review counts in local review CSV summaries.
- Included stale review counts in `review --summary-json` output.
- Kept stale review summary checks local-only with no source CSV mutation, API calls, outreach sending, or CRM sync.

## v0.50.0 - 2026-07-01

- Added `review --summary` for local review CSV queue counts by status, review coverage, invalid review dates, and oldest/newest review timestamps.
- Added `review --summary-json <path>` for automation-friendly review queue summaries.
- Kept review summaries read-only with no source CSV mutation, API calls, outreach sending, or CRM sync.

## v0.49.0 - 2026-06-30

- Removed the default `--no-sandbox` Chrome launch flag from Lighthouse audits.
- Raised the Cheerio dependency floor so fresh installs resolve a patched `undici` transitive dependency.
- Documented the upgrade path for old consuming projects that still have vulnerable transitive dependency locks.

## v0.48.0 - 2026-06-30

- Added bulk `review --input <path>` updates from shortlist CSV and JSON files.
- Added `review --dry-run` previews for bulk review CSV updates.
- Kept bulk review updates local-only with no source CSV mutation, API calls, outreach sending, or CRM sync.

## v0.47.0 - 2026-06-29

- Added `source`, `auditStatus`, and `hasWebsite` columns to shortlist CSV and Markdown reports.
- Kept shortlist rendering local-only with no source CSV mutation, API calls, outreach sending, or CRM sync.

## v0.46.0 - 2026-06-29

- Added `shortlist --top-finding <finding>` for local top-finding shortlist filtering.
- Applied top-finding filtering after review suppression and before sorting and top-N selection.
- Kept top-finding filtering local-only with no source CSV mutation, review CSV mutation, API calls, outreach sending, or CRM sync.

## v0.45.0 - 2026-06-29

- Added `shortlist --has-website <status>` for local website-presence shortlist filtering.
- Applied has-website filtering after review suppression and before sorting and top-N selection.
- Kept has-website filtering local-only with no source CSV mutation, review CSV mutation, API calls, outreach sending, or CRM sync.

## v0.44.0 - 2026-06-28

- Added `shortlist --min-contact-confidence <level>` for local ordinal contact-confidence shortlist filtering.
- Applied min-contact-confidence filtering after review suppression and before sorting and top-N selection.
- Kept min-contact-confidence filtering local-only with no source CSV mutation, review CSV mutation, API calls, outreach sending, or CRM sync.

## v0.43.0 - 2026-06-27

- Added `shortlist --audit-status <status>` for local audit-status shortlist filtering.
- Applied audit-status filtering after review suppression and before sorting and top-N selection.
- Kept audit-status filtering local-only with no source CSV mutation, review CSV mutation, API calls, outreach sending, or CRM sync.

## v0.42.0 - 2026-06-24

- Added `shortlist --min-score <score>` for local audit-score shortlist filtering.
- Applied min-score filtering after review suppression and before sorting and top-N selection.
- Kept min-score filtering local-only with no source CSV mutation, review CSV mutation, API calls, outreach sending, or CRM sync.

## v0.41.0 - 2026-06-24

- Added `review --review-csv <path> --lead-key <key> --status <status>` for local review CSV upserts.
- Preserved existing review CSV columns while adding missing review-state columns and writing ISO review timestamps.
- Kept review updates local-only with no source CSV mutation, API calls, outreach sending, or CRM sync.

## v0.40.0 - 2026-06-23

- Added `shortlist --source <source>` for local discovery-source shortlist filtering.
- Applied source filtering after review suppression and before sorting and top-N selection.
- Kept source filtering local-only with no source CSV mutation, review CSV mutation, API calls, outreach sending, or CRM sync.

## v0.39.0 - 2026-06-20

- Added `shortlist --reviewed-before <date>` for local re-review shortlist queues.
- Added strict `YYYY-MM-DD` threshold validation and strictly-earlier review-date filtering.
- Kept reviewed-before filtering local-only with no source CSV mutation, review CSV mutation, API calls, outreach sending, or CRM sync.

## v0.38.0 - 2026-06-19

- Added `shortlist --unreviewed` for local first-review shortlist queues.
- Applied unreviewed filtering after review suppression and before sorting and top-N selection.
- Kept unreviewed filtering local-only with no source CSV mutation, review CSV mutation, API calls, outreach sending, or CRM sync.

## v0.37.0 - 2026-06-17

- Added `shortlist --missing-website` for local website-backlog shortlist filtering.
- Applied missing-website filtering after review suppression and before sorting and top-N selection.
- Kept missing-website filtering local-only with no source CSV mutation, review CSV mutation, API calls, outreach sending, or CRM sync.

## v0.36.0 - 2026-06-16

- Added `shortlist --missing-contact` for local contact-backlog shortlist filtering.
- Applied missing-contact filtering after review suppression and before sorting and top-N selection.
- Kept missing-contact filtering local-only with no source CSV mutation, review CSV mutation, API calls, outreach sending, or CRM sync.

## v0.35.0 - 2026-06-15

- Added `shortlist --missing-report` for local report-backlog shortlist filtering.
- Applied missing-report filtering after review suppression and before sorting and top-N selection.
- Kept missing-report filtering local-only with no source CSV mutation, review CSV mutation, API calls, outreach sending, or CRM sync.

## v0.34.0 - 2026-06-14

- Added `shortlist --preferred-contact-channel <channel>` for local outreach-channel shortlist filtering.
- Applied preferred-contact-channel filtering after review suppression and before sorting and top-N selection.
- Kept preferred-contact-channel filtering local-only with no source CSV mutation, review CSV mutation, API calls, outreach sending, or CRM sync.

## v0.33.0 - 2026-06-13

- Added `shortlist --require-report` for local report-ready shortlist filtering.
- Applied report-required filtering after review suppression and before sorting and top-N selection.
- Kept report-required filtering local-only with no source CSV mutation, review CSV mutation, API calls, outreach sending, or CRM sync.

## v0.32.0 - 2026-06-12

- Added `shortlist --require-contact` for local contact-ready shortlist filtering.
- Applied contact-required filtering after review suppression and before sorting and top-N selection.
- Kept contact-required filtering local-only with no source CSV mutation, review CSV mutation, API calls, outreach sending, or CRM sync.

## v0.31.0 - 2026-06-11

- Added `shortlist --require-website` for local website-present shortlist filtering.
- Applied website-required filtering after review suppression and before sorting and top-N selection.
- Kept website-required filtering local-only with no source CSV mutation, review CSV mutation, API calls, outreach sending, or CRM sync.

## v0.30.0 - 2026-06-09

- Added `shortlist --exclude-review-status <status>` for local active-review-status exclusion.
- Applied review-status exclusion after review suppression and before sorting and top-N selection.
- Kept exclusion filtering local-only with no source CSV mutation, review CSV mutation, API calls, outreach sending, or CRM sync.

## v0.29.0 - 2026-06-08

- Added `shortlist --summary-json <path>` for separate local automation summary output.
- Added `renderShortlistSummaryJson` for package consumers.
- Kept summary output local-only with no source CSV mutation, review CSV mutation, API calls, outreach sending, or CRM sync.

## v0.28.0 - 2026-06-07

- Added `shortlist --sort <sort>` for local shortlist ranking control.
- Supported `opportunity-desc`, `score-desc`, `company-asc`, and `last-reviewed-asc` sort modes.
- Kept sorting local-only with no source CSV mutation, review CSV mutation, API calls, outreach sending, or CRM sync.

## v0.27.0 - 2026-06-06

- Added `shortlist --review-status <status>` for active review-state filtering.
- Applied review-status filtering after review-state suppression and before ranking and top-N selection.
- Kept review-status filtering local-only with no review CSV mutation, source CSV mutation, API calls, outreach sending, or CRM sync.

## v0.26.0 - 2026-06-05

- Added `shortlist` focus filters for segment, profile, priority, and contact confidence.
- Combined supplied focus filters with case-insensitive `AND` matching.
- Applied focus filters after review suppression and before ranking and top-N selection.
- Kept focus filtering local-only with no source CSV mutation, API calls, outreach sending, or CRM sync.

## v0.25.0 - 2026-06-04

- Added `shortlist --min-opportunity-score <score>` for local shortlist filtering.
- Filtered low-opportunity shortlist leads after review-state suppression and before top-N ranking.
- Reported filtered row counts in CLI output, Markdown summaries, and JSON results.
- Kept shortlist filtering local-only with no API calls, outreach sending, review CSV mutation, or CRM sync.

## v0.24.0 - 2026-06-03

- Added `shortlist --format csv` for spreadsheet-ready local shortlist output.
- Included rank, scoring, contact handoff, review context, lead key, and report path columns in CSV shortlist reports.
- Reused existing CSV cell hardening so formula-like shortlist values are neutralized before spreadsheet review.
- Kept CSV shortlist generation local-only with no API calls, outreach sending, review CSV mutation, or CRM sync.

## v0.23.0 - 2026-06-01

- Added `shortlist --review-csv <path>` for local review-state aware shortlist runs.
- Suppressed already handled shortlist leads marked `rejected`, `contacted`, `not-fit`, `not_a_fit`, `do-not-contact`, or `suppressed`.
- Carried active review status, review reason, and last-reviewed date into Markdown and JSON shortlist reports.
- Kept shortlist review handling local-only with no review CSV mutation, API calls, outreach sending, or CRM sync.

## v0.22.0 - 2026-05-31

- Added `shortlist --input <path> --out <path>` for local lead shortlist reports.
- Added Markdown and JSON shortlist output for discovery and CRM CSV exports.
- Ranked leads by opportunity score, priority, contact confidence, audit score, and company name.
- Kept shortlist generation local-only with no API calls, outreach sending, or CRM sync.

## v0.21.0 - 2026-05-28

- Added `package-report --input <path> --out <path>` for local customer-shareable report packs.
- Added report-pack `README.md`, `next-actions.md`, and `manifest.json` generation from existing single-site JSON reports.
- Copied available JSON, Markdown, HTML, and PDF report artifacts into the local package.
- Kept report packaging local-only with no uploads, outreach sending, or CRM sync.

## v0.20.0 - 2026-05-27

- Added `validate-export --input <path> --preset crm` for local CRM CSV import checks.
- Added Markdown and JSON validation reports with row counts, errors, warnings, and issue details.
- Flagged missing CRM columns, missing company or website fields, duplicate lead keys, low contact confidence, and manual-review handoffs.
- Kept validation local-only with no CRM API sync, remote import, or outreach sending.

## v0.19.0 - 2026-05-26

- Added `--export-preset standard|crm` for batch and discovery CSV exports.
- Added CRM-ready local import columns for company identity, website, scoring, contact handoff, source, lead key, and report path.
- Preserved existing standard CSV export behavior as the default.
- Kept CRM export local-only with no CRM API sync or outreach sending.

## v0.18.0 - 2026-05-23

- Added batch index contact rollups for public contact coverage and confidence.
- Added batch outreach rollups for preferred manual contact channels.
- Added per-entry batch index contact and outreach metadata for successful audits.
- Added batch CSV export columns for contact confidence, preferred contact channel, and contactability reason.

## v0.17.0 - 2026-05-22

- Added advisory fuzzy duplicate candidate groups to discovery duplicate JSON output.
- Added duplicate review reasons for likely business-label and website-domain similarity.
- Preserved exact duplicate reporting while keeping fuzzy matching manual-review only.
- Confirmed fuzzy duplicate review does not auto-suppress leads, send outreach, or sync to a CRM.

## v0.16.0 - 2026-05-20

- Added discovery outreach handoff fields: `preferredContactChannel`, `outreachAction`, and `contactabilityReason`.
- Added deterministic channel selection for email, WhatsApp, phone, contact-page, and manual-review discovery leads.
- Preserved CSV formula hardening for the new outreach handoff fields.

## v0.15.0 - 2026-05-19

- Added public contact extraction for audited pages, including email, phone, WhatsApp, contact-page, and social-profile signals.
- Added Contact Readiness sections to Markdown, HTML, and PDF reports.
- Added contact enrichment columns to discovery CSV exports while preserving CSV formula hardening.

## v0.14.0 - 2026-05-16

- Added `--brand-config` for JSON-driven report branding across Markdown, HTML, and PDF outputs.
- Added Executive Summary sections with business impact, top issues, and a recommended first fix.
- Added lead export enrichment columns: `pitchAngle`, `recommendedOffer`, `estimatedNeed`, and `outreachPriorityReason`.

## v0.13.0 - 2026-05-15

- Added opt-in Lighthouse category scoring with `--lighthouse`.
- Added branded PDF report output with `--format pdf`.
- Added `opportunityReasons` to discovery CSV exports so operators can explain lead scores.
- Added Lighthouse sections to JSON, Markdown, HTML, and PDF reports.

## v0.12.0 - 2026-05-14

- Added discovery suppression lists with `--suppression-list` to skip previously reviewed leads.
- Added `leadKey`, `reviewStatus`, `reviewReason`, and `lastReviewedAt` columns to discovery CSV exports for local review workflows.
- Added `--min-opportunity-score` for filtering discovery exports to higher-value opportunities.
- Added `--review-csv` for merging local operator review decisions across discovery reruns.
- Added `--duplicates-json` for reporting duplicate lead groups.
- Added lawyer, clinic, gym, hotel, and auto-service industry profiles.
- Polished HTML reports with a branded shell, summary cards, and stronger visual hierarchy.
- Added Windows user-environment fallback for `GOOGLE_MAPS_API_KEY`.

## v0.11.0 - 2026-05-13

- Added discovery controls: `--limit`, `--max-audits`, and `--summary-json`.
- Added terminal discovery summary output for website, audit, priority, and average-score counts.
- Added `opportunityScore` to discovery prospect CSV exports.
- Added CSV formula-injection hardening for exported CSV cells.
- Added a Google Maps Platform billing warning when `--provider google-places` is used.

## v0.10.0 - 2026-05-12

- Added an opt-in `google-places` provider for `discover`.
- Added `GOOGLE_MAPS_API_KEY` support for official Google Places Text Search requests.
- Resolved official place website URLs through `websiteUri` where available.
- Kept Google Places storage conservative: no Google Maps scraping, no reviews/photos/ratings collection, and no long-term raw Places data store.
- Fed resolved Google Places websites into the existing audit pipeline and prospect CSV export.

## v0.9.0 - 2026-05-12

- Added `discover --input places.csv --provider manual-csv` for operator-prepared lead discovery.
- Added `leads.csv` prospect exports with website presence, audit status, priority, next action, report path, and error columns.
- Reused the existing batch audit pipeline for website-present discovery rows.
- Added `--dry-run` discovery mode for local prospect triage without website audits.
- Documented the discovery boundary: no Google Maps scraping, no `google-places` provider calls, and no outreach sending in this release.

## v0.8.0 - 2026-05-12

- Added `--concurrency` for controlled parallel batch audits.
- Added batch index insights with average score, profile breakdown, segment breakdown, and frequent findings.
- Added profile-specific findings for dental, beauty, restaurant, and contractor audits.
- Expanded profile tests to cover missing and satisfied vertical conversion/trust signals.

## v0.7.0 - 2026-05-11

- Added industry profiles with `--profile generic|dental|beauty|restaurant|contractor`.
- Added optional `profile` CSV input column for batch audits.
- Added profile metadata to JSON, Markdown, HTML, and batch index outputs.
- Added `--export-csv` for batch prospect exports with score, top finding, report path, and error columns.

## v0.6.0 - 2026-05-10

- Added `--screenshot` for rendered homepage screenshot capture.
- Added visual evidence metadata to JSON reports.
- Added Visual Evidence sections to Markdown and HTML reports.
- Added batch screenshot artifact paths for per-site report folders.

## v0.5.0 - 2026-05-09

- Added opt-in Playwright-rendered audits with `--render`.
- Added batch triage controls with `--segment`, `--min-score`, `--top`, and `--sort`.
- Added trust and conversion checks for current date signals, review cues, service detail depth, brand icons, and placeholder social profile links.

## v0.4.0 - 2026-05-09

- Added resilient batch runs that keep auditing after individual URL failures.
- Added aggregate batch index reports in JSON, Markdown, and HTML.
- Added CSV batch input with `url`, `label`, and `segment` columns.
- Added `@graph` JSON-LD support for structured-data checks.
- Added LocalBusiness contact-field, Organization schema, visible address, opening-hours, service-location copy, primary CTA, and placeholder-copy checks.

## v0.3.0 - 2026-05-09

- Added standalone HTML report rendering.
- Added `--format html`.
- Expanded `--format all` to write JSON, Markdown, and HTML reports.
- Added `--input <path>` for batch audits from text files.
- Added safe per-site output folders for batch reports.

## v0.2.0 - 2026-05-08

- Added optional same-origin internal link scanning with `--check-links` and `--max-pages`.
- Added a high-severity finding for broken internal links.
- Added `--fail-on none|high|medium|low` for CI-friendly exit codes.
- Added compact terminal summaries when reports are written to files.
- Added integration tests for link scanning and CLI behavior helpers.

## v0.1.1 - 2026-05-08

- Added `robots.txt`, `sitemap.xml`, Open Graph, and invalid JSON-LD checks.
- Added `--format all --out-dir <path>` for writing JSON and Markdown reports together.
- Added fixture-based rule tests and report output tests.
- Added `npm run release-check` for local and CI release verification.

## v0.1.0 - 2026-05-08

- Project documentation and release planning created.
- Initial TypeScript CLI scaffold added.
- JSON and Markdown report generation added.
- Initial audit rule set and Vitest coverage added.
- Example report artifacts added.
