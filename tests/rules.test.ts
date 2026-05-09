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

  it("recognizes LocalBusiness schema nested in @graph", () => {
    const report = auditSnapshot(
      snapshot(`
        <!doctype html>
        <html>
          <head>
            <title>Graph Clinic Istanbul</title>
            <meta name="description" content="Dental services in Istanbul.">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <meta property="og:title" content="Graph Clinic Istanbul">
            <meta property="og:description" content="Dental services in Istanbul.">
            <meta property="og:url" content="https://example.test/">
            <link rel="canonical" href="https://example.test/">
            <script type="application/ld+json">
              {
                "@context":"https://schema.org",
                "@graph":[
                  {"@type":"Organization","name":"Graph Clinic"},
                  {
                    "@type":"LocalBusiness",
                    "name":"Graph Clinic",
                    "telephone":"+902120000000",
                    "address":{"@type":"PostalAddress","streetAddress":"Example Street 12","addressLocality":"Istanbul"},
                    "openingHours":"Mo-Fr 09:00-18:00"
                  }
                ]
              }
            </script>
          </head>
          <body>
            <h1>Graph Clinic</h1>
            <p>Dental services in Istanbul.</p>
            <p>Address: Example Street 12, Istanbul.</p>
            <p>Opening hours: Monday-Friday 09:00-18:00.</p>
            <a href="tel:+902120000000">Call</a>
            <a href="mailto:hello@example.test">Email</a>
            <a href="https://wa.me/902120000000">WhatsApp</a>
            <a href="https://www.google.com/maps?q=example">Directions</a>
            <a href="/book">Book an appointment</a>
            <img src="/office.jpg" alt="Office">
          </body>
        </html>
      `)
    );

    expect(report.findings.map((finding) => finding.id)).not.toContain("localbusiness-schema-present");
  });

  it("flags weak structured data and local-business conversion signals", () => {
    const report = auditSnapshot(
      snapshot(`
        <!doctype html>
        <html>
          <head>
            <title>Example Services</title>
            <meta name="description" content="Professional services.">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <meta property="og:title" content="Example Services">
            <meta property="og:description" content="Professional services.">
            <meta property="og:url" content="https://example.test/">
            <link rel="canonical" href="https://example.test/">
            <script type="application/ld+json">
              {"@context":"https://schema.org","@type":"LocalBusiness","name":"Example Services"}
            </script>
          </head>
          <body>
            <h1>Example Services</h1>
            <p>Lorem ipsum dolor sit amet. Coming soon.</p>
            <a href="tel:+902120000000">Call</a>
            <a href="mailto:hello@example.test">Email</a>
            <a href="https://wa.me/902120000000">WhatsApp</a>
            <a href="https://www.google.com/maps?q=example">Directions</a>
            <img src="/team.jpg" alt="Team">
          </body>
        </html>
      `)
    );

    expect(report.findings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining([
        "localbusiness-schema-contact-fields",
        "organization-schema-present",
        "visible-address-present",
        "opening-hours-present",
        "service-location-copy-present",
        "primary-cta-present",
        "placeholder-copy-absent"
      ])
    );
  });

  it("flags stale trust signals, missing social proof, shallow service detail, and missing brand icons", () => {
    const report = auditSnapshot(
      snapshot(`
        <!doctype html>
        <html>
          <head>
            <title>Example Dental Clinic Istanbul</title>
            <meta name="description" content="Family dental clinic in Istanbul.">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <meta property="og:title" content="Example Dental Clinic Istanbul">
            <meta property="og:description" content="Family dental clinic in Istanbul.">
            <meta property="og:url" content="https://example.test/">
            <link rel="canonical" href="https://example.test/">
            <script type="application/ld+json">
              {
                "@context":"https://schema.org",
                "@graph":[
                  {
                    "@type":"LocalBusiness",
                    "name":"Example Dental Clinic",
                    "telephone":"+902120000000",
                    "address":{"@type":"PostalAddress","streetAddress":"Example Street 12","addressLocality":"Istanbul"},
                    "openingHours":"Mo-Fr 09:00-18:00"
                  },
                  {"@type":"Organization","name":"Example Dental Clinic"}
                ]
              }
            </script>
          </head>
          <body>
            <h1>Example Dental Clinic</h1>
            <p>Family dental services in Istanbul for Kadikoy and nearby neighborhoods.</p>
            <p>Address: Example Street 12, Istanbul.</p>
            <p>Opening hours: Monday-Friday 09:00-18:00.</p>
            <a href="/book">Book an appointment</a>
            <a href="tel:+902120000000">Call</a>
            <a href="mailto:hello@example.test">Email</a>
            <a href="https://wa.me/902120000000">WhatsApp</a>
            <a href="https://www.google.com/maps?q=example">Directions</a>
            <footer>Copyright 2023 Example Dental Clinic</footer>
            <img src="/office.jpg" alt="Clinic reception">
          </body>
        </html>
      `)
    );

    expect(report.findings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining([
        "current-date-signals",
        "review-cue-present",
        "service-detail-depth",
        "brand-icons-present"
      ])
    );
  });

  it("flags deterministic placeholder social profile links", async () => {
    const report = auditSnapshot(
      snapshot(`
        <!doctype html>
        <html>
          <head>
            <title>Example Dental Clinic Istanbul</title>
            <meta name="description" content="Family dental clinic in Istanbul.">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <meta property="og:title" content="Example Dental Clinic Istanbul">
            <meta property="og:description" content="Family dental clinic in Istanbul.">
            <meta property="og:url" content="https://example.test/">
            <link rel="canonical" href="https://example.test/">
            <link rel="icon" href="/favicon.ico">
            <link rel="apple-touch-icon" href="/apple-touch-icon.png">
            <script type="application/ld+json">
              {
                "@context":"https://schema.org",
                "@graph":[
                  {
                    "@type":"LocalBusiness",
                    "name":"Example Dental Clinic",
                    "telephone":"+902120000000",
                    "address":{"@type":"PostalAddress","streetAddress":"Example Street 12","addressLocality":"Istanbul"},
                    "openingHours":"Mo-Fr 09:00-18:00"
                  },
                  {"@type":"Organization","name":"Example Dental Clinic"}
                ]
              }
            </script>
          </head>
          <body>
            <h1>Example Dental Clinic</h1>
            <p>Family dental services in Istanbul for Kadikoy and nearby neighborhoods.</p>
            <section>
              <h2>Dental services</h2>
              <ul>
                <li>Preventive dental exams for families.</li>
                <li>Cosmetic whitening with appointment planning.</li>
                <li>Emergency dental repair and follow-up care.</li>
              </ul>
            </section>
            <blockquote>Patients rate our service 4.9 stars in local reviews.</blockquote>
            <p>Address: Example Street 12, Istanbul.</p>
            <p>Opening hours: Monday-Friday 09:00-18:00.</p>
            <a href="/book">Book an appointment</a>
            <a href="tel:+902120000000">Call</a>
            <a href="mailto:hello@example.test">Email</a>
            <a href="https://wa.me/902120000000">WhatsApp</a>
            <a href="https://www.google.com/maps?q=example">Directions</a>
            <a href="https://www.instagram.com/yourbusiness">Instagram</a>
            <img src="/office.jpg" alt="Clinic reception">
          </body>
        </html>
      `)
    );

    expect(report.findings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining(["placeholder-social-links"])
    );
  });
});
