import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
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
  type ShortlistLead,
  type ShortlistOptions,
  type ShortlistResult
} from "./shortlist.js";
import type { AuditReport } from "./types.js";
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
  // legal holds Companies House results; with it, only active companies and LLPs get a draft. recheck fetches each
  // website that would get a draft again and keeps only the points it still shows.
  emailDrafts?: { dir: string; config: OutreachConfig; reportsDir: string; links: boolean; legal?: LegalStatusIndex; recheck?: boolean };
  format: ShortlistFormat;
  shortlist: Omit<ShortlistOptions, "reviewRows">;
}

export async function runShortlistReport(
  options: ShortlistRunOptions,
  recheck?: (lead: ShortlistLead) => Promise<AuditReport>
): Promise<ShortlistResult> {
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
    const { planOutreachDrafts, readLeadEmails, writeOutreachDrafts } = await import("./outreach.js");
    const emails = readLeadEmails(input);
    const reports = await Promise.all(result.leads.map((lead) => readLeadReport(reportsDir, lead.reportPath)));
    const briefs = result.leads.map((lead, index) => buildPitchBrief(lead, reports[index].report, reports[index].status));
    const planned = planOutreachDrafts(briefs, config, { emails, links, legal });
    if (options.emailDrafts.recheck) {
      const fetchSite = recheck ?? (await import("./follow-ups.js")).recheckSite;
      // As with follow-ups, a point stays in a draft only when the audit found it and today's check finds it again.
      for (const [index, entry] of planned.entries()) {
        if (!entry.draft) {
          continue;
        }
        const { draft: _draft, file: _file, ...base } = entry;
        const lead = result.leads[index];
        let fresh: AuditReport;
        try {
          fresh = await fetchSite(lead);
        } catch (error) {
          planned[index] = { ...base, skipped: `could not re-check the site: ${error instanceof Error ? error.message : "unknown error"}` };
          continue;
        }
        const audited = new Set(reports[index].report?.findings.map((finding) => finding.id));
        const brief = buildPitchBrief(lead, { ...fresh, findings: fresh.findings.filter((finding) => audited.has(finding.id)) }, "found");
        if (brief.points.length === 0) {
          planned[index] = { ...base, skipped: "nothing the audit found is still on the page; check the site by hand" };
          continue;
        }
        const freshIds = new Set(fresh.findings.map((finding) => finding.id));
        const gone = briefs[index].points.filter((point) => !freshIds.has(point.findingId)).map((point) => point.title);
        const note = gone.length > 0 ? { note: `no longer found: ${gone.join("; ")}` } : {};
        planned[index] = meetsPitchStrength(brief.strength, "medium")
          ? { ...planOutreachDrafts([brief], config, { emails, links, legal })[0], ...note }
          : { ...base, strength: brief.strength, skipped: `pitch strength ${brief.strength} after the re-check: not worth a cold email`, ...note };
      }
    }
    await writeOutreachDrafts(dir, planned);
  }

  return result;
}
