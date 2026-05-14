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

const reportWithVisualEvidence = {
  ...report,
  visualEvidence: [
    {
      path: "artifacts/example-home.png",
      screenshotPath: "artifacts/example-home.png",
      label: "Homepage render"
    }
  ]
};

describe("report renderers", () => {
  it("renders parseable JSON", () => {
    const parsed = JSON.parse(renderJsonReport(report));

    expect(parsed.url).toBe("https://example.test");
    expect(parsed.findings.length).toBeGreaterThan(0);
  });

  it("renders Markdown with scores, findings, and recommendations", () => {
    const markdown = renderMarkdownReport(report);

    expect(markdown).toContain("# Open Local Audit Report");
    expect(markdown).toContain("- Profile: generic");
    expect(markdown).toContain("## Score Summary");
    expect(markdown).toContain("## Findings");
    expect(markdown).toContain("## Recommendations");
  });

  it("renders standalone HTML with escaped report content", () => {
    const html = renderHtmlReport(report);

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<title>Open Local Audit Report");
    expect(html).toContain('class="report-shell"');
    expect(html).toContain("Overall Health");
    expect(html).toContain("Priority Findings");
    expect(html).toContain("Profile: generic");
    expect(html).toContain("Score Summary");
    expect(html).toContain("Findings");
  });

  it("renders Markdown with Visual Evidence section when visual evidence is provided", () => {
    const markdown = renderMarkdownReport(reportWithVisualEvidence);

    expect(markdown).toContain("## Visual Evidence");
    expect(markdown).toContain("artifacts/example-home.png");
  });

  it("renders HTML with Visual Evidence section when visual evidence is provided", () => {
    const html = renderHtmlReport(reportWithVisualEvidence);

    expect(html).toContain("<h2>Visual Evidence</h2>");
    expect(html).toContain("artifacts/example-home.png");
  });
});
