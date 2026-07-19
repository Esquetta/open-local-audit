import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { auditUrl } from "./audit.js";
import { cleanInputLines, escapeCsvCell, parseCsvLine } from "./csv.js";
import { writeReportOutputs, type OutputFormat, type ReportOutput } from "./output.js";
import { auditProfileSchema, inputUrlSchema } from "./schema.js";
import type { AuditOptions, AuditProfile, AuditReport, PublicContact, ReportBrandConfig, Severity } from "./types.js";
import { writeWorkflowOutputFile } from "./workflow-output.js";

export interface BatchInputEntry {
  url: string;
  label?: string;
  segment?: string;
  profile?: AuditProfile;
  source?: string;
}

export interface BatchReportOptions {
  format: OutputFormat;
  outDir: string;
  pretty?: boolean;
  audit?: (url: string, context: BatchAuditContext) => Promise<AuditReport>;
  index?: BatchIndexOptions;
  summaryJson?: string;
  exportCsv?: string;
  exportPreset?: BatchCsvExportPreset;
  concurrency?: number;
  profile?: AuditProfile;
  brand?: ReportBrandConfig;
  managedOutputRoot?: string;
}

export type BatchCsvExportPreset = "standard" | "crm";

export interface BatchAuditContext {
  slug: string;
  outDir: string;
  profile: AuditProfile;
}

export type BatchIndexSort = "score-asc" | "severity-desc";

export interface BatchIndexOptions {
  segment?: string;
  minScore?: number;
  top?: number;
  sort?: BatchIndexSort;
  source?: string;
  auditStatus?: string;
  hasWebsite?: string;
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

type BatchContactChannel = "email" | "whatsapp" | "phone" | "contact-page" | "manual-review";

type BatchContactRollup = {
  withAnyPublicContact: number;
  publicEmail: number;
  publicPhone: number;
  whatsapp: number;
  contactPage: number;
  socialProfiles: number;
  confidence: Record<PublicContact["contactConfidence"], number>;
};

type BatchOutreachRollup = {
  preferredChannels: Record<BatchContactChannel, number>;
};

type BatchOutreachHandoff = {
  preferredContactChannel: BatchContactChannel;
  outreachAction: string;
  contactabilityReason: string;
};

type BatchIndexEntry = {
  url: string;
  label?: string;
  segment?: string;
  profile?: AuditProfile;
  status: BatchReportResult["status"];
  slug: string;
  score?: number;
  findings?: AuditReport["summary"];
  topFinding?: string;
  reports?: Partial<Record<Exclude<OutputFormat, "all">, string>>;
  contact?: PublicContact;
  outreach?: BatchOutreachHandoff;
  error?: string;
};

type BatchBreakdownEntry = {
  total: number;
  succeeded: number;
  failed: number;
  averageScore?: number;
};

type BatchFindingFrequency = {
  title: string;
  count: number;
};

interface BatchIndex {
  summary: {
    total: number;
    succeeded: number;
    failed: number;
    averageScore?: number;
    profiles: Record<string, BatchBreakdownEntry>;
    segments: Record<string, BatchBreakdownEntry>;
    topFindings: BatchFindingFrequency[];
    contact: BatchContactRollup;
    outreach: BatchOutreachRollup;
  };
  entries: BatchIndexEntry[];
}

type PreparedBatchEntry = {
  entry: BatchInputEntry;
  slug: string;
  siteOutDir: string;
  profile: AuditProfile;
};

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
  const profileIndex = headers.indexOf("profile");
  const sourceIndex = headers.indexOf("source");

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

    if (profileIndex >= 0 && cells[profileIndex]) {
      entry.profile = auditProfileSchema.parse(cells[profileIndex]);
    }

    if (sourceIndex >= 0 && cells[sourceIndex]) {
      entry.source = cells[sourceIndex];
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

type BatchIndexFormat = "json" | "markdown" | "html";

function formatsFor(format: OutputFormat): BatchIndexFormat[] {
  if (format === "all") {
    return ["json", "markdown", "html"];
  }

  if (format === "pdf") {
    throw new Error("PDF batch indexes are not supported");
  }

  return [format];
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

function hasAnyPublicContact(contact: PublicContact | undefined): boolean {
  return Boolean(
    contact?.publicEmail ||
      contact?.publicPhone ||
      contact?.whatsappUrl ||
      contact?.contactPageUrl ||
      (contact?.socialProfiles.length ?? 0) > 0
  );
}

function contactHandoffFor(contact: PublicContact | undefined): BatchOutreachHandoff {
  if (contact?.publicEmail) {
    return {
      preferredContactChannel: "email",
      outreachAction: "Send a personalized audit summary by email.",
      contactabilityReason: "Public email found on the audited website."
    };
  }

  if (contact?.whatsappUrl) {
    return {
      preferredContactChannel: "whatsapp",
      outreachAction: "Send a short WhatsApp message with the top audit issue.",
      contactabilityReason: "WhatsApp link found on the audited website."
    };
  }

  if (contact?.publicPhone) {
    return {
      preferredContactChannel: "phone",
      outreachAction: "Call with the top audit issue and offer a review.",
      contactabilityReason: "Public phone number found on the audited website."
    };
  }

  if (contact?.contactPageUrl) {
    return {
      preferredContactChannel: "contact-page",
      outreachAction: "Use the website contact page with the top audit issue.",
      contactabilityReason: "Contact page found on the audited website."
    };
  }

  return {
    preferredContactChannel: "manual-review",
    outreachAction: "Find a public contact path manually before outreach.",
    contactabilityReason: "No public contact channel found on the audited website."
  };
}

function worstSeverityRank(report: AuditReport): number {
  const ranks: Record<Severity, number> = {
    high: 4,
    medium: 3,
    low: 2,
    info: 1
  };

  return Math.max(0, ...report.findings.map((finding) => ranks[finding.severity]));
}

function buildBatchIndexEntry(result: BatchReportResult, profile?: AuditProfile): BatchIndexEntry {
  const resultProfile = result.profile ?? profile ?? "generic";
  if (result.status === "failed") {
    return {
      url: result.url,
      label: result.label,
      segment: result.segment,
      profile: resultProfile,
      status: result.status,
      slug: result.slug,
      error: result.error
    };
  }

  const contact = result.report.contact ?? {
    socialProfiles: [],
    contactConfidence: "None" as const
  };

  return {
    url: result.url,
    label: result.label,
    segment: result.segment,
    profile: result.report.profile ?? resultProfile,
    status: result.status,
    slug: result.slug,
    score: totalScore(result.report),
    findings: result.report.summary,
    topFinding: result.report.findings[0]?.title,
    contact,
    outreach: contactHandoffFor(contact),
    reports: outputReports(result.slug, result.outputs)
  };
}

function resultScore(result: BatchReportResult): number {
  return result.status === "success" ? totalScore(result.report) : Number.POSITIVE_INFINITY;
}

function resultSeverityRank(result: BatchReportResult): number {
  return result.status === "success" ? worstSeverityRank(result.report) : 0;
}

function filterBatchIndexResults(results: BatchReportResult[], options: BatchIndexOptions): BatchReportResult[] {
  return results.filter((result) => {
    if (options.segment !== undefined && result.segment !== options.segment) {
      return false;
    }

    if (options.minScore !== undefined && (result.status !== "success" || totalScore(result.report) < options.minScore)) {
      return false;
    }

    if (options.source !== undefined && result.source !== options.source) {
      return false;
    }

    if (options.auditStatus !== undefined && result.status !== options.auditStatus) {
      return false;
    }

    if (options.hasWebsite !== undefined) {
      const hasWebsite = result.status === "success" ? "yes" : "no";
      if (hasWebsite !== options.hasWebsite.toLowerCase()) {
        return false;
      }
    }

    return true;
  });
}

function sortBatchIndexResults(results: BatchReportResult[], sort: BatchIndexSort | undefined): BatchReportResult[] {
  if (sort === "score-asc") {
    return [...results].sort((left, right) => resultScore(left) - resultScore(right));
  }

  if (sort === "severity-desc") {
    return [...results].sort((left, right) => resultSeverityRank(right) - resultSeverityRank(left));
  }

  return results;
}

function applyBatchIndexOptions(results: BatchReportResult[], options: BatchIndexOptions = {}): BatchReportResult[] {
  const filtered = filterBatchIndexResults(results, options);
  const sorted = sortBatchIndexResults(filtered, options.sort);

  return options.top === undefined ? sorted : sorted.slice(0, options.top);
}

function averageScore(scores: number[]): number | undefined {
  if (scores.length === 0) {
    return undefined;
  }

  return Math.round(scores.reduce((total, score) => total + score, 0) / scores.length);
}

function addBreakdownEntry(
  breakdown: Record<string, BatchBreakdownEntry & { scores: number[] }>,
  key: string,
  entry: BatchIndexEntry
): void {
  const current = breakdown[key] ?? {
    total: 0,
    succeeded: 0,
    failed: 0,
    scores: []
  };

  current.total += 1;
  if (entry.status === "success") {
    current.succeeded += 1;
    if (entry.score !== undefined) {
      current.scores.push(entry.score);
    }
  } else {
    current.failed += 1;
  }

  breakdown[key] = current;
}

function finalizeBreakdown(
  breakdown: Record<string, BatchBreakdownEntry & { scores: number[] }>
): Record<string, BatchBreakdownEntry> {
  return Object.fromEntries(
    Object.entries(breakdown).map(([key, value]) => [
      key,
      {
        total: value.total,
        succeeded: value.succeeded,
        failed: value.failed,
        averageScore: averageScore(value.scores)
      }
    ])
  );
}

function buildBatchSummary(entries: BatchIndexEntry[]): BatchIndex["summary"] {
  const scores = entries.flatMap((entry) => (entry.status === "success" && entry.score !== undefined ? [entry.score] : []));
  const profileBreakdown: Record<string, BatchBreakdownEntry & { scores: number[] }> = {};
  const segmentBreakdown: Record<string, BatchBreakdownEntry & { scores: number[] }> = {};
  const findingCounts = new Map<string, number>();

  for (const entry of entries) {
    addBreakdownEntry(profileBreakdown, entry.profile ?? "generic", entry);
    addBreakdownEntry(segmentBreakdown, entry.segment ?? "unsegmented", entry);

    if (entry.topFinding) {
      findingCounts.set(entry.topFinding, (findingCounts.get(entry.topFinding) ?? 0) + 1);
    }
  }

  return {
    total: entries.length,
    succeeded: entries.filter((entry) => entry.status === "success").length,
    failed: entries.filter((entry) => entry.status === "failed").length,
    averageScore: averageScore(scores),
    profiles: finalizeBreakdown(profileBreakdown),
    segments: finalizeBreakdown(segmentBreakdown),
    topFindings: Array.from(findingCounts.entries())
      .map(([title, count]) => ({ title, count }))
      .filter((entry) => entry.count > 1)
      .sort((left, right) => right.count - left.count || left.title.localeCompare(right.title))
      .slice(0, 5),
    contact: buildContactRollup(entries),
    outreach: buildOutreachRollup(entries)
  };
}

function buildContactRollup(entries: BatchIndexEntry[]): BatchContactRollup {
  const confidence: BatchContactRollup["confidence"] = {
    High: 0,
    Medium: 0,
    Low: 0,
    None: 0
  };
  for (const entry of entries) {
    if (entry.contact) {
      confidence[entry.contact.contactConfidence] += 1;
    }
  }

  return {
    withAnyPublicContact: entries.filter((entry) => hasAnyPublicContact(entry.contact)).length,
    publicEmail: entries.filter((entry) => entry.contact?.publicEmail).length,
    publicPhone: entries.filter((entry) => entry.contact?.publicPhone).length,
    whatsapp: entries.filter((entry) => entry.contact?.whatsappUrl).length,
    contactPage: entries.filter((entry) => entry.contact?.contactPageUrl).length,
    socialProfiles: entries.filter((entry) => (entry.contact?.socialProfiles.length ?? 0) > 0).length,
    confidence
  };
}

function buildOutreachRollup(entries: BatchIndexEntry[]): BatchOutreachRollup {
  const preferredChannels: BatchOutreachRollup["preferredChannels"] = {
    email: 0,
    whatsapp: 0,
    phone: 0,
    "contact-page": 0,
    "manual-review": 0
  };

  for (const entry of entries) {
    if (entry.outreach) {
      preferredChannels[entry.outreach.preferredContactChannel] += 1;
    }
  }

  return {
    preferredChannels
  };
}

function normalizeConcurrency(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 1;
  }

  return Math.max(1, Math.floor(value));
}

function buildBatchIndex(
  results: BatchReportResult[],
  options?: BatchIndexOptions,
  profile?: AuditProfile
): BatchIndex {
  const entries = applyBatchIndexOptions(results, options).map((result) => buildBatchIndexEntry(result, profile));

  return {
    summary: buildBatchSummary(entries),
    entries
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
    `- Average score: ${index.summary.averageScore ?? "N/A"}`,
    `- With public contact: ${index.summary.contact.withAnyPublicContact}`,
    `- Manual contact review: ${index.summary.outreach.preferredChannels["manual-review"]}`,
    "",
    "## Profile Breakdown",
    "",
    "| Profile | Total | Succeeded | Failed | Average score |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...Object.entries(index.summary.profiles).map(
      ([profile, entry]) =>
        `| ${escapeMarkdownCell(profile)} | ${entry.total} | ${entry.succeeded} | ${entry.failed} | ${entry.averageScore ?? ""} |`
    ),
    "",
    "## Segment Breakdown",
    "",
    "| Segment | Total | Succeeded | Failed | Average score |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...Object.entries(index.summary.segments).map(
      ([segment, entry]) =>
        `| ${escapeMarkdownCell(segment)} | ${entry.total} | ${entry.succeeded} | ${entry.failed} | ${entry.averageScore ?? ""} |`
    ),
    "",
    "## Frequent Findings",
    "",
    "| Finding | Count |",
    "| --- | ---: |",
    ...(index.summary.topFindings.length > 0
      ? index.summary.topFindings.map((entry) => `| ${escapeMarkdownCell(entry.title)} | ${entry.count} |`)
      : ["|  |  |"]),
    "",
    "## Contact Rollup",
    "",
    "| Preferred channel | Count |",
    "| --- | ---: |",
    `| email | ${index.summary.contact.publicEmail} |`,
    `| whatsapp | ${index.summary.contact.whatsapp} |`,
    `| phone | ${index.summary.contact.publicPhone} |`,
    `| contact-page | ${index.summary.contact.contactPage} |`,
    `| social-profiles | ${index.summary.contact.socialProfiles} |`,
    "",
    "| Contact confidence | Count |",
    "| --- | ---: |",
    `| High | ${index.summary.contact.confidence.High} |`,
    `| Medium | ${index.summary.contact.confidence.Medium} |`,
    `| Low | ${index.summary.contact.confidence.Low} |`,
    `| None | ${index.summary.contact.confidence.None} |`,
    "",
    "## Outreach Rollup",
    "",
    "| Preferred channel | Count |",
    "| --- | ---: |",
    `| email | ${index.summary.outreach.preferredChannels.email} |`,
    `| whatsapp | ${index.summary.outreach.preferredChannels.whatsapp} |`,
    `| phone | ${index.summary.outreach.preferredChannels.phone} |`,
    `| contact-page | ${index.summary.outreach.preferredChannels["contact-page"]} |`,
    `| manual-review | ${index.summary.outreach.preferredChannels["manual-review"]} |`,
    "",
    "## Entries",
    "",
    "| Status | Label | URL | Segment | Profile | Score | Contact confidence | Preferred channel | Contact reason | Top issue | Error |",
    "| --- | --- | --- | --- | --- | ---: | --- | --- | --- | --- | --- |"
  ];

  for (const entry of index.entries) {
    lines.push(
      [
        entry.status,
        entry.label ?? "",
        entry.url,
        entry.segment ?? "",
        entry.profile ?? "",
        entry.score?.toString() ?? "",
        entry.contact?.contactConfidence ?? "",
        entry.outreach?.preferredContactChannel ?? "",
        entry.outreach?.contactabilityReason ?? "",
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
  const renderBreakdownRows = (breakdown: Record<string, BatchBreakdownEntry>) =>
    Object.entries(breakdown)
      .map(
        ([key, entry]) =>
          `<tr><td>${escapeHtml(key)}</td><td>${entry.total}</td><td>${entry.succeeded}</td><td>${entry.failed}</td><td>${entry.averageScore ?? ""}</td></tr>`
      )
      .join("\n");
  const findingRows =
    index.summary.topFindings.length > 0
      ? index.summary.topFindings
          .map((entry) => `<tr><td>${escapeHtml(entry.title)}</td><td>${entry.count}</td></tr>`)
          .join("\n")
      : `<tr><td></td><td></td></tr>`;
  const contactChannelRows = [
    ["email", index.summary.contact.publicEmail],
    ["whatsapp", index.summary.contact.whatsapp],
    ["phone", index.summary.contact.publicPhone],
    ["contact-page", index.summary.contact.contactPage],
    ["social-profiles", index.summary.contact.socialProfiles]
  ]
    .map(([channel, count]) => `<tr><td>${escapeHtml(String(channel))}</td><td>${count}</td></tr>`)
    .join("\n");
  const contactConfidenceRows = Object.entries(index.summary.contact.confidence)
    .map(([confidence, count]) => `<tr><td>${escapeHtml(confidence)}</td><td>${count}</td></tr>`)
    .join("\n");
  const outreachChannelRows = Object.entries(index.summary.outreach.preferredChannels)
    .map(([channel, count]) => `<tr><td>${escapeHtml(channel)}</td><td>${count}</td></tr>`)
    .join("\n");
  const rows = index.entries
    .map(
      (entry) =>
        `<tr><td>${entry.status}</td><td>${escapeHtml(entry.label ?? "")}</td><td>${escapeHtml(entry.url)}</td><td>${escapeHtml(entry.segment ?? "")}</td><td>${escapeHtml(entry.profile ?? "")}</td><td>${entry.score ?? ""}</td><td>${escapeHtml(entry.contact?.contactConfidence ?? "")}</td><td>${escapeHtml(entry.outreach?.preferredContactChannel ?? "")}</td><td>${escapeHtml(entry.outreach?.contactabilityReason ?? "")}</td><td>${escapeHtml(entry.topFinding ?? "")}</td><td>${escapeHtml(entry.error ?? "")}</td></tr>`
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
    <p>Total: ${index.summary.total}<br>Succeeded: ${index.summary.succeeded}<br>Failed: ${index.summary.failed}<br>Average score: ${index.summary.averageScore ?? "N/A"}<br>With public contact: ${index.summary.contact.withAnyPublicContact}<br>Manual contact review: ${index.summary.outreach.preferredChannels["manual-review"]}</p>
    <h2>Profile Breakdown</h2>
    <table>
      <thead><tr><th>Profile</th><th>Total</th><th>Succeeded</th><th>Failed</th><th>Average score</th></tr></thead>
      <tbody>
${renderBreakdownRows(index.summary.profiles)}
      </tbody>
    </table>
    <h2>Segment Breakdown</h2>
    <table>
      <thead><tr><th>Segment</th><th>Total</th><th>Succeeded</th><th>Failed</th><th>Average score</th></tr></thead>
      <tbody>
${renderBreakdownRows(index.summary.segments)}
      </tbody>
    </table>
    <h2>Frequent Findings</h2>
    <table>
      <thead><tr><th>Finding</th><th>Count</th></tr></thead>
      <tbody>
${findingRows}
      </tbody>
    </table>
    <h2>Contact Rollup</h2>
    <table>
      <thead><tr><th>Preferred channel</th><th>Count</th></tr></thead>
      <tbody>
${contactChannelRows}
      </tbody>
    </table>
    <table>
      <thead><tr><th>Contact confidence</th><th>Count</th></tr></thead>
      <tbody>
${contactConfidenceRows}
      </tbody>
    </table>
    <h2>Outreach Rollup</h2>
    <table>
      <thead><tr><th>Preferred channel</th><th>Count</th></tr></thead>
      <tbody>
${outreachChannelRows}
      </tbody>
    </table>
    <h2>Entries</h2>
    <table>
      <thead><tr><th>Status</th><th>Label</th><th>URL</th><th>Segment</th><th>Profile</th><th>Score</th><th>Contact confidence</th><th>Preferred channel</th><th>Contact reason</th><th>Top issue</th><th>Error</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </body>
</html>
`;
}

async function writeBatchIndex(results: BatchReportResult[], options: BatchReportOptions): Promise<void> {
  if (!options.managedOutputRoot) {
    await mkdir(options.outDir, { recursive: true });
  }
  const index = buildBatchIndex(results, options.index, options.profile);
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
    await writeWorkflowOutputFile(join(options.outDir, fileNames[format]), writers[format](), {
      managedOutputRoot: options.managedOutputRoot
    });
  }

  if (options.summaryJson) {
    await mkdir(dirname(options.summaryJson), { recursive: true });
    await writeFile(options.summaryJson, writers.json(), "utf8");
  }
}

function fallbackCompanyName(result: BatchReportResult): string {
  if (result.label?.trim()) {
    return result.label;
  }

  try {
    return new URL(result.url).hostname.replace(/^www\./, "");
  } catch {
    return result.url;
  }
}

function reportPathsFor(result: BatchReportResult): string {
  const reports = result.status === "success" ? outputReports(result.slug, result.outputs) : {};
  return Object.values(reports).join("; ");
}

function preferredReportPathFor(result: BatchReportResult): string {
  if (result.status !== "success") {
    return "";
  }

  const reports = outputReports(result.slug, result.outputs);
  return reports.html ?? reports.markdown ?? reports.json ?? "";
}

function renderCrmProspectCsv(results: BatchReportResult[]): string {
  const header = [
    "companyName",
    "website",
    "segment",
    "profile",
    "source",
    "auditStatus",
    "hasWebsite",
    "priority",
    "score",
    "opportunityScore",
    "topFinding",
    "contactConfidence",
    "preferredContactChannel",
    "contactabilityReason",
    "publicEmail",
    "publicPhone",
    "contactPageUrl",
    "leadKey",
    "reportPath"
  ];
  const rows = results.filter((result) => result.status === "success").map((result) => {
    const contact = result.status === "success" ? (result.report.contact ?? { socialProfiles: [], contactConfidence: "None" as const }) : undefined;
    const outreach = result.status === "success" ? contactHandoffFor(contact) : undefined;
    const score = result.status === "success" ? totalScore(result.report).toString() : "";
    const profile = result.status === "success" ? (result.report.profile ?? result.profile ?? "generic") : (result.profile ?? "");
    const values = [
      fallbackCompanyName(result),
      result.url,
      result.segment ?? "",
      profile,
      result.source ?? "batch",
      result.status,
      result.status === "success" ? "yes" : "no",
      "",
      score,
      "",
      result.status === "success" ? (result.report.findings[0]?.title ?? "") : "",
      contact?.contactConfidence ?? "",
      outreach?.preferredContactChannel ?? "",
      outreach?.contactabilityReason ?? "",
      contact?.publicEmail ?? "",
      contact?.publicPhone ?? "",
      contact?.contactPageUrl ?? "",
      `url:${result.url}`,
      preferredReportPathFor(result)
    ];

    return values.map(escapeCsvCell).join(",");
  });

  return `${[header.join(","), ...rows].join("\n")}\n`;
}

function renderProspectCsv(results: BatchReportResult[], preset: BatchCsvExportPreset = "standard"): string {
  if (preset === "crm") {
    return renderCrmProspectCsv(results);
  }

  const header = [
    "url",
    "label",
    "segment",
    "profile",
    "source",
    "auditStatus",
    "hasWebsite",
    "status",
    "score",
    "topFinding",
    "contactConfidence",
    "preferredContactChannel",
    "contactabilityReason",
    "report paths",
    "error"
  ];
  const rows = results.map((result) => {
    const reportPaths = reportPathsFor(result);
    const contact = result.status === "success" ? (result.report.contact ?? { socialProfiles: [], contactConfidence: "None" as const }) : undefined;
    const outreach = result.status === "success" ? contactHandoffFor(contact) : undefined;
    const values = [
      result.url,
      result.label ?? "",
      result.segment ?? "",
      result.status === "success" ? (result.report.profile ?? result.profile ?? "generic") : (result.profile ?? ""),
      result.source ?? "",
      result.status,
      result.status === "success" ? "yes" : "no",
      result.status,
      result.status === "success" ? totalScore(result.report).toString() : "",
      result.status === "success" ? (result.report.findings[0]?.title ?? "") : "",
      contact?.contactConfidence ?? "",
      outreach?.preferredContactChannel ?? "",
      outreach?.contactabilityReason ?? "",
      reportPaths,
      result.status === "failed" ? result.error : ""
    ];

    return values.map(escapeCsvCell).join(",");
  });

  return `${[header.join(","), ...rows].join("\n")}\n`;
}

export async function runBatchReports(
  urls: Array<string | BatchInputEntry>,
  options: BatchReportOptions
): Promise<BatchReportResult[]> {
  const usedSlugs = new Map<string, number>();
  const audit = options.audit ?? ((url: string, context: BatchAuditContext) => auditUrl(url, { profile: context.profile } as Partial<AuditOptions>));
  const preparedEntries: PreparedBatchEntry[] = urls.map((rawEntry) => {
    const entry = normalizeEntry(rawEntry);
    const slug = uniqueSlug(safeReportSlug(entry.url), usedSlugs);
    return {
      entry,
      slug,
      siteOutDir: join(options.outDir, slug),
      profile: entry.profile ?? options.profile ?? "generic"
    };
  });
  const results = new Array<BatchReportResult>(preparedEntries.length);
  const concurrency = normalizeConcurrency(options.concurrency);
  let nextIndex = 0;

  async function runOne(prepared: PreparedBatchEntry): Promise<BatchReportResult> {
    try {
      const report = await audit(prepared.entry.url, {
        slug: prepared.slug,
        outDir: prepared.siteOutDir,
        profile: prepared.profile
      });
      const reportProfile = report.profile ?? "generic";
      const outputs = await writeReportOutputs(report, {
        format: options.format,
        outDir: prepared.siteOutDir,
        pretty: options.pretty,
        brand: options.brand,
        managedOutputRoot: options.managedOutputRoot
      });

      return {
        ...prepared.entry,
        profile: reportProfile,
        status: "success",
        slug: prepared.slug,
        report,
        outputs
      };
    } catch (error) {
      return {
        ...prepared.entry,
        profile: prepared.profile,
        status: "failed",
        slug: prepared.slug,
        error: error instanceof Error ? error.message : "Unknown error",
        outputs: []
      };
    }
  }

  async function worker(): Promise<void> {
    while (nextIndex < preparedEntries.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await runOne(preparedEntries[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, preparedEntries.length) }, () => worker()));
  await writeBatchIndex(results, options);
  if (options.exportCsv) {
    await mkdir(dirname(options.exportCsv), { recursive: true });
    await writeFile(options.exportCsv, renderProspectCsv(results, options.exportPreset), "utf8");
  }

  return results;
}
