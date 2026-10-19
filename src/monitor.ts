import { createHash } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import type { BatchInputEntry } from "./batch.js";
import { compareReports, readComparisonReport, renderComparisonHtml, renderComparisonMarkdown, renderComparisonPdf } from "./compare.js";
import { writeDashboard } from "./monitor-dashboard.js";
import { renderSiteHistory, type SiteHistoryRun } from "./monitor-history.js";
import { writeReportOutputs } from "./output.js";
import { escapeCell, overallScore, severityRank } from "./reporters.js";
import type { AuditComparison } from "./compare.js";
import type { AuditProfile, AuditReport, LighthouseSummary, ReportBrandConfig } from "./types.js";

export interface MonitorOptions {
  outDir: string;
  audit: (url: string, profile: AuditProfile) => Promise<AuditReport>;
  profile?: AuditProfile;
  brand?: ReportBrandConfig;
  now?: Date;
  // Runs Lighthouse for a site after its audit; a failure is noted on the site instead of failing it.
  lighthouse?: (url: string) => Promise<LighthouseSummary>;
}

export interface MonitorAlert {
  kind: "new-high" | "certificate" | "domain" | "failed" | "down";
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
  // A ready-to-edit monthly email for the client; it is never sent.
  emailPath?: string;
  // The site's history page across every run in the output folder.
  historyPath?: string;
  previousRunId?: string;
  score?: number;
  previousScore?: number;
  scoreChange?: number;
  // Lighthouse performance score when `lighthouse` is set, with the previous run's score when it had one.
  performance?: number;
  previousPerformance?: number;
  // Time to fetch the page HTML, with the previous run's time when it had one.
  responseTimeMs?: number;
  previousResponseTimeMs?: number;
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
  // The operator overview (index.html); missing when it could not be written.
  dashboardPath?: string;
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

export function currentAlerts(report: AuditReport): MonitorAlert[] {
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

function longDate(value: string | Date): string {
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function change(value: number): string {
  return value > 0 ? `up ${value}` : value < 0 ? `down ${-value}` : "no change";
}

export interface ClientEmailInput {
  entry: BatchInputEntry;
  report: AuditReport;
  runDate: Date;
  pdfFile: string;
  brand?: ReportBrandConfig;
  comparison?: AuditComparison;
  previousPerformance?: number;
  // True when an earlier run exists but could not be compared, such as after a profile change.
  newBaseline?: boolean;
}

// A plain-text draft the operator edits and sends from their own mailbox. Only facts from the audit go in.
export function renderClientEmail(input: ClientEmailInput): string {
  const { entry, report, comparison } = input;
  const name = entry.label ?? new URL(report.finalUrl).hostname.replace(/^www\./, "");
  const score = overallScore(report);
  const performance = report.lighthouse?.categories.performance;
  const titles = (findings: AuditReport["findings"]) => findings.map((finding) => `- ${finding.title}`);
  const evidence = (id: string) => report.findings.find((finding) => finding.id === id)?.evidence[0]?.value;
  const certificate = evidence("tls-certificate-valid");
  const domain = evidence("domain-expiry");
  const nextSteps = [...report.findings]
    .filter((finding) => finding.severity !== "info")
    .sort((left, right) => severityRank(left) - severityRank(right))
    .slice(0, 3)
    .map((finding, index) => `${index + 1}. ${finding.title}: ${finding.recommendation}`);

  return [
    "<!-- Draft written by Open Local Audit. Check each point on the live site before sending; nothing has been sent. -->",
    "",
    `Subject: Website check for ${name}, ${input.runDate.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}`,
    "",
    "Hi,",
    "",
    `Here is this month's check of ${report.finalUrl}.`,
    "",
    comparison
      ? `Overall score: ${score}/100, ${change(comparison.overall.change)} since the last check on ${longDate(comparison.beforeScannedAt)}.`
      : input.newBaseline
        ? `Overall score: ${score}/100. Monitoring starts again from this check, so next month's email will show what changed.`
        : `Overall score: ${score}/100. This is the first check, so next month's email will show what changed.`,
    ...(performance === undefined
      ? []
      : [
          `Page speed (Lighthouse performance): ${performance}/100${
            input.previousPerformance === undefined ? "" : `, ${change(performance - input.previousPerformance)} since the last check`
          }.`
        ]),
    ...(comparison
      ? comparison.fixed.length === 0 && comparison.introduced.length === 0
        ? ["", "No issues were fixed or newly found since the last check."]
        : [
            ...(comparison.fixed.length > 0 ? ["", "Fixed since the last check:", ...titles(comparison.fixed)] : []),
            ...(comparison.introduced.length > 0 ? ["", "New since the last check:", ...titles(comparison.introduced)] : [])
          ]
      : []),
    ...(certificate || domain
      ? ["", ...(certificate ? [`HTTPS certificate: ${certificate}`] : []), ...(domain ? [`Domain registration: ${domain}`] : [])]
      : []),
    ...(nextSteps.length > 0 ? ["", "What I recommend next:", ...nextSteps] : ["", "The checks found nothing that needs fixing right now."]),
    "",
    `The full report is attached (${input.pdfFile}).`,
    "",
    ...(input.brand?.signature
      ? [input.brand.signature]
      : ["Best regards,", ...(input.brand?.name ? [input.brand.name] : []), ...(input.brand?.contact ? [input.brand.contact] : [])]),
    ""
  ].join("\n");
}

// Rebuilds the site's history page from every readable run, including the one just written.
async function writeSiteHistory(siteDir: string, name: string, brand: ReportBrandConfig | undefined): Promise<string> {
  const runs: SiteHistoryRun[] = [];
  // "~" sorts after every run id, so this lists them all.
  for (const runId of (await previousRunIds(siteDir, "~")).reverse()) {
    try {
      runs.push({ runId, report: await readComparisonReport(join(siteDir, runId)) });
    } catch {
      continue;
    }
  }
  const path = join(siteDir, "history.html");
  await writeFile(path, renderSiteHistory(runs, { name, brand }));
  return path;
}

async function monitorSite(entry: BatchInputEntry, slug: string, runId: string, options: MonitorOptions): Promise<MonitorSiteResult> {
  const base = { url: entry.url, ...(entry.label ? { label: entry.label } : {}), slug, newFindings: 0, fixedFindings: 0 };
  const profile = entry.profile ?? options.profile ?? "generic";
  const siteDir = join(options.outDir, slug);
  const reportDir = join(siteDir, runId);
  const runDate = options.now ?? new Date();

  let report: AuditReport;
  try {
    report = await options.audit(entry.url, profile);
  } catch (error) {
    return { ...base, status: "failed", alerts: [{ kind: "failed", message: `Audit failed: ${message(error)}` }] };
  }
  let lighthouseNote: string | undefined;
  if (options.lighthouse) {
    try {
      report.lighthouse = await options.lighthouse(report.finalUrl);
      if (report.lighthouse.categories.performance === undefined) {
        lighthouseNote = "Lighthouse returned no performance score";
      }
    } catch (error) {
      lighthouseNote = `Lighthouse failed: ${message(error).replace(/^Lighthouse audit failed:\s*/i, "")}`;
    }
  }
  await writeReportOutputs(report, { format: "all", outDir: reportDir, brand: options.brand });
  const [reportPdf] = await writeReportOutputs(report, { format: "pdf", outDir: reportDir, brand: options.brand });
  const reportPdfPath = reportPdf.path;
  const emailPath = join(reportDir, "client-email.md");
  const performance = report.lighthouse?.categories.performance;

  const score = overallScore(report);
  const alerts = currentAlerts(report);
  const previous = await previousReport(siteDir, runId);
  let comparison: AuditComparison | undefined;
  let baselineNote = "First run: baseline recorded";
  if (previous) {
    try {
      comparison = compareReports(previous.report, report);
    } catch (error) {
      baselineNote = `Not compared with ${previous.runId}: ${message(error)}; new baseline recorded`;
    }
  }
  const previousPerformance = comparison ? previous?.report.lighthouse?.categories.performance : undefined;
  const speed = { ...(performance === undefined ? {} : { performance }), ...(previousPerformance === undefined ? {} : { previousPerformance }) };
  const previousResponseTimeMs = comparison ? previous?.report.responseTimeMs : undefined;
  const response = {
    ...(report.responseTimeMs === undefined ? {} : { responseTimeMs: report.responseTimeMs }),
    ...(previousResponseTimeMs === undefined ? {} : { previousResponseTimeMs })
  };
  // The history page is extra: if it cannot be written, the run still counts and the summary note says why.
  const history = async (): Promise<{ historyPath?: string; historyNote?: string }> => {
    try {
      return { historyPath: await writeSiteHistory(siteDir, entry.label ?? new URL(report.finalUrl).hostname.replace(/^www\./, ""), options.brand) };
    } catch (error) {
      return { historyNote: `History page not updated: ${message(error)}` };
    }
  };

  if (!comparison || !previous) {
    await writeFile(emailPath, renderClientEmail({ entry, report, runDate, pdfFile: basename(reportPdfPath ?? "open-local-audit-report.pdf"), brand: options.brand, newBaseline: Boolean(previous) }));
    const { historyPath, historyNote } = await history();
    const note = [baselineNote, lighthouseNote, historyNote].filter(Boolean).join("; ");
    return { ...base, status: "baseline", reportDir, pdfPath: reportPdfPath, emailPath, ...(historyPath ? { historyPath } : {}), score, ...speed, ...response, alerts, note };
  }

  const comparisonPath = join(reportDir, "comparison.html");
  await writeFile(join(reportDir, "comparison.md"), renderComparisonMarkdown(comparison, { brand: options.brand }));
  await writeFile(comparisonPath, renderComparisonHtml(comparison, { brand: options.brand }));
  const pdfPath = join(reportDir, "comparison.pdf");
  await writeFile(pdfPath, await renderComparisonPdf(comparison, { brand: options.brand }));
  await writeFile(
    emailPath,
    renderClientEmail({ entry, report, runDate, pdfFile: "comparison.pdf", brand: options.brand, comparison, previousPerformance })
  );
  const { historyPath, historyNote } = await history();
  const comparedNote = [lighthouseNote, historyNote].filter(Boolean).join("; ");
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
    emailPath,
    ...(historyPath ? { historyPath } : {}),
    previousRunId: previous.runId,
    score,
    previousScore: comparison.overall.before,
    scoreChange: comparison.overall.change,
    ...speed,
    ...response,
    newFindings: comparison.introduced.length,
    fixedFindings: comparison.fixed.length,
    alerts: [...newHigh, ...alerts],
    ...(comparedNote ? { note: comparedNote } : {})
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
  // The overview is a convenience, so a failure to write it never fails the run.
  try {
    summary.dashboardPath = await writeDashboard(options.outDir, options.brand);
  } catch {
    summary.dashboardPath = undefined;
  }
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
    pdfPath: site.pdfPath ? relativePath(summary, site.pdfPath) : undefined,
    emailPath: site.emailPath ? relativePath(summary, site.emailPath) : undefined,
    historyPath: site.historyPath ? relativePath(summary, site.historyPath) : undefined
  }));
  return `${JSON.stringify({ runId: summary.runId, sites }, null, 2)}\n`;
}

export function renderMonitorMarkdown(summary: MonitorSummary): string {
  const count = (status: MonitorSiteResult["status"]) => summary.sites.filter((site) => site.status === status).length;
  const attention = summary.sites.filter((site) => site.alerts.length > 0);
  const plural = (value: number, word: string) => `${value} ${word}${value === 1 ? "" : "s"}`;
  const signed = (value: number) => (value > 0 ? `+${value}` : `${value}`);
  // The speed column appears only when the run used Lighthouse.
  const showSpeed = summary.sites.some((site) => site.performance !== undefined);
  const showResponse = summary.sites.some((site) => site.responseTimeMs !== undefined);
  const responseTime = (site: MonitorSiteResult) =>
    site.responseTimeMs === undefined
      ? ""
      : `${site.responseTimeMs} ms${site.previousResponseTimeMs === undefined ? "" : ` (${signed(site.responseTimeMs - site.previousResponseTimeMs)})`}`;
  const speed = (site: MonitorSiteResult) =>
    site.performance === undefined
      ? ""
      : `${site.performance}/100${site.previousPerformance === undefined ? "" : ` (${signed(site.performance - site.previousPerformance)})`}`;
  const rows = summary.sites.map((site) => [
    siteName(site),
    site.status === "compared"
      ? `Compared with ${site.previousRunId}${site.note ? `; ${site.note}` : ""}`
      : site.status === "baseline"
        ? (site.note ?? "Baseline")
        : "Failed",
    site.score === undefined ? "" : `${site.score}/100`,
    site.scoreChange === undefined ? "" : signed(site.scoreChange),
    ...(showSpeed ? [speed(site)] : []),
    ...(showResponse ? [responseTime(site)] : []),
    site.status === "compared" ? `${site.newFindings}` : "",
    site.status === "compared" ? `${site.fixedFindings}` : "",
    relativePath(summary, site.comparisonPath ?? (site.reportDir ? join(site.reportDir, "open-local-audit-report.html") : undefined)),
    relativePath(summary, site.pdfPath),
    relativePath(summary, site.emailPath),
    relativePath(summary, site.historyPath)
  ]);
  const header = ["Site", "Status", "Score", "Change", ...(showSpeed ? ["Speed"] : []), ...(showResponse ? ["Response"] : []), "New", "Fixed", "Report", "Client PDF", "Email draft", "History"];

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
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`),
    "",
    "Reports, comparisons, and email drafts stay on this computer; nothing has been sent.",
    ""
  ].join("\n");
}
