import { describe, expect, it } from "vitest";
import { auditUrl } from "../src/audit.js";
import { cliOptionsSchema } from "../src/schema.js";

async function auditedHtml(profile: string, marker = "Prospects") {
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
              <h1>${marker}</h1>
            </body>
          </html>`
      })
    } as any
  );
}

describe("industry profile support", () => {
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
});
