import { describe, expect, it } from "vitest";
import { auditSnapshot } from "../src/audit.js";
import { renderHtmlReport, renderJsonReport, renderMarkdownReport } from "../src/reporters.js";

const report = auditSnapshot(
  {
    url: "https://example.test",
    finalUrl: "https://example.test",
    statusCode: 200,
    headers: {
      "content-type": "text/html"
    },
    html: `
      <html>
        <head><title>Example</title></head>
        <body><h1>Example</h1></body>
      </html>
    `
  },
  "2026-05-08T00:00:00.000Z"
);

describe("report renderers", () => {
  it("renders parseable JSON", () => {
    const parsed = JSON.parse(renderJsonReport(report));

    expect(parsed.url).toBe("https://example.test");
    expect(parsed.findings.length).toBeGreaterThan(0);
  });

  it("renders Markdown with scores, findings, and recommendations", () => {
    const markdown = renderMarkdownReport(report);

    expect(markdown).toContain("# Open Local Audit Report");
    expect(markdown).toContain("## Score Summary");
    expect(markdown).toContain("## Findings");
    expect(markdown).toContain("## Recommendations");
  });

  it("renders standalone HTML with escaped report content", () => {
    const html = renderHtmlReport(report);

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<title>Open Local Audit Report");
    expect(html).toContain("Score Summary");
    expect(html).toContain("Findings");
  });
});
