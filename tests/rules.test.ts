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

  it("adds public contact readiness to audit reports", () => {
    const report = auditSnapshot(
      snapshot(`
        <!doctype html>
        <html>
          <body>
            <a href="mailto:hello@localclinic.com">Email</a>
            <a href="tel:+902120000000">Call</a>
            <a href="https://wa.me/902120000000">WhatsApp</a>
            <a href="/contact">Contact</a>
          </body>
        </html>
      `)
    );

    expect(report.contact).toMatchObject({
      publicEmail: "hello@localclinic.com",
      publicPhone: "+902120000000",
      whatsappUrl: "https://wa.me/902120000000",
      contactPageUrl: "https://example.test/contact",
      contactConfidence: "High"
    });
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

describe("LocalBusiness NAP consistency rule", () => {
  function napPage(schema: Record<string, unknown>, body: string): PageSnapshot {
    return snapshot(`
      <!doctype html>
      <html>
        <head>
          <script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", ...schema })}</script>
        </head>
        <body>${body}</body>
      </html>
    `);
  }

  function napFinding(page: PageSnapshot) {
    return auditSnapshot(page).findings.find((finding) => finding.id === "localbusiness-schema-nap-consistency");
  }

  const schema = {
    "@type": "LocalBusiness",
    telephone: "+90 212 000 00 00",
    address: { "@type": "PostalAddress", streetAddress: "Example Street 12", addressLocality: "Istanbul" }
  };

  it("passes when the visible phone uses a different format and the street uses an abbreviation", () => {
    const page = napPage(schema, `
      <p>Address: Example St. 12, Kadikoy, Istanbul</p>
      <p>Call 0212 000 00 00</p>
    `);

    expect(napFinding(page)).toBeUndefined();
  });

  it("flags a schema telephone that differs from every visible phone number", () => {
    const page = napPage(schema, `
      <p>Address: Example Street 12, Istanbul</p>
      <a href="tel:+902125550000">Call us</a>
    `);

    const finding = napFinding(page);
    expect(finding).toMatchObject({ severity: "medium", category: "search-basics" });
    expect(finding?.evidence[0]?.value).toBe(
      "Schema telephone +90 212 000 00 00 not found among visible phone numbers: +90 212 555 00 00"
    );
  });

  it("flags a schema street address that the visible address does not show", () => {
    const page = napPage(schema, `
      <p>Address: Harbour Road 48, Istanbul</p>
      <a href="tel:+902120000000">Call us</a>
    `);

    expect(napFinding(page)?.evidence[0]?.value).toBe(
      'Schema streetAddress "Example Street 12" not found in visible page text'
    );
  });

  it("matches Turkish street names regardless of diacritics", () => {
    const page = napPage(
      { "@type": "LocalBusiness", address: { "@type": "PostalAddress", streetAddress: "Bağdat Caddesi No: 45" } },
      "<p>Adres: Bagdat Cd. No 45, Kadıköy</p>"
    );

    expect(napFinding(page)).toBeUndefined();
  });

  it("ignores JSON-LD placed in the body when reading visible text", () => {
    const page = snapshot(`
      <!doctype html>
      <html>
        <body>
          <script type="application/ld+json">${JSON.stringify(schema)}</script>
          <p>Address: Harbour Road 48, Istanbul</p>
          <a href="tel:+902125550000">Call us</a>
        </body>
      </html>
    `);

    expect(napFinding(page)?.evidence[0]?.value).toContain("Schema telephone +90 212 000 00 00");
    expect(napFinding(page)?.evidence[0]?.value).toContain('Schema streetAddress "Example Street 12"');
  });

  it("does not treat dates or copyright year ranges as visible phone numbers", () => {
    const page = napPage(schema, `
      <p>Address: Example Street 12, Istanbul</p>
      <p>Updated 2026-10-04. Copyright 2019 - 2026 Example Dental.</p>
    `);

    expect(napFinding(page)).toBeUndefined();
  });

  it("flags numbers with different explicit country codes", () => {
    const page = napPage(schema, `
      <p>Address: Example Street 12, Istanbul</p>
      <a href="tel:+492120000000">Call us</a>
    `);

    expect(napFinding(page)?.evidence[0]?.value).toContain("Schema telephone +90 212 000 00 00");
  });

  it("accepts 00-prefixed international numbers", () => {
    const page = napPage(schema, `
      <p>Address: Example Street 12, Istanbul</p>
      <p>Call 0090 212 000 00 00</p>
    `);

    expect(napFinding(page)).toBeUndefined();
  });

  it("compares non-Latin street names", () => {
    const cyrillic = { "@type": "LocalBusiness", address: { "@type": "PostalAddress", streetAddress: "улица Ленина 5" } };

    expect(napFinding(napPage(cyrillic, "<p>Address: улица Ленина 5, Москва</p>"))).toBeUndefined();
    expect(napFinding(napPage(cyrillic, "<p>Address: улица Пушкина 5, Москва</p>"))).toBeDefined();
  });

  it("matches CJK street addresses inside unspaced page text", () => {
    const page = napPage(
      { "@type": "LocalBusiness", address: { "@type": "PostalAddress", streetAddress: "銀座4丁目" } },
      "<p>Address: 東京都中央区銀座4丁目</p>"
    );

    expect(napFinding(page)).toBeUndefined();
  });

  it("does not let unrelated page copy supply missing street words", () => {
    const page = napPage(
      { "@type": "LocalBusiness", address: { "@type": "PostalAddress", streetAddress: "12 Main Street" } },
      `
        <h1>Main Bakery</h1>
        <p>Fresh bread every morning for the whole neighbourhood and visitors from across the city.</p>
        <p>Address: 12 Oak Road, Springfield</p>
      `
    );

    expect(napFinding(page)?.evidence[0]?.value).toBe('Schema streetAddress "12 Main Street" not found in visible page text');
  });

  it("does not compare addresses when the page only mentions an email address", () => {
    const page = napPage(schema, "<p>Enter your email address to book.</p>");

    expect(napFinding(page)).toBeUndefined();
  });

  it("matches national numbers whose trunk prefix replaces the country code", () => {
    const french = {
      "@type": "LocalBusiness",
      telephone: "+33 1 23 45 67 89",
      address: { "@type": "PostalAddress", streetAddress: "12 Rue de Rivoli", addressCountry: "FR" }
    };
    const german = { "@type": "LocalBusiness", telephone: "+49 30 123456" };

    expect(napFinding(napPage(french, "<p>Adresse: 12 Rue de Rivoli, Paris</p><p>Tel 01 23 45 67 89</p>"))).toBeUndefined();
    expect(napFinding(napPage(german, "<p>Telefon 030 123456</p>"))).toBeUndefined();
    expect(napFinding(napPage(german, "<p>Telefon 030 654321</p>"))).toBeDefined();
  });

  it("does not treat ZIP+4 codes as visible phone numbers", () => {
    const page = napPage(
      {
        "@type": "LocalBusiness",
        telephone: "+1 212 555 0100",
        address: { "@type": "PostalAddress", streetAddress: "350 Fifth Avenue", addressCountry: "US" }
      },
      "<p>Address: 350 Fifth Avenue, New York, NY 10118-0110</p>"
    );

    expect(napFinding(page)).toBeUndefined();
  });

  it("does not read an email address label as a postal address", () => {
    const page = napPage(schema, `
      <form><label>Email address:</label><input type="email"></form>
      <footer>Copyright 2026</footer>
    `);

    expect(napFinding(page)).toBeUndefined();
  });

  it("compares the street only against the element that shows the address", () => {
    const page = napPage(
      { "@type": "LocalBusiness", address: { "@type": "PostalAddress", streetAddress: "12 Main Street" } },
      "<h1>Main Bakery</h1><p>Address: 12 Oak Road</p>"
    );

    expect(napFinding(page)?.evidence[0]?.value).toBe('Schema streetAddress "12 Main Street" not found in visible page text');
  });

  it("uses full country names to read national phone numbers", () => {
    const business = (country: string) => ({
      "@type": "LocalBusiness",
      telephone: "(212) 555-0100",
      address: { "@type": "PostalAddress", streetAddress: "350 Fifth Avenue", addressCountry: { "@type": "Country", name: country } }
    });

    expect(napFinding(napPage(business("United States"), "<p>Call (212) 555-0199</p>"))?.evidence[0]?.value).toContain(
      "Schema telephone (212) 555-0100 not found"
    );
    expect(napFinding(napPage(business("USA"), "<p>Call (212) 555-0100</p>"))).toBeUndefined();
  });

  it("reports a schema telephone that is not a valid number", () => {
    const page = napPage({ ...schema, telephone: "+90 212-555-01XX" }, '<a href="tel:+902125550100">Call</a>');

    expect(napFinding(page)?.evidence[0]?.value).toBe(
      "Schema telephone +90 212-555-01XX is not a valid phone number; visible phone numbers: +90 212 555 01 00"
    );
  });

  it("ignores hidden telephone links and hidden address blocks", () => {
    const page = napPage(schema, `
      <a href="tel:+902125550100" hidden>Call</a>
      <div style="display: none"><a href="tel:+902125550100">Call</a><p>Address: Harbour Road 48</p></div>
      <template><a href="tel:+902125550100">Call</a></template>
    `);

    expect(napFinding(page)).toBeUndefined();
  });

  it("requires exact words for space-delimited non-Latin scripts", () => {
    const page = napPage(
      { "@type": "LocalBusiness", address: { "@type": "PostalAddress", streetAddress: "улица Ленина 5" } },
      "<p>Address: улица Каленина 5, Москва</p>"
    );

    expect(napFinding(page)).toBeDefined();
  });

  it("only reads body-text phone numbers that follow a phone label", () => {
    const us = {
      "@type": "LocalBusiness",
      telephone: "+1 212-555-0100",
      address: { "@type": "PostalAddress", streetAddress: "350 Fifth Avenue", addressCountry: "US" }
    };

    expect(napFinding(napPage(us, "<p>Order 4155550199 has shipped.</p>"))).toBeUndefined();
    expect(napFinding(napPage(us, "<p>Phone: (415) 555-0199</p>"))?.evidence[0]?.value).toContain("+1 415 555 0199");
    expect(napFinding(napPage(us, "<p>Kara 415 555 0199</p>"))).toBeUndefined();
  });

  it("treats German street abbreviations as the same street", () => {
    const page = napPage(
      { "@type": "LocalBusiness", address: { "@type": "PostalAddress", streetAddress: "Hauptstraße 5" } },
      "<p>Adresse: Hauptstr. 5, Berlin</p>"
    );

    expect(napFinding(page)).toBeUndefined();
  });

  it("compares addresses shown in address elements", () => {
    const page = napPage(
      { "@type": "LocalBusiness", address: { "@type": "PostalAddress", streetAddress: "12 Rue de Rivoli" } },
      "<address>14 Rue de Rivoli, Paris</address>"
    );

    expect(napFinding(page)?.evidence[0]?.value).toBe('Schema streetAddress "12 Rue de Rivoli" not found in visible page text');
  });

  it("follows @id references to PostalAddress nodes", () => {
    const page = napPage(
      {
        "@graph": [
          { "@type": "LocalBusiness", "@id": "#business", address: { "@id": "#location-address" } },
          { "@type": "PostalAddress", "@id": "#location-address", streetAddress: "Example Street 12" }
        ]
      },
      "<p>Address: Harbour Road 48, Istanbul</p>"
    );

    expect(napFinding(page)?.evidence[0]?.value).toBe('Schema streetAddress "Example Street 12" not found in visible page text');
  });

  it("follows @id references to Country nodes", () => {
    const page = napPage(
      {
        "@graph": [
          {
            "@type": "LocalBusiness",
            telephone: "(212) 555-0100",
            address: { "@type": "PostalAddress", streetAddress: "350 Fifth Avenue", addressCountry: { "@id": "#us" } }
          },
          { "@type": "Country", "@id": "#us", name: "United States" }
        ]
      },
      "<p>Call (212) 555-0199</p>"
    );

    expect(napFinding(page)?.evidence[0]?.value).toContain("Schema telephone (212) 555-0100 not found");
  });

  it("does not join a phone label from one element to a number in the next", () => {
    const page = napPage(
      {
        "@type": "LocalBusiness",
        telephone: "+1 212-555-0100",
        address: { "@type": "PostalAddress", streetAddress: "350 Fifth Avenue", addressCountry: "US" }
      },
      "<p>Phone support unavailable.</p><p>Order 4155550199 has shipped.</p>"
    );

    expect(napFinding(page)).toBeUndefined();
  });

  it("treats house-number suffix formats as the same number", () => {
    const page = napPage(
      { "@type": "LocalBusiness", address: { "@type": "PostalAddress", streetAddress: "12-A Oak Road" } },
      "<p>Address: 12A Oak Road</p>"
    );

    expect(napFinding(page)).toBeUndefined();
  });

  it("requires every distinctive street word", () => {
    const page = napPage(
      { "@type": "LocalBusiness", address: { "@type": "PostalAddress", streetAddress: "12 Martin Luther King Boulevard" } },
      "<p>Address: 12 Martin Luther Road</p>"
    );

    expect(napFinding(page)).toBeDefined();
  });

  it("distinguishes different street types", () => {
    const business = { "@type": "LocalBusiness", address: { "@type": "PostalAddress", streetAddress: "12 Main Street" } };

    expect(napFinding(napPage(business, "<p>Address: 12 Main Road</p>"))).toBeDefined();
    expect(napFinding(napPage(business, "<p>Address: 12 Main St.</p>"))).toBeUndefined();
  });

  it("keeps the whole address line when inline markup splits it", () => {
    const page = napPage(
      { "@type": "LocalBusiness", address: { "@type": "PostalAddress", streetAddress: "12 Main Street" } },
      "<p><strong>Address: 12</strong> Main Street</p>"
    );

    expect(napFinding(page)).toBeUndefined();
  });

  it("does not read a MAC address label as a postal address", () => {
    const page = napPage(schema, "<p>MAC address: 00:1A:2B:3C:4D:5E</p>");

    expect(napFinding(page)).toBeUndefined();
  });

  it("matches the house number next to the street, not a suite number", () => {
    const business = { "@type": "LocalBusiness", address: { "@type": "PostalAddress", streetAddress: "300 Main Street" } };

    expect(napFinding(napPage(business, "<address>12 Main Street, Suite 300</address>"))).toBeDefined();
    expect(napFinding(napPage(business, "<address>300 Main Street, Suite 12</address>"))).toBeUndefined();
  });

  it("keeps compass abbreviations after a house number as directionals", () => {
    const page = napPage(
      { "@type": "LocalBusiness", address: { "@type": "PostalAddress", streetAddress: "123 North Main Street" } },
      "<p>Address: 123 N Main St</p>"
    );

    expect(napFinding(page)).toBeUndefined();
  });

  it("matches addresses with numbered floor or room parts", () => {
    const business = {
      "@type": "LocalBusiness",
      address: { "@type": "PostalAddress", streetAddress: "12 Main Street, Floor 2, Room 3" }
    };

    expect(napFinding(napPage(business, "<p>Address: 12 Main Street, Floor 2, Room 3</p>"))).toBeUndefined();
    expect(napFinding(napPage(business, "<p>Address: 12 Main Street, Floor 5</p>"))).toBeDefined();
  });

  it("keeps sub-address numbers with their labels", () => {
    const page = napPage(
      { "@type": "LocalBusiness", address: { "@type": "PostalAddress", streetAddress: "12 Main Street, Floor 2, Room 3" } },
      "<p>Address: 12 Main Street, Floor 3, Room 2</p>"
    );

    expect(napFinding(page)).toBeDefined();
  });

  it("applies one phone label to a list of numbers on the same line", () => {
    const page = napPage(
      {
        "@type": "LocalBusiness",
        telephone: "+1 646 555 0100",
        address: { "@type": "PostalAddress", streetAddress: "350 Fifth Avenue", addressCountry: "US" }
      },
      "<p>Phone: +1 212 555 0100 / +1 646 555 0100</p>"
    );

    expect(napFinding(page)).toBeUndefined();
  });

  it("treats ordinal street names as street words, not house numbers", () => {
    const page = napPage(
      { "@type": "LocalBusiness", address: { "@type": "PostalAddress", streetAddress: "300 5th Avenue" } },
      "<p>Address: 12 5th Avenue, Suite 300</p>"
    );

    expect(napFinding(page)).toBeDefined();
    expect(
      napFinding(
        napPage(
          { "@type": "LocalBusiness", address: { "@type": "PostalAddress", streetAddress: "300 5th Avenue" } },
          "<p>Address: 300 5th Ave.</p>"
        )
      )
    ).toBeUndefined();
  });

  it("binds floor numbers to their label", () => {
    const business = { "@type": "LocalBusiness", address: { "@type": "PostalAddress", streetAddress: "12 Main Street, Floor 2" } };

    expect(napFinding(napPage(business, "<p>Address: 12 Main Street, Floor 3, Room 2</p>"))).toBeDefined();
    expect(napFinding(napPage(business, "<p>Address: 12 Main Street, Fl. 2</p>"))).toBeUndefined();
  });

  it("ignores address elements that only hold contact details", () => {
    const page = napPage(schema, '<address>Phone: <a href="tel:+902125550100">0212 555 01 00</a><br>Fax 0212 555 01 01</address>');

    expect(napFinding(page)?.evidence[0]?.value ?? "").not.toContain("streetAddress");
  });

  it("leaves missing visible phone or address to the existing presence rules", () => {
    const page = napPage(schema, "<p>Welcome to our clinic.</p>");

    expect(napFinding(page)).toBeUndefined();
  });

  it("does not run without LocalBusiness structured data", () => {
    const page = napPage(
      { "@type": "Organization", telephone: "+90 212 000 00 00" },
      '<p>Address: Harbour Road 48</p><a href="tel:+902125550000">Call</a>'
    );

    expect(napFinding(page)).toBeUndefined();
  });

  it("compares addresses shown as definition list and table label/value pairs", () => {
    const parisSchema = {
      "@type": "LocalBusiness",
      address: { "@type": "PostalAddress", streetAddress: "12 Rue de Rivoli", addressCountry: "FR" }
    };

    const definitionList = napPage(parisSchema, "<dl><dt>Adresse</dt><dd>14 Rue de Rivoli</dd></dl>");
    const table = napPage(parisSchema, "<table><tr><th>Address</th><td>14 Rue de Rivoli</td></tr></table>");
    const matching = napPage(parisSchema, "<dl><dt>Adresse</dt><dd>12 Rue de Rivoli, Paris</dd></dl>");

    expect(napFinding(definitionList)?.evidence[0]?.value).toContain('Schema streetAddress "12 Rue de Rivoli" not found');
    expect(napFinding(table)?.evidence[0]?.value).toContain('Schema streetAddress "12 Rue de Rivoli" not found');
    expect(napFinding(matching)).toBeUndefined();
  });

  it("does not read numbers labelled as call identifiers as phone numbers", () => {
    const usSchema = {
      "@type": "LocalBusiness",
      telephone: "+1 415 555 0123",
      address: { "@type": "PostalAddress", streetAddress: "1 Market Street", addressCountry: "US" }
    };
    const page = napPage(usSchema, "<p>Call ID: 4155550199</p><p>Address: 1 Market Street, San Francisco</p>");

    expect(napFinding(page)).toBeUndefined();
  });

  it("keeps a numbered highway in the street name instead of treating it as a suite number", () => {
    const highwaySchema = {
      "@type": "LocalBusiness",
      address: { "@type": "PostalAddress", streetAddress: "12 Highway 66", addressCountry: "US" }
    };

    const otherHighway = napPage(highwaySchema, "<p>Address: 12 Highway 77, Suite 66</p>");
    const sameHighway = napPage(highwaySchema, "<p>Address: 12 Hwy 66, Tulsa</p>");

    expect(napFinding(otherHighway)?.evidence[0]?.value).toContain('Schema streetAddress "12 Highway 66" not found');
    expect(napFinding(sameHighway)).toBeUndefined();
  });

  it("does not read a phone number after an empty address label as a visible address", () => {
    const usSchema = {
      "@type": "LocalBusiness",
      address: { "@type": "PostalAddress", streetAddress: "1 Market Street", addressCountry: "US" }
    };
    const page = napPage(usSchema, "<p>Address: unavailable; Phone: (415) 555-0199</p>");

    expect(napFinding(page)).toBeUndefined();
  });

  it("treats standalone Straße and Str. as the same street word", () => {
    const germanSchema = {
      "@type": "LocalBusiness",
      address: { "@type": "PostalAddress", streetAddress: "Muster Straße 5", addressCountry: "DE" }
    };
    const page = napPage(germanSchema, "<p>Adresse: Muster Str. 5, Berlin</p>");

    expect(napFinding(page)).toBeUndefined();
  });

  it("binds lettered suite identifiers to their label", () => {
    const suiteSchema = {
      "@type": "LocalBusiness",
      address: { "@type": "PostalAddress", streetAddress: "12 Main Street, Suite A", addressCountry: "US" }
    };

    const otherSuite = napPage(suiteSchema, "<p>Address: 12 Main Street, Suite B, Building A</p>");
    const sameSuite = napPage(suiteSchema, "<p>Address: 12 Main St., Suite A, Springfield</p>");

    expect(napFinding(otherSuite)?.evidence[0]?.value).toContain('Schema streetAddress "12 Main Street, Suite A" not found');
    expect(napFinding(sameSuite)).toBeUndefined();
  });

  it("finds unlabelled addresses on court, place and parkway streets", () => {
    const courtSchema = {
      "@type": "LocalBusiness",
      address: { "@type": "PostalAddress", streetAddress: "12 Main Court", addressCountry: "US" }
    };
    const page = napPage(courtSchema, "<p>14 Main Court</p>");

    expect(napFinding(page)?.evidence[0]?.value).toContain('Schema streetAddress "12 Main Court" not found');
  });

  it("does not read website addresses as postal addresses", () => {
    const usSchema = {
      "@type": "LocalBusiness",
      address: { "@type": "PostalAddress", streetAddress: "1 Market Street", addressCountry: "US" }
    };
    const page = napPage(usSchema, "<p>Website address: https://shop2026.example</p><p>Address: see https://maps.example/2026</p>");

    expect(napFinding(page)).toBeUndefined();
  });

  it("reads St before a street name as Saint", () => {
    const saintSchema = {
      "@type": "LocalBusiness",
      address: { "@type": "PostalAddress", streetAddress: "12 Saint John Street", addressCountry: "GB" }
    };
    const page = napPage(saintSchema, "<p>Address: 12 St John St., London</p>");

    expect(napFinding(page)).toBeUndefined();
  });

  it("finds unlabelled addresses with long street names", () => {
    const longSchema = {
      "@type": "LocalBusiness",
      address: { "@type": "PostalAddress", streetAddress: "123 North Martin Luther King Boulevard", addressCountry: "US" }
    };
    const page = napPage(longSchema, "<p>125 North Martin Luther King Boulevard</p>");

    expect(napFinding(page)?.evidence[0]?.value).toContain('Schema streetAddress "123 North Martin Luther King Boulevard" not found');
  });

  it("recognizes address labels without a colon when the value opens with the house number", () => {
    const parisSchema = {
      "@type": "LocalBusiness",
      address: { "@type": "PostalAddress", streetAddress: "12 Rue de Rivoli", addressCountry: "FR" }
    };

    const different = napPage(parisSchema, "<p>Adresse 14 Rue de Rivoli</p>");
    const prose = napPage(parisSchema, "<p>Our address changed in 2020.</p>");

    expect(napFinding(different)?.evidence[0]?.value).toContain('Schema streetAddress "12 Rue de Rivoli" not found');
    expect(napFinding(prose)).toBeUndefined();
  });

  it("ignores address elements that only hold a localized phone number", () => {
    const madridSchema = {
      "@type": "LocalBusiness",
      address: { "@type": "PostalAddress", streetAddress: "Calle Mayor 5", addressCountry: "ES" }
    };
    const page = napPage(madridSchema, "<address>Teléfono: 91 123 45 67</address>");

    expect(napFinding(page)).toBeUndefined();
  });

  it("keeps address lines split with a line break together", () => {
    const suiteSchema = {
      "@type": "LocalBusiness",
      address: { "@type": "PostalAddress", streetAddress: "12 Main Street, Suite 100", addressCountry: "US" }
    };
    const page = napPage(suiteSchema, "<p>Address: 12 Main Street<br>Suite 100</p>");

    expect(napFinding(page)).toBeUndefined();
  });

  it("compares fractional house numbers as one number", () => {
    const fractionSchema = {
      "@type": "LocalBusiness",
      address: { "@type": "PostalAddress", streetAddress: "12 1/2 Main Street", addressCountry: "US" }
    };

    const otherNumber = napPage(fractionSchema, "<p>Address: 14 1/2 Main Street, Suite 12</p>");
    const sameNumber = napPage(fractionSchema, "<p>Address: 12½ Main St.</p>");

    expect(napFinding(otherNumber)?.evidence[0]?.value).toContain('Schema streetAddress "12 1/2 Main Street" not found');
    expect(napFinding(sameNumber)).toBeUndefined();
  });

  it("finds unlabelled addresses on ordinal streets", () => {
    const ordinalSchema = {
      "@type": "LocalBusiness",
      address: { "@type": "PostalAddress", streetAddress: "12 5th Avenue", addressCountry: "US" }
    };
    const page = napPage(ordinalSchema, "<p>14 5th Avenue</p>");

    expect(napFinding(page)?.evidence[0]?.value).toContain('Schema streetAddress "12 5th Avenue" not found');
  });

  it("compares ranged house numbers as one number", () => {
    const rangeSchema = {
      "@type": "LocalBusiness",
      address: { "@type": "PostalAddress", streetAddress: "12-14 Main Street", addressCountry: "US" }
    };

    const otherRange = napPage(rangeSchema, "<p>Address: 14-16 Main Street, Suite 12</p>");
    const sameRange = napPage(rangeSchema, "<p>Address: 12 – 14 Main St.</p>");

    expect(napFinding(otherRange)?.evidence[0]?.value).toContain('Schema streetAddress "12-14 Main Street" not found');
    expect(napFinding(sameRange)).toBeUndefined();
  });

  it("binds a compound suite identifier to its label", () => {
    const suiteSchema = {
      "@type": "LocalBusiness",
      address: { "@type": "PostalAddress", streetAddress: "12 Main Street, Suite A-1", addressCountry: "US" }
    };

    const otherSuite = napPage(suiteSchema, "<p>Address: 12 Main Street, Suite A-2, Room 1</p>");
    const sameSuite = napPage(suiteSchema, "<p>Address: 12 Main St., Suite A-1, Springfield</p>");

    expect(napFinding(otherSuite)?.evidence[0]?.value).toContain('Schema streetAddress "12 Main Street, Suite A-1" not found');
    expect(napFinding(sameSuite)).toBeUndefined();
  });

  it("finds unlabelled addresses with the street type before the name", () => {
    const parisSchema = {
      "@type": "LocalBusiness",
      address: { "@type": "PostalAddress", streetAddress: "12 Rue de Rivoli", addressCountry: "FR" }
    };
    const page = napPage(parisSchema, "<p>14 Rue de Rivoli</p>");

    expect(napFinding(page)?.evidence[0]?.value).toContain('Schema streetAddress "12 Rue de Rivoli" not found');
  });

  it("keeps a County Road number in the street name", () => {
    const countySchema = {
      "@type": "LocalBusiness",
      address: { "@type": "PostalAddress", streetAddress: "100 County Road 12", addressCountry: "US" }
    };

    const otherRoad = napPage(countySchema, "<p>Address: 100 County Road 15, Suite 12</p>");
    const sameRoad = napPage(countySchema, "<p>Address: 100 County Rd 12</p>");

    expect(napFinding(otherRoad)?.evidence[0]?.value).toContain('Schema streetAddress "100 County Road 12" not found');
    expect(napFinding(sameRoad)).toBeUndefined();
  });

  it("finds unlabelled addresses with compound house numbers", () => {
    const compoundSchema = (streetAddress: string) => ({
      "@type": "LocalBusiness",
      address: { "@type": "PostalAddress", streetAddress, addressCountry: "US" }
    });

    const range = napPage(compoundSchema("12-14 Main Street"), "<p>14-16 Main Street</p>");
    const fraction = napPage(compoundSchema("12 1/2 Main Street"), "<p>14½ Main Street</p>");
    const suffix = napPage(compoundSchema("12-A Main Street"), "<p>12-B Main Street</p>");

    expect(napFinding(range)?.evidence[0]?.value).toContain('Schema streetAddress "12-14 Main Street" not found');
    expect(napFinding(fraction)?.evidence[0]?.value).toContain('Schema streetAddress "12 1/2 Main Street" not found');
    expect(napFinding(suffix)?.evidence[0]?.value).toContain('Schema streetAddress "12-A Main Street" not found');
  });

  it("does not read a labelled postal code as a visible street address", () => {
    const usSchema = {
      "@type": "LocalBusiness",
      address: { "@type": "PostalAddress", streetAddress: "1 Market Street", addressCountry: "US" }
    };
    const page = napPage(usSchema, "<p>Address: unavailable, ZIP 94105</p>");

    expect(napFinding(page)).toBeUndefined();
  });

  it("compares P.O. box addresses", () => {
    const boxSchema = {
      "@type": "LocalBusiness",
      address: { "@type": "PostalAddress", streetAddress: "P.O. Box 123", addressCountry: "US" }
    };

    expect(napFinding(napPage(boxSchema, "<p>Address: P.O. Box 456</p>"))?.evidence[0]?.value).toContain(
      'Schema streetAddress "P.O. Box 123" not found'
    );
    expect(napFinding(napPage(boxSchema, "<p>Address: PO Box 123</p>"))).toBeUndefined();
  });

  it("reads a phone label that is several words before the number", () => {
    const usSchema = {
      "@type": "LocalBusiness",
      telephone: "+1 415 555 0123",
      address: { "@type": "PostalAddress", streetAddress: "1 Market Street", addressCountry: "US" }
    };
    const page = napPage(usSchema, "<p>Telephone for general enquiries: (415) 555-0199</p>");

    expect(napFinding(page)?.evidence[0]?.value).toContain("Schema telephone +1 415 555 0123 not found");
  });

  it("ignores address elements without postal content", () => {
    const usSchema = {
      "@type": "LocalBusiness",
      address: { "@type": "PostalAddress", streetAddress: "1 Market Street", addressCountry: "US" }
    };

    expect(napFinding(napPage(usSchema, "<address>Company registration 123456</address>"))).toBeUndefined();
    expect(napFinding(napPage(usSchema, "<address>Last updated 2026</address>"))).toBeUndefined();
  });

  it("finds unlabelled prefix-style streets with the number after the name", () => {
    const romaSchema = {
      "@type": "LocalBusiness",
      address: { "@type": "PostalAddress", streetAddress: "Via Roma 12", addressCountry: "IT" }
    };

    expect(napFinding(napPage(romaSchema, "<p>Via Roma 14</p>"))?.evidence[0]?.value).toContain('Schema streetAddress "Via Roma 12" not found');
    expect(napFinding(napPage(romaSchema, "<p>We reply via email 2 days later.</p>"))).toBeUndefined();
  });

  it("does not read a year after an address label as a house number", () => {
    const usSchema = {
      "@type": "LocalBusiness",
      address: { "@type": "PostalAddress", streetAddress: "1 Market Street", addressCountry: "US" }
    };
    const page = napPage(usSchema, "<p>Address: temporarily unavailable until 2027</p>");

    expect(napFinding(page)).toBeUndefined();
  });

  it("compares lowercase prefix-style streets inside address elements", () => {
    const romaSchema = {
      "@type": "LocalBusiness",
      address: { "@type": "PostalAddress", streetAddress: "Via Roma 12", addressCountry: "IT" }
    };
    const page = napPage(romaSchema, "<address>via Roma 14</address>");

    expect(napFinding(page)?.evidence[0]?.value).toContain('Schema streetAddress "Via Roma 12" not found');
  });

  it("reads phone numbers from definition list and table label/value pairs", () => {
    const usSchema = {
      "@type": "LocalBusiness",
      telephone: "+1 415 555 0123",
      address: { "@type": "PostalAddress", streetAddress: "1 Market Street", addressCountry: "US" }
    };

    const definitionList = napPage(usSchema, "<dl><dt>Phone</dt><dd>(415) 555-0199</dd></dl>");
    const table = napPage(usSchema, "<table><tr><th>Phone</th><td>(415) 555-0199</td></tr></table>");

    expect(napFinding(definitionList)?.evidence[0]?.value).toContain("Schema telephone +1 415 555 0123 not found");
    expect(napFinding(table)?.evidence[0]?.value).toContain("Schema telephone +1 415 555 0123 not found");
  });

  it("binds hash unit identifiers", () => {
    const hashSchema = {
      "@type": "LocalBusiness",
      address: { "@type": "PostalAddress", streetAddress: "12 Main Street #100", addressCountry: "US" }
    };

    expect(napFinding(napPage(hashSchema, "<p>Address: 12 Main Street #200, Room 100</p>"))?.evidence[0]?.value).toContain(
      'Schema streetAddress "12 Main Street #100" not found'
    );
    expect(napFinding(napPage(hashSchema, "<p>Address: 12 Main St., Suite 100</p>"))).toBeUndefined();
    expect(napFinding(napPage(hashSchema, "<p>Address: 12 Main St. # 100</p>"))).toBeUndefined();
  });

  it("requires address structure in labelled values", () => {
    const usSchema = {
      "@type": "LocalBusiness",
      address: { "@type": "PostalAddress", streetAddress: "1 Market Street", addressCountry: "US" }
    };

    expect(napFinding(napPage(usSchema, "<p>Address: unavailable, error 404</p>"))).toBeUndefined();
    expect(napFinding(napPage(usSchema, "<p>Address: Kungsgatan 14</p>"))?.evidence[0]?.value).toContain(
      'Schema streetAddress "1 Market Street" not found'
    );
  });

  it("finds unlabelled addresses on numbered routes", () => {
    const routeSchema = {
      "@type": "LocalBusiness",
      address: { "@type": "PostalAddress", streetAddress: "100 Route 66", addressCountry: "US" }
    };
    const page = napPage(routeSchema, "<p>200 Route 66</p>");

    expect(napFinding(page)?.evidence[0]?.value).toContain('Schema streetAddress "100 Route 66" not found');
  });

  it("keeps slash-separated unit and street numbers together", () => {
    const unitSchema = {
      "@type": "LocalBusiness",
      address: { "@type": "PostalAddress", streetAddress: "2/14 Main Street", addressCountry: "AU" }
    };

    expect(napFinding(napPage(unitSchema, "<p>Address: 3/14 Main Street, Suite 2</p>"))?.evidence[0]?.value).toContain(
      'Schema streetAddress "2/14 Main Street" not found'
    );
    expect(napFinding(napPage(unitSchema, "<p>Address: 2 / 14 Main St.</p>"))).toBeUndefined();
  });

  it("does not read a year before a street name in prose as a house number", () => {
    const usSchema = {
      "@type": "LocalBusiness",
      address: { "@type": "PostalAddress", streetAddress: "12 Main Street", addressCountry: "US" }
    };

    expect(napFinding(napPage(usSchema, "<p>Join us at the 2026 Main Street Festival!</p>"))).toBeUndefined();
    expect(napFinding(napPage(usSchema, "<p>2000 Main Street, Springfield</p>"))?.evidence[0]?.value).toContain(
      'Schema streetAddress "12 Main Street" not found'
    );
  });

  it("treats Av. and Avenida as the same street type", () => {
    const spanishSchema = {
      "@type": "LocalBusiness",
      address: { "@type": "PostalAddress", streetAddress: "Avenida Diagonal 12", addressCountry: "ES" }
    };
    const page = napPage(spanishSchema, "<p>Dirección: Av. Diagonal 12, Barcelona</p>");

    expect(napFinding(page)).toBeUndefined();
  });

  it("keeps a bare road number after a house number in the street name", () => {
    const roadSchema = {
      "@type": "LocalBusiness",
      address: { "@type": "PostalAddress", streetAddress: "100 Road 12", addressCountry: "US" }
    };

    expect(napFinding(napPage(roadSchema, "<p>Address: 100 Road 15, Suite 12</p>"))?.evidence[0]?.value).toContain(
      'Schema streetAddress "100 Road 12" not found'
    );
    expect(napFinding(napPage(roadSchema, "<p>Address: 100 Road 12</p>"))).toBeUndefined();
  });

  it("reads a phone number from the block after a label-only block", () => {
    const usSchema = {
      "@type": "LocalBusiness",
      telephone: "+1 415 555 0123",
      address: { "@type": "PostalAddress", streetAddress: "1 Market Street", addressCountry: "US" }
    };
    const page = napPage(usSchema, "<div>Phone:</div><div>(415) 555-0199</div>");

    expect(napFinding(page)?.evidence[0]?.value).toContain("Schema telephone +1 415 555 0123 not found");
  });

  it("does not read driving directions as an address", () => {
    const usSchema = {
      "@type": "LocalBusiness",
      address: { "@type": "PostalAddress", streetAddress: "12 Main Street", addressCountry: "US" }
    };

    expect(napFinding(napPage(usSchema, "<p>Drive 5 minutes to our location.</p>"))).toBeUndefined();
    expect(napFinding(napPage(usSchema, "<p>Only 5 minutes drive from the station.</p>"))).toBeUndefined();
  });

  it("accepts any house-number-and-name structure inside address elements", () => {
    const crescentSchema = {
      "@type": "LocalBusiness",
      address: { "@type": "PostalAddress", streetAddress: "12 Main Crescent", addressCountry: "GB" }
    };

    expect(napFinding(napPage(crescentSchema, "<address>14 Main Crescent</address>"))?.evidence[0]?.value).toContain(
      'Schema streetAddress "12 Main Crescent" not found'
    );
    expect(napFinding(napPage(crescentSchema, "<address>Copyright 2026</address>"))).toBeUndefined();
  });

  it("keeps a compass letter that names the street", () => {
    const letterSchema = {
      "@type": "LocalBusiness",
      address: { "@type": "PostalAddress", streetAddress: "12 S Street", addressCountry: "US" }
    };

    expect(napFinding(napPage(letterSchema, "<p>Address: 12 South Street</p>"))?.evidence[0]?.value).toContain(
      'Schema streetAddress "12 S Street" not found'
    );
    expect(napFinding(napPage(letterSchema, "<p>Address: 12 S. Street</p>"))).toBeUndefined();
  });
});
