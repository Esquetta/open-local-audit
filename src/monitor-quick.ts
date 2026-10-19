import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BatchInputEntry } from "./batch.js";
import { writeDashboard } from "./monitor-dashboard.js";
import { currentAlerts, monitorRunId, monitorSiteFolder, type MonitorAlert } from "./monitor.js";
import type { AuditReport, ReportBrandConfig } from "./types.js";

export interface QuickCheckOptions {
  // Usually quickCheckUrl: the page itself plus the certificate and domain, without a full audit.
  check: (url: string) => Promise<AuditReport>;
  now?: Date;
  // When set, the latest result is kept in quick-status.json there and the overview (index.html) is rebuilt.
  outDir?: string;
  brand?: ReportBrandConfig;
}

export interface QuickCheckSite {
  url: string;
  label?: string;
  status: "ok" | "alert";
  finalUrl?: string;
  statusCode?: number;
  responseTimeMs?: number;
  alerts: MonitorAlert[];
}

export interface QuickCheckSummary {
  runId: string;
  sites: QuickCheckSite[];
  dashboardPath?: string;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

// A daily check between monthly runs: it only reports whether each site loads and whether its certificate or domain
// needs attention. It writes no reports and leaves the monthly history alone.
export async function runQuickCheck(entries: BatchInputEntry[], options: QuickCheckOptions): Promise<QuickCheckSummary> {
  const seen = new Map<string, string>();
  for (const entry of entries) {
    const { identity } = monitorSiteFolder(entry.url);
    const earlier = seen.get(identity);
    if (earlier) {
      throw new Error(`Monitor input lists the same site twice: ${earlier} and ${entry.url}`);
    }
    seen.set(identity, entry.url);
  }

  const sites: QuickCheckSite[] = [];
  for (const entry of entries) {
    const base = { url: entry.url, ...(entry.label ? { label: entry.label } : {}) };
    let report: AuditReport;
    try {
      report = await options.check(entry.url);
    } catch (error) {
      sites.push({ ...base, status: "alert", alerts: [{ kind: "down", message: `Site did not load: ${message(error)}` }] });
      continue;
    }
    // A maintenance, parked, or for-sale page answers 200 but means the site is down. The full audit keeps only that
    // finding for such pages, so it also stands in for any certificate or domain problem behind it.
    const placeholder = report.findings.find((finding) => finding.id === "website-placeholder");
    const alerts: MonitorAlert[] = [
      ...(report.statusCode >= 200 && report.statusCode < 300 ? [] : [{ kind: "down" as const, message: `Site returned HTTP ${report.statusCode}` }]),
      ...(placeholder ? [{ kind: "down" as const, message: `Site shows a placeholder page: ${placeholder.evidence[0]?.value || placeholder.title}` }] : []),
      ...currentAlerts(report)
    ];
    sites.push({
      ...base,
      status: alerts.length > 0 ? "alert" : "ok",
      finalUrl: report.finalUrl,
      statusCode: report.statusCode,
      ...(report.responseTimeMs === undefined ? {} : { responseTimeMs: report.responseTimeMs }),
      alerts
    });
  }
  const summary: QuickCheckSummary = { runId: monitorRunId(options.now ?? new Date()), sites };
  if (options.outDir) {
    // Only the latest result is kept; the monthly history is left alone. Saving it is a convenience, so a locked or
    // read-only folder never hides the alerts this check found.
    try {
      await mkdir(options.outDir, { recursive: true });
      await writeFile(join(options.outDir, "quick-status.json"), `${JSON.stringify(summary, null, 2)}\n`);
      summary.dashboardPath = await writeDashboard(options.outDir, options.brand);
    } catch {
      summary.dashboardPath = undefined;
    }
  }
  return summary;
}

export function renderQuickCheck(summary: QuickCheckSummary): string {
  const attention = summary.sites.filter((site) => site.status === "alert").length;
  const plural = (value: number, word: string) => `${value} ${word}${value === 1 ? "" : "s"}`;
  const name = (site: QuickCheckSite) => (site.label ? `${site.label} (${site.url})` : site.url);
  return [
    `Quick check ${summary.runId}: ${plural(summary.sites.length, "site")}, ${
      attention === 0 ? "all fine" : `${plural(attention, "site")} need${attention === 1 ? "s" : ""} attention`
    }.`,
    ...summary.sites.map((site) =>
      site.status === "ok"
        ? `OK     ${name(site)}: HTTP ${site.statusCode}${site.responseTimeMs === undefined ? "" : ` in ${site.responseTimeMs} ms`}`
        : `ALERT  ${name(site)}: ${site.alerts.map((alert) => alert.message).join("; ")}`
    ),
    ""
  ].join("\n");
}
