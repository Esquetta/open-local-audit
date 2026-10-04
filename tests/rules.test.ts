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
});
