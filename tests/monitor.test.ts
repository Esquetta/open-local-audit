import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { auditSnapshot } from "../src/audit.js";
import { monitorRunId, runMonitor } from "../src/monitor.js";
import type { AuditProfile, AuditReport, PageSnapshot } from "../src/types.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "open-local-audit-monitor-"));
  tempDirs.push(dir);
  return dir;
}

const goodPage =
  '<html lang="en"><head><title>Clinic</title><meta name="description" content="Clinic"></head><body><h1>Clinic</h1></body></html>';

function report(url: string, scannedAt: string, overrides: Partial<PageSnapshot> = {}, profile: AuditProfile = "generic"): AuditReport {
  return auditSnapshot(
    { url, finalUrl: url, statusCode: 200, headers: {}, html: goodPage, ...overrides },
    scannedAt,
    { profile }
  );
}

describe("monitor runs", () => {
  it("names runs by UTC time without separators that Windows rejects", () => {
    expect(monitorRunId(new Date("2026-10-13T08:40:12.345Z"))).toBe("2026-10-13T08-40-12Z");
  });

  it("records a baseline first, then compares with the latest earlier run and alerts on new high issues", async () => {
    const outDir = tempDir();
    const entries = [{ url: "https://clinic.test/", label: "Clinic" }];

    const first = await runMonitor(entries, {
      outDir,
      now: new Date("2026-09-13T08:00:00Z"),
      audit: async (url) => report(url, "2026-09-13T08:00:00.000Z")
    });
    expect(first.sites[0]).toMatchObject({ status: "baseline", note: "First run: baseline recorded", alerts: [] });
    expect(existsSync(join(outDir, "clinic-test", "2026-09-13T08-00-00Z", "open-local-audit-report.json"))).toBe(true);
    expect(existsSync(join(outDir, "clinic-test", "2026-09-13T08-00-00Z", "open-local-audit-report.html"))).toBe(true);

    const second = await runMonitor(entries, {
      outDir,
      now: new Date("2026-10-13T08:00:00Z"),
      audit: async (url) => report(url, "2026-10-13T08:00:00.000Z", { statusCode: 500 })
    });
    const site = second.sites[0];
    expect(site).toMatchObject({ status: "compared", previousRunId: "2026-09-13T08-00-00Z", newFindings: 1, fixedFindings: 0 });
    expect(site.alerts).toEqual([{ kind: "new-high", message: "New high issue: Page does not return a successful HTTP status" }]);
    expect(site.scoreChange).toBeLessThan(0);
    expect(readFileSync(join(outDir, "clinic-test", "2026-10-13T08-00-00Z", "comparison.md"), "utf8")).toContain("Page does not return a successful HTTP status");
    expect(existsSync(join(outDir, "clinic-test", "2026-10-13T08-00-00Z", "comparison.html"))).toBe(true);

    const markdown = readFileSync(second.summaryPaths.markdown, "utf8");
    expect(second.summaryPaths.markdown).toBe(join(outDir, "monitor-summary-2026-10-13T08-00-00Z.md"));
    expect(markdown).toContain("Run 2026-10-13T08-00-00Z: 1 site, 1 compared, 0 baseline, 0 failed. 1 site needs attention.");
    expect(markdown).toContain("- **Clinic (https://clinic.test/)**: New high issue: Page does not return a successful HTTP status");
    expect(markdown).toContain("| Compared with 2026-09-13T08-00-00Z |");
    expect(markdown).toContain("clinic-test/2026-10-13T08-00-00Z/comparison.html");

    const json = JSON.parse(readFileSync(second.summaryPaths.json, "utf8"));
    expect(json.sites[0].comparisonPath).toBe("clinic-test/2026-10-13T08-00-00Z/comparison.html");
  });

  it("alerts on certificate and domain findings on every run and keeps going after a failed audit", async () => {
    const outDir = tempDir();
    const summary = await runMonitor([{ url: "https://clinic.test/" }, { url: "https://down.test/" }], {
      outDir,
      now: new Date("2026-10-13T08:00:00Z"),
      audit: async (url) => {
        if (url.includes("down")) {
          throw new Error("fetch failed");
        }
        return report(url, "2026-10-13T08:00:00.000Z", {
          tls: { validFrom: "2026-07-01T00:00:00.000Z", validTo: "2026-10-20T00:00:00.000Z", daysRemaining: 7, authorized: true },
          domain: { name: "clinic.test", expiresAt: "2026-11-01T00:00:00.000Z", daysRemaining: 19, status: ["active"] }
        });
      }
    });

    expect(summary.sites[0].alerts.map((alert) => alert.kind)).toEqual(["certificate", "domain"]);
    expect(summary.sites[0].alerts[1].message).toBe("Domain: clinic.test expires 2026-11-01 (19 days)");
    expect(summary.sites[1]).toMatchObject({ status: "failed", alerts: [{ kind: "failed", message: "Audit failed: fetch failed" }] });
    expect(existsSync(join(outDir, "down-test"))).toBe(false);
    expect(readFileSync(summary.summaryPaths.markdown, "utf8")).toContain("0 compared, 1 baseline, 1 failed. 2 sites need attention.");
  });

  it("compares with the newest earlier run that has a readable report", async () => {
    const outDir = tempDir();
    const entries = [{ url: "https://clinic.test/" }];
    await runMonitor(entries, { outDir, now: new Date("2026-08-13T08:00:00Z"), audit: async (url) => report(url, "2026-08-13T08:00:00.000Z") });
    await runMonitor(entries, { outDir, now: new Date("2026-09-13T08:00:00Z"), audit: async (url) => report(url, "2026-09-13T08:00:00.000Z") });
    rmSync(join(outDir, "clinic-test", "2026-09-13T08-00-00Z", "open-local-audit-report.json"));

    const summary = await runMonitor(entries, {
      outDir,
      now: new Date("2026-10-13T08:00:00Z"),
      audit: async (url) => report(url, "2026-10-13T08:00:00.000Z")
    });

    expect(summary.sites[0]).toMatchObject({ status: "compared", previousRunId: "2026-08-13T08-00-00Z" });
  });

  it("keeps monitoring other sites when one site's run cannot be saved", async () => {
    const outDir = tempDir();
    writeFileSync(join(outDir, "blocked-test"), "not a folder");

    const summary = await runMonitor([{ url: "https://blocked.test/" }, { url: "https://clinic.test/" }], {
      outDir,
      now: new Date("2026-10-13T08:00:00Z"),
      audit: async (url) => report(url, "2026-10-13T08:00:00.000Z")
    });

    expect(summary.sites[0].status).toBe("failed");
    expect(summary.sites[0].alerts[0].message).toMatch(/^Could not save the run: /);
    expect(summary.sites[1].status).toBe("baseline");
    expect(existsSync(summary.summaryPaths.markdown)).toBe(true);
  });

  it("records a new baseline when the profile changed since the last run", async () => {
    const outDir = tempDir();
    const entries = [{ url: "https://clinic.test/" }];
    await runMonitor(entries, { outDir, now: new Date("2026-09-13T08:00:00Z"), audit: async (url) => report(url, "2026-09-13T08:00:00.000Z") });

    const summary = await runMonitor(entries, {
      outDir,
      profile: "dental",
      now: new Date("2026-10-13T08:00:00Z"),
      audit: async (url, profile) => report(url, "2026-10-13T08:00:00.000Z", {}, profile)
    });

    expect(summary.sites[0].status).toBe("baseline");
    expect(summary.sites[0].note).toBe(
      "Not compared with 2026-09-13T08-00-00Z: Reports use different profiles: generic and dental; new baseline recorded"
    );
  });

  it("rejects input that lists the same site twice", async () => {
    await expect(
      runMonitor([{ url: "https://clinic.test/" }, { url: "https://www.clinic.test" }], {
        outDir: tempDir(),
        audit: async (url) => report(url, "2026-10-13T08:00:00.000Z")
      })
    ).rejects.toThrow("Monitor input lists the same site twice: https://clinic.test/ and https://www.clinic.test");
  });

  it("runs from the CLI and fails on alerts only when asked", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "sites.txt"), "http://127.0.0.1:9/\n");
    const run = (extra: string[]) =>
      spawnSync(
        process.execPath,
        ["--import", "tsx", "src/cli.ts", "monitor", "--input", join(dir, "sites.txt"), "--out-dir", join(dir, "monitor"), "--timeout", "2000", ...extra],
        { encoding: "utf8" }
      );

    const plain = run([]);
    expect(plain.status).toBe(0);
    expect(plain.stdout).toContain("Monitored 1 site: 1 needs attention");

    const strict = run(["--fail-on-alerts", "--no-check-domain"]);
    expect(strict.status).toBe(1);
    expect(strict.stderr).toContain("sites need attention (--fail-on-alerts)");
  }, 60_000);
});
