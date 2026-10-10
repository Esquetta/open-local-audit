import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { auditSnapshot } from "../src/audit.js";
import { buildPitchBrief, readLeadReport, renderPitchBriefsMarkdown } from "../src/pitch-brief.js";
import type { ShortlistLead } from "../src/shortlist.js";
import type { AuditReport, Finding } from "../src/types.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "open-local-audit-pitch-"));
  tempDirs.push(dir);
  return dir;
}

function lead(overrides: Partial<ShortlistLead> = {}): ShortlistLead {
  return {
    rank: 1,
    companyName: "Example Dental",
    website: "https://example.test/",
    segment: "dental",
    profile: "dental",
    priority: "high",
    auditStatus: "success",
    hasWebsite: "yes",
    source: "overture",
    score: 40,
    opportunityScore: 80,
    topFinding: "Meta description is missing",
    contactConfidence: "Medium",
    preferredContactChannel: "email",
    contactabilityReason: "Public email found",
    reason: "Audit score is below 60; Top finding: Meta description is missing",
    reportPath: "example-test/open-local-audit-report.html",
    leadKey: "overture:1",
    reviewStatus: "new",
    reviewReason: "",
    lastReviewedAt: "",
    ...overrides
  };
}

function finding(id: string, severity: Finding["severity"] = "medium", value = "Missing"): Finding {
  return {
    id,
    title: `Title for ${id}`,
    severity,
    category: "search-basics",
    evidence: [{ label: "Source", value }],
    recommendation: `Fix ${id}.`,
    source: "Source"
  };
}

function report(findings: Finding[], identity?: "matched" | "uncertain"): AuditReport {
  const base = auditSnapshot({ url: "https://example.test/", finalUrl: "https://example.test/", statusCode: 200, headers: {}, html: "" });
  return {
    ...base,
    findings,
    ...(identity ? { businessIdentity: { status: identity, reasons: [], evidence: [] } as unknown as AuditReport["businessIdentity"] } : {})
  };
}

describe("pitch briefs", () => {
  it("picks up to three owner-visible findings in pitch order, one per reason", () => {
    const brief = buildPitchBrief(
      lead(),
      report([
        finding("robots-txt-present", "low"),
        finding("meta-description-present"),
        finding("sitemap-xml-present", "medium", "Not checked"),
        finding("dental-appointment-cta"),
        finding("primary-cta-present"),
        finding("phone-link-present", "high"),
        finding("current-date-signals", "low", "© 2021"),
        finding("viewport-present", "high")
      ]),
      "found"
    );

    expect(brief.points.map((point) => point.findingId)).toEqual(["viewport-present", "phone-link-present", "dental-appointment-cta"]);
    expect(brief.morePoints).toBe(2);
    expect(brief.offer).toBe("Quick-fix sprint for the 3 points below, with the remaining 2 as a follow-up tune-up.");
    expect(brief.points[1]).toMatchObject({
      severity: "high",
      whyItMatters: "The phone number is not tap-to-call on mobile.",
      evidence: "Missing",
      fix: "Fix phone-link-present."
    });
    expect(brief.reasons).toEqual(["Audit score is below 60", "Top finding: Meta description is missing"]);
  });

  it("chooses the offer from the site state", () => {
    expect(buildPitchBrief(lead(), report([finding("website-placeholder", "high"), finding("title-present")]), "found").offer).toBe(
      "Starter website: the business has no working site to fix."
    );
    expect(buildPitchBrief(lead({ hasWebsite: "no", reportPath: "" }), undefined, "none").offer).toBe(
      "Starter website: the business has no working site to fix."
    );
    expect(buildPitchBrief(lead(), undefined, "missing").offer).toBe("No offer yet: audit the website first.");
    expect(buildPitchBrief(lead(), report([finding("robots-txt-present", "low")]), "found").offer).toMatch(/^No quick-fix pitch/);
    expect(buildPitchBrief(lead(), report([finding("title-present")]), "found").offer).toBe("Quick-fix sprint for the point below.");
  });

  it("adds checks for uncertain identity and chain or location flags", () => {
    const matched = buildPitchBrief(lead(), report([finding("title-present")], "matched"), "found").checks;
    const flagged = buildPitchBrief(
      lead({ priority: "low", reason: "3 leads in this search share mydentist.co.uk; this looks like a multi-location brand" }),
      report([finding("title-present")], "uncertain"),
      "found"
    ).checks;

    expect(matched).toHaveLength(3);
    expect(matched.join(" ")).toContain("PECR");
    expect(buildPitchBrief(lead({ priority: "low", reason: "Audit score is 80 or higher" }), report([]), "found").checks).toHaveLength(3);
    for (const reason of [
      "Website is on a public-sector domain (nhs.uk); this is not a small-business lead",
      "3 leads in this search share mydentist.co.uk; this looks like a multi-location brand",
      "Website URL is a branch page on a larger site (/our-practices/…)",
      "Phone area code 01934 differs from 0113, which most leads in this search use; the business may be listed in the wrong place"
    ]) {
      expect(buildPitchBrief(lead({ reason: `Audit score is below 60; ${reason}` }), report([]), "found").checks).toContain(
        "Confirm this is an independent local business in the searched area, not a chain branch or public body."
      );
    }
    expect(flagged).toContain("Confirm the website belongs to this business; the identity check is uncertain.");
    expect(flagged).toContain(
      "Confirm this is an independent local business in the searched area, not a chain branch or public body."
    );
  });

  it("reads the JSON report next to any linked report file and stays inside the reports directory", async () => {
    const reportsDir = tempDir();
    mkdirSync(join(reportsDir, "example-test"));
    writeFileSync(join(reportsDir, "example-test", "open-local-audit-report.json"), JSON.stringify(report([finding("title-present")])));
    mkdirSync(join(reportsDir, "broken"));
    writeFileSync(join(reportsDir, "broken", "open-local-audit-report.json"), "{");
    mkdirSync(join(reportsDir, "partial"));
    writeFileSync(
      join(reportsDir, "partial", "open-local-audit-report.json"),
      JSON.stringify({ ...report([finding("title-present")]), findings: [null, { id: "phone-link-present" }, { ...finding("viewport-present"), severity: "urgent" }, { ...finding("title-present"), evidence: undefined }] })
    );
    const partial = await readLeadReport(reportsDir, "partial/open-local-audit-report.json");
    expect(partial.report?.findings.map((item) => item.id)).toEqual(["title-present"]);
    expect(buildPitchBrief(lead(), partial.report, "found").points[0]?.evidence).toBe("");

    expect((await readLeadReport(reportsDir, "example-test/open-local-audit-report.html")).status).toBe("found");
    expect((await readLeadReport(reportsDir, "example-test/open-local-audit-report.html")).report?.findings[0]?.id).toBe("title-present");
    expect(await readLeadReport(reportsDir, "  ")).toEqual({ status: "none" });
    expect(await readLeadReport(reportsDir, "broken/open-local-audit-report.md")).toEqual({ status: "missing" });
    expect(await readLeadReport(reportsDir, "missing/open-local-audit-report.md")).toEqual({ status: "missing" });
    expect(await readLeadReport(reportsDir, "../outside/open-local-audit-report.md")).toEqual({ status: "missing" });
  });

  it("renders escaped Markdown with points, missing reports, and checklists", () => {
    const markdown = renderPitchBriefsMarkdown(
      [
        buildPitchBrief(lead({ companyName: "Smile <Studio> *Leeds*" }), report([finding("title-present")]), "found"),
        buildPitchBrief(lead({ rank: 2, companyName: "No Report Dental", reportPath: "" }), undefined, "none"),
        buildPitchBrief(lead({ rank: 3, companyName: "Broken Dental" }), undefined, "missing")
      ],
      "2026-10-10T00:00:00.000Z"
    );

    expect(markdown).toContain("Generated 2026-10-10T00:00:00.000Z for 3 shortlisted leads.");
    expect(markdown).toContain("## 1. Smile \\<Studio\\> \\*Leeds\\*");
    expect(markdown).toContain(
      "1. **Title for title-present** (medium). The page has no title, so Google and browser tabs show a generic label."
    );
    expect(markdown).toContain("No audit report is linked to this lead, so there are no pitch points yet.");
    expect(markdown).toContain("The linked audit report could not be read, so there are no pitch points yet.");
    expect(markdown).toContain("- [ ] Say who you are, include your company details, and give an easy way to opt out.");
  });

  it("writes pitch briefs from the shortlist CLI", () => {
    const dir = tempDir();
    const reportsDir = join(dir, "reports", "example-test");
    mkdirSync(reportsDir, { recursive: true });
    writeFileSync(join(reportsDir, "open-local-audit-report.json"), JSON.stringify(report([finding("phone-link-present", "high")])));
    const header = "leadKey,label,websiteUrl,hasWebsite,auditStatus,priority,opportunityScore,opportunityReasons,reportPath";
    writeFileSync(
      join(dir, "leads.csv"),
      `${header}\noverture:1,Example Dental,https://example.test/,yes,success,high,80,Audit score is below 60,example-test/open-local-audit-report.html\n`
    );
    const run = (extra: string[]) =>
      spawnSync(
        process.execPath,
        ["--import", "tsx", "src/cli.ts", "shortlist", "--input", join(dir, "leads.csv"), "--out", join(dir, "shortlist.md"), ...extra],
        { encoding: "utf8" }
      );

    const defaultDir = run(["--pitch-brief", join(dir, "briefs", "pitch.md")]);
    expect(defaultDir.status).toBe(0);
    expect(defaultDir.stdout).toContain(`Pitch brief: ${join(dir, "briefs", "pitch.md")}`);
    expect(readFileSync(join(dir, "briefs", "pitch.md"), "utf8")).toContain("The phone number is not tap-to-call on mobile.");

    const otherDir = run(["--pitch-brief", join(dir, "pitch-other.md"), "--reports-dir", join(dir, "elsewhere")]);
    expect(otherDir.status).toBe(0);
    expect(readFileSync(join(dir, "pitch-other.md"), "utf8")).toContain("The linked audit report could not be read");

    const withoutBrief = run(["--reports-dir", join(dir, "reports")]);
    expect(withoutBrief.status).toBe(1);
    expect(withoutBrief.stderr).toContain("--reports-dir is only used with --pitch-brief");

    // "start" keeps report folders next to leads.csv instead of in a reports folder.
    const startLayout = join(dir, "start");
    mkdirSync(join(startLayout, "example-test"), { recursive: true });
    writeFileSync(join(startLayout, "example-test", "open-local-audit-report.json"), JSON.stringify(report([finding("title-present")])));
    writeFileSync(join(startLayout, "leads.csv"), readFileSync(join(dir, "leads.csv")));
    const fromStart = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", "shortlist", "--input", join(startLayout, "leads.csv"), "--out", join(startLayout, "shortlist.md"), "--pitch-brief", join(startLayout, "pitch.md")],
      { encoding: "utf8" }
    );
    expect(fromStart.status).toBe(0);
    expect(readFileSync(join(startLayout, "pitch.md"), "utf8")).toContain("The page has no title");
  }, 60_000);
});
