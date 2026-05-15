import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { auditSnapshot } from "../src/audit.js";
import { writeReportOutputs } from "../src/output.js";

describe("report output writer", () => {
  it("writes JSON, Markdown, and HTML reports when format is all", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "open-local-audit-"));
    try {
      const report = auditSnapshot(
        {
          url: "https://example.test",
          finalUrl: "https://example.test",
          statusCode: 200,
          headers: {
            "content-type": "text/html"
          },
          html: "<html><head><title>Example</title></head><body><h1>Example</h1></body></html>",
          resources: {
            robotsTxt: {
              url: "https://example.test/robots.txt",
              finalUrl: "https://example.test/robots.txt",
              statusCode: 404
            },
            sitemapXml: {
              url: "https://example.test/sitemap.xml",
              finalUrl: "https://example.test/sitemap.xml",
              statusCode: 404
            }
          }
        },
        "2026-05-08T00:00:00.000Z"
      );

      const outputs = await writeReportOutputs(report, {
        format: "all",
        outDir,
        pretty: true
      });

      expect(outputs.map((output) => output.format)).toEqual(["json", "markdown", "html"]);
      expect(JSON.parse(await readFile(join(outDir, "open-local-audit-report.json"), "utf8")).url).toBe(
        "https://example.test"
      );
      expect(await readFile(join(outDir, "open-local-audit-report.md"), "utf8")).toContain("# Open Local Audit Report");
      expect(await readFile(join(outDir, "open-local-audit-report.html"), "utf8")).toContain("<!doctype html>");
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("writes a branded PDF report when format is pdf", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "open-local-audit-pdf-"));
    try {
      const report = auditSnapshot(
        {
          url: "https://example.test",
          finalUrl: "https://example.test",
          statusCode: 200,
          headers: {
            "content-type": "text/html"
          },
          html: "<html><head><title>Example</title></head><body><h1>Example</h1></body></html>"
        },
        "2026-05-08T00:00:00.000Z"
      );

      const outputs = await writeReportOutputs(report, {
        format: "pdf",
        outDir,
        pretty: true
      });

      expect(outputs.map((output) => output.format)).toEqual(["pdf"]);
      const pdfPath = join(outDir, "open-local-audit-report.pdf");
      expect((await readFile(pdfPath)).subarray(0, 4).toString("utf8")).toBe("%PDF");
      expect((await stat(pdfPath)).size).toBeGreaterThan(500);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("requires a file destination when writing PDF output", async () => {
    const report = auditSnapshot(
      {
        url: "https://example.test",
        finalUrl: "https://example.test",
        statusCode: 200,
        headers: {
          "content-type": "text/html"
        },
        html: "<html><head><title>Example</title></head><body><h1>Example</h1></body></html>"
      },
      "2026-05-08T00:00:00.000Z"
    );

    await expect(
      writeReportOutputs(report, {
        format: "pdf",
        pretty: true
      })
    ).rejects.toThrow("--out or --out-dir is required when --format pdf is used");
  });
});
