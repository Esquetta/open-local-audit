import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { auditSnapshot } from "../src/audit.js";
import { packageReport } from "../src/report-pack.js";

describe("report pack", () => {
  it("creates a local customer-shareable report pack", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-local-audit-report-pack-"));
    const inputDir = join(dir, "site");
    const outDir = join(dir, "pack");

    try {
      await mkdir(inputDir, { recursive: true });
      const report = auditSnapshot(
        {
          url: "https://clinic.test",
          finalUrl: "https://clinic.test",
          statusCode: 200,
          headers: {
            "content-type": "text/html"
          },
          html: "<html><head><title></title></head><body><h1></h1><a href=\"mailto:hello@clinic.test\">Email</a></body></html>"
        },
        "2026-05-28T00:00:00.000Z"
      );
      await writeFile(join(inputDir, "open-local-audit-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
      await writeFile(join(inputDir, "open-local-audit-report.md"), "# Open Local Audit Report\n", "utf8");
      await writeFile(join(inputDir, "open-local-audit-report.html"), "<!doctype html>\n", "utf8");

      const result = await packageReport({ inputDir, outDir });

      expect(result.manifest.files).toEqual([
        "README.md",
        "next-actions.md",
        "manifest.json",
        "reports/open-local-audit-report.json",
        "reports/open-local-audit-report.md",
        "reports/open-local-audit-report.html"
      ]);
      expect(await readFile(join(outDir, "README.md"), "utf8")).toContain("# Open Local Audit Report Pack");
      expect(await readFile(join(outDir, "next-actions.md"), "utf8")).toContain("# Next Actions");
      expect(JSON.parse(await readFile(join(outDir, "manifest.json"), "utf8"))).toMatchObject({
        sourceReport: "open-local-audit-report.json",
        url: "https://clinic.test",
        finalUrl: "https://clinic.test"
      });
      expect(await readFile(join(outDir, "reports", "open-local-audit-report.md"), "utf8")).toContain(
        "# Open Local Audit Report"
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("requires a JSON report in the input directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-local-audit-report-pack-missing-"));
    try {
      await expect(packageReport({ inputDir: dir, outDir: join(dir, "pack") })).rejects.toThrow(
        "package-report requires open-local-audit-report.json in the input directory"
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
