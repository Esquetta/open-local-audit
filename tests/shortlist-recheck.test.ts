import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readLegalStatus, type OutreachConfig } from "../src/outreach.js";
import { runShortlistReport, type ShortlistRunOptions } from "../src/shortlist-runner.js";
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
  offer: "I run a fixed-price 48-hour fix."
};

function finding(id: string): Finding {
  return { id, title: `Title for ${id}`, severity: "medium", category: "trust-contact", source: "test", recommendation: `Fix ${id}.`, evidence: [{ label: "test", value: "Missing" }] };
}

// Leads in rank order (the opportunity score falls with each), each with its first audit's findings.
function setup(leads: Array<{ slug: string; name: string; first: string[] }>): { dir: string; options: ShortlistRunOptions } {
  const dir = mkdtempSync(join(tmpdir(), "open-local-audit-recheck-"));
  tempDirs.push(dir);
  const csv = ["leadKey,label,websiteUrl,hasWebsite,auditStatus,priority,opportunityScore,opportunityReasons,publicEmail,reportPath"];
  leads.forEach((lead, index) => {
    csv.push(`overture:${lead.slug},${lead.name},https://${lead.slug}.test/,yes,success,high,${90 - index},Audit score is below 60,info@${lead.slug}.test,${lead.slug}/open-local-audit-report.html`);
    mkdirSync(join(dir, "reports", lead.slug), { recursive: true });
    writeFileSync(join(dir, "reports", lead.slug, "open-local-audit-report.json"), JSON.stringify({ findings: lead.first.map(finding) }));
  });
  writeFileSync(join(dir, "leads.csv"), `${csv.join("\n")}\n`);
  return {
    dir,
    options: {
      input: join(dir, "leads.csv"),
      out: join(dir, "shortlist.md"),
      format: "markdown",
      shortlist: { top: 20 },
      emailDrafts: { dir: join(dir, "drafts"), config, reportsDir: join(dir, "reports"), links: false, recheck: true }
    }
  };
}

// The live check's findings per lead slug, or an error, and the slugs it was asked to fetch.
function live(results: Record<string, string[] | Error>) {
  const fetched: string[] = [];
  const recheck = async (lead: ShortlistLead): Promise<AuditReport> => {
    const slug = lead.leadKey.replace("overture:", "");
    fetched.push(slug);
    const result = results[slug];
    if (result instanceof Error) {
      throw result;
    }
    return { findings: result.map(finding) } as unknown as AuditReport;
  };
  return { fetched, recheck };
}

function decodeBody(eml: string): string {
  return Buffer.from(eml.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf8").replace(/\r\n/g, "\n");
}

describe("re-checked email drafts", () => {
  it("names only the audit's points that the live site still shows", async () => {
    const { dir, options } = setup([{ slug: "smith", name: "Smith Ltd", first: ["phone-link-present", "meta-description-present", "current-date-signals"] }]);
    const { recheck } = live({ smith: ["meta-description-present", "current-date-signals", "viewport-present"] });

    await runShortlistReport(options, recheck);

    const body = decodeBody(readFileSync(join(dir, "drafts", "01-smith-ltd.eml"), "utf8"));
    expect(body).toContain("Without a meta description, Google writes its own snippet for the search result.");
    expect(body).toContain("An outdated year on the page makes the business look inactive.");
    // Gone from the page, so not claimed; new on the page, but the audit did not find it, so not claimed either.
    expect(body).not.toContain("tap-to-call");
    expect(body).not.toContain("adapt to phones");
    expect(readFileSync(join(dir, "drafts", "index.md"), "utf8")).toContain(
      "| 1 | Smith Ltd | medium | info@smith.test | not checked | 01-smith-ltd.eml; no longer found: Title for phone-link-present |"
    );
  });

  it("gives a reason instead of a draft when the live site no longer supports one", async () => {
    const { dir, options } = setup([
      { slug: "down", name: "Down Ltd", first: ["phone-link-present"] },
      { slug: "fixed", name: "Fixed Ltd", first: ["phone-link-present", "meta-description-present"] },
      { slug: "weaker", name: "Weaker Ltd", first: ["phone-link-present", "meta-description-present"] }
    ]);
    const { recheck } = live({ down: new Error("website returned HTTP 503"), fixed: ["single-h1"], weaker: ["meta-description-present", "single-h1"] });

    await runShortlistReport(options, recheck);

    expect(readdirSync(join(dir, "drafts"))).toEqual(["index.md"]);
    const index = readFileSync(join(dir, "drafts", "index.md"), "utf8");
    expect(index).toContain("0 drafts for 3 shortlisted leads.");
    expect(index).toContain("| 1 | Down Ltd | strong | info@down.test | not checked | skipped: could not re-check the site: website returned HTTP 503 |");
    expect(index).toContain("| 2 | Fixed Ltd | strong | info@fixed.test | not checked | skipped: nothing the audit found is still on the page; check the site by hand |");
    expect(index).toContain(
      "| 3 | Weaker Ltd | weak | info@weaker.test | not checked | skipped: pitch strength weak after the re-check: not worth a cold email; no longer found: Title for phone-link-present |"
    );
  });

  it("fetches only the websites that would get a draft", async () => {
    const { dir, options } = setup([
      { slug: "strong", name: "Strong Ltd", first: ["phone-link-present"] },
      { slug: "weak", name: "Weak Ltd", first: ["single-h1"] },
      { slug: "trader", name: "Sole Trader", first: ["phone-link-present"] }
    ]);
    writeFileSync(join(dir, "legal.csv"), ["label,companyType,companyStatus", "Strong Ltd,ltd,active", "Sole Trader,sole-trader,active", ""].join("\n"));
    const { fetched, recheck } = live({ strong: ["phone-link-present"] });

    await runShortlistReport({ ...options, emailDrafts: { ...options.emailDrafts!, legal: readLegalStatus(readFileSync(join(dir, "legal.csv"), "utf8")) } }, recheck);

    expect(fetched).toEqual(["strong"]);
    expect(readdirSync(join(dir, "drafts")).sort()).toEqual(["01-strong-ltd.eml", "index.md"]);
    expect(readFileSync(join(dir, "drafts", "index.md"), "utf8")).toContain("| 1 | Strong Ltd | strong | info@strong.test | (ltd, active) | 01-strong-ltd.eml |");
  });

  it("fetches nothing without the option", async () => {
    const { dir, options } = setup([{ slug: "smith", name: "Smith Ltd", first: ["phone-link-present"] }]);
    const { fetched, recheck } = live({});

    await runShortlistReport({ ...options, emailDrafts: { ...options.emailDrafts!, recheck: false } }, recheck);

    expect(fetched).toEqual([]);
    expect(readdirSync(join(dir, "drafts")).sort()).toEqual(["01-smith-ltd.eml", "index.md"]);
  });

  it("is only used with --email-drafts", () => {
    const { dir } = setup([{ slug: "smith", name: "Smith Ltd", first: ["phone-link-present"] }]);
    const result = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "shortlist", "--input", join(dir, "leads.csv"), "--out", join(dir, "shortlist.md"), "--recheck"], {
      encoding: "utf8"
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--recheck is only used with --email-drafts");
  }, 30_000);
});
