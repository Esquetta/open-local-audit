import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildOutreachDraft, configLink, findLink, legalLine, planOutreachDrafts, readLeadEmails, renderOutreachEml, type OutreachConfig } from "../src/outreach.js";
import { buildPitchBrief } from "../src/pitch-brief.js";
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
  registeredOffice: "1 Example Street, London E1 1AA",
  opener: "I came across {name} while looking at accountants in Leeds.",
  offer: "I run a fixed-price 48-hour fix for up to 3 issues like these.",
  callToAction: "If useful, I can send the exact changes first, free."
};

function finding(id: string): Finding {
  return { id, title: `Title for ${id}`, severity: "medium", category: "trust-contact", source: "test", recommendation: `Fix ${id}.`, evidence: [{ label: "test", value: "Missing" }] };
}

function lead(overrides: Partial<ShortlistLead> = {}): ShortlistLead {
  return {
    rank: 1,
    companyName: "Smith Accountants",
    website: "https://smith.test/",
    segment: "accountant",
    profile: "general",
    priority: "high",
    auditStatus: "success",
    hasWebsite: "yes",
    source: "overture",
    topFinding: "",
    contactConfidence: "High",
    preferredContactChannel: "email",
    contactabilityReason: "",
    reason: "Audit score is below 60",
    reportPath: "smith/open-local-audit-report.html",
    leadKey: "overture:1",
    reviewStatus: "",
    reviewReason: "",
    lastReviewedAt: "",
    ...overrides
  };
}

function brief(ids: string[], overrides: Partial<ShortlistLead> = {}) {
  return buildPitchBrief(lead(overrides), { findings: ids.map(finding) } as unknown as AuditReport, "found");
}

function decodeBody(eml: string): string {
  const encoded = eml.split("\r\n\r\n")[1];
  return Buffer.from(encoded.replace(/\r\n/g, ""), "base64").toString("utf8");
}

describe("outreach drafts", () => {
  it("writes the owner-visible points, the offer, and the sender's company details with an opt-out", () => {
    const draft = buildOutreachDraft(brief(["phone-link-present", "current-date-signals"]), config, { to: "info@smith.test", links: true });
    expect(draft.to).toBe("info@smith.test");
    expect(draft.subject).toBe("Tap-to-call on the Smith Accountants website");
    expect(draft.body).toBe(
      [
        "Hi,",
        "",
        "I came across Smith Accountants while looking at accountants in Leeds.",
        "",
        "A few things on https://smith.test/ may be putting visitors off:",
        "- The phone number is not tap-to-call on mobile.",
        "- An outdated year on the page makes the business look inactive.",
        "",
        "I run a fixed-price 48-hour fix for up to 3 issues like these.",
        "",
        "If useful, I can send the exact changes first, free.",
        "",
        "Sam Sender",
        "EXAMPLE STUDIO LTD",
        "",
        "If you would rather not hear from me, just reply \"no\" and I will not contact you again.",
        "EXAMPLE STUDIO LTD, Company No. 01234567, registered office: 1 Example Street, London E1 1AA.",
        ""
      ].join("\n")
    );

    const plain = buildOutreachDraft(brief(["https-enabled"]), { ...config, opener: undefined, callToAction: undefined }, { links: false });
    expect(plain.subject).toBe("A few quick fixes for the Smith Accountants website");
    expect(plain.body).toContain("I came across Smith Accountants and had a quick look at the website.");
    expect(plain.body).toContain("One thing on the website may be putting visitors off:");
    expect(findLink(`${plain.subject}\n${plain.body}`)).toBeUndefined();
    expect(legalLine({ ...config, companyNumber: undefined, registeredOffice: "2 Road, Leeds." })).toBe("EXAMPLE STUDIO LTD, registered office: 2 Road, Leeds.");
    expect(legalLine({ ...config, registeredIn: "England and Wales" })).toBe(
      "EXAMPLE STUDIO LTD, registered in England and Wales, Company No. 01234567, registered office: 1 Example Street, London E1 1AA."
    );
  });

  it("keeps the tool's own wording link-free for every pitch point", () => {
    const ids = [
      "website-placeholder", "http-status-ok", "tls-certificate-valid", "domain-expiry", "page-indexable", "robots-txt-allows-page",
      "https-enabled", "viewport-present", "phone-link-present", "phone-number-visible", "primary-cta-present", "contact-form-present",
      "broken-internal-links", "cookie-consent-present", "privacy-policy-link-present", "title-present", "meta-description-present",
      "single-h1", "mixed-content-absent", "current-date-signals", "visible-address-present", "opening-hours-present", "map-link-present",
      "image-alt-coverage", "review-cue-present"
    ];
    for (const id of ids) {
      const draft = buildOutreachDraft(brief([id]), config, { links: false });
      expect(draft.body).toContain("- ");
      expect(findLink(`${draft.subject}\n${draft.body}`), id).toBeUndefined();
    }
  });

  it("finds URLs, domains, and email addresses but not ordinary sentences", () => {
    expect(findLink("See https://x.test for more")).toBe("https://");
    expect(findLink("TORUT LTD · torut.dev")).toBe("torut.dev");
    expect(findLink("reply to info@shop.co.uk")).toBe("shop.co.uk");
    expect(findLink("Company No. 17205563, London E1 0SG. Fixed price, e.g. three fixes.")).toBeUndefined();
    expect(findLink("I fix robots.txt files and Next.js sites.")).toBeUndefined();
    expect(configLink({ ...config, signature: "Sam\nexample.studio" })).toBe("example.studio");
    expect(configLink(config)).toBeUndefined();
  });

  it("skips dead-domain, weak, and link-bearing leads with the reason", () => {
    const planned = planOutreachDrafts(
      [
        brief(["phone-link-present"], { rank: 1, leadKey: "overture:1" }),
        brief(["single-h1"], { rank: 2, companyName: "Weak Clinic", leadKey: "overture:2" }),
        buildPitchBrief(lead({ rank: 3, companyName: "Lapsed Ltd", leadKey: "overture:3", reason: "Listed website domain does not resolve (site down; the domain may have lapsed)" }), undefined, "missing"),
        brief(["phone-link-present"], { rank: 4, companyName: "Shop.co.uk Ltd", leadKey: "overture:4" }),
        brief(["phone-link-present"], { rank: 12, companyName: "Çiçek Diş Kliniği", leadKey: "overture:5" })
      ],
      config,
      { emails: new Map([["overture:1", "info@smith.test"]]), links: false }
    );
    expect(planned.map(({ draft: _draft, ...entry }) => entry)).toEqual([
      { rank: 1, companyName: "Smith Accountants", strength: "strong", to: "info@smith.test", file: "01-smith-accountants.eml" },
      { rank: 2, companyName: "Weak Clinic", strength: "weak", skipped: "pitch strength weak: not worth a cold email" },
      { rank: 3, companyName: "Lapsed Ltd", strength: "strong", skipped: "website domain does not resolve; email there may bounce, so phone or use another public channel" },
      { rank: 4, companyName: "Shop.co.uk Ltd", strength: "strong", skipped: "the draft would contain \"Shop.co.uk\", which --no-links leaves out" },
      { rank: 12, companyName: "Çiçek Diş Kliniği", strength: "strong", file: "12-cicek-dis-klinigi.eml" }
    ]);
  });

  it("renders a plain-text .eml without an attachment and reads the first plain lead email", () => {
    const eml = renderOutreachEml({ to: "info@smith.test", subject: "Tap-to-call on the Smith Accountants website", body: "Hi,\n\nBody é\n" });
    expect(eml.startsWith("X-Unsent: 1\r\nTo: info@smith.test\r\nSubject: Tap-to-call on the Smith Accountants website\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n")).toBe(true);
    expect(eml).not.toContain("multipart");
    expect(decodeBody(eml)).toBe("Hi,\r\n\r\nBody é\r\n");

    const emails = readLeadEmails(["leadKey,label,publicEmail", "overture:1,A,\"not an email; info@a.test\"", "overture:2,B,", ",C,c@c.test", ""].join("\n"));
    expect([...emails]).toEqual([["overture:1", "info@a.test"]]);
  });

  it("writes drafts and an index from the shortlist command", () => {
    const dir = mkdtempSync(join(tmpdir(), "open-local-audit-outreach-"));
    tempDirs.push(dir);
    const write = (slug: string, ids: string[]) => {
      mkdirSync(join(dir, "reports", slug), { recursive: true });
      writeFileSync(join(dir, "reports", slug, "open-local-audit-report.json"), JSON.stringify({ findings: ids.map(finding) }));
    };
    write("strong-test", ["phone-link-present"]);
    write("weak-test", ["single-h1"]);
    writeFileSync(
      join(dir, "leads.csv"),
      [
        "leadKey,label,websiteUrl,hasWebsite,auditStatus,priority,opportunityScore,opportunityReasons,publicEmail,reportPath",
        "overture:1,Strong Clinic,https://strong.test/,yes,success,high,90,Audit score is below 60,info@strong.test,strong-test/open-local-audit-report.html",
        "overture:2,Weak Clinic,https://weak.test/,yes,success,high,95,Audit score is below 60,info@weak.test,weak-test/open-local-audit-report.html",
        ""
      ].join("\n")
    );
    writeFileSync(join(dir, "outreach.json"), JSON.stringify(config));
    const run = (extra: string[]) =>
      spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "shortlist", "--input", join(dir, "leads.csv"), "--out", join(dir, "shortlist.md"), ...extra], { encoding: "utf8" });

    // A draft left from an earlier run is replaced; the operator's own files stay.
    mkdirSync(join(dir, "drafts"));
    writeFileSync(join(dir, "drafts", "01-old-lead.eml"), "old");
    writeFileSync(join(dir, "drafts", "notes.txt"), "mine");
    const result = run(["--email-drafts", join(dir, "drafts"), "--outreach", join(dir, "outreach.json"), "--no-links"]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Email drafts: ${join(dir, "drafts", "index.md")}`);
    expect(readdirSync(join(dir, "drafts")).sort()).toEqual(["02-strong-clinic.eml", "index.md", "notes.txt"]);
    const eml = readFileSync(join(dir, "drafts", "02-strong-clinic.eml"), "utf8");
    expect(eml).toContain("To: info@strong.test\r\n");
    expect(decodeBody(eml)).toContain("One thing on the website may be putting visitors off:");
    const index = readFileSync(join(dir, "drafts", "index.md"), "utf8");
    expect(index).toContain("1 draft for 2 shortlisted leads. Nothing has been sent.");
    expect(index).toContain("| 1 | Weak Clinic | weak | info@weak.test | skipped: pitch strength weak: not worth a cold email |");
    expect(index).toContain("| 2 | Strong Clinic | strong | info@strong.test | 02-strong-clinic.eml |");

    writeFileSync(join(dir, "linked.json"), JSON.stringify({ ...config, signature: "Sam\nexample.studio" }));
    const linked = run(["--email-drafts", join(dir, "drafts"), "--outreach", join(dir, "linked.json"), "--no-links"]);
    expect(linked.status).toBe(1);
    expect(linked.stderr).toContain("contains \"example.studio\", which --no-links leaves out of drafts");

    expect(run(["--email-drafts", join(dir, "drafts")]).stderr).toContain("--email-drafts and --outreach must be used together");
    expect(run(["--no-links"]).stderr).toContain("--no-links is only used with --email-drafts");
  }, 60_000);
});
