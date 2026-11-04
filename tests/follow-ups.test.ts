import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runFollowUps } from "../src/follow-ups.js";
import { readLegalStatus, type OutreachConfig } from "../src/outreach.js";
import type { ShortlistLead } from "../src/shortlist.js";
import type { AuditReport, Finding } from "../src/types.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

const config: OutreachConfig = {
  senderName: "Sam Sender",
  company: "EXAMPLE STUDIO LTD",
  companyNumber: "01234567",
  offer: "I run a fixed-price 48-hour fix.",
  callToAction: "If useful, I can send the exact changes first, free.",
  followUp: "If useful, I can send a short free note. The fix stays at a fixed price."
};

const now = new Date("2026-11-06T09:00:00.000Z");

function finding(id: string): Finding {
  return { id, title: `Title for ${id}`, severity: "medium", category: "trust-contact", source: "test", recommendation: `Fix ${id}.`, evidence: [{ label: "test", value: "Missing" }] };
}

function report(ids: string[]): AuditReport {
  return { findings: ids.map(finding) } as unknown as AuditReport;
}

// Each lead: first audit findings, the live check's findings (or an error), and the date it was contacted.
function setup(leads: Array<{ slug: string; name: string; first?: string[]; contactedAt?: string; status?: string }>): { dir: string; options: Parameters<typeof runFollowUps>[0] } {
  const dir = mkdtempSync(join(tmpdir(), "open-local-audit-follow-ups-"));
  tempDirs.push(dir);
  const csv = ["leadKey,label,websiteUrl,hasWebsite,auditStatus,priority,opportunityScore,opportunityReasons,publicEmail,reportPath"];
  const review = ["leadKey,reviewStatus,reviewReason,lastReviewedAt"];
  for (const lead of leads) {
    csv.push(`overture:${lead.slug},${lead.name},https://${lead.slug}.test/,yes,success,high,90,Audit score is below 60,info@${lead.slug}.test,${lead.slug}/open-local-audit-report.html`);
    review.push(`overture:${lead.slug},${lead.status ?? "contacted"},,${lead.contactedAt ?? "2026-11-01T09:00:00.000Z"}`);
    if (lead.first) {
      mkdirSync(join(dir, "reports", lead.slug), { recursive: true });
      writeFileSync(join(dir, "reports", lead.slug, "open-local-audit-report.json"), JSON.stringify({ findings: lead.first.map(finding) }));
    }
  }
  writeFileSync(join(dir, "leads.csv"), `${csv.join("\n")}\n`);
  writeFileSync(join(dir, "review.csv"), `${review.join("\n")}\n`);
  return {
    dir,
    options: { input: join(dir, "leads.csv"), reviewCsv: join(dir, "review.csv"), reportsDir: join(dir, "reports"), outDir: join(dir, "drafts"), afterDays: 5, config, links: false, now }
  };
}

function live(results: Record<string, string[] | Error>) {
  return async (lead: ShortlistLead): Promise<AuditReport> => {
    const result = results[lead.leadKey.replace("overture:", "")];
    if (result instanceof Error) {
      throw result;
    }
    return report(result);
  };
}

function decodeBody(eml: string): string {
  return Buffer.from(eml.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf8").replace(/\r\n/g, "\n");
}

describe("follow-up drafts", () => {
  it("names only the points still on the page, in reply to the first email", async () => {
    const { dir, options } = setup([{ slug: "smith", name: "Smith Ltd", first: ["phone-link-present", "meta-description-present", "current-date-signals"] }]);

    const result = await runFollowUps(options, live({ smith: ["meta-description-present", "current-date-signals", "viewport-present"] }));

    expect(result).toMatchObject({ contacted: 1, drafted: 1, results: [{ file: "01-smith-ltd.eml", to: "info@smith.test", note: "no longer found: Title for phone-link-present" }] });
    const eml = readFileSync(join(dir, "drafts", "01-smith-ltd.eml"), "utf8");
    expect(eml).toContain("To: info@smith.test\r\n");
    // The first email's subject named the point the owner has since fixed; the reply keeps it so the thread reads as one.
    expect(eml).toContain("Subject: Re: Tap-to-call on the Smith website\r\n");
    expect(decodeBody(eml)).toBe(
      [
        "Hi,",
        "",
        "Just following up on my earlier email about your website. These things are still on the page:",
        "- Without a meta description, Google writes its own snippet for the search result.",
        "- An outdated year on the page makes the business look inactive.",
        "",
        "If useful, I can send a short free note. The fix stays at a fixed price.",
        "",
        "This is my only follow-up, so no worries if the timing isn't right.",
        "",
        "Sam Sender",
        "EXAMPLE STUDIO LTD",
        "",
        "If you would rather not hear from me, just reply \"no\" and I will not contact you again.",
        "EXAMPLE STUDIO LTD, Company No. 01234567.",
        ""
      ].join("\n")
    );
    const index = readFileSync(join(dir, "drafts", "index.md"), "utf8");
    expect(index).toContain("# Follow-up Drafts");
    expect(index).toContain("Send it as a reply in the first email's thread");
    expect(index).toContain("mark the lead `followed-up`");
    expect(index).toContain("01-smith-ltd.eml; no longer found: Title for phone-link-present |");
  });

  it("gives a reason instead of a draft when a claim cannot be made", async () => {
    const { dir, options } = setup([
      { slug: "fixed", name: "Fixed Clinic", first: ["phone-link-present"] },
      { slug: "minor", name: "Minor Clinic", first: ["phone-link-present", "opening-hours-present"] },
      { slug: "down", name: "Down Clinic", first: ["phone-link-present"] },
      { slug: "noreport", name: "No Report Clinic" },
      { slug: "early", name: "Early Clinic", first: ["phone-link-present"], contactedAt: "2026-11-04T09:00:00.000Z" },
      { slug: "nodate", name: "No Date Clinic", first: ["phone-link-present"], contactedAt: "soon" },
      { slug: "newpage", name: "New Page Clinic", first: ["phone-link-present"] }
    ]);
    const checked: string[] = [];
    const recheck = live({
      fixed: ["viewport-present"],
      minor: ["opening-hours-present"],
      down: new Error("robots.txt could not be reached"),
      newpage: ["website-placeholder"]
    });

    const result = await runFollowUps(options, (lead) => {
      checked.push(lead.companyName);
      return recheck(lead);
    });

    expect(result.drafted).toBe(0);
    expect(result.results.map(({ companyName, skipped }) => [companyName, skipped])).toEqual([
      ["Fixed Clinic", "nothing the first email named is still on the page; check the site by hand"],
      ["Minor Clinic", "pitch strength weak: not worth a cold email"],
      ["Down Clinic", "could not re-check the site: robots.txt could not be reached"],
      ["No Report Clinic", "no earlier audit report to compare with"],
      ["Early Clinic", "not due until 2026-11-09"],
      ["No Date Clinic", "the review CSV has no valid contact date"],
      ["New Page Clinic", "nothing the first email named is still on the page; check the site by hand"]
    ]);
    // Leads that cannot get a draft anyway are not fetched.
    expect(checked).toEqual(["Fixed Clinic", "Minor Clinic", "Down Clinic", "New Page Clinic"]);
    // A skipped lead still shows its address, so the index does not say none was found.
    expect(result.results[0]).toMatchObject({ companyName: "Fixed Clinic", to: "info@fixed.test" });
    expect(readdirSync(join(dir, "drafts"))).toEqual(["index.md"]);
  });

  it("only follows up leads marked contacted, once", async () => {
    const { options } = setup([
      { slug: "done", name: "Done Clinic", first: ["phone-link-present"], status: "followed-up" },
      { slug: "stop", name: "Stop Clinic", first: ["phone-link-present"], status: "do-not-contact" },
      { slug: "new", name: "New Clinic", first: ["phone-link-present"], status: "new" },
      { slug: "open", name: "Open Clinic", first: ["phone-link-present"], status: "Contacted" }
    ]);

    const result = await runFollowUps(options, live({ open: ["phone-link-present"] }));

    expect(result.contacted).toBe(1);
    expect(result.results.map((entry) => entry.companyName)).toEqual(["Open Clinic"]);
  });

  it("never reaches a business twice or one that was not contacted", async () => {
    const { options } = setup([
      { slug: "open", name: "Smith Dental", first: ["phone-link-present"] },
      { slug: "open2", name: "Jones Dental", first: ["phone-link-present"] },
      { slug: "open3", name: "Lee Dental", first: ["phone-link-present"] }
    ]);
    const header = "leadKey,label,websiteUrl,hasWebsite,auditStatus,priority,opportunityScore,opportunityReasons,publicEmail,reportPath";
    const row = (key: string, label: string, site: string, email: string, report: string) =>
      `overture:${key},${label},https://${site}.test/,yes,success,high,90,Audit score is below 60,${email},${report}/open-local-audit-report.html`;
    writeFileSync(
      options.input,
      [
        header,
        row("open", "Smith Dental", "open", "info@open.test", "open"),
        // Same label and website as a contacted lead, but its own row says it already had its follow-up.
        row("done", "Smith Dental", "open", "other@open.test", "open"),
        // Same label as a contacted lead, but never contacted itself.
        row("never", "Smith Dental", "never", "info@never.test", "open"),
        // The same row twice.
        row("open2", "Jones Dental", "open2", "info@open2.test", "open2"),
        row("open2", "Jones Dental", "open2", "info@open2.test", "open2"),
        // Contacted, but another lead above already uses this address.
        row("open3", "Lee Dental", "open3", "info@open2.test", "open3"),
        ""
      ].join("\n")
    );
    writeFileSync(
      options.reviewCsv,
      [
        "leadKey,label,websiteUrl,reviewStatus,reviewReason,lastReviewedAt",
        "overture:open,Smith Dental,https://open.test/,contacted,,2026-11-01T09:00:00.000Z",
        "overture:done,Smith Dental,https://open.test/,followed-up,,2026-11-01T09:00:00.000Z",
        "overture:open2,Jones Dental,https://open2.test/,contacted,,2026-11-01T09:00:00.000Z",
        "overture:open3,Lee Dental,https://open3.test/,contacted,,2026-11-01T09:00:00.000Z",
        ""
      ].join("\n")
    );
    const checked: string[] = [];

    const result = await runFollowUps(options, async (lead) => {
      checked.push(lead.leadKey);
      return report(["phone-link-present"]);
    });

    expect(result.results.map(({ companyName, to, file, skipped }) => [companyName, to, file ?? skipped])).toEqual([
      ["Smith Dental", "info@open.test", "01-smith-dental.eml"],
      ["Jones Dental", "info@open2.test", "02-jones-dental.eml"],
      ["Lee Dental", "info@open2.test", "another contacted lead has the same address or website, so this would be a second follow-up"]
    ]);
    expect(checked).toEqual(["overture:open", "overture:open2"]);
  });

  it("only says still about the points the first email named", async () => {
    const { options } = setup([
      { slug: "smith", name: "Smith Clinic", first: ["viewport-present", "phone-link-present", "title-present", "meta-description-present"] },
      { slug: "legal", name: "Legal Clinic", first: ["lawyer-consultation-cta", "primary-cta-present", "phone-link-present"] },
      { slug: "extra", name: "Extra Clinic", first: ["tls-certificate-valid", "page-indexable", "viewport-present", "primary-cta-present"] }
    ]);

    const result = await runFollowUps(
      options,
      live({
        // The fourth point was in the first audit but not in the email, so it is not "still" anything.
        smith: ["viewport-present", "meta-description-present"],
        // A named contact-button point stays, once, as the general rule still finds no contact action.
        legal: ["lawyer-consultation-cta", "primary-cta-present", "phone-link-present"],
        // No contact-button point was named, so a general finding does not add one.
        extra: ["viewport-present", "primary-cta-present"]
      })
    );

    expect(result.drafted).toBe(3);
    const points = (file: string) =>
      decodeBody(readFileSync(join(options.outDir, file), "utf8"))
        .split("\n")
        .filter((line) => line.startsWith("- "));
    expect(points("01-smith-clinic.eml")).toEqual(["- The page does not adapt to phones, where most local searches happen."]);
    expect(points("02-legal-clinic.eml")).toEqual([
      "- The phone number is not tap-to-call on mobile.",
      "- There is no clear booking or contact button, so ready-to-buy visitors have to hunt for the next step."
    ]);
    expect(points("03-extra-clinic.eml")).toEqual(["- The page does not adapt to phones, where most local searches happen."]);
  });

  it("does not fetch a lead the Companies House results already rule out", async () => {
    const { options } = setup([{ slug: "closed", name: "Closed Clinic", first: ["phone-link-present"] }]);
    const legal = readLegalStatus(["leadKey,companyType,companyStatus", "overture:closed,ltd,dissolved", ""].join("\n"));
    const checked: string[] = [];

    const result = await runFollowUps({ ...options, legal }, async (lead) => {
      checked.push(lead.leadKey);
      return report(["phone-link-present"]);
    });

    expect(checked).toEqual([]);
    expect(result.results[0].skipped).toBe("company status is dissolved, not active");
  });

  it("treats a header-only leads file as no leads", async () => {
    const { options } = setup([]);
    writeFileSync(options.input, "leadKey,label,websiteUrl\n");

    await expect(runFollowUps(options, live({}))).resolves.toMatchObject({ contacted: 0, drafted: 0 });
  });

  it("applies the Companies House gate and link rules of first emails", async () => {
    const { options } = setup([
      { slug: "closed", name: "Closed Clinic", first: ["phone-link-present"] },
      { slug: "active", name: "Active Clinic", first: ["phone-link-present"] },
      { slug: "down", name: "Down Clinic", first: ["phone-link-present"] }
    ]);
    const legal = readLegalStatus(
      ["leadKey,companyNumber,companyType,companyStatus", "overture:closed,01,ltd,dissolved", "overture:active,02,ltd,active", "overture:down,03,ltd,active", ""].join("\n")
    );

    const result = await runFollowUps({ ...options, legal, links: true }, live({ closed: ["phone-link-present"], active: ["phone-link-present"], down: new Error("timed out") }));

    expect(result.results.map(({ file, skipped, company }) => [company, file ?? skipped])).toEqual([
      ["01 (ltd, dissolved)", "company status is dissolved, not active"],
      ["02 (ltd, active)", "02-active-clinic.eml"],
      ["03 (ltd, active)", "could not re-check the site: timed out"]
    ]);
    const body = decodeBody(readFileSync(join(options.outDir, "02-active-clinic.eml"), "utf8"));
    expect(body).toContain("my earlier email about https://active.test/. One thing is still on the page:");
  });

  it("falls back to the call to action, and replaces drafts from an earlier run", async () => {
    const { options } = setup([{ slug: "smith", name: "Smith Clinic", first: ["phone-link-present"] }]);
    mkdirSync(options.outDir);
    writeFileSync(join(options.outDir, "01-old-lead.eml"), "old");
    writeFileSync(join(options.outDir, "notes.txt"), "mine");

    await runFollowUps({ ...options, config: { ...config, followUp: undefined } }, live({ smith: ["phone-link-present"] }));

    expect(decodeBody(readFileSync(join(options.outDir, "01-smith-clinic.eml"), "utf8"))).toContain("If useful, I can send the exact changes first, free.");
    expect(readdirSync(options.outDir).sort()).toEqual(["01-smith-clinic.eml", "index.md", "notes.txt"]);
  });

  it("validates its options from the command line", () => {
    const { dir } = setup([{ slug: "smith", name: "Smith Clinic", first: ["phone-link-present"], status: "new" }]);
    writeFileSync(join(dir, "outreach.json"), JSON.stringify(config));
    const run = (extra: string[]) =>
      spawnSync(
        process.execPath,
        ["--import", "tsx", "src/cli.ts", "follow-ups", "--input", join(dir, "leads.csv"), "--review-csv", join(dir, "review.csv"), "--out-dir", join(dir, "drafts"), ...extra],
        { encoding: "utf8" }
      );
    const outreach = ["--outreach", join(dir, "outreach.json")];

    const none = run(outreach);
    expect(none.stderr).toBe("");
    expect(none.status).toBe(0);
    expect(none.stdout).toContain("Follow-up drafts: 0 of 0 contacted leads");
    expect(none.stdout).toContain(`Index: ${join(dir, "drafts", "index.md")}`);

    expect(run([...outreach, "--after-days", "0"]).stderr).toContain("follow-ups --after-days must be a whole number from 1 to 3650");
    expect(run([...outreach, "--after-days", "999999999999"]).stderr).toContain("follow-ups --after-days must be a whole number from 1 to 3650");
    expect(run([]).stderr).toContain("--outreach <path>");

    writeFileSync(join(dir, "linked.json"), JSON.stringify({ ...config, followUp: "See example.studio" }));
    expect(run(["--outreach", join(dir, "linked.json"), "--no-links"]).stderr).toContain('contains "example.studio"');
  }, 60_000);
});
