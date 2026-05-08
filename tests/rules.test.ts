import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { auditSnapshot } from "../src/audit.js";
import { ruleCount } from "../src/rules.js";
import type { PageResource, PageSnapshot } from "../src/types.js";

function resource(statusCode: number): PageResource {
  return {
    url: "https://example.test/resource",
    finalUrl: "https://example.test/resource",
    statusCode
  };
}

function snapshot(html: string, overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    url: "https://example.test",
    finalUrl: "https://example.test",
    statusCode: 200,
    headers: {
      "content-type": "text/html; charset=utf-8"
    },
    html,
    resources: {
      robotsTxt: resource(200),
      sitemapXml: resource(200)
    },
    ...overrides
  };
}

async function fixture(name: string): Promise<string> {
  return readFile(join("tests", "fixtures", name), "utf8");
}

describe("audit rules", () => {
  it("keeps at least ten release-candidate rules active", () => {
    expect(ruleCount).toBeGreaterThanOrEqual(10);
  });

  it("passes a complete local-business page fixture with no findings", async () => {
    const html = await fixture("complete-local-page.html");
    const report = auditSnapshot(
      snapshot(html)
    );

    expect(report.summary.totalFindings).toBe(0);
  });

  it("flags missing essentials with owner-readable recommendations", () => {
    const report = auditSnapshot(
      snapshot(`
        <!doctype html>
        <html>
          <head><title></title></head>
          <body><h1></h1><img src="/team.jpg"></body>
        </html>
      `, {
        resources: {
          robotsTxt: resource(404),
          sitemapXml: resource(404)
        }
      })
    );

    expect(report.findings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining([
        "title-present",
        "meta-description-present",
        "viewport-present",
        "single-h1",
        "phone-link-present",
        "localbusiness-schema-present",
        "robots-txt-present",
        "sitemap-xml-present",
        "open-graph-present"
      ])
    );
    expect(report.recommendations.some((recommendation) => recommendation.includes("tappable phone link"))).toBe(true);
  });

  it("flags missing robots.txt and sitemap.xml discovery resources", async () => {
    const report = auditSnapshot(
      snapshot(await fixture("complete-local-page.html"), {
        resources: {
          robotsTxt: resource(404),
          sitemapXml: resource(404)
        }
      })
    );

    expect(report.findings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining(["robots-txt-present", "sitemap-xml-present"])
    );
  });

  it("flags missing Open Graph tags and invalid JSON-LD", async () => {
    const report = auditSnapshot(snapshot(await fixture("missing-discovery-page.html")));

    expect(report.findings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining(["open-graph-present", "json-ld-valid"])
    );
  });
});
