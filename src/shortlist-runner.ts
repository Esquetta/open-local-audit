import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { LegalStatusIndex, OutreachConfig } from "./outreach.js";
import { buildPitchBrief, meetsPitchStrength, pitchStrength, readLeadReport, renderPitchBriefsMarkdown, type PitchStrength } from "./pitch-brief.js";
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
  // Keep only leads whose audit supports at least this pitch strength, read from reportsDir, before taking the top N.
  minPitchStrength?: { minimum: PitchStrength; reportsDir: string };
  // Write an unsent .eml cold email draft for each lead worth one, plus an index of every lead and why it was skipped.
  // legal holds Companies House results; with it, only active companies and LLPs get a draft.
  emailDrafts?: { dir: string; config: OutreachConfig; reportsDir: string; links: boolean; legal?: LegalStatusIndex };
  format: ShortlistFormat;
  shortlist: Omit<ShortlistOptions, "reviewRows">;
}

export async function runShortlistReport(options: ShortlistRunOptions): Promise<ShortlistResult> {
  const input = await readFile(options.input, "utf8");
  const reviewRows = options.reviewCsv ? readShortlistReviewCsv(await readFile(options.reviewCsv, "utf8")) : [];
  const top = options.shortlist.top ?? 20;
  if (!Number.isInteger(top) || top < 1) {
    throw new Error("shortlist --top must be a positive integer");
  }
  let result = buildLeadShortlist(input, {
    ...options.shortlist,
    ...(options.minPitchStrength ? { top: Number.MAX_SAFE_INTEGER } : {}),
    reviewRows
  });
  if (options.minPitchStrength) {
    const { minimum, reportsDir } = options.minPitchStrength;
    const strengths = await Promise.all(
      result.leads.map(async (lead) => pitchStrength(lead.reason, (await readLeadReport(reportsDir, lead.reportPath)).report).strength)
    );
    const strongEnough = result.leads.filter((_lead, index) => meetsPitchStrength(strengths[index], minimum));
    const leads = strongEnough.slice(0, top).map(({ rank: _rank, ...lead }, index) => ({ rank: index + 1, ...lead }));
    result = { ...result, filteredRows: result.filteredRows + result.leads.length - strongEnough.length, selected: leads.length, leads };
  }

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

  const readBriefs = (reportsDir: string) =>
    Promise.all(
      result.leads.map(async (lead) => {
        const { report, status } = await readLeadReport(reportsDir, lead.reportPath);
        return buildPitchBrief(lead, report, status);
      })
    );

  if (options.pitchBrief) {
    const briefs = await readBriefs(options.pitchBrief.reportsDir);
    await mkdir(dirname(options.pitchBrief.out), { recursive: true });
    await writeWorkflowOutputFile(options.pitchBrief.out, renderPitchBriefsMarkdown(briefs, new Date().toISOString()));
  }

  if (options.emailDrafts) {
    const { dir, config, reportsDir, links, legal } = options.emailDrafts;
    // The .eml writer lives with monitoring, which loads the PDF renderer, so it is only imported when drafts are asked for.
    const { planOutreachDrafts, readLeadEmails, renderOutreachEml, renderOutreachIndex } = await import("./outreach.js");
    const planned = planOutreachDrafts(await readBriefs(reportsDir), config, { emails: readLeadEmails(input), links, legal });
    await mkdir(dir, { recursive: true });
    // Drafts from an earlier run are named by rank, so they would sit next to the new ones, including drafts for
    // leads since marked contacted or do-not-contact. Only files with this command's naming are removed.
    for (const name of await readdir(dir)) {
      if (/^\d{2,}-[a-z0-9-]+\.eml$/.test(name)) {
        await rm(join(dir, name), { force: true });
      }
    }
    for (const { draft, file } of planned) {
      if (draft && file) {
        await writeWorkflowOutputFile(join(dir, file), renderOutreachEml(draft));
      }
    }
    await writeWorkflowOutputFile(
      join(dir, "index.md"),
      renderOutreachIndex(planned.map(({ draft: _draft, ...entry }) => entry), new Date().toISOString())
    );
  }

  return result;
}
