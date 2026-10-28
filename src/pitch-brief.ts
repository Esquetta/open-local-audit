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

// How strong a cold email the audit supports. Strong: one problem an owner notices at once (the site is down, hidden
// from Google, marked "Not secure", broken on phones, or its number cannot be tapped). Medium: at least two smaller
// owner-visible problems. Weak: only minor points (headings, opening hours, map links), not worth a cold email.
export type PitchStrength = "strong" | "medium" | "weak" | "none";

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
  strength: PitchStrength;
  strengthReason: string;
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
  [/^domain-expiry$/, "The domain registration is about to run out or has lapsed; if it is not renewed, the website and email stop working."],
  [/^page-indexable$/, "The page tells Google not to list it, so it cannot appear in search results."],
  [/^robots-txt-allows-page$/, "The site's robots.txt tells Google not to crawl the page, so it can drop out of search results."],
  [/^https-enabled$/, "Browsers mark the site as \"Not secure\"."],
  [/^viewport-present$/, "The page does not adapt to phones, where most local searches happen."],
  [/^phone-link-present$/, "The phone number is not tap-to-call on mobile."],
  [/^phone-number-visible$/, "No phone number is shown, so visitors who want to call have to look elsewhere."],
  [/^primary-cta-present$|-cta$/, "There is no clear booking or contact button, so ready-to-buy visitors have to hunt for the next step."],
  [/^contact-form-present$/, "Visitors who do not want to call have no way to send an enquiry."],
  [/^broken-internal-links$/, "Some links on the site lead to dead pages."],
  [/^cookie-consent-present$/, "The site loads analytics or advertising tags and no cookie consent banner was found; UK and EU cookie rules generally expect consent before non-essential tracking."],
  [/^privacy-policy-link-present$/, "There is no privacy policy link, which data protection rules expect from sites that take enquiries or use analytics."],
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

export const maxPoints = 3;

const strongPitchIds = new Set([
  "website-placeholder",
  "http-status-ok",
  "tls-certificate-valid",
  "domain-expiry",
  "page-indexable",
  "robots-txt-allows-page",
  "viewport-present",
  "phone-link-present",
  "title-present"
]);
const mediumPitchPattern =
  // https-enabled only says the final URL is http; HTTPS may still work, so it is not enough on its own.
  /^(?:https-enabled|phone-number-visible|contact-form-present|broken-internal-links|meta-description-present|mixed-content-absent|current-date-signals|visible-address-present|primary-cta-present)$|-cta$/;
const strengthRank: Record<PitchStrength, number> = { strong: 3, medium: 2, weak: 1, none: 0 };

export function pitchStrength(leadReason: string, report: AuditReport | undefined): { strength: PitchStrength; reason: string } {
  if (/domain does not resolve/i.test(leadReason)) {
    return { strength: "strong", reason: "the listed website does not load" };
  }
  const points = report ? pitchPoints(report) : [];
  const strong = points.find((point) => strongPitchIds.has(point.findingId));
  if (strong) {
    return { strength: "strong", reason: strong.title };
  }
  const medium = points.filter((point) => mediumPitchPattern.test(point.findingId));
  if (medium.length >= 2) {
    return { strength: "medium", reason: medium.slice(0, 2).map((point) => point.title).join("; ") };
  }
  if (points.length > 0) {
    return { strength: "weak", reason: `only minor points: ${points.slice(0, 3).map((point) => point.title).join("; ")}` };
  }
  return { strength: "none", reason: report ? "no owner-visible problems" : "no audit report" };
}

export function meetsPitchStrength(strength: PitchStrength, minimum: PitchStrength): boolean {
  return strengthRank[strength] >= strengthRank[minimum];
}
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

// The findings a business owner would notice, most pressing first, one per reason.
export function pitchPoints(report: AuditReport): PitchPoint[] {
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
  if (/domain does not resolve/i.test(lead.reason)) {
    return "Website rescue or starter website: the listed website no longer loads because its domain does not resolve.";
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
  const dead = /domain does not resolve/i.test(lead.reason);
  const checks = dead
    ? [
        "Open the listed website in a browser to confirm it does not load.",
        "Confirm the business still trades (Companies House status, phone, recent reviews) before contacting it; a dead website can also mean the business has closed.",
        "Avoid emailing an address at that domain; it may bounce. Call or use another public channel."
      ]
    : ["Re-check each pitch point on the live site; audits can be wrong or out of date."];
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
  const { strength, reason: strengthReason } = pitchStrength(lead.reason, report);
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
    strength,
    strengthReason,
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
      `- Pitch strength: ${brief.strength} (${inline(brief.strengthReason)})`,
      `- Priority: ${brief.priority || "unknown"}${brief.opportunityScore === undefined ? "" : ` (opportunity score ${brief.opportunityScore})`}`,
      `- Contact: ${brief.contactChannel ? inline(brief.contactChannel) : "unknown"}${brief.contactabilityReason ? ` - ${inline(brief.contactabilityReason)}` : ""}`,
      ...(brief.reasons.length > 0 ? [`- Why it was shortlisted: ${brief.reasons.map(inline).join("; ")}`] : []),
      `- Lead key: ${inline(brief.leadKey)}`,
      ""
    );

    if (brief.reportStatus !== "found") {
      lines.push(
        brief.reasons.some((reason) => /domain does not resolve/i.test(reason))
          ? "The listed website does not load: its domain has no DNS record. Check the site in a browser to confirm before using it as the pitch."
          : brief.reportStatus === "none"
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
