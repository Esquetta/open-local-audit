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

  it("renders Markdown with scores, findings, Lighthouse summary, and recommendations", () => {
    const markdown = renderMarkdownReport({
      ...report,
      contact: {
        publicEmail: "hello@localclinic.com",
        publicPhone: "+902120000000",
        whatsappUrl: "https://wa.me/902120000000",
        contactPageUrl: "https://example.test/contact",
        socialProfiles: ["https://www.instagram.com/localclinic"],
        contactConfidence: "High",
        contactSource: "mailto, tel, whatsapp, contact-page, social"
      },
      lighthouse: {
        requestedUrl: "https://example.test",
        finalUrl: "https://example.test",
        fetchTime: "2026-05-08T00:00:01.000Z",
        categories: {
          performance: 72,
          accessibility: 91,
          bestPractices: 86,
          seo: 94
        },
        warnings: ["The page used a test Lighthouse runner."]
      }
    });

    expect(markdown).toContain("# Open Local Audit Report");
    expect(markdown).toContain("- Profile: generic");
    expect(markdown).toContain("## Score Summary");
    expect(markdown).toContain("## Executive Summary");
    expect(markdown).toContain("Recommended first fix");
    expect(markdown).toContain("## Contact Readiness");
    expect(markdown).toContain("hello@localclinic.com");
    expect(markdown).toContain("## Lighthouse Summary");
    expect(markdown).toContain("| Performance | 72 |");
    expect(markdown).toContain("The page used a test Lighthouse runner.");
    expect(markdown).toContain("## Findings");
    expect(markdown).toContain("## Recommendations");
  });

  it("renders standalone HTML with escaped report content", () => {
    const html = renderHtmlReport({
      ...report,
      contact: {
        publicEmail: "hello@localclinic.com",
        publicPhone: "+902120000000",
        whatsappUrl: "https://wa.me/902120000000",
        contactPageUrl: "https://example.test/contact",
        socialProfiles: ["https://www.instagram.com/localclinic"],
        contactConfidence: "High",
        contactSource: "mailto, tel, whatsapp, contact-page, social"
      },
      lighthouse: {
        requestedUrl: "https://example.test",
        categories: {
          performance: 72,
          accessibility: 91,
          bestPractices: 86,
          seo: 94
        }
      }
    });

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<title>Open Local Audit Report");
    expect(html).toContain('class="report-shell"');
    expect(html).toContain("Overall Health");
    expect(html).toContain("Executive Summary");
    expect(html).toContain("Recommended first fix");
    expect(html).toContain("Contact Readiness");
    expect(html).toContain("hello@localclinic.com");
    expect(html).toContain("Priority Findings");
    expect(html).toContain("Profile: generic");
    expect(html).toContain("Score Summary");
    expect(html).toContain("Lighthouse Summary");
    expect(html).toContain("Performance");
    expect(html).toContain("72");
    expect(html).toContain("Findings");
  });

  it("applies report branding to HTML reports", () => {
    const html = renderHtmlReport(report, {
      brand: {
        name: "TORUT Audit Studio",
        primaryColor: "#123456",
        accentColor: "#abcdef",
        footerText: "Prepared for outreach review"
      }
    });

    expect(html).toContain("TORUT Audit Studio");
    expect(html).toContain("--brand: #123456");
    expect(html).toContain("--accent: #abcdef");
    expect(html).toContain("Prepared for outreach review");
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
