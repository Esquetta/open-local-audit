import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { auditSnapshot } from "../src/audit.js";
import { runMonitor } from "../src/monitor.js";
import { renderDashboard } from "../src/monitor-dashboard.js";
import { runQuickCheck } from "../src/monitor-quick.js";
import { buildMonitorSchedule } from "../src/monitor-schedule.js";
import type { AuditReport } from "../src/types.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "open-local-audit-dashboard-"));
  tempDirs.push(dir);
  return dir;
}

const page = '<html lang="en"><head><title>Clinic</title></head><body><h1>Clinic</h1></body></html>';

function report(url: string, scannedAt = "2026-10-01T12:00:00.000Z"): AuditReport {
  return auditSnapshot({ url, finalUrl: url, statusCode: 200, headers: {}, html: page, responseTimeMs: 300 }, scannedAt);
}

describe("schedule notifications", () => {
  it("shows a Windows toast when the run ends with a non-zero exit code or npx is missing", () => {
    const ps1 = buildMonitorSchedule({ platform: "win32", frequency: "daily", cwd: "C:\\Work", outDir: "C:\\Work\\monitoring", version: "0.85.0", args: ["--quick"] })
      .files[0].content;

    expect(ps1).toContain("function Show-Notification([string]$text) {");
    expect(ps1).toContain("$appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'");
    expect(ps1).toContain("$lines.Item(0).AppendChild($template.CreateTextNode('Open Local Audit quick check')) | Out-Null");
    expect(ps1).toContain("if ($code -ne 0) {");
    expect(ps1).toMatch(/Show-Notification \$message\r\n {2}exit 1/);
    expect(ps1).toContain("see quick.log.");
  });

  it("passes the alert text to osascript or notify-send as an argument", () => {
    const sh = buildMonitorSchedule({ platform: "darwin", cwd: "/w", outDir: "/w/monitoring", version: "0.85.0", args: ["--input", "/w/clients.csv"] }).files[0]
      .content;

    expect(sh).toContain("osascript - \"$1\" >/dev/null 2>&1 <<'APPLESCRIPT'");
    expect(sh).toContain('display notification (item 1 of argv) with title "Open Local Audit monitor"');
    expect(sh).toContain("notify-send 'Open Local Audit monitor' \"$1\"");
    expect(sh).toContain("output=$(npx --yes open-local-audit@0.85.0 monitor --input /w/clients.csv 2>&1)\ncode=$?\n");
    expect(sh).toContain('if [ "$code" -ne 0 ]; then');
    expect(sh.trimEnd().endsWith('exit "$code"')).toBe(true);
  });
});

describe("client overview", () => {
  it("lists every client with the monthly score, the daily check, alerts, and file links, problems first", () => {
    const html = renderDashboard({
      monthly: {
        runId: "2026-10-01T09-00-00-000Z",
        sites: [
          { url: "https://ok.test/", label: "OK Clinic", status: "compared", score: 88, scoreChange: 4, alerts: [], historyPath: "ok.test/history.html", pdfPath: "ok.test/2026-10-01T09-00-00-000Z/comparison.pdf" },
          { url: "https://warn.test/", label: "Warn <Clinic>", status: "baseline", score: 51, alerts: [{ kind: "domain", message: "Domain: warn.test expires soon" }] }
        ]
      },
      quick: {
        runId: "2026-10-19T08-00-00-000Z",
        sites: [
          { url: "https://www.ok.test", status: "ok", statusCode: 200, responseTimeMs: 412, alerts: [] },
          { url: "https://new.test/", status: "alert", alerts: [{ kind: "down", message: "Site did not load: fetch failed" }] }
        ]
      },
      brand: { name: "TORUT LTD" }
    });

    expect(html).toContain("<h1>TORUT LTD client overview</h1>");
    expect(html).toContain("3 clients, 2 need attention.");
    expect(html).toContain("Warn &lt;Clinic&gt;");
    expect(html.indexOf("Warn &lt;Clinic&gt;")).toBeLessThan(html.indexOf("OK Clinic"));
    expect(html.indexOf("https://new.test/")).toBeLessThan(html.indexOf("OK Clinic"));
    expect(html).toContain("88/100 <span class=\"muted\">(+4)</span>");
    expect(html).toContain("OK, HTTP 200 in 412 ms");
    expect(html).toContain("<li>Site did not load: fetch failed</li>");
    expect(html).toContain('<a href="ok.test/history.html">History</a> · <a href="ok.test/2026-10-01T09-00-00-000Z/comparison.pdf">PDF</a>');
    expect(html).toMatch(/Last monthly check: \d+ (September|October) 2026, \d{2}:\d{2}\./);
  });

  it("trusts the daily check over older monthly certificate, domain, and outage alerts", () => {
    const html = renderDashboard({
      monthly: {
        runId: "2026-10-01T09-00-00-000Z",
        sites: [
          {
            url: "https://clinic.test/",
            status: "compared",
            score: 70,
            alerts: [
              { kind: "certificate", message: "HTTPS certificate: Certificate expires 2026-10-10 (9 days)" },
              { kind: "new-high", message: "New high issue: Page does not return a successful HTTP status" }
            ]
          },
          { url: "https://renewed.test/", status: "compared", score: 80, alerts: [{ kind: "domain", message: "Domain: renewed.test expires 2026-10-20 (19 days)" }] }
        ]
      },
      quick: {
        runId: "2026-10-05T08-00-00-000Z",
        sites: [
          { url: "https://clinic.test/", status: "alert", statusCode: 200, alerts: [{ kind: "certificate", message: "HTTPS certificate: Certificate expires 2026-10-10 (5 days)" }] },
          { url: "https://renewed.test/", status: "ok", alerts: [] }
        ]
      }
    });

    expect(html).toContain("(5 days)");
    expect(html).not.toContain("(9 days)");
    expect(html).toContain("<li>New high issue: Page does not return a successful HTTP status</li>");
    expect(html).not.toContain("renewed.test expires");
    expect(html).toContain("2 clients, 1 needs attention.");
    expect(html).toMatch(/https:\/\/renewed\.test\/<\/th>\s*<td><span class="chip ok">/);
    expect(html).toContain("<td>OK</td>");
  });

  it("only links to relative files inside the output folder", () => {
    const html = renderDashboard({
      monthly: {
        sites: [
          { url: "https://a.test/", historyPath: "javascript:alert(1)", pdfPath: "../secret.pdf", emailPath: "/etc/passwd" },
          { url: "https://b.test/", historyPath: "b.test/history.html", pdfPath: "C:\\x.pdf", emailPath: "b.test/run/client-email.md" }
        ]
      }
    });

    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("secret.pdf");
    expect(html).not.toContain("/etc/passwd");
    expect(html).not.toContain("x.pdf");
    expect(html).toContain('<a href="b.test/history.html">History</a> · <a href="b.test/run/client-email.md">Email draft</a>');
  });

  it("still reports quick-check alerts when the output folder cannot be written", async () => {
    const dir = tempDir();
    const blocked = join(dir, "not-a-folder");
    writeFileSync(blocked, "x");

    const summary = await runQuickCheck([{ url: "https://down.test/" }], {
      outDir: blocked,
      check: async () => {
        throw new Error("fetch failed");
      }
    });

    expect(summary.sites[0].alerts[0].message).toBe("Site did not load: fetch failed");
    expect(summary.dashboardPath).toBeUndefined();
  });

  it("is rebuilt by monthly runs and daily checks in the output folder", async () => {
    const outDir = tempDir();
    const monthly = await runMonitor([{ url: "https://clinic.test/", label: "Clinic" }], {
      outDir,
      now: new Date("2026-10-01T12:00:00Z"),
      audit: async (url) => report(url)
    });
    expect(monthly.dashboardPath).toBe(join(outDir, "index.html"));
    expect(readFileSync(monthly.dashboardPath ?? "", "utf8")).toContain("Last daily check: none yet.");

    const quick = await runQuickCheck([{ url: "https://clinic.test/" }], {
      outDir,
      now: new Date("2026-10-19T08:00:00Z"),
      check: async (url) => report(url)
    });
    expect(JSON.parse(readFileSync(join(outDir, "quick-status.json"), "utf8")).runId).toBe("2026-10-19T08-00-00-000Z");
    const html = readFileSync(quick.dashboardPath ?? "", "utf8");
    expect(html).toContain("1 client, none need attention.");
    expect(html).toContain("OK, HTTP 200 in 300 ms");
    expect(html).toContain('<a href="clinic.test/history.html">History</a>');
  });
});
