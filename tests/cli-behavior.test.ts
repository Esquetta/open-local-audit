import { describe, expect, it } from "vitest";
import { auditSnapshot } from "../src/audit.js";
import { shouldFailOnThreshold } from "../src/exit-policy.js";
import { renderTerminalSummary } from "../src/summary.js";

const report = auditSnapshot(
  {
    url: "https://example.test",
    finalUrl: "https://example.test",
    statusCode: 200,
    headers: {
      "content-type": "text/html"
    },
    html: "<html><head><title></title></head><body><h1></h1></body></html>",
    resources: {
      robotsTxt: {
        url: "https://example.test/robots.txt",
        finalUrl: "https://example.test/robots.txt",
        statusCode: 404
      },
      sitemapXml: {
        url: "https://example.test/sitemap.xml",
        finalUrl: "https://example.test/sitemap.xml",
        statusCode: 404
      }
    }
  },
  "2026-05-08T00:00:00.000Z"
);

describe("CLI behavior helpers", () => {
  it("fails when findings meet the configured severity threshold", () => {
    expect(shouldFailOnThreshold(report, "high")).toBe(true);
    expect(shouldFailOnThreshold(report, "medium")).toBe(true);
    expect(shouldFailOnThreshold(report, "none")).toBe(false);
  });

  it("renders a compact terminal summary", () => {
    const summary = renderTerminalSummary(report);

    expect(summary).toContain("Overall score:");
    expect(summary).toContain("High:");
    expect(summary).toContain("Medium:");
    expect(summary).toContain("Top issue:");
  });
});
