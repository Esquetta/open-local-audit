import { describe, expect, it } from "vitest";
import { auditSnapshot } from "../src/audit.js";
import { ruleCount } from "../src/rules.js";
import type { PageSnapshot } from "../src/types.js";

function snapshot(html: string, overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    url: "https://example.test",
    finalUrl: "https://example.test",
    statusCode: 200,
    headers: {
      "content-type": "text/html; charset=utf-8"
    },
    html,
    ...overrides
  };
}

describe("audit rules", () => {
  it("keeps at least ten release-candidate rules active", () => {
    expect(ruleCount).toBeGreaterThanOrEqual(10);
  });

  it("passes a complete local-business page with no findings", () => {
    const report = auditSnapshot(
      snapshot(`
        <!doctype html>
        <html>
          <head>
            <title>Example Dental Clinic Istanbul</title>
            <meta name="description" content="Family dental clinic in Istanbul.">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <link rel="canonical" href="https://example.test/">
            <script type="application/ld+json">
              {"@context":"https://schema.org","@type":"LocalBusiness","name":"Example Dental Clinic"}
            </script>
          </head>
          <body>
            <h1>Example Dental Clinic</h1>
            <a href="tel:+902120000000">Call</a>
            <a href="mailto:hello@example.test">Email</a>
            <a href="https://wa.me/902120000000">WhatsApp</a>
            <a href="https://www.google.com/maps?q=example">Directions</a>
            <img src="/office.jpg" alt="Clinic reception">
          </body>
        </html>
      `)
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
      `)
    );

    expect(report.findings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining([
        "title-present",
        "meta-description-present",
        "viewport-present",
        "single-h1",
        "phone-link-present",
        "localbusiness-schema-present"
      ])
    );
    expect(report.recommendations.some((recommendation) => recommendation.includes("tappable phone link"))).toBe(true);
  });
});
