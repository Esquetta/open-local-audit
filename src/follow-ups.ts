import { readFile } from "node:fs/promises";
import { buildFollowUpDraft, draftResultBase, legalSkipReason, planOutreachDrafts, readLeadEmails, writeOutreachDrafts, type LegalStatusIndex, type OutreachConfig, type OutreachDraftResult, type PlannedOutreachDraft } from "./outreach.js";
import { buildPitchBrief, readLeadReport, type PitchBrief } from "./pitch-brief.js";
import { auditProfiles } from "./profiles.js";
import { parseReviewTimestamp, readContactedLeads, readShortlistReviewCsv, type ShortlistLead } from "./shortlist.js";
import type { AuditReport } from "./types.js";

export interface FollowUpOptions {
  input: string;
  reviewCsv: string;
  reportsDir: string;
  outDir: string;
  afterDays: number;
  config: OutreachConfig;
  links: boolean;
  legal?: LegalStatusIndex;
  now?: Date;
}

export interface FollowUpResult {
  contacted: number;
  drafted: number;
  results: OutreachDraftResult[];
}

const dayMs = 24 * 60 * 60 * 1000;

function websiteKey(website: string): string {
  return website.trim().toLowerCase().replace(/^https?:\/\/(?:www\.)?/, "").replace(/\/+$/, "");
}

// The same polite fetch as discovery: robots rules, public addresses only, and bounded requests.
async function recheckSite(lead: ShortlistLead): Promise<AuditReport> {
  const { enrichWebsite } = await import("./website-enrichment.js");
  const { auditSnapshot } = await import("./audit.js");
  const enriched = await enrichWebsite(lead.website);
  if (enriched.status !== "success" || !enriched.snapshot) {
    throw new Error(enriched.error ?? "the site returned no auditable page");
  }
  return auditSnapshot(enriched.snapshot, undefined, { profile: auditProfiles.find((profile) => profile === lead.profile) });
}

// A follow-up says a problem is still there, so a lead needs both its first audit and a fresh check of the live site.
// Without either, or when nothing from the first audit remains, it gets a reason instead of a draft.
export async function runFollowUps(options: FollowUpOptions, recheck: (lead: ShortlistLead) => Promise<AuditReport> = recheckSite): Promise<FollowUpResult> {
  const input = await readFile(options.input, "utf8");
  const leads = readContactedLeads(input, readShortlistReviewCsv(await readFile(options.reviewCsv, "utf8")));
  const emails = readLeadEmails(input);
  const now = (options.now ?? new Date()).getTime();
  const briefs: PitchBrief[] = [];
  const firstBriefs = new Map<number, PitchBrief>();
  const goneNotes = new Map<number, string>();
  const reached = new Set<string>();
  const skipped: PlannedOutreachDraft[] = [];

  for (const lead of leads) {
    const skip = (reason: string) => skipped.push({ ...draftResultBase({ ...lead, strength: "none" }, { emails, legal: options.legal }), skipped: reason });
    const identities = [emails.get(lead.leadKey)?.toLowerCase(), websiteKey(lead.website)].filter((identity): identity is string => Boolean(identity));
    if (identities.some((identity) => reached.has(identity))) {
      skip("another contacted lead has the same address or website, so this would be a second follow-up");
      continue;
    }
    identities.forEach((identity) => reached.add(identity));
    const contactedAt = parseReviewTimestamp(lead.lastReviewedAt);
    if (contactedAt === undefined) {
      skip("the review CSV has no valid contact date");
      continue;
    }
    const due = contactedAt + options.afterDays * dayMs;
    if (now < due) {
      skip(`not due until ${new Date(due).toISOString().slice(0, 10)}`);
      continue;
    }
    const notCorporate = legalSkipReason(lead, options.legal);
    if (notCorporate) {
      skip(notCorporate);
      continue;
    }
    const { report: first } = await readLeadReport(options.reportsDir, lead.reportPath);
    if (!first) {
      skip("no earlier audit report to compare with");
      continue;
    }

    let fresh: AuditReport;
    try {
      fresh = await recheck(lead);
    } catch (error) {
      skip(`could not re-check the site: ${error instanceof Error ? error.message : "unknown error"}`);
      continue;
    }

    // "Still" only covers what the first email named. A named contact-button point needs the general rule's finding too,
    // because a profile rule alone no longer makes that claim.
    const firstBrief = buildPitchBrief(lead, first, "found");
    const named = new Set(firstBrief.points.map((point) => point.findingId));
    const namedContactButton = [...named].some((id) => id.endsWith("-cta"));
    const brief = buildPitchBrief(
      lead,
      { ...fresh, findings: fresh.findings.filter((finding) => named.has(finding.id) || (namedContactButton && finding.id === "primary-cta-present")) },
      "found"
    );
    if (brief.points.length === 0) {
      skip("nothing the first email named is still on the page; check the site by hand");
      continue;
    }
    // "No longer found" rather than "fixed": a newer version of a rule can also stop reporting a page.
    const freshIds = new Set(fresh.findings.map((finding) => finding.id));
    const gone = firstBrief.points.filter((point) => !freshIds.has(point.findingId)).map((point) => point.title);
    if (gone.length > 0) {
      goneNotes.set(lead.rank, `no longer found: ${gone.join("; ")}`);
    }
    briefs.push(brief);
    firstBriefs.set(lead.rank, firstBrief);
  }

  const planned = planOutreachDrafts(briefs, options.config, {
    emails,
    links: options.links,
    legal: options.legal,
    build: (brief, to) => buildFollowUpDraft(brief, firstBriefs.get(brief.rank) ?? brief, options.config, { to, links: options.links })
  }).map((entry) => {
    const note = goneNotes.get(entry.rank);
    return note ? { ...entry, note } : entry;
  });
  const all = [...planned, ...skipped].sort((left, right) => left.rank - right.rank);
  await writeOutreachDrafts(options.outDir, all, true);
  return {
    contacted: leads.length,
    drafted: planned.filter((entry) => entry.file).length,
    results: all.map(({ draft: _draft, ...entry }) => entry)
  };
}
