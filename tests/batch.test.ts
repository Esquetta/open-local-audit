import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { auditSnapshot } from "../src/audit.js";
import { readInputUrls, runBatchReports, safeReportSlug } from "../src/batch.js";
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
});
