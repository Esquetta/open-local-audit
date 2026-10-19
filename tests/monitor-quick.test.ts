import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { auditSnapshot, quickCheckUrl } from "../src/audit.js";
import { readBrandConfig } from "../src/brand.js";
import { comparisonDates } from "../src/compare.js";
import { renderClientEmail } from "../src/monitor.js";
import { buildMonitorSchedule } from "../src/monitor-schedule.js";
import { renderQuickCheck, runQuickCheck } from "../src/monitor-quick.js";
import type { AuditReport, PageSnapshot } from "../src/types.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "open-local-audit-quick-"));
  tempDirs.push(dir);
  return dir;
}

const page = '<html lang="en"><head><title>Clinic</title></head><body><h1>Clinic</h1></body></html>';

function report(url: string, overrides: Partial<PageSnapshot> = {}): AuditReport {
  return auditSnapshot({ url, finalUrl: url, statusCode: 200, headers: {}, html: page, ...overrides }, "2026-10-18T08:00:00.000Z");
}

describe("quick checks", () => {
  it("flags sites that do not load, return an error status, or have certificate or domain problems", async () => {
    const summary = await runQuickCheck(
      [
        { url: "https://ok.test/", label: "OK Clinic" },
        { url: "https://down.test/" },
        { url: "https://error.test/" },
        { url: "https://expiring.test/" }
      ],
      {
        now: new Date("2026-10-18T08:00:00Z"),
        check: async (url) => {
          if (url.includes("down")) {
            throw new Error("fetch failed");
          }
          if (url.includes("error")) {
            return report(url, { statusCode: 503 });
          }
          if (url.includes("expiring")) {
            return report(url, {
              tls: { validFrom: "2026-07-01T00:00:00.000Z", validTo: "2026-10-25T00:00:00.000Z", daysRemaining: 7, authorized: true },
              domain: { name: "expiring.test", expiresAt: "2026-10-30T00:00:00.000Z", daysRemaining: 12, status: ["active"] }
            });
          }
          return report(url, { responseTimeMs: 412 });
        }
      }
    );

    expect(summary.runId).toBe("2026-10-18T08-00-00-000Z");
    expect(summary.sites.map((site) => site.status)).toEqual(["ok", "alert", "alert", "alert"]);
    expect(summary.sites[1].alerts).toEqual([{ kind: "down", message: "Site did not load: fetch failed" }]);
    expect(summary.sites[2].alerts[0]).toEqual({ kind: "down", message: "Site returned HTTP 503" });
    expect(summary.sites[3].alerts.map((alert) => alert.kind)).toEqual(["certificate", "domain"]);

    expect(renderQuickCheck(summary).split("\n")).toEqual([
      "Quick check 2026-10-18T08-00-00-000Z: 4 sites, 3 sites need attention.",
      "OK     OK Clinic (https://ok.test/): HTTP 200 in 412 ms",
      "ALERT  https://down.test/: Site did not load: fetch failed",
      expect.stringMatching(/^ALERT  https:\/\/error\.test\/: Site returned HTTP 503/),
      "ALERT  https://expiring.test/: HTTPS certificate: Certificate expires 2026-10-25 (7 days); Domain: expiring.test expires 2026-10-30 (12 days)",
      ""
    ]);
  });

  it("treats a parked or maintenance page as down even though it answers 200", async () => {
    const summary = await runQuickCheck([{ url: "http://lapsed.test/" }], {
      check: async (url) => report(url, { html: "<html><head><title>lapsed.test</title></head><body>This domain may be for sale. Buy this domain today.</body></html>" })
    });

    expect(summary.sites[0].status).toBe("alert");
    expect(summary.sites[0].alerts[0].kind).toBe("down");
    expect(summary.sites[0].alerts[0].message).toMatch(/^Site shows a placeholder page: Parked domain: /);
  });

  it("rejects input that lists the same site twice", async () => {
    await expect(
      runQuickCheck([{ url: "https://clinic.test/" }, { url: "http://www.clinic.test" }], { check: async (url) => report(url) })
    ).rejects.toThrow("Monitor input lists the same site twice");
  });

  it("fetches only the page itself", async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(request.url ?? "");
      response.writeHead(200, { "content-type": "text/html" });
      response.end(page);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
      const checked = await quickCheckUrl(url, { timeoutMs: 5000 });

      expect(checked.statusCode).toBe(200);
      expect(checked.responseTimeMs).toBeGreaterThanOrEqual(0);
      expect(requests).toEqual(["/"]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe("daily schedules", () => {
  it("runs the quick check every day with its own script, log, and task name", () => {
    const windows = buildMonitorSchedule({
      platform: "win32",
      frequency: "daily",
      cwd: "C:\\Work",
      outDir: "C:\\Work\\monitoring",
      version: "0.84.0",
      args: ["--input", "C:\\Work\\clients.csv", "--quick"]
    });
    expect(windows.scriptPath).toBe("C:\\Work\\monitoring\\run-monitor-quick.ps1");
    expect(windows.files[0].content).toContain("'--quick'");
    expect(windows.files[0].content).toContain("$log = 'C:\\Work\\monitoring\\quick.log'");
    expect(windows.instructions).toContain('schtasks /Create /SC DAILY /ST 08:00 /TN "Open Local Audit quick check" /TR "powershell');
    expect(windows.instructions).toContain("Schedule it every day at 08:00");

    const cron = buildMonitorSchedule({ platform: "linux", frequency: "daily", cwd: "/w", outDir: "/w/monitoring", version: "0.84.0", args: ["--quick"] });
    expect(cron.instructions).toContain("0 8 * * * /w/monitoring/run-monitor-quick.sh");
  });

  it("checks sites and prints a daily schedule from the CLI", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "sites.txt"), "http://127.0.0.1:9/\n");
    const run = (extra: string[]) =>
      spawnSync(
        process.execPath,
        ["--import", "tsx", "src/cli.ts", "monitor", "--input", join(dir, "sites.txt"), "--out-dir", join(dir, "monitoring"), "--timeout", "2000", ...extra],
        { encoding: "utf8" }
      );

    const quick = run(["--quick", "--fail-on-alerts"]);
    expect(quick.status).toBe(1);
    expect(quick.stdout).toContain("ALERT  http://127.0.0.1:9/: Site did not load:");
    expect(quick.stdout).toContain(`Overview: ${join(dir, "monitoring", "index.html")}`);
    expect(JSON.parse(readFileSync(join(dir, "monitoring", "quick-status.json"), "utf8")).sites[0].status).toBe("alert");

    const lighthouse = run(["--quick", "--lighthouse", "--print-schedule"]);
    expect(lighthouse.status).toBe(1);
    expect(lighthouse.stderr).toContain("--lighthouse is not used with --quick");
    expect(existsSync(join(dir, "monitoring", process.platform === "win32" ? "run-monitor-quick.ps1" : "run-monitor-quick.sh"))).toBe(false);

    const schedule = run(["--quick", "--print-schedule"]);
    expect(schedule.status).toBe(0);
    const script = join(dir, "monitoring", process.platform === "win32" ? "run-monitor-quick.ps1" : "run-monitor-quick.sh");
    expect(readFileSync(script, "utf8")).toContain("--quick");
  }, 60_000);
});

describe("report polish", () => {
  it("signs client emails with the brand signature when one is set", () => {
    const email = renderClientEmail({
      entry: { url: "https://clinic.test/" },
      report: report("https://clinic.test/"),
      runDate: new Date("2026-10-18T12:00:00Z"),
      pdfFile: "open-local-audit-report.pdf",
      brand: { name: "TORUT LTD", contact: "hello@torut.test", signature: "Best regards,\nFurkan Tasci\nTORUT LTD, company no. 17205563" }
    });

    expect(email.trimEnd().endsWith("Best regards,\nFurkan Tasci\nTORUT LTD, company no. 17205563")).toBe(true);
    expect(email).not.toContain("hello@torut.test");
  });

  it("reads a signature with Windows line endings as plain lines", async () => {
    const dir = tempDir();
    const path = join(dir, "brand.json");
    writeFileSync(path, JSON.stringify({ name: "TORUT LTD", signature: "  Best regards,\r\nFurkan Tasci\r\n" }));

    expect((await readBrandConfig(path)).signature).toBe("Best regards,\nFurkan Tasci");
  });

  it("shows comparison dates as readable dates, with times when both checks share a day", () => {
    const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

    expect(comparisonDates({ beforeScannedAt: "2026-09-01T12:00:00.000Z", afterScannedAt: "2026-10-01T12:00:00.000Z" })).toEqual({
      before: day("2026-09-01T12:00:00.000Z"),
      after: day("2026-10-01T12:00:00.000Z")
    });
    const sameDay = comparisonDates({ beforeScannedAt: "2026-10-15T10:00:00.000Z", afterScannedAt: "2026-10-15T11:30:00.000Z" });
    expect(sameDay.before.startsWith(`${day("2026-10-15T10:00:00.000Z")}, `)).toBe(true);
    expect(sameDay.before).toMatch(/, \d{2}:\d{2}$/);
    expect(sameDay.after).not.toBe(sameDay.before);
  });
});
