import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { ShortlistLead } from "./shortlist.js";
import type { AuditReport, Finding } from "./types.js";

export interface PitchPoint {
  findingId: string;
  severity: Finding["severity"];
  title: string;
  whyItMatters: string;
  evidence: string;
  fix: string;
}

export type PitchReportStatus = "found" | "missing" | "none";

export interface PitchBrief {
  rank: number;
  companyName: string;
  website: string;
  leadKey: string;
  priority: string;
  opportunityScore?: number;
  reasons: string[];
  contactChannel: string;
  contactabilityReason: string;
  reportStatus: PitchReportStatus;
  offer: string;
  points: PitchPoint[];
  morePoints: number;
  checks: string[];
}

// Only findings a business owner understands without technical background become pitch points, in this order.
// Everything else stays in the full audit report.
const pitchReasons: Array<[RegExp, string]> = [
  [/^website-placeholder$/, "People who find the business online land on a placeholder instead of a website."],
  [/^http-status-ok$/, "The page returns an error, so visitors and Google may not see it at all."],
  [/^tls-certificate-valid$/, "Browsers show, or will soon show, a security warning instead of the site."],
  [/^page-indexable$/, "The page tells Google not to list it, so it cannot appear in search results."],
  [/^https-enabled$/, "Browsers mark the site as \"Not secure\"."],
  [/^viewport-present$/, "The page does not adapt to phones, where most local searches happen."],
  [/^phone-link-present$/, "The phone number is not tap-to-call on mobile."],
  [/^primary-cta-present$|-cta$/, "There is no clear booking or contact button, so ready-to-buy visitors have to hunt for the next step."],
  [/^contact-form-present$/, "Visitors who do not want to call have no way to send an enquiry."],
  [/^broken-internal-links$/, "Some links on the site lead to dead pages."],
  [/^title-present$/, "The page has no title, so Google and browser tabs show a generic label."],
  [/^meta-description-present$/, "Without a meta description, Google writes its own snippet for the search result."],
  [/^single-h1$/, "The page has no clear main heading telling visitors and Google what the business does."],
  [/^mixed-content-absent$/, "Some files load insecurely, so browsers may block them or warn visitors."],
  [/^current-date-signals$/, "An outdated year on the page makes the business look inactive."],
  [/^visible-address-present$/, "Visitors cannot see where the business is."],
  [/^opening-hours-present$/, "Visitors cannot see when the business is open."],
  [/^map-link-present$/, "There is no map or directions link."],
  [/^image-alt-coverage$/, "Images have no text descriptions, which hurts accessibility and image search."],
  [/^review-cue-present$/, "No reviews or testimonials are shown, so new visitors have less reason to trust the business."]
];

const maxPoints = 3;
// The chain, public-body, and location reasons that discovery writes into opportunityReasons.
const placementFlagPattern =
  /public-sector domain|looks like a multi-location brand|branch page on a larger site|phone area code \S+ differs/i;
const severities = new Set(["high", "medium", "low", "info"]);

function pitchRank(finding: Finding): number {
  return pitchReasons.findIndex(([pattern]) => pattern.test(finding.id));
}

function evidenceText(finding: Finding): string {
  return Array.isArray(finding.evidence) ? finding.evidence.map((item) => item?.value ?? "").join("; ") : "";
}

function pitchPoints(report: AuditReport): PitchPoint[] {
  const seen = new Set<number>();
  return report.findings
    .filter((finding) => pitchRank(finding) >= 0 && !/^not checked$/i.test(evidenceText(finding).trim()))
    .sort((left, right) => pitchRank(left) - pitchRank(right))
    // Profile rules can repeat a generic finding (a dental appointment CTA and the general CTA), so keep one point per reason.
    .filter((finding) => !seen.has(pitchRank(finding)) && Boolean(seen.add(pitchRank(finding))))
    .map((finding) => ({
      findingId: finding.id,
      severity: finding.severity,
      title: finding.title,
      whyItMatters: pitchReasons[pitchRank(finding)][1],
      evidence: evidenceText(finding),
      fix: finding.recommendation
    }));
}

function offerFor(lead: ShortlistLead, report: AuditReport | undefined, points: PitchPoint[]): string {
  if (points.some((point) => point.findingId === "website-placeholder") || lead.hasWebsite === "no") {
    return "Starter website: the business has no working site to fix.";
  }
  if (!report) {
    return "No offer yet: audit the website first.";
  }
  if (points.length === 0) {
    return "No quick-fix pitch: the audit found nothing an owner would notice. Keep for monitoring.";
  }
  return points.length > maxPoints
    ? `Quick-fix sprint for the ${maxPoints} points below, with the remaining ${points.length - maxPoints} as a follow-up tune-up.`
    : `Quick-fix sprint for the ${points.length === 1 ? "point" : `${points.length} points`} below.`;
}

function checksFor(lead: ShortlistLead, report: AuditReport | undefined): string[] {
  const checks = ["Re-check each pitch point on the live site; audits can be wrong or out of date."];
  const identity = report?.businessIdentity?.status;
  if (identity && identity !== "matched") {
    checks.push(`Confirm the website belongs to this business; the identity check is ${identity}.`);
  }
  if (placementFlagPattern.test(lead.reason)) {
    checks.push("Confirm this is an independent local business in the searched area, not a chain branch or public body.");
  }
  checks.push(
    "Check the business's legal form and local rules before a cold email. In the UK (PECR), unsolicited marketing email is allowed to limited companies and LLPs but needs prior consent from sole traders and partnerships; use the phone or the contact form instead.",
    "Say who you are, include your company details, and give an easy way to opt out."
  );
  return checks;
}

export function buildPitchBrief(lead: ShortlistLead, report: AuditReport | undefined, reportStatus: PitchReportStatus): PitchBrief {
  const points = report ? pitchPoints(report) : [];
  return {
    rank: lead.rank,
    companyName: lead.companyName,
    website: lead.website,
    leadKey: lead.leadKey,
    priority: lead.priority,
    opportunityScore: lead.opportunityScore,
    reasons: lead.reason
      .split(";")
      .map((reason) => reason.trim())
      .filter(Boolean),
    contactChannel: lead.preferredContactChannel,
    contactabilityReason: lead.contactabilityReason,
    reportStatus,
    offer: offerFor(lead, report, points),
    points: points.slice(0, maxPoints),
    morePoints: Math.max(points.length - maxPoints, 0),
    checks: checksFor(lead, report)
  };
}

// Lead CSVs store the report path relative to the reports directory, pointing at any of the report formats.
export async function readLeadReport(
  reportsDir: string,
  reportPath: string
): Promise<{ report?: AuditReport; status: PitchReportStatus }> {
  if (!reportPath.trim()) {
    return { status: "none" };
  }

  const resolved = resolve(reportsDir, reportPath.trim());
  const inside = relative(resolve(reportsDir), resolved);
  if (!inside || inside.startsWith("..") || isAbsolute(inside)) {
    return { status: "missing" };
  }

  try {
    const content = await readFile(join(dirname(resolved), "open-local-audit-report.json"), "utf8");
    const report = JSON.parse(content.replace(/^\uFEFF/, "")) as AuditReport;
    if (!Array.isArray(report.findings)) {
      return { status: "missing" };
    }
    // Skip malformed findings instead of failing the whole brief.
    const findings = report.findings.filter(
      (finding) =>
        typeof finding?.id === "string" &&
        typeof finding.title === "string" &&
        typeof finding.recommendation === "string" &&
        severities.has(finding.severity)
    );
    return { report: { ...report, findings }, status: "found" };
  } catch {
    return { status: "missing" };
  }
}

function inline(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/([`*_\[\]<>|])/g, "\\$1");
}

export function renderPitchBriefsMarkdown(briefs: PitchBrief[], generatedAt: string): string {
  const lines = [
    "# Pitch Briefs",
    "",
    `Generated ${generatedAt} for ${briefs.length} shortlisted lead${briefs.length === 1 ? "" : "s"}.`,
    "These are operator notes for writing your own outreach, not messages to send as they are.",
    ""
  ];

  for (const brief of briefs) {
    lines.push(
      `## ${brief.rank}. ${inline(brief.companyName)}`,
      "",
      `- Website: ${brief.website ? inline(brief.website) : "None found"}`,
      `- Offer: ${brief.offer}`,
      `- Priority: ${brief.priority || "unknown"}${brief.opportunityScore === undefined ? "" : ` (opportunity score ${brief.opportunityScore})`}`,
      `- Contact: ${brief.contactChannel ? inline(brief.contactChannel) : "unknown"}${brief.contactabilityReason ? ` - ${inline(brief.contactabilityReason)}` : ""}`,
      ...(brief.reasons.length > 0 ? [`- Why it was shortlisted: ${brief.reasons.map(inline).join("; ")}`] : []),
      `- Lead key: ${inline(brief.leadKey)}`,
      ""
    );

    if (brief.reportStatus !== "found") {
      lines.push(
        brief.reportStatus === "none"
          ? "No audit report is linked to this lead, so there are no pitch points yet."
          : "The linked audit report could not be read, so there are no pitch points yet.",
        ""
      );
    } else if (brief.points.length > 0) {
      lines.push("### Pitch points", "");
      brief.points.forEach((point, index) => {
        lines.push(
          `${index + 1}. **${inline(point.title)}** (${point.severity}). ${point.whyItMatters}`,
          `   - Evidence: ${inline(point.evidence)}`,
          `   - Fix: ${inline(point.fix)}`
        );
      });
      if (brief.morePoints > 0) {
        lines.push("", `${brief.morePoints} more owner-visible issue${brief.morePoints === 1 ? "" : "s"} in the full report.`);
      }
      lines.push("");
    }

    lines.push("### Before contacting", "", ...brief.checks.map((check) => `- [ ] ${check}`), "");
  }

  return `${lines.join("\n")}\n`;
}
