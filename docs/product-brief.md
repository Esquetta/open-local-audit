# Open Local Audit

## Executive summary

Open Local Audit is an open-source website and local presence auditor for small businesses. It scans a public website and produces a practical report covering technical SEO, performance basics, contact conversion, mobile readiness, schema, broken links, social/contact links, and local business trust signals.

Its main job is credibility and lead generation for implementation services. It should be useful enough to earn trust from developers and business owners, but focused enough that it can be built and maintained by a solo founder.

## Strategic role

- Role in portfolio: open-source trust engine and lead magnet.
- Commercial benefit: public proof that maintainers can build serious technical tools.
- Business link: every audit can recommend an implementation package.
- Distribution: GitHub, developer communities, local SEO content, and product landing pages.

## Target users

Primary:
- Internal operator running audits for prospects.
- Small agencies and freelancers.
- Technical founders checking local business sites.

Secondary:
- Business owners who can run a web version by entering their URL.

## Problem

Local business websites often fail on simple basics: unclear contact actions, missing mobile optimization, missing metadata, no structured data, slow images, broken links, outdated social links, and weak local trust signals. Existing SEO tools are either too broad, too expensive, or too technical for small local businesses.

## Product promise

"A practical local business website audit that turns technical issues into owner-readable next actions."

## Brand profile

- Name direction: Open Local Audit.
- Tone: diagnostic, plain-language, evidence-first.
- Visual style: report-like, not flashy.
- Public identity: open-source local website auditing utility.

## MVP scope

Scanner checks:
- HTTP status and redirects.
- HTTPS presence.
- Title and meta description.
- Viewport tag.
- H1 presence.
- LocalBusiness schema presence.
- Open Graph basics.
- Contact links: tel, mailto, WhatsApp.
- Address and map link signals.
- Broken internal links.
- Image alt and large image warnings.
- Basic performance hints.
- robots.txt and sitemap.xml presence.
- Social links.

Report output:
- Markdown report.
- JSON report.
- Simple score categories.
- Owner-readable recommendations.
- Evidence table with URLs and findings.

Excluded:
- Automated Google Maps scraping.
- Automated Google Business Profile updates.
- Deep backlink analysis.
- Paid keyword research.
- Full Core Web Vitals lab replacement.

## Technical architecture

Recommended stack:
- TypeScript CLI.
- Playwright for browser rendering and DOM inspection.
- Cheerio for static HTML parsing where browser rendering is not needed.
- Zod for config validation.
- Markdown and JSON output.
- Optional web UI later with React/Vite.

Alternative stack:
- Go for single-binary distribution if CLI adoption becomes the priority.

Why TypeScript first:
- Matches current TypeScript CLI and Playwright strengths.
- Fast to build.
- Easy to share logic between CLI and web UI.
- Good ecosystem for website parsing and Playwright.

## Security and ethics

- Scan only user-provided URLs.
- Rate-limit crawling.
- Respect robots.txt for crawl breadth.
- Do not collect personal data beyond public business contact details found on the scanned site.
- Do not store scans by default.
- Make external network behavior explicit in CLI output.

## Open-source strategy

Repository:
- Public GitHub repo under a neutral project or maintainer account.
- MIT or Apache-2.0 license.
- Clear contributing guide.
- Example reports for demo businesses.

Developer credibility:
- Clean README.
- Screenshots of reports.
- Deterministic tests for parsers.
- GitHub Actions for lint/test.
- Release binaries if CLI adoption grows.

Commercial boundary:
- Open-source scanner stays useful.
- Paid value is implementation, redesign, maintenance, and custom reporting.

## Go-to-market

Launch content:
- "We audited 20 local business websites and found the same 10 fixable issues."
- Demo report page on the project website.
- GitHub README with sample command.

Lead capture:
- Free report request form.
- "Send this report to an implementation partner for a fixed-price cleanup quote."

## 30-60-90 day plan

First 30 days:
- Build CLI MVP.
- Create 3 sample reports.
- Use it manually for outreach.
- Publish repo and launch article.

Days 31-60:
- Add web UI for one-off scans.
- Add vertical-specific scoring.
- Add report branding.
- Collect first GitHub feedback.

Days 61-90:
- Add GitHub Action mode for agencies.
- Add batch mode from CSV.
- Add paid "audit to website refresh" workflow.

## Metrics

- GitHub stars.
- CLI downloads or npm installs.
- Reports generated.
- Qualified leads from reports.
- Conversion from audit to implementation services.
- Average time to generate and explain a report.

## Risks

- Tool becomes too broad and competes with mature SEO suites.
- False positives hurt trust.
- Business owners may not understand technical output.
- Web scanning can create support burden due to varied sites.

## Open decisions

- CLI package name.
- License.
- Whether to publish to npm first or GitHub releases first.
- Whether report language should default to Turkish, English, or both.
