import { compareReports } from "./compare.js";
import { escapeHtml, overallScore } from "./reporters.js";
import type { AuditReport, ReportBrandConfig } from "./types.js";

// Pass runs oldest first; the chart and the fixed/new lists follow the array order.
export interface SiteHistoryRun {
  runId: string;
  report: AuditReport;
}

export interface SiteHistoryOptions {
  name: string;
  brand?: ReportBrandConfig;
}

interface HistoryRow {
  date: string;
  shortDate: string;
  score: number;
  performance?: number;
  responseTimeMs?: number;
  high: number;
  medium: number;
  low: number;
  fixed: string[];
  added: string[];
  // "First check" or "New baseline" when the run could not be compared with the one before it.
  baseline?: string;
  certificate?: string;
  domain?: string;
}

function evidence(report: AuditReport, id: string): string | undefined {
  const finding = report.findings.find((item) => item.id === id);
  return finding ? finding.evidence[0]?.value || finding.title : undefined;
}

// Values read back from older report files are coerced, so the page only ever prints numbers.
function wholeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : undefined;
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}`;
}

function historyRows(runs: SiteHistoryRun[]): HistoryRow[] {
  const dates = runs.map(({ report }) => new Date(report.scannedAt));
  const sharedMonth = new Set(dates.map(monthKey)).size < dates.length;
  const manyYears = new Set(dates.map((date) => date.getFullYear())).size > 1;
  return runs.map(({ report }, index) => {
    const previous = runs[index - 1]?.report;
    // The same rules as the monitoring comparison: a changed host, profile, or order starts a new baseline.
    let comparison: ReturnType<typeof compareReports> | undefined;
    try {
      comparison = previous ? compareReports(previous, report) : undefined;
    } catch {
      comparison = undefined;
    }
    const severity = (level: string) => report.findings.filter((finding) => finding.severity === level).length;
    const date = dates[index];
    return {
      date: date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
      // Label by month unless two runs share a month; add the year to day labels when the runs span years.
      shortDate: date.toLocaleDateString(
        "en-GB",
        sharedMonth ? { day: "numeric", month: "short", ...(manyYears ? { year: "2-digit" } : {}) } : { month: "short", year: "numeric" }
      ),
      score: overallScore(report),
      ...(wholeNumber(report.lighthouse?.categories?.performance) === undefined
        ? {}
        : { performance: wholeNumber(report.lighthouse?.categories?.performance) }),
      ...(wholeNumber(report.responseTimeMs) === undefined ? {} : { responseTimeMs: wholeNumber(report.responseTimeMs) }),
      high: severity("high"),
      medium: severity("medium"),
      low: severity("low"),
      fixed: comparison ? comparison.fixed.map((finding) => finding.title) : [],
      added: comparison ? comparison.introduced.map((finding) => finding.title) : [],
      ...(comparison ? {} : { baseline: previous ? "New baseline" : "First check" }),
      ...(evidence(report, "tls-certificate-valid") ? { certificate: evidence(report, "tls-certificate-valid") } : {}),
      ...(evidence(report, "domain-expiry") ? { domain: evidence(report, "domain-expiry") } : {})
    };
  });
}

const width = 640;
const height = 240;
const plot = { left: 40, right: 96, top: 16, bottom: 32 };

function chart(rows: HistoryRow[]): string {
  const showSpeed = rows.some((row) => row.performance !== undefined);
  const plotWidth = width - plot.left - plot.right;
  const plotHeight = height - plot.top - plot.bottom;
  const x = (index: number) => plot.left + (rows.length === 1 ? plotWidth / 2 : (index * plotWidth) / (rows.length - 1));
  const y = (value: number) => plot.top + plotHeight - (value / 100) * plotHeight;
  const grid = [0, 25, 50, 75, 100]
    .map(
      (value) =>
        `<line class="grid" x1="${plot.left}" x2="${width - plot.right}" y1="${y(value)}" y2="${y(value)}"/><text class="axis" x="${plot.left - 8}" y="${y(value) + 4}" text-anchor="end">${value}</text>`
    )
    .join("");
  // Count labels back from the newest check so it is always labelled and the spacing stays even.
  const labelEvery = Math.max(1, Math.ceil(rows.length / 8));
  const xLabels = rows
    .map((row, index) =>
      (rows.length - 1 - index) % labelEvery === 0
        ? `<text class="axis" x="${x(index)}" y="${height - 10}" text-anchor="middle">${escapeHtml(row.shortDate)}</text>`
        : ""
    )
    .join("");

  type Point = { index: number; value: number };
  const pointsFor = (key: "score" | "performance"): Point[] =>
    rows.flatMap((row, index) => (row[key] === undefined ? [] : [{ index, value: row[key] as number }]));
  // A run without a value breaks the line, so no line implies data that does not exist.
  const segments = (points: Point[]): Point[][] =>
    points.reduce<Point[][]>((all, point) => {
      const current = all[all.length - 1];
      if (current && current[current.length - 1].index === point.index - 1) {
        current.push(point);
      } else {
        all.push([point]);
      }
      return all;
    }, []);
  const scorePoints = pointsFor("score");
  const speedPoints = showSpeed ? pointsFor("performance") : [];
  // End labels sit at the newest check; when both are close, they are pushed apart so they never overlap.
  const labels = [
    { label: "Score", points: scorePoints },
    { label: "Speed", points: speedPoints }
  ].flatMap(({ label, points }) => {
    const last = points[points.length - 1];
    return last && last.index === rows.length - 1 ? [{ text: `${label} ${last.value}`, y: y(last.value) + 4 }] : [];
  });
  if (labels.length === 2 && Math.abs(labels[0].y - labels[1].y) < 14) {
    const [upper, lower] = labels[0].y <= labels[1].y ? [labels[0], labels[1]] : [labels[1], labels[0]];
    const middle = (upper.y + lower.y) / 2;
    upper.y = middle - 7;
    lower.y = middle + 7;
  }
  const series = (points: Point[], css: string) =>
    [
      ...segments(points)
        .filter((segment) => segment.length > 1)
        .map((segment) => `<polyline class="line ${css}" points="${segment.map((point) => `${x(point.index)},${y(point.value)}`).join(" ")}"/>`),
      ...points.map((point) => `<circle class="dot ${css}" cx="${x(point.index)}" cy="${y(point.value)}" r="5"/>`)
    ].join("");
  const endLabels = labels
    .map((label) => `<text class="end-label" x="${x(rows.length - 1) + 10}" y="${label.y}">${escapeHtml(label.text)}</text>`)
    .join("");

  return `<figure class="chart">
      <figcaption>${showSpeed ? "Overall score and page speed" : "Overall score"} out of 100, by check</figcaption>
      ${
        showSpeed
          ? '<div class="legend"><span><i class="key score"></i>Overall score</span><span><i class="key speed"></i>Page speed (Lighthouse performance)</span></div>'
          : ""
      }
      <div class="plot">
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${showSpeed ? "Overall score and page speed" : "Overall score"} for each check; the table below lists every value">
          ${grid}${xLabels}
          <line class="crosshair" x1="0" x2="0" y1="${plot.top}" y2="${plot.top + plotHeight}" visibility="hidden"/>
          ${series(scorePoints, "score")}${series(speedPoints, "speed")}${endLabels}
          <rect class="hit" x="${plot.left}" y="${plot.top}" width="${plotWidth}" height="${plotHeight}"/>
        </svg>
        <div class="tooltip" role="status" hidden></div>
      </div>
    </figure>`;
}

function list(items: string[]): string {
  return items.length === 0 ? "" : `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

// A self-contained page that shows every monitoring run of one site, newest last in the chart and first in the table.
export function renderSiteHistory(runs: SiteHistoryRun[], options: SiteHistoryOptions): string {
  const rows = historyRows(runs);
  const showSpeed = rows.some((row) => row.performance !== undefined);
  const showResponse = rows.some((row) => row.responseTimeMs !== undefined);
  const brandName = options.brand?.name ?? "Open Local Audit";
  const accent = options.brand?.primaryColor ?? "#145a73";
  const data = rows.map((row) => ({ date: row.date, score: row.score, performance: row.performance ?? null }));
  const tableRows = [...rows]
    .reverse()
    .map(
      (row) => `<tr>
          <th scope="row">${escapeHtml(row.date)}</th>
          <td>${row.score}/100</td>
          ${showSpeed ? `<td>${row.performance === undefined ? "–" : `${row.performance}/100`}</td>` : ""}
          ${showResponse ? `<td>${row.responseTimeMs === undefined ? "–" : `${row.responseTimeMs} ms`}</td>` : ""}
          <td>${row.high} high, ${row.medium} medium, ${row.low} low</td>
          <td>${row.baseline ? escapeHtml(row.baseline) : `${list(row.fixed.map((title) => `Fixed: ${title}`))}${list(row.added.map((title) => `New: ${title}`))}` || "No change"}${
            row.certificate ? `<p class="flag">HTTPS certificate: ${escapeHtml(row.certificate)}</p>` : ""
          }${row.domain ? `<p class="flag">Domain registration: ${escapeHtml(row.domain)}</p>` : ""}</td>
        </tr>`
    )
    .join("");
  const footer = [options.brand?.footerText, options.brand?.contact].filter(Boolean).join(" | ");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(options.name)} website history</title>
    <style>
      :root { color-scheme: light; --surface: #fcfcfb; --plane: #f9f9f7; --ink: #0b0b0b; --ink-2: #52514e; --muted: #6b6a65; --grid: #e1e0d9; --border: rgba(11,11,11,0.10); --score: #2a78d6; --speed: #eb6834; --accent: ${escapeHtml(accent)}; --eyebrow: var(--accent); }
      @media (prefers-color-scheme: dark) {
        :root:where(:not([data-theme="light"])) { color-scheme: dark; --surface: #1a1a19; --plane: #0d0d0d; --ink: #f0efec; --ink-2: #c3c2b7; --muted: #898781; --grid: #2c2c2a; --border: rgba(255,255,255,0.10); --score: #3987e5; --speed: #d95926; --eyebrow: var(--ink-2); }
      }
      :root[data-theme="dark"] { color-scheme: dark; --surface: #1a1a19; --plane: #0d0d0d; --ink: #f0efec; --ink-2: #c3c2b7; --muted: #898781; --grid: #2c2c2a; --border: rgba(255,255,255,0.10); --score: #3987e5; --speed: #d95926; --eyebrow: var(--ink-2); }
      body { margin: 0; background: var(--plane); color: var(--ink); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
      main { max-width: 860px; margin: 0 auto; padding: 32px 16px; }
      .eyebrow { color: var(--eyebrow); font-size: 0.78rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; margin: 0; }
      h1 { margin: 4px 0 4px; font-size: 1.6rem; overflow-wrap: anywhere; }
      .meta, figcaption, .axis, .legend { color: var(--ink-2); }
      .chart { margin: 24px 0; padding: 16px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; }
      figcaption { font-size: 0.9rem; margin-bottom: 8px; }
      .legend { display: flex; gap: 16px; font-size: 0.85rem; margin-bottom: 8px; }
      .key { display: inline-block; width: 14px; height: 2px; vertical-align: middle; margin-right: 6px; }
      .key.score { background: var(--score); } .key.speed { background: var(--speed); }
      /* Below 640px the chart scrolls sideways instead of shrinking its lines and labels. */
      .plot { position: relative; overflow-x: auto; }
      svg { width: 100%; min-width: 640px; height: auto; display: block; overflow: visible; }
      .grid { stroke: var(--grid); stroke-width: 1; vector-effect: non-scaling-stroke; }
      .axis { font-size: 11px; fill: var(--muted); }
      .line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
      .line.score { stroke: var(--score); } .line.speed { stroke: var(--speed); }
      .dot { stroke: var(--surface); stroke-width: 2; }
      .dot.score { fill: var(--score); } .dot.speed { fill: var(--speed); }
      .end-label { font-size: 12px; fill: var(--ink-2); }
      .crosshair { stroke: var(--muted); stroke-width: 1; }
      .hit { fill: transparent; }
      .tooltip { position: absolute; top: 0; pointer-events: none; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; font-size: 0.85rem; white-space: nowrap; box-shadow: 0 2px 8px rgba(0,0,0,0.12); }
      .table-wrap { overflow-x: auto; }
      table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; }
      th, td { text-align: left; vertical-align: top; padding: 10px 12px; border-bottom: 1px solid var(--grid); font-size: 0.9rem; }
      thead th { color: var(--ink-2); font-weight: 600; }
      ul { margin: 0; padding-left: 18px; }
      .flag { margin: 6px 0 0; }
      footer { margin-top: 24px; color: var(--muted); font-size: 0.85rem; }
    </style>
  </head>
  <body>
    <main>
      <p class="eyebrow">${escapeHtml(brandName)} website history</p>
      <h1>${escapeHtml(options.name)}</h1>
      <p class="meta">${rows.length} check${rows.length === 1 ? "" : "s"}${rows.length > 0 ? `, ${escapeHtml(rows[0].date)} to ${escapeHtml(rows[rows.length - 1].date)}` : ""}.</p>
      ${rows.length > 0 ? chart(rows) : ""}
      <div class="table-wrap">
        <table>
          <thead><tr><th scope="col">Check</th><th scope="col">Score</th>${showSpeed ? '<th scope="col">Page speed</th>' : ""}${
            showResponse ? '<th scope="col">Response time</th>' : ""
          }<th scope="col">Open issues</th><th scope="col">Changes</th></tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
      ${footer ? `<footer>${escapeHtml(footer)}</footer>` : ""}
    </main>
    <script>
      (() => {
        const data = ${JSON.stringify(data).replace(/</g, "\\u003c")};
        const svg = document.querySelector("svg");
        const tip = document.querySelector(".tooltip");
        if (!svg || !tip || data.length === 0) return;
        const hair = svg.querySelector(".crosshair");
        const left = ${plot.left}, plotWidth = ${width - plot.left - plot.right};
        const xFor = (i) => left + (data.length === 1 ? plotWidth / 2 : (i * plotWidth) / (data.length - 1));
        const show = (event) => {
          const box = svg.getBoundingClientRect();
          const scale = box.width / ${width};
          const px = (event.clientX - box.left) / scale;
          let index = 0;
          data.forEach((_, i) => { if (Math.abs(xFor(i) - px) < Math.abs(xFor(index) - px)) index = i; });
          const row = data[index];
          hair.setAttribute("x1", xFor(index)); hair.setAttribute("x2", xFor(index)); hair.setAttribute("visibility", "visible");
          tip.replaceChildren();
          const lines = [row.date, "Overall score: " + row.score + "/100"];
          if (row.performance !== null) lines.push("Page speed: " + row.performance + "/100");
          for (const text of lines) { const line = document.createElement("div"); line.textContent = text; tip.append(line); }
          tip.hidden = false;
          const tipX = xFor(index) * scale + 12;
          tip.style.left = Math.min(tipX, box.width - tip.offsetWidth) + "px";
        };
        const hide = () => { tip.hidden = true; hair.setAttribute("visibility", "hidden"); };
        svg.addEventListener("pointermove", show);
        svg.addEventListener("pointerdown", show);
        svg.addEventListener("pointerleave", (event) => { if (event.pointerType !== "touch") hide(); });
      })();
    </script>
  </body>
</html>
`;
}
