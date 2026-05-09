import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { auditSnapshot } from "../src/audit.js";
import { readBatchInput, readInputUrls, runBatchReports, safeReportSlug } from "../src/batch.js";
import type { AuditReport, Finding, Severity } from "../src/types.js";

function reportFor(url: string): AuditReport {
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
    "2026-05-09T00:00:00.000Z"
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

function scoredReportFor(url: string, score: number, severities: Severity[]): AuditReport {
  const report = reportFor(url);
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
});
