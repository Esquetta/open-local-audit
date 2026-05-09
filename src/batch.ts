import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { auditUrl } from "./audit.js";
import { writeReportOutputs, type OutputFormat, type ReportOutput } from "./output.js";
import { inputUrlSchema } from "./schema.js";
import type { AuditOptions, AuditReport } from "./types.js";

export interface BatchReportOptions {
  format: OutputFormat;
  outDir: string;
  pretty?: boolean;
  audit?: (url: string) => Promise<AuditReport>;
}

export interface BatchReportResult {
  url: string;
  slug: string;
  report: AuditReport;
  outputs: ReportOutput[];
}

export async function readInputUrls(path: string): Promise<string[]> {
  const content = await readFile(path, "utf8");

  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => inputUrlSchema.parse(line));
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

export async function runBatchReports(urls: string[], options: BatchReportOptions): Promise<BatchReportResult[]> {
  const usedSlugs = new Map<string, number>();
  const audit = options.audit ?? ((url: string) => auditUrl(url, {} as Partial<AuditOptions>));
  const results: BatchReportResult[] = [];

  for (const url of urls) {
    const report = await audit(url);
    const slug = uniqueSlug(safeReportSlug(url), usedSlugs);
    const outputs = await writeReportOutputs(report, {
      format: options.format,
      outDir: join(options.outDir, slug),
      pretty: options.pretty
    });

    results.push({
      url,
      slug,
      report,
      outputs
    });
  }

  return results;
}
