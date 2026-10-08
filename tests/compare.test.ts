import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { auditSnapshot } from "../src/audit.js";
import {
  compareReports,
  readComparisonReport,
  renderComparisonHtml,
  renderComparisonJson,
  renderComparisonMarkdown
} from "../src/compare.js";
import type { AuditReport } from "../src/types.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "open-local-audit-compare-"));
  tempDirs.push(dir);
  return dir;
}

function report(html: string, scannedAt: string, finalUrl = "https://example.test/"): AuditReport {
  return auditSnapshot({ url: finalUrl, finalUrl, statusCode: 200, headers: {}, html }, scannedAt);
}

const before = report("<html><head></head><body><h1>Example</h1></body></html>", "2026-09-01T00:00:00.000Z");
const after = report(
  '<html><head><title>Example Plumbing</title><meta name="description" content="Plumbing in Leeds"><meta name="robots" content="noindex"></head><body><h1>Example</h1></body></html>',
  "2026-10-01T00:00:00.000Z",
  "https://www.example.test/"
);

describe("report comparison", () => {
  it("splits findings into fixed, remaining, and new by rule id", () => {
    const comparison = compareReports(before, after);
    const ids = (findings: AuditReport["findings"]) => findings.map((finding) => finding.id);

    expect(ids(comparison.fixed)).toEqual(expect.arrayContaining(["title-present", "meta-description-present"]));
    expect(ids(comparison.introduced)).toEqual(["page-indexable"]);
    expect(ids(comparison.remaining)).toContain("viewport-present");
    expect(ids(comparison.remaining)).not.toContain("title-present");
    expect(comparison.fixed.length + comparison.remaining.length).toBe(before.findings.length);
    expect(comparison.introduced.length + comparison.remaining.length).toBe(after.findings.length);
  });

  it("reports score changes per category and overall", () => {
    const comparison = compareReports(before, after);
    const search = comparison.scores["search-basics"];

    expect(search?.before).toBe(before.scores["search-basics"].score);
    expect(search?.after).toBe(after.scores["search-basics"].score);
    expect(search?.change).toBe(after.scores["search-basics"].score - before.scores["search-basics"].score);
    expect(comparison.overall.change).toBe(comparison.overall.after - comparison.overall.before);
    expect(comparison.url).toBe("https://www.example.test/");
  });

  it("rejects reports for different sites, profiles, or in reverse order", () => {
    expect(() => compareReports(before, report("<html></html>", "2026-10-01T00:00:00.000Z", "https://other.test/"))).toThrow(
      "Reports are for different sites"
    );
    expect(() => compareReports(before, { ...after, profile: "dental" })).toThrow("Reports use different profiles: generic and dental");
    expect(() => compareReports(after, before)).toThrow("swap the report order");
    expect(() => compareReports({ ...before, profile: undefined }, after)).not.toThrow();
  });

  it("escapes finding text from the audited page", () => {
    const hostile = { ...after.findings[0]!, id: "hostile", title: "<img src=x onerror=alert(1)> | extra" };
    const comparison = compareReports(before, { ...after, findings: [...after.findings, hostile] });

    expect(renderComparisonHtml(comparison)).toContain("&lt;img src=x onerror=alert(1)&gt; | extra");
    expect(renderComparisonHtml(comparison)).not.toContain("<img");
    expect(renderComparisonMarkdown(comparison)).toContain(" \\| extra |");
  });

  it("renders owner-readable Markdown and escaped HTML", () => {
    const comparison = compareReports(before, after);
    const markdown = renderComparisonMarkdown(comparison, { brand: { name: "Torut Web" } });
    const html = renderComparisonHtml(
      { ...comparison, url: "https://example.test/<script>" },
      { brand: { name: "Torut Web", footerText: "Thanks", contact: "hello@torut.test" } }
    );

    expect(markdown).toContain("# Torut Web Progress Report");
    expect(markdown).toContain(`- Overall health: ${comparison.overall.before}/100 -> ${comparison.overall.after}/100`);
    expect(markdown).toContain(`- Fixed issues: ${comparison.fixed.length}`);
    expect(markdown).toContain("| high | Page tells search engines not to index it | Robots directives: meta robots: noindex |");
    expect(html).toContain("<h1>Torut Web Progress Report</h1>");
    expect(html).toContain("https://example.test/&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("Thanks | hello@torut.test");
    expect(JSON.parse(renderComparisonJson(comparison)).introduced[0].id).toBe("page-indexable");
  });

  it("shows empty states when nothing changed", () => {
    const markdown = renderComparisonMarkdown(compareReports(before, { ...before, scannedAt: "2026-10-01T00:00:00.000Z" }));

    expect(markdown).toContain("No issues from the earlier audit were fixed.");
    expect(markdown).toContain("No new issues were found.");
    expect(markdown).toContain("(0)");
  });

  it("reads a report file or a report directory and rejects other JSON", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "open-local-audit-report.json"), `﻿${JSON.stringify(before)}`);
    writeFileSync(join(dir, "other.json"), JSON.stringify({ hello: "world" }));
    writeFileSync(join(dir, "broken.json"), "{");

    expect((await readComparisonReport(dir)).scannedAt).toBe(before.scannedAt);
    expect((await readComparisonReport(join(dir, "open-local-audit-report.json"))).findings).toHaveLength(before.findings.length);
    await expect(readComparisonReport(join(dir, "other.json"))).rejects.toThrow("is not an Open Local Audit JSON report");
    await expect(readComparisonReport(join(dir, "broken.json"))).rejects.toThrow("is not valid JSON");
    await expect(readComparisonReport(join(dir, "missing.json"))).rejects.toThrow("missing.json was not found");
    await expect(readComparisonReport(tempDir())).rejects.toThrow("open-local-audit-report.json was not found");

    writeFileSync(join(dir, "bad-date.json"), JSON.stringify({ ...before, scannedAt: "yesterday" }));
    writeFileSync(join(dir, "bad-url.json"), JSON.stringify({ ...before, finalUrl: "example" }));
    await expect(readComparisonReport(join(dir, "bad-date.json"))).rejects.toThrow("is not an Open Local Audit JSON report");
    await expect(readComparisonReport(join(dir, "bad-url.json"))).rejects.toThrow("is not an Open Local Audit JSON report");
  });

  it("writes a comparison from the CLI", () => {
    const dir = tempDir();
    const beforePath = join(dir, "before.json");
    const afterPath = join(dir, "after.json");
    const outPath = join(dir, "out", "progress.html");
    writeFileSync(beforePath, JSON.stringify(before));
    writeFileSync(afterPath, JSON.stringify(after));

    const written = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", "compare", beforePath, afterPath, "--format", "html", "--out", outPath],
      { encoding: "utf8" }
    );
    expect(written.status).toBe(0);
    expect(written.stdout).toContain("Compared https://www.example.test/:");
    expect(readFileSync(outPath, "utf8")).toContain("Progress Report");

    const printed = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "compare", beforePath, afterPath], {
      encoding: "utf8"
    });
    expect(printed.status).toBe(0);
    expect(printed.stdout).toContain("## Fixed Issues");

    const badFormat = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", "compare", beforePath, afterPath, "--format", "pdf"],
      { encoding: "utf8" }
    );
    expect(badFormat.status).toBe(1);
    expect(badFormat.stderr).toContain("compare --format must be markdown, json, or html");

    const reversed = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "compare", afterPath, beforePath], {
      encoding: "utf8"
    });
    expect(reversed.status).toBe(1);
    expect(reversed.stderr).toContain("swap the report order");
  }, 60_000);
});
