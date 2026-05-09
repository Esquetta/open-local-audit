import { describe, expect, it } from "vitest";
import { auditUrl } from "../src/audit.js";
import { cliOptionsSchema } from "../src/schema.js";

describe("rendered audit mode", () => {
  it("uses a rendered page snapshot when render mode is enabled", async () => {
    const report = await auditUrl("https://example.test", {
      render: true,
      timeoutMs: 1000,
      renderPage: async (url) => ({
        url,
        finalUrl: `${url}/rendered`,
        statusCode: 200,
        headers: {
          "content-type": "text/html; charset=utf-8"
        },
        html: `
          <!doctype html>
          <html>
            <head>
              <title>Rendered Clinic Istanbul</title>
              <meta name="description" content="Rendered dental services in Istanbul.">
              <meta name="viewport" content="width=device-width, initial-scale=1">
              <meta property="og:title" content="Rendered Clinic Istanbul">
              <meta property="og:description" content="Rendered dental services in Istanbul.">
              <meta property="og:url" content="https://example.test/">
              <link rel="canonical" href="https://example.test/">
              <script type="application/ld+json">
                {
                  "@context":"https://schema.org",
                  "@graph":[
                    {
                      "@type":"LocalBusiness",
                      "name":"Rendered Clinic",
                      "telephone":"+902120000000",
                      "address":{"@type":"PostalAddress","streetAddress":"Example Street 12","addressLocality":"Istanbul"},
                      "openingHours":"Mo-Fr 09:00-18:00"
                    },
                    {"@type":"Organization","name":"Rendered Clinic"}
                  ]
                }
              </script>
            </head>
            <body>
              <h1>Rendered Clinic</h1>
              <p>Dental services in Istanbul.</p>
              <p>Address: Example Street 12, Istanbul.</p>
              <p>Opening hours: Monday-Friday 09:00-18:00.</p>
              <a href="/book">Book an appointment</a>
              <a href="tel:+902120000000">Call</a>
              <a href="mailto:hello@example.test">Email</a>
              <a href="https://wa.me/902120000000">WhatsApp</a>
              <a href="https://www.google.com/maps?q=example">Directions</a>
              <img src="/office.jpg" alt="Office">
            </body>
          </html>
        `
      })
    });

    expect(report.finalUrl).toBe("https://example.test/rendered");
    expect(report.findings.map((finding) => finding.id)).not.toContain("title-present");
    expect(report.findings.map((finding) => finding.id)).not.toContain("phone-link-present");
  });

  it("parses the CLI render flag", () => {
    expect(cliOptionsSchema.parse({ render: true }).render).toBe(true);
  });
});
