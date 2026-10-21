import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { escapeHtml } from "./reporters.js";
import type { MonitorAlert } from "./monitor.js";
import {
  localDay,
  readQuickHistory,
  readWorkLog,
  runIdDate,
  siteAvailability,
  siteIdentity,
  siteWork,
  workLogFile,
  workTotal,
  type WorkLogEntry
} from "./monitor-service.js";
import type { ReportBrandConfig } from "./types.js";

// The rows the dashboard needs from the monthly summary JSON and quick-status.json. Both files are read back from
// disk, so every field is treated as possibly missing.
interface MonthlySite {
  url?: unknown;
  label?: unknown;
  status?: unknown;
  score?: unknown;
  scoreChange?: unknown;
  alerts?: unknown;
  historyPath?: unknown;
  pdfPath?: unknown;
  emailPath?: unknown;
  emlPath?: unknown;
  includedMinutes?: unknown;
}

interface QuickSite {
  url?: unknown;
  label?: unknown;
  status?: unknown;
  statusCode?: unknown;
  responseTimeMs?: unknown;
  includedMinutes?: unknown;
  alerts?: unknown;
}

export interface DashboardInput {
  monthly?: { runId?: unknown; sites?: unknown };
  quick?: { runId?: unknown; sites?: unknown };
  // Every daily check so far (quick-history.jsonl) and the work log, with the number of work log rows it could not read.
  quickHistory?: Awaited<ReturnType<typeof readQuickHistory>>;
  workLog?: WorkLogEntry[];
  workLogErrors?: number;
  brand?: ReportBrandConfig;
}

function runDate(runId: unknown): string | undefined {
  const date = runIdDate(runId);
  if (!date) {
    return undefined;
  }
  return `${date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}, ${date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit"
  })}`;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : undefined;
}

// Kinds that the daily check also reports. Their messages carry a day count, so the newer daily result replaces them.
const dailyKinds = new Set(["certificate", "domain", "down"]);

function alerts(value: unknown, skipDailyKinds = false): string[] {
  return Array.isArray(value)
    ? value.flatMap((alert: Partial<MonitorAlert> | null) =>
        alert && typeof alert.message === "string" && !(skipDailyKinds && dailyKinds.has(String(alert.kind))) ? [alert.message] : []
      )
    : [];
}

function sites<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value.filter((site) => site && typeof site === "object") as T[]) : [];
}

// Matches the identity monitor uses for its folders, so the same site lines up in both files.
const siteKey = siteIdentity;

const dayMs = 24 * 60 * 60 * 1000;

// Only relative paths inside the output folder become links, so a hand-edited file cannot add a script or remote URL.
function link(path: unknown, label: string): string {
  if (typeof path !== "string" || !path || /^[a-z][a-z0-9+.-]*:/i.test(path) || /^[\\/]/.test(path) || path.split(/[\\/]/).includes("..")) {
    return "";
  }
  try {
    return `<a href="${escapeHtml(encodeURI(path))}">${label}</a>`;
  } catch {
    return "";
  }
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

// One page for the operator: every client with the latest monthly score, the latest daily check, open alerts, and
// links to the files to send. It is rebuilt after every monthly run and every quick check.
export function renderDashboard(input: DashboardInput): string {
  const monthly = sites<MonthlySite>(input.monthly?.sites);
  const quick = sites<QuickSite>(input.quick?.sites);
  const quickByKey = new Map(quick.map((site) => [siteKey(text(site.url)), site]));
  const keys = [...new Set([...monthly.map((site) => siteKey(text(site.url))), ...quick.map((site) => siteKey(text(site.url)))])];
  const monthlyByKey = new Map(monthly.map((site) => [siteKey(text(site.url)), site]));
  // Uptime covers the 30 days up to the latest daily check; work counts from the day of the latest monthly run, which
  // is what the next monthly email will list.
  const uptimeEnd = runIdDate(input.quick?.runId);
  const monthlyRun = runIdDate(input.monthly?.runId);
  const workSince = monthlyRun ? localDay(monthlyRun) : "0000-00-00";

  const rows = keys.map((key) => {
    const month = monthlyByKey.get(key);
    const day = quickByKey.get(key);
    const url = text(month?.url) || text(day?.url);
    const label = text(month?.label) || text(day?.label);
    const score = count(month?.score);
    const change = count(month?.scoreChange);
    // When there is a daily result, it is the current word on whether the site loads and on its certificate and domain;
    // the monthly run's alerts of those kinds are older and are left out.
    const messages = [...new Set([...alerts(month?.alerts, Boolean(day)), ...alerts(day?.alerts)])];
    const statusCode = count(day?.statusCode);
    const responseTime = count(day?.responseTimeMs);
    const loaded = statusCode === undefined ? "" : `HTTP ${statusCode}${responseTime === undefined ? "" : ` in ${responseTime} ms`}`;
    const daily = !day ? "Not checked" : day.status === "ok" ? (loaded ? `OK, ${loaded}` : "OK") : loaded ? `Alert, ${loaded}` : "Did not load";
    const availability = uptimeEnd ? siteAvailability(input.quickHistory ?? [], url, new Date(uptimeEnd.getTime() - 30 * dayMs), uptimeEnd) : undefined;
    const work = siteWork(input.workLog ?? [], url, workSince, undefined, count(day?.includedMinutes) ?? count(month?.includedMinutes));
    if (work?.includedMinutes !== undefined && work.minutes > work.includedMinutes) {
      messages.push(workTotal(work));
    }
    return {
      attention: messages.length > 0 || month?.status === "failed",
      html: `<tr>
          <th scope="row">${escapeHtml(label || url)}${label ? `<div class="url">${escapeHtml(url)}</div>` : ""}</th>
          <td>${messages.length > 0 || month?.status === "failed" ? '<span class="chip warn">⚠ Needs attention</span>' : '<span class="chip ok">✓ OK</span>'}</td>
          <td>${score === undefined ? "–" : `${score}/100${change === undefined ? "" : ` <span class="muted">(${signed(change)})</span>`}`}</td>
          <td>${escapeHtml(daily)}</td>
          <td>${availability ? `${Math.floor((availability.up / availability.checks) * 100)}% <span class="muted">(${availability.up}/${availability.checks})</span>` : '<span class="muted">–</span>'}</td>
          <td>${work ? `${work.minutes}${work.includedMinutes === undefined ? "" : ` of ${work.includedMinutes}`} min` : '<span class="muted">–</span>'}</td>
          <td>${messages.length > 0 ? `<ul>${messages.map((message) => `<li>${escapeHtml(message)}</li>`).join("")}</ul>` : '<span class="muted">None</span>'}</td>
          <td class="links">${[link(month?.historyPath, "History"), link(month?.pdfPath, "PDF"), link(month?.emailPath, "Email draft"), link(month?.emlPath, "Mail (.eml)")].filter(Boolean).join(" · ") || '<span class="muted">–</span>'}</td>
        </tr>`
    };
  });
  // Sites that need attention come first; otherwise the input order is kept.
  const ordered = [...rows.filter((row) => row.attention), ...rows.filter((row) => !row.attention)];
  const attention = rows.filter((row) => row.attention).length;
  const monthlyDate = runDate(input.monthly?.runId);
  const quickDate = runDate(input.quick?.runId);
  const brandName = input.brand?.name ?? "Open Local Audit";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Client overview</title>
    <style>
      :root { color-scheme: light; --plane: #f9f9f7; --surface: #fcfcfb; --ink: #0b0b0b; --ink-2: #52514e; --muted: #6b6a65; --line: #e1e0d9; --border: rgba(11,11,11,0.10); --ok: #006300; --warn: #8a5300; --warn-bg: #fff4dc; --ok-bg: #e7f5e7; }
      @media (prefers-color-scheme: dark) {
        :root:where(:not([data-theme="light"])) { color-scheme: dark; --plane: #0d0d0d; --surface: #1a1a19; --ink: #f0efec; --ink-2: #c3c2b7; --muted: #a3a29b; --line: #2c2c2a; --border: rgba(255,255,255,0.10); --ok: #0ca30c; --warn: #f0b23c; --warn-bg: #33270f; --ok-bg: #12301a; }
      }
      :root[data-theme="dark"] { color-scheme: dark; --plane: #0d0d0d; --surface: #1a1a19; --ink: #f0efec; --ink-2: #c3c2b7; --muted: #a3a29b; --line: #2c2c2a; --border: rgba(255,255,255,0.10); --ok: #0ca30c; --warn: #f0b23c; --warn-bg: #33270f; --ok-bg: #12301a; }
      body { margin: 0; background: var(--plane); color: var(--ink); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
      main { max-width: 1100px; margin: 0 auto; padding: 32px 16px; }
      h1 { margin: 0 0 4px; font-size: 1.5rem; overflow-wrap: anywhere; }
      .meta, .muted, .url { color: var(--muted); }
      .url { font-size: 0.8rem; font-weight: 400; overflow-wrap: anywhere; }
      .table-wrap { overflow-x: auto; margin-top: 20px; }
      table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; }
      th, td { text-align: left; vertical-align: top; padding: 10px 12px; border-bottom: 1px solid var(--line); font-size: 0.9rem; }
      thead th { color: var(--ink-2); font-weight: 600; white-space: nowrap; }
      ul { margin: 0; padding-left: 18px; }
      .chip { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 0.8rem; font-weight: 600; white-space: nowrap; }
      .chip.ok { color: var(--ok); background: var(--ok-bg); }
      .chip.warn, .notice { color: var(--warn); background: var(--warn-bg); }
      .notice { margin: 12px 0 0; padding: 8px 12px; border-radius: 8px; font-size: 0.9rem; font-weight: 600; overflow-wrap: anywhere; }
      .links { white-space: nowrap; }
      a { color: inherit; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(brandName)} client overview</h1>
      <p class="meta">${rows.length} client${rows.length === 1 ? "" : "s"}, ${attention === 0 ? "none need attention" : `${attention} need${attention === 1 ? "s" : ""} attention`}. Last monthly check: ${escapeHtml(monthlyDate ?? "none yet")}. Last daily check: ${escapeHtml(quickDate ?? "none yet")}.</p>${
        input.workLogErrors
          ? `\n      <p class="notice">${workLogFile} has ${input.workLogErrors} problem${input.workLogErrors === 1 ? "" : "s"}; the next monthly run stops until ${input.workLogErrors === 1 ? "it is" : "they are"} fixed.</p>`
          : ""
      }
      <div class="table-wrap">
        <table>
          <thead><tr><th scope="col">Client</th><th scope="col">Status</th><th scope="col">Score</th><th scope="col">Daily check</th><th scope="col">Uptime, 30 days</th><th scope="col">Work since report</th><th scope="col">Alerts</th><th scope="col">Files</th></tr></thead>
          <tbody>${ordered.map((row) => row.html).join("")}</tbody>
        </table>
      </div>
    </main>
  </body>
</html>
`;
}

async function readJson(path: string): Promise<{ runId?: unknown; sites?: unknown } | undefined> {
  try {
    return JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, "")) as { runId?: unknown; sites?: unknown };
  } catch {
    return undefined;
  }
}

// Rebuilds index.html in the output folder from the newest monthly summary and the latest quick check.
export async function writeDashboard(outDir: string, brand?: ReportBrandConfig): Promise<string> {
  let names: string[] = [];
  try {
    names = await readdir(outDir);
  } catch {
    names = [];
  }
  const newestSummary = names
    .filter((name) => /^monitor-summary-.+\.json$/.test(name))
    .sort()
    .at(-1);
  const path = join(outDir, "index.html");
  const workLog = await readWorkLog(outDir).catch(() => ({ entries: [], errors: [] }));
  await writeFile(
    path,
    renderDashboard({
      monthly: newestSummary ? await readJson(join(outDir, newestSummary)) : undefined,
      quick: await readJson(join(outDir, "quick-status.json")),
      quickHistory: await readQuickHistory(outDir),
      workLog: workLog.entries,
      workLogErrors: workLog.errors.length,
      brand
    })
  );
  return path;
}
