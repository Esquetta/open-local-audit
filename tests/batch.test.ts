import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { auditSnapshot } from "../src/audit.js";
import { readBatchInput, readInputUrls, runBatchReports, safeReportSlug } from "../src/batch.js";
import type { AuditReport } from "../src/types.js";

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
});
