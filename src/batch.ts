import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { auditUrl } from "./audit.js";
import { writeReportOutputs, type OutputFormat, type ReportOutput } from "./output.js";
import { inputUrlSchema } from "./schema.js";
import type { AuditOptions, AuditReport } from "./types.js";

export interface BatchInputEntry {
  url: string;
  label?: string;
  segment?: string;
}

export interface BatchReportOptions {
  format: OutputFormat;
  outDir: string;
  pretty?: boolean;
  audit?: (url: string) => Promise<AuditReport>;
}

export interface SuccessfulBatchReportResult extends BatchInputEntry {
  status: "success";
  url: string;
  slug: string;
  report: AuditReport;
  outputs: ReportOutput[];
}

export interface FailedBatchReportResult extends BatchInputEntry {
  status: "failed";
  url: string;
  slug: string;
  error: string;
  outputs: ReportOutput[];
}

export type BatchReportResult = SuccessfulBatchReportResult | FailedBatchReportResult;

interface BatchIndex {
  summary: {
    total: number;
    succeeded: number;
    failed: number;
  };
  entries: Array<{
    url: string;
    label?: string;
    segment?: string;
    status: BatchReportResult["status"];
    slug: string;
    score?: number;
    findings?: AuditReport["summary"];
    topFinding?: string;
    reports?: Partial<Record<Exclude<OutputFormat, "all">, string>>;
    error?: string;
  }>;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function cleanInputLines(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function isCsvInput(lines: string[]): boolean {
  return lines[0]?.split(",").some((cell) => cell.trim().toLowerCase() === "url") ?? false;
}

export async function readBatchInput(path: string): Promise<BatchInputEntry[]> {
  const content = await readFile(path, "utf8");
  const lines = cleanInputLines(content);

  if (!isCsvInput(lines)) {
    return lines.map((line) => ({
      url: inputUrlSchema.parse(line)
    }));
  }

  const [rawHeader, ...rows] = lines;
  const headers = parseCsvLine(rawHeader).map((header) => header.trim().toLowerCase());
  const urlIndex = headers.indexOf("url");
  const labelIndex = headers.indexOf("label");
  const segmentIndex = headers.indexOf("segment");

  if (urlIndex < 0) {
    throw new Error("CSV batch input requires a url column");
  }

  return rows.map((row) => {
    const cells = parseCsvLine(row);
    const entry: BatchInputEntry = {
      url: inputUrlSchema.parse(cells[urlIndex] ?? "")
    };

    if (labelIndex >= 0 && cells[labelIndex]) {
      entry.label = cells[labelIndex];
    }

    if (segmentIndex >= 0 && cells[segmentIndex]) {
      entry.segment = cells[segmentIndex];
    }

    return entry;
  });
}

export async function readInputUrls(path: string): Promise<string[]> {
  return (await readBatchInput(path)).map((entry) => entry.url);
}

export function safeReportSlug(rawUrl: string): string {
  const url = new URL(rawUrl);
  const parts = [url.hostname.replace(/^www\./, ""), url.pathname.replace(/^\/|\/$/g, "")]
    .filter(Boolean)
    .join("-");
  const slug = parts
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "site";
}

function uniqueSlug(base: string, used: Map<string, number>): string {
  const count = used.get(base) ?? 0;
  used.set(base, count + 1);
  return count === 0 ? base : `${base}-${count + 1}`;
}

function normalizeEntry(entry: string | BatchInputEntry): BatchInputEntry {
  return typeof entry === "string" ? { url: entry } : entry;
}

function formatsFor(format: OutputFormat): Array<Exclude<OutputFormat, "all">> {
  return format === "all" ? ["json", "markdown", "html"] : [format];
}

function outputReports(slug: string, outputs: ReportOutput[]): Partial<Record<Exclude<OutputFormat, "all">, string>> {
  return Object.fromEntries(outputs.map((output) => [output.format, `${slug}/${basename(output.path ?? "")}`]));
}

function totalScore(report: AuditReport): number {
  const scores = Object.values(report.scores);
  if (scores.length === 0) {
    return 0;
  }

  return Math.round(scores.reduce((total, score) => total + score.score, 0) / scores.length);
}

function buildBatchIndex(results: BatchReportResult[]): BatchIndex {
  return {
    summary: {
      total: results.length,
      succeeded: results.filter((result) => result.status === "success").length,
      failed: results.filter((result) => result.status === "failed").length
    },
    entries: results.map((result) => {
      if (result.status === "failed") {
        return {
          url: result.url,
          label: result.label,
          segment: result.segment,
          status: result.status,
          slug: result.slug,
          error: result.error
        };
      }

      return {
        url: result.url,
        label: result.label,
        segment: result.segment,
        status: result.status,
        slug: result.slug,
        score: totalScore(result.report),
        findings: result.report.summary,
        topFinding: result.report.findings[0]?.title,
        reports: outputReports(result.slug, result.outputs)
      };
    })
  };
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderBatchIndexMarkdown(index: BatchIndex): string {
  const lines = [
    "# Open Local Audit Batch Index",
    "",
    `- Total: ${index.summary.total}`,
    `- Succeeded: ${index.summary.succeeded}`,
    `- Failed: ${index.summary.failed}`,
    "",
    "| Status | Label | URL | Segment | Score | Top issue | Error |",
    "| --- | --- | --- | --- | ---: | --- | --- |"
  ];

  for (const entry of index.entries) {
    lines.push(
      [
        entry.status,
        entry.label ?? "",
        entry.url,
        entry.segment ?? "",
        entry.score?.toString() ?? "",
        entry.topFinding ?? "",
        entry.error ?? ""
      ]
        .map(escapeMarkdownCell)
        .join(" | ")
        .replace(/^/, "| ")
        .replace(/$/, " |")
    );
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderBatchIndexHtml(index: BatchIndex): string {
  const rows = index.entries
    .map(
      (entry) =>
        `<tr><td>${entry.status}</td><td>${escapeHtml(entry.label ?? "")}</td><td>${escapeHtml(entry.url)}</td><td>${escapeHtml(entry.segment ?? "")}</td><td>${entry.score ?? ""}</td><td>${escapeHtml(entry.topFinding ?? "")}</td><td>${escapeHtml(entry.error ?? "")}</td></tr>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Open Local Audit Batch Index</title>
    <style>
      body { color: #172026; font-family: Arial, sans-serif; line-height: 1.5; margin: 2rem; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #d4d9dd; padding: 0.5rem; text-align: left; vertical-align: top; }
      th { background: #f3f5f7; }
    </style>
  </head>
  <body>
    <h1>Open Local Audit Batch Index</h1>
    <p>Total: ${index.summary.total}<br>Succeeded: ${index.summary.succeeded}<br>Failed: ${index.summary.failed}</p>
    <table>
      <thead><tr><th>Status</th><th>Label</th><th>URL</th><th>Segment</th><th>Score</th><th>Top issue</th><th>Error</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </body>
</html>
`;
}

async function writeBatchIndex(results: BatchReportResult[], options: BatchReportOptions): Promise<void> {
  await mkdir(options.outDir, { recursive: true });
  const index = buildBatchIndex(results);
  const writers = {
    json: () => JSON.stringify(index, null, options.pretty ? 2 : 0) + "\n",
    markdown: () => renderBatchIndexMarkdown(index),
    html: () => renderBatchIndexHtml(index)
  };
  const fileNames = {
    json: "open-local-audit-batch-index.json",
    markdown: "open-local-audit-batch-index.md",
    html: "open-local-audit-batch-index.html"
  };

  for (const format of formatsFor(options.format)) {
    await writeFile(join(options.outDir, fileNames[format]), writers[format](), "utf8");
  }
}

export async function runBatchReports(
  urls: Array<string | BatchInputEntry>,
  options: BatchReportOptions
): Promise<BatchReportResult[]> {
  const usedSlugs = new Map<string, number>();
  const audit = options.audit ?? ((url: string) => auditUrl(url, {} as Partial<AuditOptions>));
  const results: BatchReportResult[] = [];

  for (const rawEntry of urls) {
    const entry = normalizeEntry(rawEntry);
    const slug = uniqueSlug(safeReportSlug(entry.url), usedSlugs);

    try {
      const report = await audit(entry.url);
      const outputs = await writeReportOutputs(report, {
        format: options.format,
        outDir: join(options.outDir, slug),
        pretty: options.pretty
      });

      results.push({
        ...entry,
        status: "success",
        slug,
        report,
        outputs
      });
    } catch (error) {
      results.push({
        ...entry,
        status: "failed",
        slug,
        error: error instanceof Error ? error.message : "Unknown error",
        outputs: []
      });
    }
  }

  await writeBatchIndex(results, options);

  return results;
}
