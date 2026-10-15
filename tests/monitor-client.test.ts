import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { auditSnapshot } from "../src/audit.js";
import { runMonitor } from "../src/monitor.js";
import { buildMonitorSchedule } from "../src/monitor-schedule.js";
import type { AuditReport, LighthouseSummary, PageSnapshot } from "../src/types.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "open-local-audit-client-"));
  tempDirs.push(dir);
  return dir;
}

const page =
  '<html lang="en"><head><title>Clinic</title><meta name="description" content="Clinic"></head><body><h1>Clinic</h1></body></html>';

function report(scannedAt: string, overrides: Partial<PageSnapshot> = {}): AuditReport {
  return auditSnapshot({ url: "https://clinic.test/", finalUrl: "https://clinic.test/", statusCode: 200, headers: {}, html: page, ...overrides }, scannedAt);
}

function lighthouse(performance: number): LighthouseSummary {
  return { requestedUrl: "https://clinic.test/", categories: { performance, accessibility: 90, bestPractices: 95, seo: 92 } };
}

describe("monitor client email drafts", () => {
  it("writes a first-run draft that names the attached report and signs with the brand", async () => {
    const outDir = tempDir();
    const summary = await runMonitor([{ url: "https://clinic.test/", label: "Bright Clinic" }], {
      outDir,
      brand: { name: "Torut Web Care", contact: "hello@torut.test" },
      now: new Date("2026-09-13T12:00:00Z"),
      audit: async () => report("2026-09-13T12:00:00.000Z")
    });

    const email = readFileSync(summary.sites[0].emailPath ?? "", "utf8");
    expect(summary.sites[0].emailPath).toBe(join(outDir, "clinic.test", "2026-09-13T12-00-00-000Z", "client-email.md"));
    expect(email).toMatch(/^<!-- Draft written by Open Local Audit\. .*nothing has been sent\. -->/);
    expect(email).toContain("Subject: Website check for Bright Clinic, September 2026");
    expect(email).toContain("This is the first check, so next month's email will show what changed.");
    expect(email).toContain("What I recommend next:\n1. ");
    expect(email).toContain("The full report is attached (open-local-audit-report.pdf).");
    expect(email.trimEnd().endsWith("Best regards,\nTorut Web Care\nhello@torut.test")).toBe(true);
    expect(readFileSync(summary.summaryPaths.markdown, "utf8")).toContain("clinic.test/2026-09-13T12-00-00-000Z/client-email.md");
  });

  it("lists fixed and new issues, certificate and domain status, and the score and speed changes", async () => {
    const outDir = tempDir();
    const entries = [{ url: "https://clinic.test/" }];
    await runMonitor(entries, {
      outDir,
      now: new Date("2026-09-13T12:00:00Z"),
      audit: async () => report("2026-09-13T12:00:00.000Z", { html: page.replace(' lang="en"', "") }),
      lighthouse: async () => lighthouse(62)
    });

    const summary = await runMonitor(entries, {
      outDir,
      now: new Date("2026-10-13T12:00:00Z"),
      audit: async () =>
        report("2026-10-13T12:00:00.000Z", {
          statusCode: 500,
          tls: { validFrom: "2026-07-01T00:00:00.000Z", validTo: "2026-10-20T00:00:00.000Z", daysRemaining: 7, authorized: true, issuer: "R11" },
          domain: { name: "clinic.test", expiresAt: "2026-11-01T00:00:00.000Z", daysRemaining: 19, status: ["active"] }
        }),
      lighthouse: async () => lighthouse(78)
    });

    const site = summary.sites[0];
    expect(site).toMatchObject({ status: "compared", performance: 78, previousPerformance: 62 });
    const email = readFileSync(site.emailPath ?? "", "utf8");
    expect(email).toContain("Subject: Website check for clinic.test, October 2026");
    const lastCheck = new Date("2026-09-13T12:00:00.000Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    expect(email).toContain(`since the last check on ${lastCheck}.`);
    expect(email).toMatch(/Overall score: \d+\/100, down \d+ since the last check on /);
    expect(email).toContain("Page speed (Lighthouse performance): 78/100, up 16 since the last check.");
    expect(email).toContain("Fixed since the last check:\n- Page language is not declared");
    expect(email).toContain("New since the last check:\n- Page does not return a successful HTTP status");
    expect(email).toContain("HTTPS certificate: Certificate expires 2026-10-20 (7 days); issuer R11");
    expect(email).toContain("Domain registration: clinic.test expires 2026-11-01 (19 days)");
    expect(email).toContain("The full report is attached (comparison.pdf).");
    expect(email).toContain("Best regards,\n");

    const markdown = readFileSync(summary.summaryPaths.markdown, "utf8");
    expect(markdown).toContain("| Site | Status | Score | Change | Speed | New | Fixed | Report | Client PDF | Email draft |");
    expect(markdown).toContain("| 78/100 (+16) |");
    expect(readFileSync(join(outDir, "clinic.test", "2026-10-13T12-00-00-000Z", "open-local-audit-report.md"), "utf8")).toContain("Lighthouse");
  });

  it("says monitoring starts again when an earlier run could not be compared", async () => {
    const outDir = tempDir();
    const entries = [{ url: "https://clinic.test/" }];
    await runMonitor(entries, { outDir, now: new Date("2026-09-13T12:00:00Z"), audit: async () => report("2026-09-13T12:00:00.000Z") });

    const summary = await runMonitor(entries, {
      outDir,
      profile: "dental",
      now: new Date("2026-10-13T12:00:00Z"),
      audit: async () => auditSnapshot({ url: "https://clinic.test/", finalUrl: "https://clinic.test/", statusCode: 200, headers: {}, html: page }, "2026-10-13T12:00:00.000Z", { profile: "dental" })
    });

    const email = readFileSync(summary.sites[0].emailPath ?? "", "utf8");
    expect(summary.sites[0].status).toBe("baseline");
    expect(email).toContain("Monitoring starts again from this check, so next month's email will show what changed.");
    expect(email).not.toContain("This is the first check");
  });

  it("notes a Lighthouse failure without failing the site", async () => {
    const summary = await runMonitor([{ url: "https://clinic.test/" }], {
      outDir: tempDir(),
      now: new Date("2026-10-13T12:00:00Z"),
      audit: async () => report("2026-10-13T12:00:00.000Z"),
      lighthouse: async () => {
        throw new Error("Chrome could not be launched");
      }
    });

    expect(summary.sites[0]).toMatchObject({
      status: "baseline",
      note: "First run: baseline recorded; Lighthouse failed: Chrome could not be launched"
    });
    expect(summary.sites[0].performance).toBeUndefined();
    expect(readFileSync(summary.summaryPaths.markdown, "utf8")).not.toContain("| Speed |");
  });
});

describe("monitor schedules", () => {
  const windows = (outDir: string, args: string[]) =>
    buildMonitorSchedule({ platform: "win32", cwd: "C:\\Work\\Clients", outDir, version: "0.82.0", args });

  it("writes one UTF-8 PowerShell script that holds the paths and passes them to npx separately", () => {
    const schedule = windows("C:\\Work\\Müşteri 100% Owner's\\monitoring", [
      "--input",
      "C:\\Work\\Müşteri 100% Owner's\\clients.csv",
      "--out-dir",
      "C:\\Work\\Müşteri 100% Owner's\\monitoring",
      "--lighthouse"
    ]);
    const [ps1] = schedule.files;

    expect(schedule.files).toHaveLength(1);
    expect(schedule.scriptPath).toBe("C:\\Work\\Müşteri 100% Owner's\\monitoring\\run-monitor.ps1");
    expect(ps1.path).toBe(schedule.scriptPath);
    expect(ps1.content.startsWith("\uFEFF")).toBe(true);
    expect(ps1.content).toContain("Set-Location -LiteralPath 'C:\\Work\\Clients'\r\n");
    expect(ps1.content).toContain(
      "& npx --yes open-local-audit@0.82.0 monitor '--input' 'C:\\Work\\Müşteri 100% Owner''s\\clients.csv' '--out-dir' 'C:\\Work\\Müşteri 100% Owner''s\\monitoring' '--lighthouse' 2>&1"
    );
    expect(ps1.content).toContain("| Out-File -LiteralPath 'C:\\Work\\Müşteri 100% Owner''s\\monitoring\\monitor.log' -Append -Encoding utf8\r\nexit $LASTEXITCODE");
  });

  it("prints schtasks lines for Command Prompt and PowerShell that start PowerShell on the script", () => {
    const schedule = windows("C:\\Work\\Owner's sites", ["--input", "C:\\Work\\clients.csv"]);
    const lines = schedule.instructions.split("\n");
    const task = lines.find((line) => line.startsWith("schtasks /Create")) ?? "";

    expect(task).toBe(
      `schtasks /Create /SC MONTHLY /D 1 /ST 09:00 /TN "Open Local Audit monitor" /TR "powershell -NoProfile -ExecutionPolicy Bypass -File \\"C:\\Work\\Owner's sites\\run-monitor.ps1\\""`
    );
    expect(lines).toContain(`cmd /c '${task.replace(/'/g, "''")}'`);
    expect(schedule.instructions).not.toContain("Warning:");
  });

  it("escapes cmd special characters in the task path and typographic apostrophes for PowerShell", () => {
    const schedule = windows("C:\\Clients\\Smith & Jones\u2019s\\monitoring", ["--input", "C:\\Clients\\Smith & Jones\u2019s\\clients.csv"]);
    const lines = schedule.instructions.split("\n");

    expect(lines.find((line) => line.startsWith("schtasks /Create"))).toContain('-File \\"C:\\Clients\\Smith ^& Jones\u2019s\\monitoring\\run-monitor.ps1\\""');
    expect(lines.find((line) => line.startsWith("cmd /c '"))).toContain("Smith ^& Jones\u2019\u2019s");
    expect(schedule.files[0].content).toContain("'--input' 'C:\\Clients\\Smith & Jones\u2019\u2019s\\clients.csv'");
  });

  it("warns when the task command would pass Task Scheduler's 261-character limit", () => {
    const schedule = windows(`C:\\${"long-folder-name\\".repeat(13)}monitoring`, ["--input", "C:\\clients.csv"]);

    expect(schedule.instructions).toMatch(/Warning: Task Scheduler accepts at most 261 characters for the task command, and this one has \d+\. Use a shorter --out-dir path\./);
  });

  it("logs a missing npx and exits 1 instead of reporting success", () => {
    const ps1 = windows("C:\\Work\\monitoring", ["--input", "C:\\Work\\clients.csv"]).files[0].content;

    expect(ps1).toContain("if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {");
    expect(ps1.indexOf("exit 1")).toBeLessThan(ps1.indexOf("& npx"));
  });

  it("writes a shell script and a cron line elsewhere", () => {
    const schedule = buildMonitorSchedule({
      platform: "linux",
      cwd: "/home/me/clients",
      outDir: "/home/me/50% sites",
      version: "0.82.0",
      args: ["--input", "/home/me/it's here/clients.csv", "--out-dir", "/home/me/50% sites"]
    });
    const [script] = schedule.files;

    expect(schedule.files).toHaveLength(1);
    expect(script.content.startsWith("#!/bin/sh\ncd /home/me/clients || exit 1\n")).toBe(true);
    expect(script.content).toContain("npx --yes open-local-audit@0.82.0 monitor --input '/home/me/it'\\''s here/clients.csv' --out-dir '/home/me/50% sites'");
    expect(schedule.instructions).toContain("0 9 1 * * '/home/me/50\\% sites/run-monitor.sh'");
  });

  it("prints the schedule from the CLI without monitoring", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "sites.txt"), "https://clinic.test/\n");
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", "monitor", "--input", join(dir, "sites.txt"), "--out-dir", join(dir, "monitoring"), "--no-check-domain", "--print-schedule"],
      { encoding: "utf8" }
    );

    expect(result.status).toBe(0);
    const windowsHost = process.platform === "win32";
    expect(result.stdout).toContain(`Wrote ${join(dir, "monitoring", windowsHost ? "run-monitor.ps1" : "run-monitor.sh")}`);
    const content = readFileSync(join(dir, "monitoring", windowsHost ? "run-monitor.ps1" : "run-monitor.sh"), "utf8");
    expect(content).toMatch(/open-local-audit@\d+\.\d+\.\d+ monitor '?--input'? /);
    expect(content).toContain("--no-check-domain");
    const command = content.split(/\r?\n/).find((line) => line.includes(" monitor ") && !line.startsWith("#") && !line.startsWith("\uFEFF#")) ?? "";
    expect(command).not.toContain("--print-schedule");
    expect(command).not.toContain("--profile");
  }, 60_000);
});

