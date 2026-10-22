import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { auditSnapshot } from "../src/audit.js";
import { pitchPoints } from "../src/pitch-brief.js";
import { buildProposal, readOfferConfig, renderProposalHtml, renderProposalPdf, type OfferConfig } from "../src/proposal.js";
import type { AuditReport } from "../src/types.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "open-local-audit-proposal-"));
  tempDirs.push(dir);
  return dir;
}

// A bare page: no viewport, phone link, booking button, or address, so the audit has several owner-facing points.
const barePage = '<html lang="en"><head><title>Clinic</title></head><body><h1>Clinic</h1><p>Welcome.</p></body></html>';

function report(html = barePage): AuditReport {
  return auditSnapshot({ url: "https://www.riverside.test/", finalUrl: "https://www.riverside.test/", statusCode: 200, headers: {}, html }, "2026-10-01T12:00:00.000Z");
}

const offer: OfferConfig = {
  plans: [
    { name: "Care Lite", price: "£29 / month", features: ["Daily check", "Monthly report"] },
    { name: "Care", price: "£49 / month", features: ["Everything in Care Lite", "30 minutes of changes each month"] }
  ]
};

describe("care proposals", () => {
  it("lists the three problems an owner would notice first, the inclusions, and the operator's plans", () => {
    const audit = report();
    const points = pitchPoints(audit);
    expect(points.length).toBeGreaterThan(3);

    const proposal = buildProposal(audit, { ...offer, validDays: 14 }, { now: new Date("2026-10-22T12:00:00Z") });
    expect(proposal.name).toBe("riverside.test");
    expect(proposal.points).toEqual(points.slice(0, 3));
    expect(proposal.morePoints).toBe(points.length - 3);
    expect(proposal.offer.includes[0]).toMatch(/^A monthly check of the website with a report/);
    expect(proposal.offer.includes.join(" ")).not.toMatch(/every day|daily/i);
    expect(proposal.issuedOn).toBe(new Date("2026-10-22T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }));
    expect(proposal.validUntil).toBe(new Date("2026-11-05T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }));

    const html = renderProposalHtml(proposal, { name: "TORUT LTD", contact: "hello@torut.test" });
    expect(html).toContain("<h1>Website care proposal for riverside.test</h1>");
    expect(html).toContain("TORUT LTD · ");
    for (const point of proposal.points) {
      expect(html).toContain(`<strong>${point.title}</strong>`);
    }
    expect(html).toContain('<p class="price">£29 / month</p>');
    expect(html).toContain("<li>30 minutes of changes each month</li>");
    expect(html).toContain(`The full report lists ${proposal.morePoints} more point`);
    expect(html).toContain("Get in touch to get started.");
    expect(html).toContain("<p>hello@torut.test</p>");
  });

  it("escapes every value from the offer and the business name, and names no brand when none is configured", () => {
    const proposal = buildProposal(report(), {
      intro: "Hi <b>there</b>",
      includes: ["<script>alert(1)</script>"],
      plans: [{ name: "Care & more", price: "<£49>", features: [] }],
      nextStep: 'Call "us"'
    }, { name: "<img src=x onerror=alert(1)>" });
    const html = renderProposalHtml(proposal);

    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("Hi &lt;b&gt;there&lt;/b&gt;");
    expect(html).toContain("Care &amp; more");
    expect(html).not.toContain("Open Local Audit");
  });

  it("says so when the check found nothing urgent", () => {
    const proposal = buildProposal(report(), offer);
    const clean = { ...proposal, points: [], morePoints: 0 };
    expect(renderProposalHtml(clean)).toContain(`scored ${proposal.score}/100 and found nothing urgent. Monthly care keeps it that way.`);
  });

  it("renders a PDF, also with a long business name and title", async () => {
    const pdf = await renderProposalPdf(buildProposal(report(), offer), { name: "TORUT LTD" });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const long = await renderProposalPdf(
      buildProposal(report(), { ...offer, title: "Website care proposal for Riverside Dental Practice and Implant Centre, Greater Manchester and Cheshire" })
    );
    expect(long.subarray(0, 5).toString()).toBe("%PDF-");
    expect(long.toString("latin1")).not.toContain("/Author");
  });

  it("refuses brand colors that could break out of the stylesheet", () => {
    const html = renderProposalHtml(buildProposal(report(), offer), { primaryColor: "red;}</style><script>alert(1)</script>" });
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("red;");
    expect(html).toContain("--primary: #145a73;");
  });

  it("reads the offer file strictly and names the field that is wrong", async () => {
    const dir = tempDir();
    const path = join(dir, "offer.json");
    writeFileSync(path, `\uFEFF${JSON.stringify(offer)}`);
    expect((await readOfferConfig(path)).plans).toHaveLength(2);

    writeFileSync(path, JSON.stringify({ plans: [] }));
    await expect(readOfferConfig(path)).rejects.toThrow(/offer\.json: plans: /);
    writeFileSync(path, JSON.stringify({ plans: [{ name: "Care", price: " " }] }));
    await expect(readOfferConfig(path)).rejects.toThrow(/plans\.0\.price: /);
    writeFileSync(path, JSON.stringify({ ...offer, discount: "10%" }));
    await expect(readOfferConfig(path)).rejects.toThrow(/offer\.json: file: /);
    writeFileSync(path, "{ plans: ");
    await expect(readOfferConfig(path)).rejects.toThrow(/offer\.json could not be read: /);
  });

  it("writes a proposal from a saved report with the CLI", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "open-local-audit-report.json"), JSON.stringify(report()));
    writeFileSync(join(dir, "offer.json"), JSON.stringify(offer));
    const run = (extra: string[]) =>
      spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "proposal", dir, "--offer", join(dir, "offer.json"), ...extra], { encoding: "utf8" });

    const html = run(["--name", "Riverside Dental", "--out", join(dir, "proposal.html")]);
    expect(html.status).toBe(0);
    expect(html.stdout).toContain("Proposal for Riverside Dental: 3 problems listed, 2 plans");
    expect(readFileSync(join(dir, "proposal.html"), "utf8")).toContain("<h1>Website care proposal for Riverside Dental</h1>");

    expect(html.stdout).not.toContain("Note: the PDF runs to");

    const longOffer = {
      includes: Array.from({ length: 10 }, (_, index) => `Inclusion ${index + 1}: ${"a careful check of one more part of the website, ".repeat(5)}`),
      plans: Array.from({ length: 4 }, (_, index) => ({ name: `Plan ${index + 1}`, price: "£99 / month", features: Array.from({ length: 10 }, () => "A long feature line that explains one more thing included in this plan") }))
    };
    writeFileSync(join(dir, "long-offer.json"), JSON.stringify(longOffer));
    const long = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", "proposal", dir, "--offer", join(dir, "long-offer.json"), "--format", "pdf", "--out", join(dir, "long.pdf")],
      { encoding: "utf8" }
    );
    expect(long.status).toBe(0);
    expect(long.stdout).toMatch(/Note: the PDF runs to [2-9] pages; shorten the offer's includes or plan features to keep it to one\./);
    const short = run(["--format", "pdf", "--out", join(dir, "short.pdf")]);
    expect(short.stdout).not.toContain("Note: the PDF runs to");

    const pdf = run(["--format", "pdf"]);
    expect(pdf.status).toBe(1);
    expect(pdf.stderr).toContain("--out is required when proposal --format pdf is used");
  }, 60_000);
});
