import { describe, expect, it } from "vitest";
import { auditUrl } from "../src/audit.js";
import { cliOptionsSchema } from "../src/schema.js";

async function auditedHtml(profile: string, marker = "Prospects", body = `<h1>${marker}</h1>`) {
  return auditUrl(
    "https://example.test",
    {
      render: true,
      timeoutMs: 1000,
      profile,
      renderPage: async () => ({
        url: "https://example.test",
        finalUrl: "https://example.test",
        statusCode: 200,
        headers: {
          "content-type": "text/html; charset=utf-8"
        },
        html: `<!doctype html>
          <html>
            <head>
              <title>${marker}</title>
              <meta name="description" content="Example services.">
              <meta name="viewport" content="width=device-width, initial-scale=1">
              <meta property="og:title" content="${marker}">
              <meta property="og:description" content="${marker}">
              <meta property="og:url" content="https://example.test/">
              <link rel="canonical" href="https://example.test/">
            </head>
            <body>
              ${body}
            </body>
          </html>`
      })
    } as any
  );
}

describe("industry profile support", () => {
  const profileSpecificFindingIds = [
    "dental-appointment-cta",
    "dental-insurance-payment-cue",
    "beauty-booking-cta",
    "beauty-portfolio-signal",
    "restaurant-menu-signal",
    "restaurant-reservation-order-signal",
    "contractor-estimate-cta",
    "contractor-license-insured-service-area-cue"
  ];

  it("supports all released profiles in CLI options", () => {
    for (const profile of ["generic", "dental", "beauty", "restaurant", "contractor"]) {
      expect((cliOptionsSchema.parse({ profile } as any) as any).profile).toBe(profile);
    }
  });

  it("rejects unsupported industry profiles", () => {
    expect(() => cliOptionsSchema.parse({ profile: "finance" })).toThrow();
  });

  it("adds profile metadata to audit reports", async () => {
    const report = await auditedHtml("dental", "Dental profile example");
    expect((report as { profile?: string }).profile).toBe("dental");
  });

  it("applies profile-specific recommendation and severity adjustments", async () => {
    const generic = await auditedHtml("generic", "Generic profile example");
    const dental = await auditedHtml("dental", "Dental profile example");
    const contractor = await auditedHtml("contractor", "Contractor profile example");

    expect((dental as { profile?: string }).profile).toBe("dental");
    expect((contractor as { profile?: string }).profile).toBe("contractor");
    expect(dental.recommendations).not.toEqual(generic.recommendations);
    expect(contractor.summary).not.toEqual(generic.summary);
  });

  it("adds owner-readable findings for missing profile-specific conversion and trust signals", async () => {
    const cases = [
      {
        profile: "dental",
        expectedIds: ["dental-appointment-cta", "dental-insurance-payment-cue"]
      },
      {
        profile: "beauty",
        expectedIds: ["beauty-booking-cta", "beauty-portfolio-signal"]
      },
      {
        profile: "restaurant",
        expectedIds: ["restaurant-menu-signal", "restaurant-reservation-order-signal"]
      },
      {
        profile: "contractor",
        expectedIds: ["contractor-estimate-cta", "contractor-license-insured-service-area-cue"]
      }
    ];

    for (const { profile, expectedIds } of cases) {
      const report = await auditedHtml(profile, `${profile} profile example`);
      const findingIds = report.findings.map((finding) => finding.id);

      expect(findingIds).toEqual(expect.arrayContaining(expectedIds));

      for (const expectedId of expectedIds) {
        const finding = report.findings.find((candidate) => candidate.id === expectedId);

        expect(finding).toMatchObject({
          category: expect.any(String),
          severity: expect.any(String),
          source: expect.stringContaining("profile"),
          recommendation: expect.any(String)
        });
        expect(finding?.evidence).toEqual([
          expect.objectContaining({
            label: expect.any(String),
            value: expect.any(String)
          })
        ]);
        expect(finding?.recommendation.length).toBeGreaterThan(24);
      }
    }
  });

  it("does not add industry profile findings to the generic profile", async () => {
    const report = await auditedHtml("generic", "Generic profile example");
    const genericProfileFindings = report.findings
      .map((finding) => finding.id)
      .filter((id) => profileSpecificFindingIds.includes(id));

    expect(genericProfileFindings).toEqual([]);
  });

  it("does not add profile-specific findings when the matching signals are present", async () => {
    const cases = [
      {
        profile: "dental",
        marker: "Dental profile example",
        body: `
          <h1>Dental profile example</h1>
          <a href="/appointments">Book an appointment</a>
          <p>We accept insurance and offer payment plans for treatment.</p>
        `,
        expectedAbsentIds: ["dental-appointment-cta", "dental-insurance-payment-cue"]
      },
      {
        profile: "beauty",
        marker: "Beauty profile example",
        body: `
          <h1>Beauty profile example</h1>
          <a href="/booking">Book a service</a>
          <section aria-label="Portfolio gallery">Before and after brow and hair portfolio.</section>
        `,
        expectedAbsentIds: ["beauty-booking-cta", "beauty-portfolio-signal"]
      },
      {
        profile: "restaurant",
        marker: "Restaurant profile example",
        body: `
          <h1>Restaurant profile example</h1>
          <a href="/menu">View our menu</a>
          <a href="/reservations">Reserve a table</a>
        `,
        expectedAbsentIds: ["restaurant-menu-signal", "restaurant-reservation-order-signal"]
      },
      {
        profile: "contractor",
        marker: "Contractor profile example",
        body: `
          <h1>Contractor profile example</h1>
          <a href="/estimate">Request an estimate</a>
          <p>Licensed and insured contractor serving the Kadikoy service area.</p>
        `,
        expectedAbsentIds: ["contractor-estimate-cta", "contractor-license-insured-service-area-cue"]
      }
    ];

    for (const { profile, marker, body, expectedAbsentIds } of cases) {
      const report = await auditedHtml(profile, marker, body);
      const findingIds = report.findings.map((finding) => finding.id);

      expect(findingIds.filter((id) => expectedAbsentIds.includes(id))).toEqual([]);
    }
  });
});
