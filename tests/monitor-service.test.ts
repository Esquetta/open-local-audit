import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { auditSnapshot } from "../src/audit.js";
import { readBatchInput } from "../src/batch.js";
import { renderComparisonPdf, compareReports } from "../src/compare.js";
import { monitorSiteFolder, runMonitor } from "../src/monitor.js";
import { renderDashboard } from "../src/monitor-dashboard.js";
import { runQuickCheck } from "../src/monitor-quick.js";
import { readWorkLog, serviceSections, siteIdentity } from "../src/monitor-service.js";
import type { AuditReport } from "../src/types.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "open-local-audit-service-"));
  tempDirs.push(dir);
  return dir;
}

const page = '<html lang="en"><head><title>Clinic</title></head><body><h1>Clinic</h1></body></html>';

function report(url: string, scannedAt: string): AuditReport {
  return auditSnapshot({ url, finalUrl: url, statusCode: 200, headers: {}, html: page, responseTimeMs: 300 }, scannedAt);
}

async function quickCheck(outDir: string, iso: string, up: boolean): Promise<void> {
  await runQuickCheck([{ url: "https://clinic.test/", includedMinutes: 30 }], {
    outDir,
    now: new Date(iso),
    check: async (url) => {
      if (!up) {
        throw new Error("fetch failed");
      }
      return report(url, iso);
    }
  });
}

describe("work log", () => {
  it("reads dated work per site, with bare hosts, quoted descriptions, and a byte order mark", async () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "work-log.csv"),
      '\uFEFFdate,site,minutes,description\r\n# March\r\n2026-09-15,clinic.test,25,"Fixed the contact form, tested on mobile"\r\n2026-09-16,https://www.other.test/,10,\r\n'
    );

    expect(await readWorkLog(dir)).toEqual({
      entries: [
        { date: "2026-09-15", site: "clinic.test", minutes: 25, description: "Fixed the contact form, tested on mobile" },
        { date: "2026-09-16", site: "https://www.other.test/", minutes: 10, description: "" }
      ],
      errors: []
    });
    expect(await readWorkLog(join(dir, "missing"))).toEqual({ entries: [], errors: [] });
  });

  it("names every row it cannot read by line number", async () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "work-log.csv"),
      "date,site,minutes,description\n2026-02-30,clinic.test,10,x\n2026-09-01,clinic.test,0,x\n2026-09-01,,10,x\n2026-09-01,clinic.test,1.5,x\n2026-09-02,clinic.test,5,ok\n"
    );

    const log = await readWorkLog(dir);
    expect(log.entries).toHaveLength(1);
    expect(log.errors).toEqual([
      'work-log.csv line 2: date must be YYYY-MM-DD, got "2026-02-30"',
      'work-log.csv line 3: minutes must be a whole number above 0, got "0"',
      'work-log.csv line 4: site must be the client\'s website, got ""',
      'work-log.csv line 5: minutes must be a whole number above 0, got "1.5"'
    ]);

    writeFileSync(join(dir, "work-log.csv"), "date,site,minutes,description\n,,,\n2026-09-02,clinic.test,5,ok\n");
    expect(await readWorkLog(dir)).toEqual({ entries: [{ date: "2026-09-02", site: "clinic.test", minutes: 5, description: "ok" }], errors: [] });

    writeFileSync(join(dir, "work-log.csv"), "when,site,minutes\n2026-09-01,clinic.test,5\n");
    expect((await readWorkLog(dir)).errors).toEqual(["work-log.csv needs date, site, and minutes columns (missing date)"]);
  });

  it("reads the minutes included in each client's plan from the client list", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "clients.csv"), "url,label,included_minutes\nhttps://clinic.test/,Clinic,30\nhttps://lite.test/,Lite,\n");
    expect(await readBatchInput(join(dir, "clients.csv"))).toEqual([
      { url: "https://clinic.test/", label: "Clinic", includedMinutes: 30 },
      { url: "https://lite.test/", label: "Lite" }
    ]);

    writeFileSync(join(dir, "clients.csv"), "url,included_minutes\nhttps://clinic.test/,half an hour\n");
    await expect(readBatchInput(join(dir, "clients.csv"))).rejects.toThrow('included_minutes must be a whole number of minutes, got "half an hour"');
  });
});

describe("availability", () => {
  it("logs every quick check, counting certificate warnings as up and failed loads as down", async () => {
    const outDir = tempDir();
    await runQuickCheck([{ url: "https://clinic.test/" }, { url: "https://down.test/" }, { url: "https://expiring.test/" }], {
      outDir,
      now: new Date("2026-09-10T12:00:00Z"),
      check: async (url) => {
        if (url.includes("down")) {
          throw new Error("fetch failed");
        }
        return url.includes("expiring")
          ? auditSnapshot(
              {
                url,
                finalUrl: url,
                statusCode: 200,
                headers: {},
                html: page,
                tls: { validFrom: "2026-07-01T00:00:00.000Z", validTo: "2026-09-15T00:00:00.000Z", daysRemaining: 5, authorized: true }
              },
              "2026-09-10T12:00:00.000Z"
            )
          : report(url, "2026-09-10T12:00:00.000Z");
      }
    });
    await quickCheck(outDir, "2026-09-11T12:00:00Z", true);

    const lines = readFileSync(join(outDir, "quick-history.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(lines).toEqual([
      {
        runId: "2026-09-10T12-00-00-000Z",
        sites: [
          { url: "https://clinic.test/", up: true },
          { url: "https://down.test/", up: false },
          { url: "https://expiring.test/", up: true }
        ]
      },
      { runId: "2026-09-11T12-00-00-000Z", sites: [{ url: "https://clinic.test/", up: true }] }
    ]);
  });

  it("keeps the daily record when quick-status.json cannot be written", async () => {
    const outDir = tempDir();
    mkdirSync(join(outDir, "quick-status.json"));
    await quickCheck(outDir, "2026-09-10T12:00:00Z", true);

    expect(readFileSync(join(outDir, "quick-history.jsonl"), "utf8")).toContain('"runId":"2026-09-10T12-00-00-000Z"');
  });

  it("matches sites the same way as the monitor folders", () => {
    for (const url of ["https://www.Clinic.test./", "http://clinic.test:8080/team/?a=1", "https://clinic.test/a/b/", "clinic.test"]) {
      expect(siteIdentity(url)).toBe(monitorSiteFolder(url.includes("://") ? url : `https://${url}`).identity);
    }
  });

  it("words a single check and a fully available period plainly", () => {
    const since = new Date("2026-09-01T12:00:00Z");
    expect(serviceSections({ since, availability: { checks: 1, up: 1, downDays: [] } })[0].lines).toEqual([
      "The site loaded on the only daily check since 1 September 2026."
    ]);
    expect(serviceSections({ since, availability: { checks: 30, up: 30, downDays: [] } })[0].lines).toEqual([
      "The site loaded on all 30 daily checks since 1 September 2026."
    ]);
    expect(serviceSections({ since, work: { entries: [], minutes: 0, includedMinutes: 0 } })).toEqual([]);
    expect(serviceSections({ since, work: { entries: [], minutes: 0, includedMinutes: 30 } })[0].lines).toEqual(["No work was needed in this period."]);
  });
});

describe("monthly service report", () => {
  it("adds availability and work done since the last run to the email, comparison reports, and summary", async () => {
    const outDir = tempDir();
    const entries = [{ url: "https://clinic.test/", label: "Clinic", includedMinutes: 30 }];
    const audit = (scannedAt: string) => async (url: string) => report(url, scannedAt);
    writeFileSync(
      join(outDir, "work-log.csv"),
      [
        "date,site,minutes,description",
        "2026-08-20,clinic.test,15,Set up monitoring",
        "2026-09-01,clinic.test,10,Updated opening hours",
        '2026-09-15,https://www.clinic.test/,25,"Fixed the contact form, tested on mobile"',
        "2026-09-20,other.test,40,Someone else's site",
        "2026-10-01,clinic.test,5,Renewed the domain",
        ""
      ].join("\n")
    );
    await quickCheck(outDir, "2026-08-31T12:00:00Z", true);

    const first = await runMonitor(entries, { outDir, now: new Date("2026-09-01T12:00:00Z"), audit: audit("2026-09-01T12:00:00.000Z") });
    const firstEmail = readFileSync(first.sites[0].emailPath ?? "", "utf8");
    expect(firstEmail).toContain("Availability:\nThe site loaded on the only daily check since 2 August 2026.");
    expect(firstEmail).toContain("Work done:\n- 20 August 2026: Set up monitoring (15 min)\nTime used: 15 of 30 included minutes.\n");
    expect(firstEmail).not.toContain("opening hours");

    await quickCheck(outDir, "2026-09-10T12:00:00Z", true);
    await quickCheck(outDir, "2026-09-11T12:00:00Z", false);
    await quickCheck(outDir, "2026-09-12T12:00:00Z", true);

    const second = await runMonitor(entries, { outDir, now: new Date("2026-10-01T12:00:00Z"), audit: audit("2026-10-01T12:00:00.000Z") });
    const site = second.sites[0];
    expect(site.status).toBe("compared");
    expect(site.availability).toEqual({ checks: 3, up: 2, downDays: ["2026-09-11"] });
    expect(site.work?.minutes).toBe(35);
    expect(site.serviceSince).toBe("2026-09-01T12:00:00.000Z");

    const email = readFileSync(site.emailPath ?? "", "utf8");
    expect(email).toContain("Availability:\nThe site loaded on 2 of 3 daily checks since 1 September 2026.\nIt did not load on 11 September 2026.");
    expect(email).toContain(
      "Work done:\n- 1 September 2026: Updated opening hours (10 min)\n- 15 September 2026: Fixed the contact form, tested on mobile (25 min)\nTime used: 35 minutes, 5 more than the 30 included.\n"
    );
    expect(email).not.toContain("Renewed the domain");
    expect(email).not.toContain("Someone else");
    expect(email.indexOf("Work done:")).toBeLessThan(email.indexOf("What I recommend next:"));

    const markdown = readFileSync(join(site.reportDir ?? "", "comparison.md"), "utf8");
    expect(markdown).toContain("## Availability\n\nThe site loaded on 2 of 3 daily checks since 1 September 2026.");
    expect(markdown).toContain("## Work Done\n\n- 1 September 2026: Updated opening hours (10 min)");
    expect(readFileSync(site.comparisonPath ?? "", "utf8")).toContain("<h2>Work Done</h2>\n    <ul><li>1 September 2026: Updated opening hours (10 min)</li>");

    const summary = readFileSync(second.summaryPaths.markdown, "utf8");
    expect(summary).toContain("| Uptime | Work |");
    expect(summary).toContain("| 2/3 checks | 35 minutes, 5 more than the 30 included |");

    const dashboard = readFileSync(second.dashboardPath ?? "", "utf8");
    expect(dashboard).toContain("75% <span class=\"muted\">(3/4)</span>");
    expect(dashboard).toContain("<td>5 of 30 min</td>");
  });

  it("stops before auditing when the work log has a mistake", async () => {
    const outDir = tempDir();
    writeFileSync(join(outDir, "work-log.csv"), "date,site,minutes\n01/09/2026,clinic.test,10\n");
    let audits = 0;

    await expect(
      runMonitor([{ url: "https://clinic.test/" }], {
        outDir,
        audit: async (url) => {
          audits += 1;
          return report(url, "2026-10-01T12:00:00.000Z");
        }
      })
    ).rejects.toThrow('Fix work-log.csv before monitoring:\nwork-log.csv line 2: date must be YYYY-MM-DD, got "01/09/2026"');
    expect(audits).toBe(0);
  });

  it("writes the sections into the comparison PDF", async () => {
    const before = report("https://clinic.test/", "2026-09-01T12:00:00.000Z");
    const after = report("https://clinic.test/", "2026-10-01T12:00:00.000Z");
    const service = serviceSections({ since: new Date("2026-09-01T12:00:00Z"), availability: { checks: 3, up: 3, downDays: [] } });
    const plain = await renderComparisonPdf(compareReports(before, after));
    const withService = await renderComparisonPdf(compareReports(before, after), { service });

    expect(withService.subarray(0, 5).toString()).toBe("%PDF-");
    expect(withService.length).toBeGreaterThan(plain.length);
  });
});

describe("client overview service columns", () => {
  it("flags clients whose logged work goes over their included minutes and warns about unreadable work log rows", () => {
    const html = renderDashboard({
      monthly: { runId: "2026-10-01T12-00-00-000Z", sites: [{ url: "https://clinic.test/", status: "compared", score: 80, includedMinutes: 30, alerts: [] }] },
      workLog: [
        { date: "2026-09-30", site: "clinic.test", minutes: 60, description: "Last month" },
        { date: "2026-10-02", site: "clinic.test", minutes: 45, description: "Rebuilt the booking page" }
      ],
      workLogErrors: 2
    });

    expect(html).toContain("<td>45 of 30 min</td>");
    expect(html).toContain("<li>Time used: 45 minutes, 15 more than the 30 included.</li>");
    expect(html).toContain("1 client, 1 needs attention.");
    expect(html).toContain("work-log.csv has 2 problems; the next monthly run stops until they are fixed.");
    expect(html).toContain("<th scope=\"col\">Uptime, 30 days</th>");
  });
});
