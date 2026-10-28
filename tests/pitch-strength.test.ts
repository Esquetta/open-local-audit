import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { meetsPitchStrength, pitchStrength } from "../src/pitch-brief.js";
import type { AuditReport, Finding } from "../src/types.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

function finding(id: string, severity: Finding["severity"] = "medium"): Finding {
  return { id, title: `Title for ${id}`, severity, category: "trust-contact", source: "test", recommendation: `Fix ${id}.`, evidence: [{ label: "test", value: "Missing" }] };
}

function report(ids: string[]): AuditReport {
  return { findings: ids.map((id) => finding(id)) } as unknown as AuditReport;
}

describe("pitch strength", () => {
  it("rates one problem an owner notices at once as strong, two smaller ones as medium, and minor points as weak", () => {
    expect(pitchStrength("", report(["single-h1", "phone-link-present"]))).toEqual({ strength: "strong", reason: "Title for phone-link-present" });
    expect(pitchStrength("", report(["page-indexable"])).strength).toBe("strong");
    expect(pitchStrength("", report(["meta-description-present", "current-date-signals", "single-h1"]))).toEqual({
      strength: "medium",
      reason: "Title for meta-description-present; Title for current-date-signals"
    });
    expect(pitchStrength("", report(["meta-description-present", "opening-hours-present", "map-link-present"]))).toEqual({
      strength: "weak",
      reason: "only minor points: Title for meta-description-present; Title for opening-hours-present; Title for map-link-present"
    });
    expect(pitchStrength("", report(["https-enabled", "single-h1"])).strength).toBe("weak");
    expect(pitchStrength("", report(["https-enabled", "phone-number-visible"])).strength).toBe("medium");
    expect(pitchStrength("", report([]))).toEqual({ strength: "none", reason: "no owner-visible problems" });
    expect(pitchStrength("", undefined)).toEqual({ strength: "none", reason: "no audit report" });
    expect(pitchStrength("Listed website domain does not resolve (site down; the domain may have lapsed)", undefined).strength).toBe("strong");
  });

  it("orders strengths so a minimum keeps everything at or above it", () => {
    expect(meetsPitchStrength("strong", "medium")).toBe(true);
    expect(meetsPitchStrength("medium", "medium")).toBe(true);
    expect(meetsPitchStrength("weak", "medium")).toBe(false);
    expect(meetsPitchStrength("none", "weak")).toBe(false);
  });

  it("filters the shortlist by pitch strength before taking the top leads, and shows the strength in pitch briefs", () => {
    const dir = mkdtempSync(join(tmpdir(), "open-local-audit-strength-"));
    tempDirs.push(dir);
    const write = (slug: string, ids: string[]) => {
      mkdirSync(join(dir, "reports", slug), { recursive: true });
      writeFileSync(join(dir, "reports", slug, "open-local-audit-report.json"), JSON.stringify({ findings: ids.map((id) => finding(id)) }));
    };
    write("weak-test", ["single-h1", "opening-hours-present"]);
    write("strong-test", ["phone-link-present"]);
    write("medium-test", ["meta-description-present", "current-date-signals"]);
    const header = "leadKey,label,websiteUrl,hasWebsite,auditStatus,priority,opportunityScore,opportunityReasons,reportPath";
    writeFileSync(
      join(dir, "leads.csv"),
      [
        header,
        "overture:1,Weak Clinic,https://weak.test/,yes,success,high,95,Audit score is below 60,weak-test/open-local-audit-report.html",
        "overture:2,Strong Clinic,https://strong.test/,yes,success,high,90,Audit score is below 60,strong-test/open-local-audit-report.html",
        "overture:3,Medium Clinic,https://medium.test/,yes,success,medium,65,Audit score is below 80,medium-test/open-local-audit-report.html",
        ""
      ].join("\n")
    );
    const run = (extra: string[]) =>
      spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "shortlist", "--input", join(dir, "leads.csv"), "--out", join(dir, "shortlist.json"), "--format", "json", ...extra], {
        encoding: "utf8"
      });

    const filtered = run(["--min-pitch-strength", "medium", "--top", "1", "--pitch-brief", join(dir, "briefs.md")]);
    expect(filtered.status).toBe(0);
    const result = JSON.parse(readFileSync(join(dir, "shortlist.json"), "utf8"));
    expect(result.leads.map((lead: { companyName: string; rank: number }) => [lead.rank, lead.companyName])).toEqual([[1, "Strong Clinic"]]);
    expect(result.filteredRows).toBe(1);
    expect(readFileSync(join(dir, "briefs.md"), "utf8")).toContain("- Pitch strength: strong (Title for phone-link-present)");

    const all = run(["--min-pitch-strength", "weak"]);
    expect(all.status).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "shortlist.json"), "utf8")).selected).toBe(3);

    const badTop = run(["--min-pitch-strength", "medium", "--top", "0"]);
    expect(badTop.status).toBe(1);
    expect(badTop.stderr).toContain("shortlist --top must be a positive integer");

    const invalid = run(["--min-pitch-strength", "great"]);
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain("shortlist --min-pitch-strength must be strong, medium, or weak");
  }, 60_000);
});
