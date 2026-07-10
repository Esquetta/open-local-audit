import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { cleanInputLines, escapeCsvCell, parseCsvLine } from "./csv.js";

export const reviewStatuses = [
  "new",
  "pending",
  "in-review",
  "qualified",
  "contacted",
  "rejected",
  "not-fit",
  "do-not-contact",
  "suppressed"
] as const;

export type ReviewStatus = (typeof reviewStatuses)[number];
export type ReviewUpsertAction = "added" | "updated";
type ReviewActionReason = "unreviewed" | "invalid-reviewed-at" | "stale";

export interface ReviewUpsertInput {
  leadKey: string;
  status: string;
  reason?: string;
  reviewedAt?: string;
}

export interface ReviewBulkUpsertInput {
  leadKeys: string[];
  status: string;
  reason?: string;
  reviewedAt?: string;
}

export interface ReviewUpsertResult {
  action: ReviewUpsertAction;
  content: string;
  leadKey: string;
  reviewStatus: ReviewStatus;
  lastReviewedAt: string;
}

export interface ReviewBulkUpsertResult {
  added: number;
  updated: number;
  skipped: number;
  total: number;
  content: string;
  reviewStatus: ReviewStatus;
  lastReviewedAt: string;
}

export interface ReviewSummary {
  totalRows: number;
  reviewedRows: number;
  unreviewedRows: number;
  unreviewedLeadKeys: string[];
  actionableLeadKeys: string[];
  actionableLeads: Array<{ leadKey: string; reasons: ReviewActionReason[] }>;
  invalidReviewedAtRows: number;
  invalidReviewedAtLeadKeys: string[];
  staleRows: number;
  staleLeadKeys: string[];
  staleBefore?: string;
  oldestReviewedAt?: string;
  newestReviewedAt?: string;
  statusCounts: Record<ReviewStatus | "unknown", number>;
}

const requiredHeaders = ["leadKey", "reviewStatus", "reviewReason", "lastReviewedAt"];
const dateOnlyPattern = /^(\d{4})-(\d{2})-(\d{2})$/;

function normalizeStatus(value: string): ReviewStatus | undefined {
  const normalized = value.trim().toLowerCase();
  return reviewStatuses.find((status) => status === normalized);
}

function parseReviewStatus(input: { status: string }): ReviewStatus {
  const reviewStatus = normalizeStatus(input.status);
  if (!reviewStatus) {
    throw new Error(`review --status must be one of: ${reviewStatuses.join(", ")}`);
  }

  return reviewStatus;
}

function isoTimestamp(value: string | undefined, now: Date): string {
  const raw = value?.trim();
  if (!raw) {
    return now.toISOString();
  }

  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error("review --reviewed-at must be a valid date or timestamp");
  }

  return new Date(parsed).toISOString();
}

function parseCalendarDate(value: string): number | undefined {
  const trimmed = value.trim();
  if (!dateOnlyPattern.test(trimmed)) {
    return undefined;
  }

  const parsed = Date.parse(`${trimmed}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === trimmed ? parsed : undefined;
}

function staleBeforeThreshold(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = parseCalendarDate(value);
  if (parsed === undefined) {
    throw new Error("review --stale-before must be a valid date in YYYY-MM-DD format");
  }

  return parsed;
}

function readRows(content: string): { headers: string[]; rows: string[][] } {
  const lines = cleanInputLines(content);
  if (lines.length === 0) {
    return {
      headers: [...requiredHeaders],
      rows: []
    };
  }

  return {
    headers: parseCsvLine(lines[0]),
    rows: lines.slice(1).map(parseCsvLine)
  };
}

function ensureHeaders(headers: string[]): string[] {
  const next = [...headers];
  for (const header of requiredHeaders) {
    if (!next.includes(header)) {
      next.push(header);
    }
  }

  return next;
}

function normalizeRows(rows: string[][], headers: string[]): string[][] {
  return rows.map((row) => {
    const next = [...row];
    while (next.length < headers.length) {
      next.push("");
    }
    return next;
  });
}

function setCell(row: string[], headers: string[], header: string, value: string): void {
  const index = headers.indexOf(header);
  row[index] = value;
}

function cell(row: string[], headers: string[], header: string): string {
  const index = headers.indexOf(header);
  return index < 0 ? "" : (row[index] ?? "").trim();
}

function renderCsv(headers: string[], rows: string[][]): string {
  const renderedRows = rows.map((row) => headers.map((_, index) => escapeCsvCell(row[index] ?? "")).join(","));
  return `${[headers.join(","), ...renderedRows].join("\n")}\n`;
}

function upsertRow(
  rows: string[][],
  headers: string[],
  leadKey: string,
  reviewStatus: ReviewStatus,
  reason: string | undefined,
  lastReviewedAt: string
): ReviewUpsertAction {
  const leadKeyIndex = headers.indexOf("leadKey");
  const existing = rows.find((row) => (row[leadKeyIndex] ?? "").trim() === leadKey);
  const row = existing ?? Array.from({ length: headers.length }, () => "");

  setCell(row, headers, "leadKey", leadKey);
  setCell(row, headers, "reviewStatus", reviewStatus);
  setCell(row, headers, "reviewReason", reason?.trim() ?? "");
  setCell(row, headers, "lastReviewedAt", lastReviewedAt);

  if (!existing) {
    rows.push(row);
  }

  return existing ? "updated" : "added";
}

export function upsertReviewCsv(content: string, input: ReviewUpsertInput, now = new Date()): ReviewUpsertResult {
  const leadKey = input.leadKey.trim();
  if (!leadKey) {
    throw new Error("review --lead-key is required");
  }

  const reviewStatus = parseReviewStatus(input);
  const { headers: rawHeaders, rows: rawRows } = readRows(content);
  const headers = ensureHeaders(rawHeaders);
  const rows = normalizeRows(rawRows, headers);
  const lastReviewedAt = isoTimestamp(input.reviewedAt, now);
  const action = upsertRow(rows, headers, leadKey, reviewStatus, input.reason, lastReviewedAt);

  return {
    action,
    content: renderCsv(headers, rows),
    leadKey,
    reviewStatus,
    lastReviewedAt
  };
}

export function upsertReviewCsvMany(content: string, input: ReviewBulkUpsertInput, now = new Date()): ReviewBulkUpsertResult {
  const reviewStatus = parseReviewStatus(input);
  const seen = new Set<string>();
  const leadKeys = input.leadKeys.flatMap((leadKey) => {
    const trimmed = leadKey.trim();
    if (!trimmed || seen.has(trimmed)) {
      return [];
    }

    seen.add(trimmed);
    return [trimmed];
  });
  const skipped = input.leadKeys.length - leadKeys.length;

  if (leadKeys.length === 0) {
    throw new Error("review --input must contain at least one leadKey");
  }

  const { headers: rawHeaders, rows: rawRows } = readRows(content);
  const headers = ensureHeaders(rawHeaders);
  const rows = normalizeRows(rawRows, headers);
  const lastReviewedAt = isoTimestamp(input.reviewedAt, now);
  let added = 0;
  let updated = 0;

  for (const leadKey of leadKeys) {
    const action = upsertRow(rows, headers, leadKey, reviewStatus, input.reason, lastReviewedAt);
    if (action === "added") {
      added += 1;
    } else {
      updated += 1;
    }
  }

  return {
    added,
    updated,
    skipped,
    total: leadKeys.length,
    content: renderCsv(headers, rows),
    reviewStatus,
    lastReviewedAt
  };
}

export function readLeadKeysFromReviewInput(content: string): string[] {
  const trimmed = content.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown;
    const rows = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && "leads" in parsed && Array.isArray(parsed.leads)
        ? parsed.leads
        : [];

    return rows.flatMap((row) => {
      if (!row || typeof row !== "object" || !("leadKey" in row) || typeof row.leadKey !== "string") {
        return [];
      }

      return [row.leadKey];
    });
  }

  const lines = cleanInputLines(content);
  if (lines.length < 2) {
    return [];
  }

  const headers = parseCsvLine(lines[0]);
  const leadKeyIndex = headers.indexOf("leadKey");
  if (leadKeyIndex < 0) {
    throw new Error("review --input CSV requires a leadKey column");
  }

  return lines.slice(1).map((line) => parseCsvLine(line)[leadKeyIndex] ?? "");
}

export function summarizeReviewCsv(content: string, options: { staleBefore?: string } = {}): ReviewSummary {
  const { headers, rows } = readRows(content);
  const staleBefore = staleBeforeThreshold(options.staleBefore);
  const staleBeforeDate = options.staleBefore?.trim();
  const statusCounts = Object.fromEntries([...reviewStatuses, "unknown"].map((status) => [status, 0])) as Record<
    ReviewStatus | "unknown",
    number
  >;
  let unreviewedRows = 0;
  const unreviewedLeadKeys: string[] = [];
  let invalidReviewedAtRows = 0;
  const invalidReviewedAtLeadKeys: string[] = [];
  let staleRows = 0;
  const staleLeadKeys: string[] = [];
  let oldestReviewedAt: string | undefined;
  let newestReviewedAt: string | undefined;
  let oldestTime = Number.POSITIVE_INFINITY;
  let newestTime = Number.NEGATIVE_INFINITY;

  for (const row of rows) {
    const status = normalizeStatus(cell(row, headers, "reviewStatus")) ?? "unknown";
    statusCounts[status] += 1;

    const reviewedAt = cell(row, headers, "lastReviewedAt");
    if (!reviewedAt) {
      unreviewedRows += 1;
      const leadKey = cell(row, headers, "leadKey");
      if (leadKey) {
        unreviewedLeadKeys.push(leadKey);
      }
      continue;
    }

    const time = Date.parse(reviewedAt);
    if (!Number.isFinite(time)) {
      invalidReviewedAtRows += 1;
      const leadKey = cell(row, headers, "leadKey");
      if (leadKey) {
        invalidReviewedAtLeadKeys.push(leadKey);
      }
      continue;
    }

    if (staleBefore !== undefined && time < staleBefore) {
      staleRows += 1;
      const leadKey = cell(row, headers, "leadKey");
      if (leadKey) {
        staleLeadKeys.push(leadKey);
      }
    }

    const normalized = new Date(time).toISOString();
    if (time < oldestTime) {
      oldestTime = time;
      oldestReviewedAt = normalized;
    }
    if (time > newestTime) {
      newestTime = time;
      newestReviewedAt = normalized;
    }
  }

  const actionableLeadReasons = new Map<string, ReviewActionReason[]>();
  for (const [reason, leadKeys] of [
    ["unreviewed", unreviewedLeadKeys],
    ["invalid-reviewed-at", invalidReviewedAtLeadKeys],
    ["stale", staleLeadKeys]
  ] as const) {
    for (const leadKey of leadKeys) {
      const reasons = actionableLeadReasons.get(leadKey) ?? [];
      if (!reasons.includes(reason)) {
        reasons.push(reason);
      }
      actionableLeadReasons.set(leadKey, reasons);
    }
  }
  const actionableLeads = [...actionableLeadReasons].map(([leadKey, reasons]) => ({ leadKey, reasons }));

  return {
    totalRows: rows.length,
    reviewedRows: rows.length - unreviewedRows,
    unreviewedRows,
    unreviewedLeadKeys,
    actionableLeadKeys: actionableLeads.map(({ leadKey }) => leadKey),
    actionableLeads,
    invalidReviewedAtRows,
    invalidReviewedAtLeadKeys,
    staleRows,
    staleLeadKeys,
    staleBefore: staleBeforeDate,
    oldestReviewedAt,
    newestReviewedAt,
    statusCounts
  };
}

async function readReviewCsvFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return "";
    }

    throw error;
  }
}

async function writeReviewCsvFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.tmp`;
  await writeFile(tempPath, content, "utf8");
  try {
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

export async function summarizeReviewCsvFile(path: string, options: { staleBefore?: string } = {}): Promise<ReviewSummary> {
  return summarizeReviewCsv(await readReviewCsvFile(path), options);
}

export async function upsertReviewCsvFile(path: string, input: ReviewUpsertInput): Promise<ReviewUpsertResult> {
  const result = upsertReviewCsv(await readReviewCsvFile(path), input);
  await writeReviewCsvFile(path, result.content);
  return result;
}

export async function upsertReviewCsvFileMany(
  path: string,
  input: ReviewBulkUpsertInput,
  dryRun = false
): Promise<ReviewBulkUpsertResult> {
  const result = upsertReviewCsvMany(await readReviewCsvFile(path), input);
  if (!dryRun) {
    await writeReviewCsvFile(path, result.content);
  }

  return result;
}
