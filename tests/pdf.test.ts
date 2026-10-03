import { beforeEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ text: [] as string[] }));

vi.mock("pdfkit", async () => {
  const { EventEmitter: MockEmitter } = await import("node:events");
  return {
    default: class MockPdfDocument extends MockEmitter {
      page = { width: 595 };
      rect() { return this; }
      fill() { return this; }
      fillColor() { return this; }
      font() { return this; }
      fontSize() { return this; }
      moveDown() { return this; }
      text(value: string) { captured.text.push(value); return this; }
      end() { this.emit("data", Buffer.from("%PDF-test")); this.emit("end"); }
    }
  };
});

import { renderPdfReport } from "../src/pdf.js";
import type { AuditReport } from "../src/types.js";

const report: AuditReport = {
  url: "https://example.test",
  finalUrl: "https://example.test",
  scannedAt: "2026-10-03T00:00:00.000Z",
  statusCode: 200,
  summary: { totalFindings: 0, high: 0, medium: 0, low: 0, info: 0 },
  scores: {
    "technical-health": { label: "Technical", score: 90, max: 100 },
    "search-basics": { label: "Search", score: 90, max: 100 },
    "mobile-usability": { label: "Mobile", score: 90, max: 100 },
    "trust-contact": { label: "Trust", score: 90, max: 100 }
  },
  findings: [],
  recommendations: [],
  evidence: []
};

describe("PDF report renderer", () => {
  beforeEach(() => { captured.text.length = 0; });

  it("writes uncertain business identity evidence before the executive summary", async () => {
    await expect(renderPdfReport({
      ...report,
      businessIdentity: {
        status: "uncertain",
        reasons: ["Only weak page evidence was available."],
        evidence: [{
          field: "name",
          state: "ambiguous",
          sourceValues: ["Mavi Dental"],
          websiteValues: ["Mavi Clinic"],
          pageUrl: "https://example.test/contact",
          reason: "Names are similar but not decisive."
        }]
      }
    })).resolves.toEqual(Buffer.from("%PDF-test"));

    const text = captured.text.join("\n");
    expect(text).toContain("Business Identity Check");
    expect(text).toContain("Warning: Business identity could not be confirmed from available evidence.");
    expect(text).toContain("Mavi Dental");
    expect(text).toContain("Mavi Clinic");
    expect(text).toContain("https://example.test/contact");
    expect(text).toContain("ambiguous");
    expect(text).toContain("Names are similar but not decisive.");
    expect(text.indexOf("Business Identity Check")).toBeLessThan(text.indexOf("Executive Summary"));
  });
});
