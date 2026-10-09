import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { auditSnapshot } from "../src/audit.js";
import { buildProspectRows } from "../src/discovery.js";
import type { PageSnapshot } from "../src/types.js";

function snapshot(html: string, statusCode = 200): PageSnapshot {
  return {
    url: "https://example.test",
    finalUrl: "https://example.test",
    statusCode,
    headers: { "content-type": "text/html; charset=utf-8" },
    html,
    resources: {
      robotsTxt: { url: "https://example.test/robots.txt", finalUrl: "https://example.test/robots.txt", statusCode: 404 },
      sitemapXml: { url: "https://example.test/sitemap.xml", finalUrl: "https://example.test/sitemap.xml", statusCode: 404 }
    }
  };
}

describe("placeholder pages", () => {
  it("reports a maintenance page as one placeholder finding with a zero score", () => {
    const report = auditSnapshot(snapshot("Website temporarily down due to maintenance."), undefined, { profile: "dental" });

    expect(report.findings.map((finding) => finding.id)).toEqual(["website-placeholder"]);
    expect(report.findings[0]).toMatchObject({
      title: "Website is down or showing a placeholder page",
      severity: "high",
      evidence: [{ value: 'Placeholder page: "temporarily down" in 44 characters of page text' }]
    });
    expect(Object.values(report.scores).every((score) => score.score === 0)).toBe(true);
  });

  it("reports a parked for-sale domain even when it also mentions maintenance", () => {
    const report = auditSnapshot(
      snapshot("<html><head><title>example.test</title></head><body><h1>example.test</h1><p>This domain may be for sale. Under maintenance.</p></body></html>")
    );

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      id: "website-placeholder",
      title: "Domain is parked or for sale instead of hosting the business website"
    });
    expect(report.findings[0]?.evidence[0]?.value).toContain('Parked domain: "This domain may be for sale"');
  });

  it("detects a maintenance page served with a 503 status", () => {
    const report = auditSnapshot(snapshot("<h1>Under maintenance</h1><p>We'll be back soon.</p>", 503));

    expect(report.findings.map((finding) => finding.id)).toEqual(["website-placeholder"]);
  });

  it("keeps the full audit for real pages that mention the same phrases", async () => {
    const html = (await readFile(join("tests", "fixtures", "complete-local-page.html"), "utf8")).replace(
      "</body>",
      "<p>Online booking is temporarily down due to maintenance. Call us to book instead.</p></body>"
    );
    const report = auditSnapshot(snapshot(html));

    expect(report.findings.some((finding) => finding.id === "website-placeholder")).toBe(false);
  });

  it("ranks an audited placeholder site as a website-build opportunity", () => {
    const [row] = buildProspectRows([
      {
        candidate: { source: "manual-csv", label: "Parked Dental", websiteUri: "https://parked.example" },
        resolution: { hasWebsite: true, websiteUrl: "https://parked.example", status: "resolved" },
        audit: {
          status: "success",
          score: 0,
          topFinding: "Domain is parked or for sale instead of hosting the business website",
          placeholder: true
        }
      }
    ]);

    expect(row).toMatchObject({
      opportunityScore: 95,
      priority: "high",
      nextAction: "Replace the placeholder or parked page with a basic website.",
      pitchAngle: "Launch a credible local website",
      recommendedOffer: "Starter website build"
    });
    expect(row?.opportunityReasons).toEqual([
      "Top finding: Domain is parked or for sale instead of hosting the business website",
      "Website-build opportunity"
    ]);
  });
});
