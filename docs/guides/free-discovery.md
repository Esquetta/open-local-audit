# Free business discovery

The `overture` provider finds business candidates without an API key, payment account, Google rating, or review collection. It runs locally. Open-data access has no per-query API charge; downloads, local compute, and any separately hosted application still have costs.

## Search by category and location

From a source checkout, install dependencies and build:

Use Node.js 22.19 or newer.

```bash
npm install
npm run build
node dist/cli.js discover restaurant --city Berlin --country DE --profile restaurant --limit 10 --max-audits 3 --concurrency 3 --out-dir reports/berlin --export-csv reports/berlin/leads.csv
```

Without `--provider`, `discover` selects Overture unless `--input` is present, which preserves manual CSV discovery. Google Places remains explicitly selectable.

Use a city name and ISO two-letter country code, such as `TR`, `US`, `DE`, or `GB`. GeoNames cities15000 covers cities above approximately 15,000 population and capitals, not every settlement. Localized/alternate names are matched. Ambiguous city names require explicit coordinates instead of guessing.

`--radius-km` defaults to 10 (maximum 50). It defines an approximate bounding-box half-width around the city centre, not an administrative boundary or exact circular radius. For another area:

```bash
node dist/cli.js discover beauty --bbox "28.85,40.95,29.10,41.10" --profile beauty --dry-run --export-csv reports/istanbul-beauty.csv
```

Friendly categories include `dental`, `restaurant`, `beauty`, `hotel`, and `gym`; official Overture taxonomy identifiers also work. Matching includes descendants. `--profile` selects existing audit rules separately from the discovery category. No matches do not prove no businesses exist in the area.

## Data and limits

- Overture cloud GeoParquet is queried using local DuckDB. First use installs its `httpfs` extension and requires network access to the extension repository, Overture STAC and S3. A full-world dataset is not intentionally downloaded.
- City lookup downloads GeoNames cities15000 and caches the extracted text for 30 days under `<out-dir>/.cache` (or `reports/.cache`). Bounding-box searches do not use GeoNames.
- `--release YYYY-MM-DD.N` pins a release; otherwise discovery resolves the current release. A monthly release does not mean every record was checked that month.
- Queries return up to 100 candidates. Geographic span, timeout, memory, and thread limits apply. Records explicitly marked permanently closed or with source confidence below 0.5 are excluded. Missing confidence remains unknown.
- Source data can be incomplete, stale, or duplicated. IDs identify source records; advisory duplicate review does not prove real-world uniqueness.
- Missing Overture website data exports `hasWebsite=unknown`, `estimatedNeed=Unknown`, and opportunity score zero pending manual qualification. It is not evidence of a website-build opportunity.

The standard CSV includes available address, country, locality, region, coordinates, confidence, operating status, source URL/provenance, release, and retrieval time. Phone/email/social fields prefer extracted website data and fall back to source data. Source-only contact confidence is `Low`. Confidence labels describe extraction signals, not ownership or deliverability checks. Review the business and branch before outreach. CRM columns keep their existing contract; use the standard export for full source details.

Known social profiles supplied in a source website field are preserved as social contacts, not audited as the business's own website. Known short links are excluded from automatic website resolution; an unexpanded link is not proof that no website exists.

## Website enrichment

`--dry-run` writes source data without visiting business websites. Otherwise `--max-audits` bounds the sample. Overture audit concurrency is capped at eight; requests to the same business hostname are serialized.

Each site receives a static scan of at most three HTML pages: its homepage and linked same-origin contact/about pages. The crawler checks robots rules, limits response size, has a total timeout, validates public destinations, and pins DNS for production HTTP requests. It does not log in, submit forms, bypass challenges, send messages, or open a browser. JavaScript-only contact data can remain unavailable.

Blocked/failed sites are recorded. If an optional secondary page fails, usable homepage data is retained with a warning. Redirects beyond the equivalent `www` host are conservatively blocked and may require manual review. Source-to-website identity is not independently verified.

## Workflow configuration

Version 1 workflows accept explicit Overture bounding boxes:

```json
{
  "version": 1,
  "outDir": "./workflow-output",
  "discovery": {
    "provider": "overture",
    "query": "dental",
    "bbox": "28.85,40.95,29.10,41.10",
    "profile": "dental",
    "limit": 10,
    "maxAudits": 3,
    "concurrency": 3
  },
  "shortlist": { "top": 10 }
}
```

Preflight/planning remain offline and do not resolve Google credentials for Overture. They validate configuration and output readiness, not network availability. Normal execution uses the existing review, shortlist, checkpoint and report-package stages.

## Repeat the benchmark

```bash
npm run benchmark:discovery -- --out-dir reports/free-discovery-benchmark
```

The default 24-search matrix uses Istanbul/Ankara (Türkiye), New York/Los Angeles (USA), Berlin/Munich (Germany), and London/Manchester (UK), each for dental, restaurant, and beauty. These are major-city samples, not an official popularity ranking. Every search uses a documented city-centre box, up to ten candidates, up to three website audits, and concurrency three. The first returned release is pinned for later searches.

Case JSON and prospect/report outputs are saved as each case completes, followed by summary JSON, CSV, and Markdown. Failure times remain in the evidence. Discovery and enrichment/report times are separate. Contact completeness among returned rows is not market coverage, recall, or contact correctness. Percentiles across different scenarios are descriptive, not load-test results or an SLA. One pass does not establish stable latency. Use `--repeats 2` to intentionally measure another pass, or `--case-filter Istanbul` to limit the matrix.

## Sources and attribution

- Business data: [Overture Places](https://docs.overturemaps.org/guides/places/) and its providers. Follow release-specific [attribution/license requirements](https://docs.overturemaps.org/attribution/) when redistributing results. MIT applies to this project's code, not all source data. Exported provenance supports license review.
- City lookup: [GeoNames](https://www.geonames.org/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), [dataset definitions](https://download.geonames.org/export/dump/readme.txt).
- Website-derived fields retain the inspected page URLs. Robots rules are crawl instructions, not reuse authorization.
