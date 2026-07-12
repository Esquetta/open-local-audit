import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { auditSnapshot } from "../src/audit.js";
import { readBatchInput, readInputUrls, runBatchReports, safeReportSlug, type BatchInputEntry } from "../src/batch.js";
import type { AuditProfile, AuditReport, Finding, Severity } from "../src/types.js";

function reportFor(url: string, profile: AuditProfile = "generic"): AuditReport {
  return auditSnapshot(
    {
      url,
      finalUrl: url,
      statusCode: 200,
      headers: {
        "content-type": "text/html"
      },
      html: "<html><head><title>Example</title></head><body><h1>Example</h1></body></html>"
    },
    "2026-05-09T00:00:00.000Z",
    { profile }
  );
}

function findingFor(severity: Severity, title: string): Finding {
  return {
    id: `${severity}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    title,
    severity,
    category: "technical-health",
    evidence: [],
    recommendation: "Fix the issue.",
    source: "test"
  };
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === "\"" && quoted && next === "\"") {
      current += "\"";
      index += 1;
      continue;
    }

    if (char === "\"") {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells.map((cell) => (cell.startsWith("\"") && cell.endsWith("\"") ? cell.slice(1, -1) : cell));
}

function reportWithVisualEvidenceFor(url: string): AuditReport {
  const report = reportFor(url);
  return {
    ...report,
    visualEvidence: [
      {
        path: `artifacts/${safeReportSlug(url)}.png`,
        screenshotPath: `artifacts/${safeReportSlug(url)}.png`,
        label: "Homepage screenshot"
      }
    ]
  };
}

function scoredReportFor(
  url: string,
  score: number,
  severities: Severity[],
  profile: AuditProfile = "generic"
): AuditReport {
  const report = reportFor(url, profile);
  return {
    ...report,
    scores: Object.fromEntries(
      Object.entries(report.scores).map(([category, value]) => [
        category,
        {
          ...value,
          score
        }
      ])
    ) as AuditReport["scores"],
    findings: severities.map((severity) => findingFor(severity, `${severity} issue`)),
    summary: {
      totalFindings: severities.length,
      high: severities.filter((severity) => severity === "high").length,
      medium: severities.filter((severity) => severity === "medium").length,
      low: severities.filter((severity) => severity === "low").length,
      info: severities.filter((severity) => severity === "info").length
    }
  };
}

function reportWithContactFor(url: string, contact: AuditReport["contact"]): AuditReport {
  return {
    ...scoredReportFor(url, 72, ["medium"]),
    contact
  };
}

async function waitFor(assertion: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (assertion()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error("Timed out waiting for expected test condition");
}

describe("batch reports", () => {
  it("reads URL input files with comments and blank lines", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-local-audit-batch-"));
    try {
      const input = join(dir, "sites.txt");
      await writeFile(input, "\n# prospects\nexample.com\nhttps://example.org/path\n", "utf8");

      await expect(readInputUrls(input)).resolves.toEqual(["https://example.com", "https://example.org/path"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reads CSV batch input with url, label, and segment columns", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-local-audit-batch-"));
    try {
      const input = join(dir, "sites.csv");
      await writeFile(
        input,
        "\n# prospects\nurl,label,segment\nexample.com,Example Dental,dental\nhttps://example.org/path,Example Legal,legal\n",
        "utf8"
      );

      await expect(readBatchInput(input)).resolves.toEqual([
        {
          url: "https://example.com",
          label: "Example Dental",
          segment: "dental"
        },
        {
          url: "https://example.org/path",
          label: "Example Legal",
          segment: "legal"
        }
      ]);
      await expect(readInputUrls(input)).resolves.toEqual(["https://example.com", "https://example.org/path"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reads CSV batch input with profile column", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-local-audit-batch-"));
    try {
      const input = join(dir, "sites.csv");
      await writeFile(
        input,
        "url,label,segment,profile\nexample.com,Example Dental,dental,dental\nhttps://example.org/path,Example Salon,beauty,beauty\n",
        "utf8"
      );

      await expect(readBatchInput(input)).resolves.toEqual([
        {
          url: "https://example.com",
          label: "Example Dental",
          segment: "dental",
          profile: "dental"
        },
        {
          url: "https://example.org/path",
          label: "Example Salon",
          segment: "beauty",
          profile: "beauty"
        }
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("creates safe report slugs from URLs", () => {
    expect(safeReportSlug("https://example.org/services/dental?utm=test")).toBe("example-org-services-dental");
  });

  it("writes per-site report directories for batch runs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-local-audit-batch-"));
    try {
      const results = await runBatchReports(["https://example.com", "https://example.org/path"], {
        format: "html",
        outDir: dir,
        pretty: true,
        audit: async (url) => reportFor(url)
      });

      expect(results.map((result) => result.slug)).toEqual(["example-com", "example-org-path"]);
      expect(await readFile(join(dir, "example-com", "open-local-audit-report.html"), "utf8")).toContain(
        "<!doctype html>"
      );
      expect(await readFile(join(dir, "example-org-path", "open-local-audit-report.html"), "utf8")).toContain(
        "https://example.org/path"
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("continues after a URL fails and writes aggregate batch indexes for all formats", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-local-audit-batch-"));
    try {
      const results = await runBatchReports(
        [
          {
            url: "https://good.test",
            label: "Good Site",
            segment: "dental"
          },
          {
            url: "https://bad.test",
            label: "Bad Site",
            segment: "legal"
          },
          {
            url: "https://good.test/about",
            label: "Good About",
            segment: "dental"
          }
        ],
        {
          format: "all",
          outDir: dir,
          pretty: true,
          audit: async (url) => {
            if (url === "https://bad.test") {
              throw new Error("request timed out");
            }

            return reportFor(url);
          }
        }
      );

      expect(results.map((result) => result.status)).toEqual(["success", "failed", "success"]);
      expect(results.map((result) => result.slug)).toEqual(["good-test", "bad-test", "good-test-about"]);
      await expect(readFile(join(dir, "good-test", "open-local-audit-report.json"), "utf8")).resolves.toContain(
        "https://good.test"
      );
      await expect(readFile(join(dir, "good-test-about", "open-local-audit-report.html"), "utf8")).resolves.toContain(
        "https://good.test/about"
      );

      const index = JSON.parse(await readFile(join(dir, "open-local-audit-batch-index.json"), "utf8"));
      expect(index.summary).toMatchObject({
        total: 3,
        succeeded: 2,
        failed: 1
      });
      expect(index.entries[0]).toMatchObject({
        url: "https://good.test",
        label: "Good Site",
        segment: "dental",
        status: "success",
        slug: "good-test",
        reports: {
          json: "good-test/open-local-audit-report.json",
          markdown: "good-test/open-local-audit-report.md",
          html: "good-test/open-local-audit-report.html"
        }
      });
      expect(index.entries[1]).toMatchObject({
        url: "https://bad.test",
        label: "Bad Site",
        segment: "legal",
        status: "failed",
        slug: "bad-test",
        error: "request timed out"
      });
      expect(await readFile(join(dir, "open-local-audit-batch-index.md"), "utf8")).toContain("| failed | Bad Site |");
      expect(await readFile(join(dir, "open-local-audit-batch-index.html"), "utf8")).toContain("Bad Site");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("limits concurrent audits while preserving result order", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-local-audit-batch-"));
    const releaseAudit: Array<() => void> = [];
    let active = 0;
    let maxActive = 0;

    try {
      let runCompleted = false;
      const run = runBatchReports(["https://one.test", "https://two.test", "https://three.test"], {
        format: "json",
        outDir: dir,
        concurrency: 2,
        audit: async (url) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise<void>((resolve) => releaseAudit.push(resolve));
          active -= 1;
          return reportFor(url);
        }
      }).finally(() => {
        runCompleted = true;
      });

      await waitFor(() => active === 2);
      expect(active).toBe(2);

      while (!runCompleted) {
        releaseAudit.splice(0).forEach((release) => release());
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      const results = await run;
      expect(maxActive).toBe(2);
      expect(results.map((result) => result.url)).toEqual([
        "https://one.test",
        "https://two.test",
        "https://three.test"
      ]);
      expect(results.map((result) => result.slug)).toEqual(["one-test", "two-test", "three-test"]);
    } finally {
      releaseAudit.splice(0).forEach((release) => release());
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("includes profile in aggregate batch index entries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-local-audit-batch-"));
    try {
      const results = await runBatchReports(
        [
          {
            url: "https://good.test",
            label: "Good Dental",
            segment: "dental",
            profile: "dental"
          },
          {
            url: "https://good.test/about",
            label: "Contractor Prospect",
            segment: "contractor",
            profile: "contractor"
          }
        ] satisfies BatchInputEntry[],
        {
          format: "json",
          outDir: dir,
          pretty: true,
          audit: async (url, context) => reportFor(url, context.profile)
        }
      );

      expect((results as Array<{ profile?: string; status: string }>).map((result) => result.profile)).toEqual([
        "dental",
        "contractor"
      ]);
      const index = JSON.parse(await readFile(join(dir, "open-local-audit-batch-index.json"), "utf8"));
      expect(index.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ url: "https://good.test", profile: "dental" }),
          expect.objectContaining({ url: "https://good.test/about", profile: "contractor" })
        ])
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not relabel custom audit reports when the hook ignores the requested profile", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-local-audit-batch-"));
    try {
      const results = await runBatchReports(
        [
          {
            url: "https://good.test",
            label: "Good Dental",
            segment: "dental",
            profile: "dental"
          }
        ] satisfies BatchInputEntry[],
        {
          format: "json",
          outDir: dir,
          pretty: true,
          audit: async (url) => reportFor(url, "generic")
        }
      );

      expect(results[0]).toMatchObject({
        status: "success",
        profile: "generic"
      });

      const report = JSON.parse(await readFile(join(dir, "good-test", "open-local-audit-report.json"), "utf8"));
      const index = JSON.parse(await readFile(join(dir, "open-local-audit-batch-index.json"), "utf8"));
      expect(report.profile).toBe("generic");
      expect(index.entries[0].profile).toBe("generic");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("adds aggregate batch insights to JSON, Markdown, and HTML indexes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-local-audit-batch-"));
    try {
      await runBatchReports(
        [
          {
            url: "https://dental.test",
            segment: "dental",
            profile: "dental"
          },
          {
            url: "https://beauty.test",
            segment: "beauty",
            profile: "beauty"
          },
          {
            url: "https://failed.test",
            segment: "beauty",
            profile: "beauty"
          }
        ] satisfies BatchInputEntry[],
        {
          format: "all",
          outDir: dir,
          pretty: true,
          audit: async (url, context) => {
            if (url === "https://failed.test") {
              throw new Error("offline");
            }

            return scoredReportFor(
              url,
              url === "https://dental.test" ? 60 : 80,
              url === "https://dental.test" ? ["high", "medium"] : ["high"],
              context.profile
            );
          }
        }
      );

      const json = JSON.parse(await readFile(join(dir, "open-local-audit-batch-index.json"), "utf8"));
      expect(json.summary.averageScore).toBe(70);
      expect(json.summary.profiles).toEqual({
        dental: { total: 1, succeeded: 1, failed: 0, averageScore: 60 },
        beauty: { total: 2, succeeded: 1, failed: 1, averageScore: 80 }
      });
      expect(json.summary.segments).toEqual({
        dental: { total: 1, succeeded: 1, failed: 0, averageScore: 60 },
        beauty: { total: 2, succeeded: 1, failed: 1, averageScore: 80 }
      });
      expect(json.summary.topFindings).toEqual([{ title: "high issue", count: 2 }]);
      expect(json.summary.contact).toEqual({
        withAnyPublicContact: 0,
        publicEmail: 0,
        publicPhone: 0,
        whatsapp: 0,
        contactPage: 0,
        socialProfiles: 0,
        confidence: {
          High: 0,
          Medium: 0,
          Low: 0,
          None: 2
        }
      });
      expect(json.summary.outreach).toEqual({
        preferredChannels: {
          email: 0,
          whatsapp: 0,
          phone: 0,
          "contact-page": 0,
          "manual-review": 2
        }
      });

      const markdown = await readFile(join(dir, "open-local-audit-batch-index.md"), "utf8");
      expect(markdown).toContain("- Average score: 70");
      expect(markdown).toContain("- With public contact: 0");
      expect(markdown).toContain("## Profile Breakdown");
      expect(markdown).toContain("| dental | 1 | 1 | 0 | 60 |");
      expect(markdown).toContain("## Frequent Findings");
      expect(markdown).toContain("## Contact Rollup");
      expect(markdown).toContain("## Outreach Rollup");

      const html = await readFile(join(dir, "open-local-audit-batch-index.html"), "utf8");
      expect(html).toContain("<h2>Profile Breakdown</h2>");
      expect(html).toContain("<td>dental</td><td>1</td><td>1</td><td>0</td><td>60</td>");
      expect(html).toContain("<h2>Frequent Findings</h2>");
      expect(html).toContain("<h2>Contact Rollup</h2>");
      expect(html).toContain("<h2>Outreach Rollup</h2>");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("adds contact and outreach rollups to batch indexes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-local-audit-batch-contact-"));
    try {
      await runBatchReports(
        [
          "https://email.test",
          "https://whatsapp.test",
          "https://phone.test",
          "https://contact-page.test",
          "https://social.test",
          "https://manual.test",
          "https://failed.test"
        ],
        {
          format: "all",
          outDir: dir,
          pretty: true,
          audit: async (url) => {
            if (url === "https://failed.test") {
              throw new Error("offline");
            }

            if (url === "https://email.test") {
              return reportWithContactFor(url, {
                publicEmail: "hello@email.test",
                socialProfiles: [],
                contactConfidence: "High",
                contactSource: "mailto"
              });
            }

            if (url === "https://whatsapp.test") {
              return reportWithContactFor(url, {
                whatsappUrl: "https://wa.me/902120000000",
                socialProfiles: [],
                contactConfidence: "Medium",
                contactSource: "whatsapp"
              });
            }

            if (url === "https://phone.test") {
              return reportWithContactFor(url, {
                publicPhone: "+902120000000",
                socialProfiles: [],
                contactConfidence: "Medium",
                contactSource: "tel"
              });
            }

            if (url === "https://contact-page.test") {
              return reportWithContactFor(url, {
                contactPageUrl: "https://contact-page.test/contact",
                socialProfiles: [],
                contactConfidence: "Low",
                contactSource: "contact-page"
              });
            }

            if (url === "https://social.test") {
              return reportWithContactFor(url, {
                socialProfiles: ["https://www.instagram.com/socialtest"],
                contactConfidence: "Low",
                contactSource: "social"
              });
            }

            return reportWithContactFor(url, {
              socialProfiles: [],
              contactConfidence: "None"
            });
          }
        }
      );

      const json = JSON.parse(await readFile(join(dir, "open-local-audit-batch-index.json"), "utf8"));
      expect(json.summary.contact).toEqual({
        withAnyPublicContact: 5,
        publicEmail: 1,
        publicPhone: 1,
        whatsapp: 1,
        contactPage: 1,
        socialProfiles: 1,
        confidence: {
          High: 1,
          Medium: 2,
          Low: 2,
          None: 1
        }
      });
      expect(json.summary.outreach).toEqual({
        preferredChannels: {
          email: 1,
          whatsapp: 1,
          phone: 1,
          "contact-page": 1,
          "manual-review": 2
        }
      });
      expect(json.entries.map((entry: {
        url: string;
        contact?: { contactConfidence: string };
        outreach?: { preferredContactChannel: string };
      }) => [
        entry.url,
        entry.outreach?.preferredContactChannel ?? "",
        entry.contact?.contactConfidence ?? ""
      ])).toEqual([
        ["https://email.test", "email", "High"],
        ["https://whatsapp.test", "whatsapp", "Medium"],
        ["https://phone.test", "phone", "Medium"],
        ["https://contact-page.test", "contact-page", "Low"],
        ["https://social.test", "manual-review", "Low"],
        ["https://manual.test", "manual-review", "None"],
        ["https://failed.test", "", ""]
      ]);
      expect(json.entries[0].contact.publicEmail).toBe("hello@email.test");
      expect(json.entries[0].outreach.contactabilityReason).toBe("Public email found on the audited website.");
      expect(json.entries[6].outreach).toBeUndefined();

      const markdown = await readFile(join(dir, "open-local-audit-batch-index.md"), "utf8");
      expect(markdown).toContain("- With public contact: 5");
      expect(markdown).toContain("- Manual contact review: 2");
      expect(markdown).toContain("| whatsapp | 1 |");
      expect(markdown).toContain("| social-profiles | 1 |");
      expect(markdown).toContain("| Medium | 2 |");
      expect(markdown).toContain(
        "| success |  | https://email.test |  | generic | 72 | High | email | Public email found on the audited website. | medium issue |  |"
      );

      const html = await readFile(join(dir, "open-local-audit-batch-index.html"), "utf8");
      expect(html).toContain("With public contact: 5");
      expect(html).toContain("<td>contact-page</td><td>1</td>");
      expect(html).toContain("<td>social-profiles</td><td>1</td>");
      expect(html).toContain("<td>https://email.test</td><td></td><td>generic</td><td>72</td><td>High</td><td>email</td>");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("writes a prospect CSV export with profile, score, topFinding, report paths, and error columns", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-local-audit-batch-"));
    const csvPath = join(dir, "nested", "prospects.csv");

    try {
      await runBatchReports(
        [
          {
            url: "https://good.test",
            label: "Good Dental",
            segment: "dental",
            profile: "dental"
          },
          {
            url: "https://bad.test",
            label: "Bad Restaurant",
            segment: "restaurant",
            profile: "restaurant"
          }
        ] satisfies BatchInputEntry[],
        {
          format: "json",
          outDir: dir,
          pretty: true,
          exportCsv: csvPath,
          audit: async (url, context) => {
            if (url === "https://bad.test") {
              throw new Error("timeout");
            }

            return scoredReportFor(url, 93, ["high"], context.profile);
          }
        }
      );

      const rows = (await readFile(csvPath, "utf8")).trim().split(/\r?\n/).map(parseCsvLine);
      expect(rows[0]).toEqual([
        "url",
        "label",
        "segment",
        "profile",
        "source",
        "auditStatus",
        "hasWebsite",
        "status",
        "score",
        "topFinding",
        "contactConfidence",
        "preferredContactChannel",
        "contactabilityReason",
        "report paths",
        "error"
      ]);
      expect(rows[1]).toEqual([
        "https://good.test",
        "Good Dental",
        "dental",
        "dental",
        "",
        "success",
        "yes",
        "success",
        "93",
        "high issue",
        "None",
        "manual-review",
        "No public contact channel found on the audited website.",
        "good-test/open-local-audit-report.json",
        ""
      ]);
      expect(rows[2]).toEqual([
        "https://bad.test",
        "Bad Restaurant",
        "restaurant",
        "restaurant",
        "",
        "failed",
        "no",
        "failed",
        "",
        "",
        "",
        "",
        "",
        "",
        "timeout"
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("writes a CRM-ready batch prospect CSV export", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-local-audit-batch-crm-"));
    const csvPath = join(dir, "crm.csv");

    try {
      await runBatchReports(
        [
          {
            url: "https://crm.test",
            label: "CRM Lead",
            segment: "clinic",
            profile: "clinic"
          },
          {
            url: "https://failed-crm.test",
            label: "Failed CRM Lead",
            segment: "clinic",
            profile: "clinic"
          }
        ],
        {
          format: "all",
          outDir: dir,
          exportCsv: csvPath,
          exportPreset: "crm",
          audit: async (url, context) => {
            if (url === "https://failed-crm.test") {
              throw new Error("offline");
            }

            return {
              ...scoredReportFor(url, 82, ["low"], context.profile),
              contact: {
                publicEmail: "hello@crm.test",
                publicPhone: "+902120000000",
                contactPageUrl: "https://crm.test/contact",
                socialProfiles: [],
                contactConfidence: "High",
                contactSource: "mailto, tel, contact-page"
              }
            };
          }
        }
      );

      const rows = (await readFile(csvPath, "utf8")).trim().split(/\r?\n/).map(parseCsvLine);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual([
        "companyName",
        "website",
        "segment",
        "profile",
        "source",
        "auditStatus",
        "hasWebsite",
        "priority",
        "score",
        "opportunityScore",
        "topFinding",
        "contactConfidence",
        "preferredContactChannel",
        "contactabilityReason",
        "publicEmail",
        "publicPhone",
        "contactPageUrl",
        "leadKey",
        "reportPath"
      ]);
      expect(rows[1]).toEqual([
        "CRM Lead",
        "https://crm.test",
        "clinic",
        "clinic",
        "batch",
        "success",
        "yes",
        "",
        "82",
        "",
        "low issue",
        "High",
        "email",
        "Public email found on the audited website.",
        "hello@crm.test",
        "'+902120000000",
        "https://crm.test/contact",
        "url:https://crm.test",
        "crm-test/open-local-audit-report.html"
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("neutralizes spreadsheet formulas in batch CSV cells alongside contact columns", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-local-audit-batch-csv-formula-"));
    const csvPath = join(dir, "prospects.csv");

    try {
      await runBatchReports([{ url: "https://formula.test", label: "=Formula Lead" }], {
        format: "json",
        outDir: dir,
        exportCsv: csvPath,
        audit: async (url) =>
          reportWithContactFor(url, {
            publicEmail: "=lead@example.test",
            socialProfiles: [],
            contactConfidence: "High",
            contactSource: "mailto"
          })
      });

      const csv = await readFile(csvPath, "utf8");
      expect(csv).toContain("'=Formula Lead");
      expect(csv).toContain("High");
      expect(csv).toContain("email");
      expect(csv).toContain("Public email found on the audited website.");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("writes the aggregate batch index matching a single requested format", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-local-audit-batch-"));
    try {
      await runBatchReports(["https://example.com"], {
        format: "markdown",
        outDir: dir,
        pretty: true,
        audit: async (url) => reportFor(url)
      });

      const markdown = await readFile(join(dir, "open-local-audit-batch-index.md"), "utf8");
      expect(markdown).toContain("# Open Local Audit Batch Index");
      expect(markdown).toContain("https://example.com");
      await expect(readFile(join(dir, "open-local-audit-batch-index.json"), "utf8")).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("filters the aggregate index by segment and minimum score", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-local-audit-batch-"));
    try {
      await runBatchReports(
        [
          {
            url: "https://dental-low.test",
            segment: "dental"
          },
          {
            url: "https://dental-high.test",
            segment: "dental"
          },
          {
            url: "https://legal-high.test",
            segment: "legal"
          }
        ],
        {
          format: "json",
          outDir: dir,
          pretty: true,
          index: {
            segment: "dental",
            minScore: 70
          },
          audit: async (url) => {
            if (url === "https://dental-low.test") {
              return scoredReportFor(url, 45, ["high"]);
            }

            return scoredReportFor(url, 85, ["low"]);
          }
        }
      );

      const index = JSON.parse(await readFile(join(dir, "open-local-audit-batch-index.json"), "utf8"));
      expect(index.summary).toMatchObject({
        total: 1,
        succeeded: 1,
        failed: 0
      });
      expect(index.entries.map((entry: { url: string }) => entry.url)).toEqual(["https://dental-high.test"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("sorts the aggregate index by ascending score before applying top N", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-local-audit-batch-"));
    try {
      await runBatchReports(["https://middle.test", "https://worst.test", "https://best.test"], {
        format: "json",
        outDir: dir,
        pretty: true,
        index: {
          sort: "score-asc",
          top: 2
        },
        audit: async (url) => {
          const scores: Record<string, number> = {
            "https://middle.test": 60,
            "https://worst.test": 25,
            "https://best.test": 95
          };
          return scoredReportFor(url, scores[url] ?? 0, ["medium"]);
        }
      });

      const index = JSON.parse(await readFile(join(dir, "open-local-audit-batch-index.json"), "utf8"));
      expect(index.summary).toMatchObject({
        total: 2,
        succeeded: 2,
        failed: 0
      });
      expect(index.entries.map((entry: { url: string; score: number }) => [entry.url, entry.score])).toEqual([
        ["https://worst.test", 25],
        ["https://middle.test", 60]
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("sorts the aggregate index by descending worst severity", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-local-audit-batch-"));
    try {
      await runBatchReports(["https://low.test", "https://high.test", "https://medium.test"], {
        format: "json",
        outDir: dir,
        pretty: true,
        index: {
          sort: "severity-desc"
        },
        audit: async (url) => {
          const severities: Record<string, Severity[]> = {
            "https://low.test": ["low"],
            "https://high.test": ["high"],
            "https://medium.test": ["medium"]
          };
          return scoredReportFor(url, 80, severities[url] ?? []);
        }
      });

      const index = JSON.parse(await readFile(join(dir, "open-local-audit-batch-index.json"), "utf8"));
      expect(index.entries.map((entry: { url: string }) => entry.url)).toEqual([
        "https://high.test",
        "https://medium.test",
        "https://low.test"
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("filters the aggregate batch index by source, audit status, and website presence", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-local-audit-batch-"));
    try {
      const result = await runBatchReports(
        [
          { url: "https://src-a.test", source: "manual-csv" },
          { url: "https://src-b.test", source: "google-places" },
          { url: "https://fail.test", source: "manual-csv" }
        ],
        {
          format: "json",
          outDir: dir,
          pretty: true,
          index: {
            source: "manual-csv",
            auditStatus: "success",
            hasWebsite: "yes"
          },
          audit: async (url) => {
            if (url === "https://fail.test") {
              throw new Error("audit failed");
            }
            return scoredReportFor(url, 85, ["low"]);
          }
        }
      );

      const index = JSON.parse(await readFile(join(dir, "open-local-audit-batch-index.json"), "utf8"));
      expect(index.summary).toMatchObject({
        total: 1,
        succeeded: 1,
        failed: 0
      });
      expect(index.entries.map((entry: { url: string }) => entry.url)).toEqual(["https://src-a.test"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("copies per-site visual evidence metadata into all batch report formats", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-local-audit-batch-"));
    try {
      await runBatchReports(["https://example.com"], {
        format: "all",
        outDir: dir,
        pretty: true,
        audit: async (url) => reportWithVisualEvidenceFor(url)
      });

      const reportPath = join(dir, "example-com", "open-local-audit-report.json");
      const markdownPath = join(dir, "example-com", "open-local-audit-report.md");
      const htmlPath = join(dir, "example-com", "open-local-audit-report.html");

      const jsonReport = JSON.parse(await readFile(reportPath, "utf8"));
      const markdownReport = await readFile(markdownPath, "utf8");
      const htmlReport = await readFile(htmlPath, "utf8");

      expect(jsonReport.visualEvidence[0].path).toBe("artifacts/example-com.png");
      expect(markdownReport).toContain("## Visual Evidence");
      expect(markdownReport).toContain("artifacts/example-com.png");
      expect(htmlReport).toContain("<h2>Visual Evidence</h2>");
      expect(htmlReport).toContain("artifacts/example-com.png");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
