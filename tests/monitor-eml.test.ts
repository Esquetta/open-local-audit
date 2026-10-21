import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { auditSnapshot } from "../src/audit.js";
import { readBatchInput } from "../src/batch.js";
import { renderClientEml, runMonitor } from "../src/monitor.js";
import { serviceSections } from "../src/monitor-service.js";
import { renderPdfReport } from "../src/pdf.js";
import type { AuditReport } from "../src/types.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "open-local-audit-eml-"));
  tempDirs.push(dir);
  return dir;
}

const page = '<html lang="en"><head><title>Clinic</title></head><body><h1>Clinic</h1></body></html>';

function report(url: string, scannedAt: string): AuditReport {
  return auditSnapshot({ url, finalUrl: url, statusCode: 200, headers: {}, html: page }, scannedAt);
}

// Splits a draft into its headers and the decoded text and attachment parts.
function parseEml(eml: string) {
  const [head, ...rest] = eml.split("\r\n\r\n");
  const headers = head.replace(/\r\n /g, " ").split("\r\n");
  const boundary = /boundary="([^"]+)"/.exec(head)?.[1] ?? "";
  const parts = rest
    .join("\r\n\r\n")
    .split(`--${boundary}`)
    .slice(1, -1)
    .map((part) => {
      const [partHead, partBody] = part.replace(/^\r\n/, "").split("\r\n\r\n");
      return { head: partHead, data: Buffer.from(partBody.replace(/\r\n/g, ""), "base64") };
    });
  return { headers, boundary, parts, closed: eml.endsWith(`--${boundary}--\r\n`) };
}

function decodeSubject(header: string): string {
  const value = header.replace(/^Subject: /, "");
  const words = [...value.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)];
  return words.length === 0 ? value : Buffer.concat(words.map((word) => Buffer.from(word[1], "base64"))).toString("utf8");
}

describe("client email drafts (.eml)", () => {
  it("writes an unsent draft with the body and the PDF attached, in short CRLF lines", () => {
    const pdf = Buffer.from(Array.from({ length: 300 }, (_, index) => index % 256));
    const eml = renderClientEml({
      to: ["owner@clinic.test", "office@clinic.test"],
      subject: "Website check for Café Çağ, October 2026 — a long subject to fold",
      body: "Hi,\n\nThe site loaded on all 30 daily checks.\n\nBest regards,\nFurkan Tasci\n",
      attachment: { filename: "comparison.pdf", data: pdf }
    });
    const parsed = parseEml(eml);

    expect(parsed.headers[0]).toBe("X-Unsent: 1");
    expect(parsed.headers).toContain("To: owner@clinic.test, office@clinic.test");
    expect(parsed.headers).toContain("MIME-Version: 1.0");
    expect(decodeSubject(parsed.headers.find((header) => header.startsWith("Subject: ")) ?? "")).toBe(
      "Website check for Café Çağ, October 2026 — a long subject to fold"
    );
    expect(parsed.parts).toHaveLength(2);
    expect(parsed.parts[0].head).toContain("Content-Type: text/plain; charset=utf-8");
    expect(parsed.parts[0].data.toString("utf8")).toBe("Hi,\r\n\r\nThe site loaded on all 30 daily checks.\r\n\r\nBest regards,\r\nFurkan Tasci\r\n");
    expect(parsed.parts[1].head).toContain('Content-Disposition: attachment; filename="comparison.pdf"');
    expect(parsed.parts[1].data.equals(pdf)).toBe(true);
    expect(parsed.closed).toBe(true);
    expect(eml.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(Math.max(...eml.split("\r\n").map((line) => line.length))).toBeLessThanOrEqual(78);
  });

  it("folds long recipient lists and long plain subjects, and refuses anything but plain addresses", () => {
    const label = "Bright Smile Dental Practice Manchester and Salford";
    const eml = renderClientEml({
      to: ["accounts.department@clinic-example.co.uk", "reception.team@clinic-example.co.uk"],
      subject: `Website check for ${label}, October 2026`,
      body: "Hi\n",
      attachment: { filename: "comparison.pdf", data: Buffer.from("x") }
    });
    const parsed = parseEml(eml);

    expect(Math.max(...eml.split("\r\n").map((line) => line.length))).toBeLessThanOrEqual(78);
    expect(parsed.headers).toContain("To: accounts.department@clinic-example.co.uk, reception.team@clinic-example.co.uk");
    expect(decodeSubject(parsed.headers.find((header) => header.startsWith("Subject: ")) ?? "")).toBe(`Website check for ${label}, October 2026`);
    for (const to of ["owner@clinic.test\r\nBcc: x@y.test", "Owner <owner@clinic.test>", "müller@café.test"]) {
      expect(() => renderClientEml({ to: [to], subject: "s", body: "b", attachment: { filename: "a.pdf", data: Buffer.from("x") } })).toThrow(
        "Not a plain email address"
      );
    }
  });

  it("leaves the recipient out when none is known and keeps ASCII subjects as they are", () => {
    const eml = renderClientEml({ subject: "Website check", body: "Hi\n", attachment: { filename: "my report.pdf", data: Buffer.from("x") } });

    expect(eml).not.toContain("To:");
    expect(eml).toContain("\r\nSubject: Website check\r\n");
    expect(eml).toContain('filename="my_report.pdf"');
  });

  it("reads client addresses from the client list and rejects anything but plain addresses", async () => {
    const dir = tempDir();
    const path = join(dir, "clients.csv");
    writeFileSync(path, "url,client_email\nhttps://clinic.test/,owner@clinic.test; office@clinic.test\nhttps://lite.test/,\n");
    expect((await readBatchInput(path)).map((entry) => entry.clientEmail)).toEqual([["owner@clinic.test", "office@clinic.test"], undefined]);

    writeFileSync(path, 'url,client_email\nhttps://clinic.test/,"Owner <owner@clinic.test>"\n');
    await expect(readBatchInput(path)).rejects.toThrow('client_email must be email addresses separated by semicolons, got "Owner <owner@clinic.test>"');
    writeFileSync(path, "url,client_email\nhttps://clinic.test/,owner\n");
    await expect(readBatchInput(path)).rejects.toThrow('got "owner"');
  });

  it("is written next to every monthly email with the PDF the client should get", async () => {
    const outDir = tempDir();
    const entries = [{ url: "https://clinic.test/", label: "Clinic", clientEmail: ["owner@clinic.test"] }];
    const first = await runMonitor(entries, {
      outDir,
      now: new Date("2026-09-01T12:00:00Z"),
      audit: async (url) => report(url, "2026-09-01T12:00:00.000Z")
    });
    const baseline = first.sites[0];
    const baselineEml = parseEml(readFileSync(baseline.emlPath ?? "", "utf8"));
    expect(baselineEml.headers).toContain("To: owner@clinic.test");
    expect(baselineEml.headers).toContain("Subject: Website check for Clinic, September 2026");
    expect(baselineEml.parts[0].data.toString("utf8")).toContain("The full report is attached (open-local-audit-report.pdf).");
    expect(baselineEml.parts[0].data.toString("utf8").replace(/\r\n/g, "\n")).toBe(
      readFileSync(baseline.emailPath ?? "", "utf8").replace(/^<!--.*-->\n\nSubject: .*\n\n/, "")
    );
    expect(baselineEml.parts[1].data.equals(readFileSync(baseline.pdfPath ?? ""))).toBe(true);

    const second = await runMonitor(entries, {
      outDir,
      now: new Date("2026-10-01T12:00:00Z"),
      audit: async (url) => report(url, "2026-10-01T12:00:00.000Z")
    });
    const compared = second.sites[0];
    const comparedEml = parseEml(readFileSync(compared.emlPath ?? "", "utf8"));
    expect(comparedEml.parts[1].head).toContain('filename="comparison.pdf"');
    expect(comparedEml.parts[1].data.equals(readFileSync(join(compared.reportDir ?? "", "comparison.pdf")))).toBe(true);

    const json = JSON.parse(readFileSync(second.summaryPaths.json, "utf8"));
    expect(json.sites[0].emlPath).toBe("clinic.test/2026-10-01T12-00-00-000Z/client-email.eml");
    expect(readFileSync(second.dashboardPath ?? "", "utf8")).toContain(
      '<a href="clinic.test/2026-10-01T12-00-00-000Z/client-email.eml">Mail (.eml)</a>'
    );
  });
});

describe("mail draft failures", () => {
  it("keep the run and note why the draft is missing", async () => {
    const outDir = tempDir();
    mkdirSync(join(outDir, "clinic.test", "2026-09-01T12-00-00-000Z", "client-email.eml"), { recursive: true });

    const summary = await runMonitor([{ url: "https://clinic.test/" }], {
      outDir,
      now: new Date("2026-09-01T12:00:00Z"),
      audit: async (url) => report(url, "2026-09-01T12:00:00.000Z")
    });

    expect(summary.sites[0].status).toBe("baseline");
    expect(summary.sites[0].emlPath).toBeUndefined();
    expect(summary.sites[0].note).toMatch(/Mail draft not written: /);
    expect(summary.sites[0].emailPath).toBeDefined();
  });
});

describe("first report PDF", () => {
  it("includes availability and work sections when monitoring passes them", async () => {
    const audit = report("https://clinic.test/", "2026-09-01T12:00:00.000Z");
    const service = serviceSections({
      since: new Date("2026-08-02T12:00:00Z"),
      availability: { checks: 3, up: 3, downDays: [] },
      work: { entries: [{ date: "2026-08-20", minutes: 15, description: "Set up monitoring" }], minutes: 15, includedMinutes: 30 }
    });

    const plain = await renderPdfReport(audit);
    const withService = await renderPdfReport(audit, { service });
    expect(withService.length).toBeGreaterThan(plain.length);
  });
});
