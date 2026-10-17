import { describe, expect, it } from "vitest";
import { auditSnapshot } from "../src/audit.js";
import type { PageSnapshot } from "../src/types.js";

function flagged(body: string, head = ""): boolean {
  const snapshot: PageSnapshot = {
    url: "https://example.test",
    finalUrl: "https://example.test",
    statusCode: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    html: `<!doctype html><html><head><title>Example</title>${head}</head><body>${body}</body></html>`,
    resources: {
      robotsTxt: { url: "https://example.test/robots.txt", finalUrl: "https://example.test/robots.txt", statusCode: 200 },
      sitemapXml: { url: "https://example.test/sitemap.xml", finalUrl: "https://example.test/sitemap.xml", statusCode: 200 }
    }
  };
  return auditSnapshot(snapshot).findings.some((finding) => finding.id === "service-location-copy-present");
}

function localBusiness(address: Record<string, string>): string {
  return `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Physiotherapy",
    name: "Harbour Physio",
    address: { "@type": "PostalAddress", ...address }
  })}</script>`;
}

describe("service-location-copy-present", () => {
  it("accepts a UK service named next to its town", () => {
    expect(flagged("<h1>Family dentist in Leeds</h1><p>Gentle check-ups and hygienist visits in Leeds city centre.</p>")).toBe(false);
  });

  it("accepts a UK postcode next to the service", () => {
    expect(flagged("<h1>Carter &amp; Shaw Solicitors</h1><p>Wills, probate and conveyancing.</p><p>Visit us: LS1 4AP</p>")).toBe(false);
  });

  it("accepts a US street address or ZIP code next to the service", () => {
    expect(flagged("<h1>Lone Star Plumbing</h1><p>Emergency plumber, open 24/7.</p><p>412 Congress Avenue</p>")).toBe(false);
    expect(flagged("<h1>Lone Star Plumbing</h1><p>Emergency plumber, open 24/7.</p><p>Austin, TX 78701</p>")).toBe(false);
  });

  it("accepts a German practice with postcode and town", () => {
    expect(flagged("<h1>Zahnarztpraxis Dr. Weber</h1><p>Prophylaxe und Implantate.</p><p>Sendlinger Str. 5, 80331 München</p>")).toBe(false);
  });

  it("accepts Turkish city names with dotted capitals", () => {
    expect(flagged("<h1>Gülüş Diş Kliniği</h1><p>İzmir'de implant ve ortodonti tedavisi.</p>")).toBe(false);
  });

  it("accepts a visible LocalBusiness addressLocality", () => {
    expect(flagged("<h1>Harbour Physio</h1><p>Sports physiotherapy for Bristol's runners.</p>", localBusiness({ addressLocality: "Bristol" }))).toBe(false);
  });

  it("flags a schema town that the page never shows", () => {
    expect(flagged("<h1>Harbour Physio</h1><p>Sports physiotherapy for runners.</p>", localBusiness({ addressLocality: "Bristol" }))).toBe(true);
  });

  it("flags generic service copy with no location", () => {
    expect(
      flagged(
        "<h1>Professional dental services</h1><p>Book an appointment in January. Dentist Near Me. Zahnarzt in Ihrer Nähe.</p><a href='/contact'>Get in Touch</a>"
      )
    ).toBe(true);
  });

  it("flags a place that is not tied to a service", () => {
    expect(flagged("<h1>Welcome</h1><p>We moved in London last year.</p>")).toBe(true);
  });
});
