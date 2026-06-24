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

export interface ReviewUpsertInput {
  leadKey: string;
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

const requiredHeaders = ["leadKey", "reviewStatus", "reviewReason", "lastReviewedAt"];

function normalizeStatus(value: string): ReviewStatus | undefined {
  const normalized = value.trim().toLowerCase();
  return reviewStatuses.find((status) => status === normalized);
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

function setCell(row: string[], headers: string[], header: string, value: string): void {
  const index = headers.indexOf(header);
  row[index] = value;
}

function renderCsv(headers: string[], rows: string[][]): string {
  const renderedRows = rows.map((row) => headers.map((_, index) => escapeCsvCell(row[index] ?? "")).join(","));
  return `${[headers.join(","), ...renderedRows].join("\n")}\n`;
}

export function upsertReviewCsv(content: string, input: ReviewUpsertInput, now = new Date()): ReviewUpsertResult {
  const leadKey = input.leadKey.trim();
  if (!leadKey) {
    throw new Error("review --lead-key is required");
  }

  const reviewStatus = normalizeStatus(input.status);
  if (!reviewStatus) {
    throw new Error(`review --status must be one of: ${reviewStatuses.join(", ")}`);
  }

  const { headers: rawHeaders, rows: rawRows } = readRows(content);
  const headers = ensureHeaders(rawHeaders);
  const leadKeyIndex = headers.indexOf("leadKey");
  const rows = rawRows.map((row) => {
    const next = [...row];
    while (next.length < headers.length) {
      next.push("");
    }
    return next;
  });
  const lastReviewedAt = isoTimestamp(input.reviewedAt, now);
  const existing = rows.find((row) => (row[leadKeyIndex] ?? "").trim() === leadKey);
  const row = existing ?? Array.from({ length: headers.length }, () => "");

  setCell(row, headers, "leadKey", leadKey);
  setCell(row, headers, "reviewStatus", reviewStatus);
  setCell(row, headers, "reviewReason", input.reason?.trim() ?? "");
  setCell(row, headers, "lastReviewedAt", lastReviewedAt);

  if (!existing) {
    rows.push(row);
  }

  return {
    action: existing ? "updated" : "added",
    content: renderCsv(headers, rows),
    leadKey,
    reviewStatus,
    lastReviewedAt
  };
}

export async function upsertReviewCsvFile(path: string, input: ReviewUpsertInput): Promise<ReviewUpsertResult> {
  let content = "";
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }

  const result = upsertReviewCsv(content, input);
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.tmp`;
  await writeFile(tempPath, result.content, "utf8");
  try {
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }

  return result;
}
