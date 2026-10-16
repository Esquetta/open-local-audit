import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { auditSnapshot, auditUrl } from "../src/audit.js";
import { runMonitor } from "../src/monitor.js";
import { renderSiteHistory } from "../src/monitor-history.js";
import type { AuditReport, PageSnapshot } from "../src/types.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "open-local-audit-history-"));
  tempDirs.push(dir);
  return dir;
}

const page = '<html lang="en"><head><title>Clinic</title><meta name="description" content="Clinic"></head><body><h1>Clinic</h1></body></html>';

function report(scannedAt: string, overrides: Partial<PageSnapshot> = {}): AuditReport {
  return auditSnapshot({ url: "https://clinic.test/", finalUrl: "https://clinic.test/", statusCode: 200, headers: {}, html: page, ...overrides }, scannedAt);
}

describe("response time", () => {
  it("is kept in the report and its evidence when the snapshot measured it", () => {
    const measured = report("2026-10-13T12:00:00.000Z", { responseTimeMs: 412 });

    expect(measured.responseTimeMs).toBe(412);
    expect(measured.evidence).toContainEqual({ label: "Response time", value: "412 ms" });
    expect(report("2026-10-13T12:00:00.000Z").responseTimeMs).toBeUndefined();
  });

  it("is measured by static audits and left out of rendered ones", async () => {
    const server = createServer((request, response) => {
      response.writeHead(request.url === "/" ? 200 : 404, { "content-type": "text/html" });
      response.end(page);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    try {
      const measured = await auditUrl(url, { timeoutMs: 5000 });
      expect(measured.responseTimeMs).toBeGreaterThanOrEqual(0);
      expect(measured.evidence.find((item) => item.label === "Response time")?.value).toMatch(/^\d+ ms$/);

      const rendered = await auditUrl(url, {
        timeoutMs: 5000,
        render: true,
        renderPage: async () => ({ url, finalUrl: url, statusCode: 200, headers: {}, html: page })
      });
      expect(rendered.responseTimeMs).toBeUndefined();
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("shows in the monitoring summary with the change since the last run", async () => {
    const outDir = tempDir();
    const entries = [{ url: "https://clinic.test/" }];
    await runMonitor(entries, { outDir, now: new Date("2026-09-13T12:00:00Z"), audit: async () => report("2026-09-13T12:00:00.000Z", { responseTimeMs: 300 }) });
    const summary = await runMonitor(entries, {
      outDir,
      now: new Date("2026-10-13T12:00:00Z"),
      audit: async () => report("2026-10-13T12:00:00.000Z", { responseTimeMs: 420 })
    });

    expect(summary.sites[0]).toMatchObject({ responseTimeMs: 420, previousResponseTimeMs: 300 });
    const markdown = readFileSync(summary.summaryPaths.markdown, "utf8");
    expect(markdown).toContain("| Site | Status | Score | Change | Response | New | Fixed | Report | Client PDF | Email draft | History |");
    expect(markdown).toContain("| 420 ms (+120) |");
  });
});

describe("site history page", () => {
  it("is rebuilt every run with each check, its changes, and the score chart", async () => {
    const outDir = tempDir();
    const entries = [{ url: "https://clinic.test/", label: "Bright <Clinic>" }];
    const brand = { name: "Torut Web Care", primaryColor: "#123456", contact: "hello@torut.test" };
    await runMonitor(entries, { outDir, brand, now: new Date("2026-08-13T12:00:00Z"), audit: async () => report("2026-08-13T12:00:00.000Z", { html: page.replace(' lang="en"', "") }) });
    await runMonitor(entries, { outDir, brand, now: new Date("2026-09-13T12:00:00Z"), audit: async () => report("2026-09-13T12:00:00.000Z") });
    const summary = await runMonitor(entries, {
      outDir,
      brand,
      now: new Date("2026-10-13T12:00:00Z"),
      audit: async () =>
        report("2026-10-13T12:00:00.000Z", {
          statusCode: 500,
          tls: { validFrom: "2026-07-01T00:00:00.000Z", validTo: "2026-10-20T00:00:00.000Z", daysRemaining: 7, authorized: true }
        })
    });

    const path = summary.sites[0].historyPath ?? "";
    expect(path).toBe(join(outDir, "clinic.test", "history.html"));
    const html = readFileSync(path, "utf8");
    expect(html).toContain("<title>Bright &lt;Clinic&gt; website history</title>");
    expect(html).toContain("Torut Web Care website history");
    expect(html).toContain("--accent: #123456");
    expect(html).toMatch(/3 checks, \d+ August 2026 to \d+ October 2026\./);
    expect(html).toContain("First check");
    expect(html).toContain("<li>Fixed: Page language is not declared</li>");
    expect(html).toContain("<li>New: Page does not return a successful HTTP status</li>");
    expect(html).toContain("HTTPS certificate: Certificate expires 2026-10-20 (7 days)");
    expect(html.match(/<circle class="dot score"/g)).toHaveLength(3);
    expect(html).not.toContain('class="dot speed"');
    expect(html).toContain("hello@torut.test");
    expect(readFileSync(summary.summaryPaths.markdown, "utf8")).toContain("| clinic.test/history.html |");
  });

  it("adds the speed series and response times when runs have them, and labels a new baseline", () => {
    const withSpeed = (scannedAt: string, performance: number, profile?: "dental") => ({
      ...auditSnapshot({ url: "https://clinic.test/", finalUrl: "https://clinic.test/", statusCode: 200, headers: {}, html: page, responseTimeMs: 250 }, scannedAt, profile ? { profile } : {}),
      lighthouse: { requestedUrl: "https://clinic.test/", categories: { performance } }
    });
    const html = renderSiteHistory(
      [
        { runId: "a", report: withSpeed("2026-08-13T12:00:00.000Z", 60) },
        { runId: "b", report: withSpeed("2026-09-13T12:00:00.000Z", 70) },
        { runId: "c", report: withSpeed("2026-10-13T12:00:00.000Z", 80, "dental") }
      ],
      { name: "clinic.test" }
    );

    expect(html.match(/<circle class="dot speed"/g)).toHaveLength(3);
    expect(html).toContain("Page speed (Lighthouse performance)");
    expect(html).toContain(">Speed 80</text>");
    expect(html).toContain("<td>250 ms</td>");
    expect(html).toContain("New baseline");
    expect(html).toContain('"performance":80');
  });

  it("starts a new baseline when the site moved to another host, like the monitoring comparison", () => {
    const moved = auditSnapshot({ url: "https://new-clinic.test/", finalUrl: "https://new-clinic.test/", statusCode: 500, headers: {}, html: page }, "2026-10-13T12:00:00.000Z");
    const html = renderSiteHistory(
      [
        { runId: "a", report: report("2026-09-13T12:00:00.000Z") },
        { runId: "b", report: moved }
      ],
      { name: "clinic.test" }
    );

    expect(html).toContain("New baseline");
    expect(html).not.toContain("<li>New: ");
  });

  it("reads older reports without a summary or Lighthouse categories", () => {
    const old = { ...report("2026-09-13T12:00:00.000Z"), summary: undefined, lighthouse: {} } as unknown as AuditReport;
    const html = renderSiteHistory([{ runId: "a", report: old }], { name: "clinic.test" });

    expect(html).toMatch(/<td>\d+ high, \d+ medium, \d+ low<\/td>/);
  });

  it("breaks the speed line where a run has no speed and keeps close end labels apart", () => {
    const run = (scannedAt: string, performance?: number) => ({
      runId: scannedAt,
      report: {
        ...report(scannedAt),
        ...(performance === undefined ? {} : { lighthouse: { requestedUrl: "https://clinic.test/", categories: { performance } } })
      }
    });
    const runs = [run("2026-06-13T12:00:00.000Z", 50), run("2026-07-13T12:00:00.000Z", 52), run("2026-08-13T12:00:00.000Z"), run("2026-09-13T12:00:00.000Z", 60)];
    const score = renderSiteHistory([runs[0]], { name: "x" }).match(/Score (\d+)/)?.[1];
    const close = run("2026-10-13T12:00:00.000Z", Number(score));
    const html = renderSiteHistory([...runs, close], { name: "clinic.test" });

    expect(html.match(/<polyline class="line speed"/g)).toHaveLength(2);
    const ys = [...html.matchAll(/<text class="end-label" x="[\d.]+" y="([\d.]+)">/g)].map((match) => Number(match[1]));
    expect(ys).toHaveLength(2);
    expect(Math.abs(ys[0] - ys[1])).toBeGreaterThan(13.9);
    expect(html).toContain('svg.addEventListener("pointerdown", show);');
  });

  it("still counts the run when the history page cannot be written", async () => {
    const outDir = tempDir();
    mkdirSync(join(outDir, "clinic.test", "history.html"), { recursive: true });

    const summary = await runMonitor([{ url: "https://clinic.test/" }], {
      outDir,
      now: new Date("2026-10-13T12:00:00Z"),
      audit: async () => report("2026-10-13T12:00:00.000Z")
    });

    expect(summary.sites[0].status).toBe("baseline");
    expect(summary.sites[0].note).toMatch(/^First run: baseline recorded; History page not updated: /);
    expect(summary.sites[0].historyPath).toBeUndefined();
    expect(summary.sites[0].emailPath).toBeDefined();
  });

  it("wraps long site names so phones never scroll the whole page", () => {
    expect(renderSiteHistory([{ runId: "a", report: report("2026-10-13T12:00:00.000Z") }], { name: "manchesterdentalclinic.co.uk" })).toContain(
      "h1 { margin: 4px 0 4px; font-size: 1.6rem; overflow-wrap: anywhere; }"
    );
  });

  it("keeps a single check readable without a line", () => {
    const html = renderSiteHistory([{ runId: "a", report: report("2026-10-13T12:00:00.000Z") }], { name: "clinic.test" });

    expect(html).toContain("1 check, ");
    expect(html).not.toContain("<polyline");
    expect(html.match(/<circle class="dot score"/g)).toHaveLength(1);
  });
});
