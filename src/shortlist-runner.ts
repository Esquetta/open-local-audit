import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { buildPitchBrief, readLeadReport, renderPitchBriefsMarkdown } from "./pitch-brief.js";
import {
  buildLeadShortlist,
  readShortlistReviewCsv,
  renderShortlistCsv,
  renderShortlistJson,
  renderShortlistMarkdown,
  renderShortlistSummaryJson,
  type ShortlistFormat,
  type ShortlistOptions,
  type ShortlistResult
} from "./shortlist.js";
import { writeWorkflowOutputFile } from "./workflow-output.js";

export interface ShortlistRunOptions {
  input: string;
  out: string;
  summaryJson?: string;
  reviewCsv?: string;
  pitchBrief?: { out: string; reportsDir: string };
  format: ShortlistFormat;
  shortlist: Omit<ShortlistOptions, "reviewRows">;
}

export async function runShortlistReport(options: ShortlistRunOptions): Promise<ShortlistResult> {
  const input = await readFile(options.input, "utf8");
  const reviewRows = options.reviewCsv ? readShortlistReviewCsv(await readFile(options.reviewCsv, "utf8")) : [];
  const result = buildLeadShortlist(input, {
    ...options.shortlist,
    reviewRows
  });

  const output =
    options.format === "json"
      ? renderShortlistJson(result)
      : options.format === "csv"
        ? renderShortlistCsv(result)
        : renderShortlistMarkdown(result);

  await mkdir(dirname(options.out), { recursive: true });
  await writeWorkflowOutputFile(options.out, output);

  if (options.summaryJson) {
    await mkdir(dirname(options.summaryJson), { recursive: true });
    await writeWorkflowOutputFile(options.summaryJson, renderShortlistSummaryJson(result));
  }

  if (options.pitchBrief) {
    const reportsDir = options.pitchBrief.reportsDir;
    const briefs = await Promise.all(
      result.leads.map(async (lead) => {
        const { report, status } = await readLeadReport(reportsDir, lead.reportPath);
        return buildPitchBrief(lead, report, status);
      })
    );
    await mkdir(dirname(options.pitchBrief.out), { recursive: true });
    await writeWorkflowOutputFile(options.pitchBrief.out, renderPitchBriefsMarkdown(briefs, new Date().toISOString()));
  }

  return result;
}
