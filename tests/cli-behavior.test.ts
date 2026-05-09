import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { auditSnapshot } from "../src/audit.js";
import { shouldFailOnThreshold } from "../src/exit-policy.js";
import { renderTerminalSummary } from "../src/summary.js";

const report = auditSnapshot(
  {
    url: "https://example.test",
    finalUrl: "https://example.test",
    statusCode: 200,
    headers: {
      "content-type": "text/html"
    },
    html: "<html><head><title></title></head><body><h1></h1></body></html>",
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

describe("CLI behavior helpers", () => {
  it("fails when findings meet the configured severity threshold", () => {
    expect(shouldFailOnThreshold(report, "high")).toBe(true);
    expect(shouldFailOnThreshold(report, "medium")).toBe(true);
    expect(shouldFailOnThreshold(report, "none")).toBe(false);
  });

  it("renders a compact terminal summary", () => {
    const summary = renderTerminalSummary(report);

    expect(summary).toContain("Overall score:");
    expect(summary).toContain("High:");
    expect(summary).toContain("Medium:");
    expect(summary).toContain("Top issue:");
  });

  it("rejects a positional URL when batch input is used", () => {
    const tmp = mkdtempSync(join(tmpdir(), "open-local-audit-cli-"));
    try {
      const inputPath = join(tmp, "sites.txt");
      const outDir = join(tmp, "reports");
      writeFileSync(inputPath, "https://example.test\n", "utf8");

      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/cli.ts",
          "https://ignored.test",
          "--input",
          inputPath,
          "--out-dir",
          outDir,
          "--timeout",
          "1"
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8"
        }
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Use either a URL or --input, not both");
      expect(result.stdout).not.toContain("Audited");
    } finally {
      rmSync(tmp, { force: true, recursive: true });
    }
  });

  it("accepts batch triage options before validating mutually exclusive input", () => {
    const tmp = mkdtempSync(join(tmpdir(), "open-local-audit-cli-"));
    try {
      const inputPath = join(tmp, "sites.txt");
      const outDir = join(tmp, "reports");
      writeFileSync(inputPath, "https://example.test\n", "utf8");

      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/cli.ts",
          "https://ignored.test",
          "--input",
          inputPath,
          "--out-dir",
          outDir,
          "--segment",
          "dental",
          "--min-score",
          "70",
          "--top",
          "5",
          "--sort",
          "severity-desc"
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8"
        }
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Use either a URL or --input, not both");
      expect(result.stderr).not.toContain("unknown option");
      expect(result.stdout).not.toContain("Audited");
    } finally {
      rmSync(tmp, { force: true, recursive: true });
    }
  });
});
