# Free business discovery

The `overture` provider finds business candidates without an API key, payment account, Google rating, or review collection. It runs locally. Open-data access has no per-query API charge; downloads, local compute, and any separately hosted application still have costs.

## Search by category and location

For a guided first search from a built source checkout:

```bash
node dist/cli.js start
```

The terminal asks for a country code, city, category, candidate count, website-audit cap, audit priority (when the cap is above zero), and output directory. It previews the search before confirmation. Enter `n` at confirmation or press Ctrl+C to cancel. No discovery requests or output files are created before confirmation. Existing output directories are refused to protect earlier results. Piped/non-interactive use exits with an error and an explicit `discover` example; use that command in scripts.

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

Friendly categories include `dental`, `restaurant`, `beauty`, `hotel`, `gym`, `lawyer` (also `solicitor` or `attorney`, mapped to `attorney_or_law_firm`), and `legal` (all of `legal_service`); official Overture taxonomy identifiers also work. Matching includes descendants. `--profile` selects existing audit rules separately from the discovery category. No matches do not prove no businesses exist in the area.

For Overture listings in the UK (`country` GB), the check first finds the landline area code that at least 60% of the search's UK landlines share (five or more landlines needed) and the locality most of those leads list. A lead that lists that same locality but has a different landline area code gets the reason "Phone area code ... differs from ..." and the next action "Confirm the business location before outreach", with its priority capped at medium. This catches source records placed in the wrong town, such as a Weston-super-Mare `01934` clinic listed in Leeds. Neighbouring towns at the edge of the search box that list their own locality, leads without a locality, mobile numbers, non-geographic numbers, and listings outside the UK are not flagged. The check is advisory and never removes a lead.

## Repeated-search cache

`discover` with Overture and `start` enable the local business-result cache by default. An entry is reusable only for the same normalized category, numeric bounding box, candidate limit, and Overture release, and for at most seven days. A different audit profile reuses source data with the newly selected profile. Website audits are never taken from this cache; they run again up to the requested audit cap.

Without `--release`, the current Overture release is checked before looking in the cache. This still needs a small network request; an old cached release is not silently used if the release lookup fails. A pinned `--release` can reuse its valid cache without querying STAC or the remote Places files. Cached results keep their original retrieval time; neither that time nor the release date means the business details were independently verified.

- `--refresh-cache` bypasses the saved result and replaces that search's entry after a successful lookup.
- `--no-cache` disables business-result cache reads and writes.
- `--cache-dir <path>` selects another directory; relative paths resolve from the current working directory. It cannot be combined with `--no-cache`.

```bash
node dist/cli.js discover dental --city Istanbul --country TR --profile dental --limit 10 --dry-run --cache-dir reports/search-cache --export-csv reports/leads.csv
```

The CLI reports `hit`, `miss`, `refresh`, `disabled`, or `unavailable`, alongside the source release and original fetch time when available. Invalid, expired, oversized, or unsafe entries do not become cache hits. Cache storage failures fall back to a fresh search with a diagnostic; an actual source-search failure remains an error.

Default storage is `%LOCALAPPDATA%/open-local-audit/cache/discovery` on Windows, `~/Library/Caches/open-local-audit/discovery` on macOS, and `$XDG_CACHE_HOME/open-local-audit/discovery` (or `~/.cache/open-local-audit/discovery`) on Linux. It contains public source business details, not API keys or website audit reports. Each entry is limited to 2 MiB; expired entries are replaced when searched again, rather than removed by a background job.

The existing GeoNames city-file cache remains separate under the output directory. Programmatic discovery opts into business caching with `cacheDir`; the version-1 `workflow` command keeps its existing uncached execution and output contract.

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

`--audit-priority source-order` is the default and keeps source ordering. For Overture, `--audit-priority missing-contact` spends the audit cap first on candidates missing source email, then on those missing source phone; ties retain source order. Only candidates with a resolved HTTP(S) website can be selected. Exported rows keep their original order and include `auditSelected`, `auditSelectionReason`, and `auditSelectionRank`. This prioritizes gaps; it does not guarantee additional valid contacts. Priority does not change the source-cache key.

```bash
node dist/cli.js discover dental --city Istanbul --country TR --profile dental --limit 20 --max-audits 3 --audit-priority missing-contact --export-csv reports/leads.csv
```

`--dry-run` writes source data without visiting business websites. Otherwise `--max-audits` bounds the sample. Overture audit concurrency is capped at eight; requests to the same business hostname are serialized.

Each site receives a static scan of at most three HTML pages: its homepage and linked same-origin contact/about pages. The crawler checks robots rules, limits response size, has a total timeout, validates public destinations, and pins DNS for production HTTP requests. It does not log in, submit forms, bypass challenges, send messages, or open a browser. JavaScript-only contact data can remain unavailable.

Blocked/failed sites are recorded. If an optional secondary page fails, usable homepage data is retained with a warning. Redirects beyond the equivalent `www` host are conservatively blocked and may require manual review.

Source names, phones, and addresses are compared with structured business data on fetched pages. The standard CSV records `identityStatus`, `identityReasons`, and `identityEvidence`, including source values, website values, and inspected page URLs. Reports include the identity result and evidence.

- `matched`: at least two fields agree without a contradiction in one structured business entity, and no other observed entity conflicts. When the source has a street and locality, the address must also agree.
- `uncertain`: evidence is missing, weak, mixed, or insufficient. Page titles alone cannot establish identity. A technical report may still be generated, but contact confidence is capped at `Low` and manual verification is required.
- `conflict`: at least two fields contradict one structured entity, with no matching or unresolved structured entity. Website contacts and audit scores are withheld, source contacts are retained, and no business report is generated for that candidate.
- `not-checked`: no website audit was selected or performed.

Missing fields are not contradictions. Formatting normalization is conservative; changed numbers, branch pages, incomplete schemas, and stale source data can require manual review. These checks do not certify ownership, contact deliverability, or business legitimacy.

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
    "auditPriority": "missing-contact",
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

The benchmark leaves business caching disabled unless `--cache-dir` is explicitly supplied, preserving fresh-search measurements. To compare the same search before and after caching, use a new cache directory and inspect the recorded `miss`/`hit` states:

```bash
npm run benchmark:discovery -- --out-dir reports/cache-benchmark --cache-dir reports/cache-benchmark/first-cache --case-filter tr-istanbul-dental --repeats 2 --max-audits 0 --release 2026-09-23.1
```

`--max-audits 0` isolates discovery from website work. A previously populated cache may produce a hit on both runs; do not label the first run cold unless its recorded state is `miss`. Per-case JSON retains cache state and original fetch time; the CSV and Markdown identify cached runs. A single pair is an indicative measurement, not a speed guarantee or a load test.

Case JSON and prospect/report outputs are saved as each case completes, followed by summary JSON, CSV, and Markdown. Failure times remain in the evidence. Discovery and enrichment/report times are separate. Contact completeness among returned rows is not market coverage, recall, or contact correctness. Percentiles across different scenarios are descriptive, not load-test results or an SLA. One pass does not establish stable latency. Use `--repeats 2` to intentionally measure another pass, or `--case-filter Istanbul` to limit the matrix.

## Compare audit priorities on a frozen pool

Use a discovery cache JSON file containing 10 or 20 raw candidates:

```bash
npx tsx scripts/benchmark-audit-priority.ts --cache-file reports/search-cache/<cache-key>.json --pool-limit 10 --budget 3 --out-dir reports/priority-comparison
```

Both modes use the same frozen candidates and a budget of three. The script fetches the union of selected websites once (at most six unique URLs), then evaluates both selections against those shared observations. Its JSON records source and website contact coverage, newly filled fields, identity evidence, and blocked/failed requests. Uncertain contacts still require manual review; conflicting contacts are excluded. The result measures field completeness for that pool, not identity accuracy or per-mode runtime. Some pools select the same candidates and cannot demonstrate a difference.

## Sources and attribution

- Business data: [Overture Places](https://docs.overturemaps.org/guides/places/) and its providers. Follow release-specific [attribution/license requirements](https://docs.overturemaps.org/attribution/) when redistributing results. MIT applies to this project's code, not all source data. Exported provenance supports license review.
- City lookup: [GeoNames](https://www.geonames.org/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), [dataset definitions](https://download.geonames.org/export/dump/readme.txt).
- Website-derived fields retain the inspected page URLs. Robots rules are crawl instructions, not reuse authorization.
