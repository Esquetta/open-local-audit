import { createHash } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { BatchInputEntry } from "./batch.js";
import { compareReports, readComparisonReport, renderComparisonHtml, renderComparisonMarkdown, renderComparisonPdf } from "./compare.js";
import { writeReportOutputs } from "./output.js";
import { escapeCell, overallScore } from "./reporters.js";
import type { AuditProfile, AuditReport, ReportBrandConfig } from "./types.js";

export interface MonitorOptions {
  outDir: string;
  audit: (url: string, profile: AuditProfile) => Promise<AuditReport>;
  profile?: AuditProfile;
  brand?: ReportBrandConfig;
  now?: Date;
}

export interface MonitorAlert {
  kind: "new-high" | "certificate" | "domain" | "failed";
  message: string;
}

export interface MonitorSiteResult {
  url: string;
  label?: string;
  slug: string;
  status: "compared" | "baseline" | "failed";
  reportDir?: string;
  comparisonPath?: string;
  // The file to send the client: comparison.pdf after a comparison, otherwise the run's report PDF.
  pdfPath?: string;
  previousRunId?: string;
  score?: number;
  previousScore?: number;
  scoreChange?: number;
  newFindings: number;
  fixedFindings: number;
  alerts: MonitorAlert[];
  note?: string;
}

export interface MonitorSummary {
  runId: string;
  outDir: string;
  sites: MonitorSiteResult[];
  summaryPaths: { markdown: string; json: string };
}

// Run folders are named by UTC time, so sorting their names sorts them by date.
// v0.80.0 named runs to the second; later versions add milliseconds so that a retried run never reuses a folder.
const runIdPattern = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:-\d{3})?Z$/;

// A site is its host (without "www.") plus any port, path, and query; the scheme does not matter. Host names are
// already safe folder names, so different hosts never share a folder, and a path or query adds a short hash of
// itself so that "/a/b" and "/a-b" stay apart. The folder is the same on every run, which keeps the history together.
export function monitorSiteFolder(rawUrl: string): { identity: string; folder: string } {
  const url = new URL(rawUrl);
  const host = url.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  const rest = `${url.pathname.replace(/\/+$/, "")}${url.search}`;
  const identity = `${host}${url.port ? `:${url.port}` : ""}${rest}`;
  const readable = rest.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const folder = `${host.replace(/[^a-z0-9.-]/g, "-")}${url.port ? `-${url.port}` : ""}${
    rest ? `_${readable ? `${readable}-` : ""}${createHash("sha256").update(rest).digest("hex").slice(0, 8)}` : ""
  }`;
  return { identity, folder };
}

export function monitorRunId(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function previousRunIds(siteDir: string, runId: string): Promise<string[]> {
  try {
    const entries = await readdir(siteDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && runIdPattern.test(entry.name) && entry.name < runId)
      .map((entry) => entry.name)
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function currentAlerts(report: AuditReport): MonitorAlert[] {
  const alerts: Array<[MonitorAlert["kind"], string, string]> = [
    ["certificate", "tls-certificate-valid", "HTTPS certificate"],
    ["domain", "domain-expiry", "Domain"]
  ];
  return alerts.flatMap(([kind, id, label]) => {
    const finding = report.findings.find((item) => item.id === id);
    return finding ? [{ kind, message: `${label}: ${finding.evidence[0]?.value || finding.title}` }] : [];
  });
}

// Uses the newest earlier run that still has a readable report, so an interrupted run does not reset the history.
async function previousReport(siteDir: string, runId: string): Promise<{ runId: string; report: AuditReport } | undefined> {
  for (const previousRunId of await previousRunIds(siteDir, runId)) {
    try {
      return { runId: previousRunId, report: await readComparisonReport(join(siteDir, previousRunId)) };
    } catch {
      continue;
    }
  }
  return undefined;
}

async function monitorSite(entry: BatchInputEntry, slug: string, runId: string, options: MonitorOptions): Promise<MonitorSiteResult> {
  const base = { url: entry.url, ...(entry.label ? { label: entry.label } : {}), slug, newFindings: 0, fixedFindings: 0 };
  const profile = entry.profile ?? options.profile ?? "generic";
  const siteDir = join(options.outDir, slug);
  const reportDir = join(siteDir, runId);

  let report: AuditReport;
  try {
    report = await options.audit(entry.url, profile);
  } catch (error) {
    return { ...base, status: "failed", alerts: [{ kind: "failed", message: `Audit failed: ${message(error)}` }] };
  }
  await writeReportOutputs(report, { format: "all", outDir: reportDir, brand: options.brand });
  const [reportPdf] = await writeReportOutputs(report, { format: "pdf", outDir: reportDir, brand: options.brand });
  const reportPdfPath = reportPdf.path;

  const score = overallScore(report);
  const alerts = currentAlerts(report);
  const previous = await previousReport(siteDir, runId);
  if (!previous) {
    return { ...base, status: "baseline", reportDir, pdfPath: reportPdfPath, score, alerts, note: "First run: baseline recorded" };
  }

  const previousRunId = previous.runId;
  let comparison: ReturnType<typeof compareReports>;
  try {
    comparison = compareReports(previous.report, report);
  } catch (error) {
    return { ...base, status: "baseline", reportDir, pdfPath: reportPdfPath, score, alerts, note: `Not compared with ${previousRunId}: ${message(error)}; new baseline recorded` };
  }

  const comparisonPath = join(reportDir, "comparison.html");
  await writeFile(join(reportDir, "comparison.md"), renderComparisonMarkdown(comparison, { brand: options.brand }));
  await writeFile(comparisonPath, renderComparisonHtml(comparison, { brand: options.brand }));
  const pdfPath = join(reportDir, "comparison.pdf");
  await writeFile(pdfPath, await renderComparisonPdf(comparison, { brand: options.brand }));
  // Certificate and domain problems already have their own alert on every run.
  const newHigh = comparison.introduced
    .filter((finding) => finding.severity === "high" && !["tls-certificate-valid", "domain-expiry"].includes(finding.id))
    .map((finding) => ({ kind: "new-high" as const, message: `New high issue: ${finding.title}` }));
  return {
    ...base,
    status: "compared",
    reportDir,
    comparisonPath,
    pdfPath,
    previousRunId,
    score,
    previousScore: comparison.overall.before,
    scoreChange: comparison.overall.change,
    newFindings: comparison.introduced.length,
    fixedFindings: comparison.fixed.length,
    alerts: [...newHigh, ...alerts]
  };
}

// Re-audits every site, compares each one with its latest earlier run in the same output folder, and writes a summary.
// Nothing is sent: the summary and reports stay on disk for the operator.
export async function runMonitor(entries: BatchInputEntry[], options: MonitorOptions): Promise<MonitorSummary> {
  const sitesByIdentity = new Map<string, string>();
  const slugs = entries.map((entry) => {
    const site = monitorSiteFolder(entry.url);
    const earlier = sitesByIdentity.get(site.identity);
    if (earlier) {
      throw new Error(`Monitor input lists the same site twice: ${earlier} and ${entry.url}`);
    }
    sitesByIdentity.set(site.identity, entry.url);
    return site.folder;
  });

  const runId = monitorRunId(options.now ?? new Date());
  const sites: MonitorSiteResult[] = [];
  for (const [index, entry] of entries.entries()) {
    try {
      sites.push(await monitorSite(entry, slugs[index], runId, options));
    } catch (error) {
      // A report that cannot be written for one site, such as a locked file, should not stop the other sites.
      sites.push({
        url: entry.url,
        ...(entry.label ? { label: entry.label } : {}),
        slug: slugs[index],
        status: "failed",
        newFindings: 0,
        fixedFindings: 0,
        alerts: [{ kind: "failed", message: `Could not save the run: ${message(error)}` }]
      });
    }
  }

  await mkdir(options.outDir, { recursive: true });
  const summaryPaths = {
    markdown: join(options.outDir, `monitor-summary-${runId}.md`),
    json: join(options.outDir, `monitor-summary-${runId}.json`)
  };
  const summary: MonitorSummary = { runId, outDir: options.outDir, sites, summaryPaths };
  await writeFile(summaryPaths.markdown, renderMonitorMarkdown(summary));
  await writeFile(summaryPaths.json, renderMonitorJson(summary));
  return summary;
}

function relativePath(summary: MonitorSummary, path: string | undefined): string {
  return path ? relative(summary.outDir, path).split(sep).join("/") : "";
}

function siteName(site: MonitorSiteResult): string {
  return site.label ? `${site.label} (${site.url})` : site.url;
}

export function renderMonitorJson(summary: MonitorSummary): string {
  const sites = summary.sites.map((site) => ({
    ...site,
    reportDir: site.reportDir ? relativePath(summary, site.reportDir) : undefined,
    comparisonPath: site.comparisonPath ? relativePath(summary, site.comparisonPath) : undefined,
    pdfPath: site.pdfPath ? relativePath(summary, site.pdfPath) : undefined
  }));
  return `${JSON.stringify({ runId: summary.runId, sites }, null, 2)}\n`;
}

export function renderMonitorMarkdown(summary: MonitorSummary): string {
  const count = (status: MonitorSiteResult["status"]) => summary.sites.filter((site) => site.status === status).length;
  const attention = summary.sites.filter((site) => site.alerts.length > 0);
  const plural = (value: number, word: string) => `${value} ${word}${value === 1 ? "" : "s"}`;
  const signed = (value: number) => (value > 0 ? `+${value}` : `${value}`);
  const rows = summary.sites.map((site) => [
    siteName(site),
    site.status === "compared" ? `Compared with ${site.previousRunId}` : site.status === "baseline" ? (site.note ?? "Baseline") : "Failed",
    site.score === undefined ? "" : `${site.score}/100`,
    site.scoreChange === undefined ? "" : signed(site.scoreChange),
    site.status === "compared" ? `${site.newFindings}` : "",
    site.status === "compared" ? `${site.fixedFindings}` : "",
    relativePath(summary, site.comparisonPath ?? (site.reportDir ? join(site.reportDir, "open-local-audit-report.html") : undefined)),
    relativePath(summary, site.pdfPath)
  ]);

  return [
    "# Website Monitoring Summary",
    "",
    `Run ${summary.runId}: ${plural(summary.sites.length, "site")}, ${count("compared")} compared, ${count("baseline")} baseline, ${count("failed")} failed. ${
      attention.length === 0 ? "No site needs attention." : `${plural(attention.length, "site")} need${attention.length === 1 ? "s" : ""} attention.`
    }`,
    "",
    "## Needs Attention",
    "",
    ...(attention.length === 0
      ? ["Nothing new to act on."]
      : attention.map((site) => `- **${siteName(site)}**: ${site.alerts.map((alert) => alert.message).join("; ")}`)),
    "",
    "## Sites",
    "",
    "| Site | Status | Score | Change | New | Fixed | Report | Client PDF |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`),
    "",
    "Reports and comparisons stay on this computer; nothing has been sent.",
    ""
  ].join("\n");
}
