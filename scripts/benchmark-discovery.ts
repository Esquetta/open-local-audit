import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cityBoundingBox, type DiscoveryCity } from "../src/discovery-location.js";
import { runDiscovery, type DiscoveryRunOptions, type DiscoveryRunResult } from "../src/discovery-runner.js";
import type { ProspectExportRow } from "../src/discovery.js";
import type { AuditProfile } from "../src/types.js";

const categories = ["dental", "restaurant", "beauty"] as const;

const cities: Array<Omit<DiscoveryCity, "country"> & { country: "TR" | "US" | "DE" | "GB" }> = [
  { name: "Istanbul", country: "TR", region: "Istanbul", latitude: 41.0082, longitude: 28.9784 },
  { name: "Ankara", country: "TR", region: "Ankara", latitude: 39.9334, longitude: 32.8597 },
  { name: "New York", country: "US", region: "New York", latitude: 40.7128, longitude: -74.006 },
  { name: "Los Angeles", country: "US", region: "California", latitude: 34.0522, longitude: -118.2437 },
  { name: "Berlin", country: "DE", region: "Berlin", latitude: 52.52, longitude: 13.405 },
  { name: "Munich", country: "DE", region: "Bavaria", latitude: 48.1351, longitude: 11.582 },
  { name: "London", country: "GB", region: "England", latitude: 51.5072, longitude: -0.1276 },
  { name: "Manchester", country: "GB", region: "England", latitude: 53.4808, longitude: -2.2426 }
];

export interface BenchmarkCase {
  id: string;
  country: "TR" | "US" | "DE" | "GB";
  city: string;
  region: string;
  category: (typeof categories)[number];
  profile: AuditProfile;
  bbox: string;
}

export interface CoverageCounts {
  denominator: number;
  website: number;
  phone: number;
  email: number;
  address: number;
}

export interface BenchmarkCaseResult {
  case: BenchmarkCase;
  repeat?: number;
  status: "success" | "failed";
  elapsedMs: number;
  requestedLimit: number;
  requestedRelease: string | null;
  returnedCount: number;
  datasetReleases: string[];
  sourceCoverage: CoverageCounts;
  coverage: CoverageCounts;
  metrics?: DiscoveryRunResult["metrics"];
  rows: ProspectExportRow[];
  error?: string;
}

export interface BenchmarkRunOptions {
  outDir: string;
  cacheDir?: string;
  release?: string;
  limit: number;
  maxAudits: number;
  repeats: number;
  now?: () => number;
  onResult?: (result: BenchmarkCaseResult) => Promise<void> | void;
}

export interface BenchmarkSummary {
  counts: { attempted: number; succeeded: number; failed: number; returned: number };
  coverage: {
    source: CoverageSummary;
    postWebsite: CoverageSummary;
  };
  websiteOutcomes: { attempted: number; success: number; blocked: number; failed: number; other: number };
  durations: {
    wallClockMs: Percentiles;
    discoveryMs: Percentiles;
    enrichmentAndReportMs: Percentiles;
    totalMs: Percentiles;
  };
  datasetReleases: string[];
  failures: Array<{ caseId: string; repeat?: number; error: string; elapsedMs: number }>;
}

interface CoverageSummary {
  denominator: number;
  website: Percentage;
  phone: Percentage;
  email: Percentage;
  address: Percentage;
}

interface Percentage {
  count: number;
  percent: number | undefined;
}

interface Percentiles {
  p50: number | undefined;
  p95: number | undefined;
  sampleSize: number;
}

type DiscoveryRunner = (options: DiscoveryRunOptions) => Promise<DiscoveryRunResult>;

export function buildBenchmarkCases(): BenchmarkCase[] {
  return cities.flatMap((city) => categories.map((category) => ({
    id: `${city.country.toLowerCase()}-${slug(city.name)}-${category}`,
    country: city.country,
    city: city.name,
    region: city.region,
    category,
    profile: category,
    bbox: cityBoundingBox(city, 10).map((coordinate) => coordinate.toFixed(6)).join(",")
  })));
}

export async function runBenchmarkCases(
  benchmarkCases: BenchmarkCase[],
  options: BenchmarkRunOptions,
  discoveryRunner: DiscoveryRunner = runDiscovery
): Promise<BenchmarkCaseResult[]> {
  const now = options.now ?? (() => performance.now());
  const results: BenchmarkCaseResult[] = [];
  let pinnedRelease = options.release;

  for (let repeat = 1; repeat <= options.repeats; repeat += 1) {
    for (const benchmarkCase of benchmarkCases) {
      const caseDir = join(options.outDir, "cases", `${benchmarkCase.id}-run-${repeat}`);
      const started = now();
      const requestedRelease = pinnedRelease;
      let result: BenchmarkCaseResult;
      try {
        const discovery = await discoveryRunner({
          provider: "overture",
          query: benchmarkCase.category,
          bbox: benchmarkCase.bbox,
          profile: benchmarkCase.profile,
          limit: options.limit,
          maxAudits: options.maxAudits,
          concurrency: 3,
          dryRun: false,
          outDir: caseDir,
          exportCsv: join(caseDir, "prospects.csv"),
          summaryJson: join(caseDir, "discovery-summary.json"),
          release: requestedRelease,
          cacheDir: options.cacheDir
        });
        const datasetReleases = releasesFrom(discovery.rows);
        if (!options.release && !pinnedRelease && datasetReleases[0]) {
          pinnedRelease = datasetReleases[0];
        }
        result = {
          case: benchmarkCase,
          repeat,
          status: "success",
          elapsedMs: now() - started,
          requestedLimit: options.limit,
          requestedRelease: requestedRelease ?? null,
          returnedCount: discovery.rows.length,
          datasetReleases,
          sourceCoverage: sourceCoverageFor(discovery.metrics),
          coverage: coverageFor(discovery.rows),
          metrics: discovery.metrics,
          rows: discovery.rows
        };
      } catch (error) {
        result = {
          case: benchmarkCase,
          repeat,
          status: "failed",
          elapsedMs: now() - started,
          requestedLimit: options.limit,
          requestedRelease: requestedRelease ?? null,
          returnedCount: 0,
          datasetReleases: [],
          sourceCoverage: emptyCoverage(),
          coverage: emptyCoverage(),
          rows: [],
          error: errorMessage(error)
        };
      }
      results.push(result);
      await options.onResult?.(result);
    }
  }

  return results;
}

export function summarizeBenchmark(results: BenchmarkCaseResult[]): BenchmarkSummary {
  const succeeded = results.filter((result) => result.status === "success");
  const sourceCoverage = aggregateCoverage(succeeded.map((result) => result.sourceCoverage));
  const postWebsiteCoverage = aggregateCoverage(succeeded.map((result) => result.coverage));
  const websites = succeeded.flatMap((result) => result.metrics?.websites ?? []);

  return {
    counts: {
      attempted: results.length,
      succeeded: succeeded.length,
      failed: results.length - succeeded.length,
      returned: postWebsiteCoverage.denominator
    },
    coverage: {
      source: coverageSummary(sourceCoverage),
      postWebsite: coverageSummary(postWebsiteCoverage)
    },
    websiteOutcomes: {
      attempted: websites.length,
      success: websites.filter((website) => website.status === "success").length,
      blocked: websites.filter((website) => website.status === "blocked").length,
      failed: websites.filter((website) => website.status === "failed").length,
      other: websites.filter((website) => !["success", "blocked", "failed"].includes(website.status)).length
    },
    durations: {
      wallClockMs: percentileSummary(succeeded.map((result) => result.elapsedMs)),
      discoveryMs: percentileSummary(succeeded.flatMap((result) => result.metrics ? [result.metrics.discoveryMs] : [])),
      enrichmentAndReportMs: percentileSummary(succeeded.flatMap((result) => result.metrics ? [result.metrics.auditMs] : [])),
      totalMs: percentileSummary(succeeded.flatMap((result) => result.metrics ? [result.metrics.totalMs] : []))
    },
    datasetReleases: Array.from(new Set(succeeded.flatMap((result) => result.datasetReleases))).sort(),
    failures: results.flatMap((result) => result.status === "failed" && result.error ? [{
      caseId: result.case.id,
      ...(result.repeat && result.repeat !== 1 ? { repeat: result.repeat } : {}),
      error: result.error,
      elapsedMs: result.elapsedMs
    }] : [])
  };
}

function aggregateCoverage(items: CoverageCounts[]): CoverageCounts {
  return items.reduce<CoverageCounts>((total, item) => ({
    denominator: total.denominator + item.denominator,
    website: total.website + item.website,
    phone: total.phone + item.phone,
    email: total.email + item.email,
    address: total.address + item.address
  }), emptyCoverage());
}

function coverageSummary(coverage: CoverageCounts): CoverageSummary {
  return {
    denominator: coverage.denominator,
    website: percentage(coverage.website, coverage.denominator),
    phone: percentage(coverage.phone, coverage.denominator),
    email: percentage(coverage.email, coverage.denominator),
    address: percentage(coverage.address, coverage.denominator)
  };
}

function coverageFor(rows: ProspectExportRow[]): CoverageCounts {
  return {
    denominator: rows.length,
    website: rows.filter((row) => row.hasWebsite === "yes").length,
    phone: rows.filter((row) => Boolean(row.publicPhone)).length,
    email: rows.filter((row) => Boolean(row.publicEmail)).length,
    address: rows.filter((row) => Boolean(row.address)).length
  };
}

function sourceCoverageFor(metrics: DiscoveryRunResult["metrics"]): CoverageCounts {
  return metrics?.sourceCoverage ?? emptyCoverage();
}

function emptyCoverage(): CoverageCounts {
  return { denominator: 0, website: 0, phone: 0, email: 0, address: 0 };
}

function releasesFrom(rows: ProspectExportRow[]): string[] {
  return Array.from(new Set(rows.flatMap((row) => row.datasetRelease ? [row.datasetRelease] : []))).sort();
}

function percentage(count: number, denominator: number): Percentage {
  return { count, percent: denominator === 0 ? undefined : round((count / denominator) * 100) };
}

function percentileSummary(values: number[]): Percentiles {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  return { p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), sampleSize: sorted.length };
}

function percentile(values: number[], fraction: number): number | undefined {
  if (values.length === 0) return undefined;
  const index = (values.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return round(values[lower]! + (values[upper]! - values[lower]!) * (index - lower));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeCsv(value: unknown): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function renderCasesCsv(results: BenchmarkCaseResult[]): string {
  const header = ["caseId", "repeat", "status", "country", "city", "region", "category", "bbox", "requestedLimit", "requestedRelease", "returnedCount", "datasetReleases", "elapsedMs", "discoveryMs", "enrichmentAndReportMs", "totalMs", "sourceWebsiteCount", "sourcePhoneCount", "sourceEmailCount", "sourceAddressCount", "sourceCoverageDenominator", "postWebsiteCount", "postPhoneCount", "postEmailCount", "postAddressCount", "postCoverageDenominator", "websiteAttempts", "websiteSuccess", "websiteBlocked", "websiteFailed", "error"];
  header.push("cacheStatus", "cacheFetchedAt");
  const records = results.map((result) => [
    result.case.id,
    result.repeat ?? 1,
    result.status,
    result.case.country,
    result.case.city,
    result.case.region,
    result.case.category,
    result.case.bbox,
    result.requestedLimit,
    result.requestedRelease ?? "",
    result.returnedCount,
    result.datasetReleases.join(";"),
    result.elapsedMs,
    result.metrics?.discoveryMs ?? "",
    result.metrics?.auditMs ?? "",
    result.metrics?.totalMs ?? "",
    result.sourceCoverage.website,
    result.sourceCoverage.phone,
    result.sourceCoverage.email,
    result.sourceCoverage.address,
    result.sourceCoverage.denominator,
    result.coverage.website,
    result.coverage.phone,
    result.coverage.email,
    result.coverage.address,
    result.coverage.denominator,
    result.metrics?.websites.length ?? "",
    result.metrics?.websites.filter((website) => website.status === "success").length ?? "",
    result.metrics?.websites.filter((website) => website.status === "blocked").length ?? "",
    result.metrics?.websites.filter((website) => website.status === "failed").length ?? "",
    result.error ?? "",
    result.metrics?.cache?.status ?? "not-recorded",
    result.metrics?.cache?.fetchedAt ?? ""
  ]);
  return `${[header, ...records].map((row) => row.map(escapeCsv).join(",")).join("\n")}\n`;
}

function renderSummaryMarkdown(summary: BenchmarkSummary, results: BenchmarkCaseResult[], packageVersion: string, timestamp: string): string {
  const duration = (item: Percentiles) => item.sampleSize === 0 ? "n/a (no successful timing samples)" : `p50 ${item.p50} ms, p95 ${item.p95} ms (n=${item.sampleSize})`;
  const coverage = (label: string, item: Percentage, denominator: number) => `${label}: ${item.percent === undefined ? "n/a (0 rows)" : `${item.count}/${denominator} (${item.percent}%)`}`;
  return [
    "# Free global discovery benchmark",
    "",
    `- Timestamp: ${timestamp}`,
    `- Package version: ${packageVersion}`,
    `- Node.js runtime: ${process.version} on ${process.platform}/${process.arch}`,
    `- Cases attempted: ${summary.counts.attempted}; succeeded: ${summary.counts.succeeded}; failed: ${summary.counts.failed}`,
    `- Returned rows (successful cases only): ${summary.counts.returned}`,
    `- Dataset releases returned: ${summary.datasetReleases.join(", ") || "none recorded"}`,
    "",
    "## Coverage",
    "",
    "### Source-only Overture rows",
    "",
    `- ${coverage("Website", summary.coverage.source.website, summary.coverage.source.denominator)}`,
    `- ${coverage("Phone", summary.coverage.source.phone, summary.coverage.source.denominator)}`,
    `- ${coverage("Email", summary.coverage.source.email, summary.coverage.source.denominator)}`,
    `- ${coverage("Address", summary.coverage.source.address, summary.coverage.source.denominator)}`,
    "",
    "### Post-website exported rows",
    "",
    `- ${coverage("Website", summary.coverage.postWebsite.website, summary.coverage.postWebsite.denominator)}`,
    `- ${coverage("Phone", summary.coverage.postWebsite.phone, summary.coverage.postWebsite.denominator)}`,
    `- ${coverage("Email", summary.coverage.postWebsite.email, summary.coverage.postWebsite.denominator)}`,
    `- ${coverage("Address", summary.coverage.postWebsite.address, summary.coverage.postWebsite.denominator)}`,
    "",
    "Counts show field presence, not recall, ownership, or contact correctness. Source and post-website denominators are reported separately.",
    "",
    "## Website retrieval outcomes",
    "",
    `- Attempts: ${summary.websiteOutcomes.attempted}; success: ${summary.websiteOutcomes.success}; blocked: ${summary.websiteOutcomes.blocked}; failed: ${summary.websiteOutcomes.failed}; other: ${summary.websiteOutcomes.other}`,
    "",
    "## Durations across successful, heterogeneous scenarios",
    "",
    `- Wall clock: ${duration(summary.durations.wallClockMs)}`,
    `- Discovery: ${duration(summary.durations.discoveryMs)}`,
    `- Enrichment and report generation: ${duration(summary.durations.enrichmentAndReportMs)}`,
    `- Runner total: ${duration(summary.durations.totalMs)}`,
    "",
    "These are descriptive samples, not load-test results or an SLA. Failed cases are retained in the case JSON and CSV, but excluded from duration percentiles.",
    "",
    "## Per-case results",
    "",
    "Cache-enabled runs can mix fresh and cached work. Compare per-case cache states when evaluating repeat-search speed; city-name lookup is excluded by this bounding-box matrix.",
    "",
    "| Case | Country | City / region | Category | Status | Cache | Requested release | Returned | Dataset release | Discovery ms | Enrichment + report ms | Runner total ms | Wall ms | Crawls (ok/blocked/failed) | Error |",
    "| --- | --- | --- | --- | --- | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | --- | --- |",
    ...results.map((result) => [
      result.case.id,
      result.case.country,
      `${result.case.city} / ${result.case.region}`,
      result.case.category,
      result.status,
      result.metrics?.cache?.status ?? "not-recorded",
      result.requestedRelease ?? "latest at request time",
      result.returnedCount,
      result.datasetReleases.join(", ") || "none recorded",
      result.metrics?.discoveryMs ?? "n/a",
      result.metrics?.auditMs ?? "n/a",
      result.metrics?.totalMs ?? "n/a",
      round(result.elapsedMs),
      `${result.metrics?.websites.filter((website) => website.status === "success").length ?? 0}/${result.metrics?.websites.filter((website) => website.status === "blocked").length ?? 0}/${result.metrics?.websites.filter((website) => website.status === "failed").length ?? 0}`,
      result.error ?? ""
    ].map(markdownCell).join(" | ").replace(/^/, "| ").concat(" |")),
    ...(summary.failures.length ? ["", "## Failures", "", ...summary.failures.map((failure) => `- ${failure.caseId}: ${failure.error} (${failure.elapsedMs} ms)`)] : []),
    ""
  ].join("\n");
}

function markdownCell(value: unknown): string {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

interface CommandLineOptions {
  outDir: string;
  cacheDir?: string;
  release?: string;
  limit: number;
  maxAudits: number;
  caseFilter?: string;
  repeats: number;
}

function parseArgs(argv: string[]): CommandLineOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (!option?.startsWith("--")) throw new Error(`Unknown argument: ${option}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
    values.set(option, value);
    index += 1;
  }
  const allowed = new Set(["--out-dir", "--release", "--limit", "--max-audits", "--case-filter", "--repeats", "--cache-dir"]);
  for (const option of values.keys()) if (!allowed.has(option)) throw new Error(`Unknown argument: ${option}`);
  const numeric = (option: string, fallback: number, minimum = 1): number => {
    const value = values.get(option);
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < minimum) throw new Error(`${option} must be an integer of at least ${minimum}`);
    return parsed;
  };
  const outDir = values.get("--out-dir");
  if (!outDir) throw new Error("--out-dir is required");
  return {
    outDir,
    cacheDir: values.get("--cache-dir"),
    release: values.get("--release"),
    limit: numeric("--limit", 10),
    maxAudits: numeric("--max-audits", 3, 0),
    caseFilter: values.get("--case-filter"),
    repeats: numeric("--repeats", 1)
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const timestamp = new Date().toISOString();
  const runDir = join(options.outDir, `run-${timestamp.replace(/[:.]/g, "-")}`);
  const filter = options.caseFilter?.trim().toLowerCase();
  const benchmarkCases = buildBenchmarkCases().filter((item) => !filter || [item.id, item.country, item.city, item.region, item.category].join(" ").toLowerCase().includes(filter));
  if (benchmarkCases.length === 0) throw new Error("--case-filter did not match any benchmark case");
  if (options.repeats > 1) process.stdout.write(`Explicit repeats requested: ${options.repeats}; this increases live discovery and audit cost.\n`);
  await mkdir(runDir, { recursive: true });
  const total = benchmarkCases.length * options.repeats;
  let completed = 0;
  const results = await runBenchmarkCases(benchmarkCases, {
    ...options,
    outDir: runDir,
    onResult: async (result) => {
      completed += 1;
      const caseDir = join(runDir, "cases", `${result.case.id}-run-${result.repeat ?? 1}`);
      await mkdir(caseDir, { recursive: true });
      await writeFile(join(caseDir, "case-result.json"), `${JSON.stringify({ timestamp: new Date().toISOString(), ...result }, null, 2)}\n`, "utf8");
      process.stdout.write(`[${completed}/${total}] ${result.case.id} ${result.status} (${round(result.elapsedMs)} ms)\n`);
    }
  });
  const packageVersion = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
  const summary = summarizeBenchmark(results);
  await writeFile(join(runDir, "benchmark-summary.json"), `${JSON.stringify({ timestamp, packageVersion: packageVersion.version, nodeVersion: process.version, platform: process.platform, arch: process.arch, options, summary, cases: results }, null, 2)}\n`, "utf8");
  await writeFile(join(runDir, "benchmark-cases.csv"), renderCasesCsv(results), "utf8");
  await writeFile(join(runDir, "benchmark-summary.md"), renderSummaryMarkdown(summary, results, packageVersion.version ?? "unknown", timestamp), "utf8");
  process.stdout.write(`Benchmark artifacts: ${runDir}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${errorMessage(error)}\n`);
    process.exitCode = 1;
  });
}
