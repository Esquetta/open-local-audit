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
      expect(index.summary).toEqual({
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
        "status",
        "score",
        "topFinding",
        "report paths",
        "error"
      ]);
      expect(rows[1]).toEqual([
        "https://good.test",
        "Good Dental",
        "dental",
        "dental",
        "success",
        "93",
        "high issue",
        "good-test/open-local-audit-report.json",
        ""
      ]);
      expect(rows[2]).toEqual([
        "https://bad.test",
        "Bad Restaurant",
        "restaurant",
        "restaurant",
        "failed",
        "",
        "",
        "",
        "timeout"
      ]);
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
      expect(index.summary).toEqual({
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
      expect(index.summary).toEqual({
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
