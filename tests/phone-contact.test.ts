import { describe, expect, it } from "vitest";
import { auditSnapshot } from "../src/audit.js";
import { extractPublicContact } from "../src/contact.js";
import { pitchPoints } from "../src/pitch-brief.js";
import type { PageSnapshot } from "../src/types.js";

function audit(html: string, url = "https://clinic.co.uk/") {
  const snapshot: PageSnapshot = { url, finalUrl: url, statusCode: 200, headers: { "content-type": "text/html" }, html };
  const report = auditSnapshot(snapshot, "2026-10-24T12:00:00.000Z");
  const finding = (id: string) => report.findings.find((item) => item.id === id);
  return { report, finding };
}

const page = (body: string, lang = "en") => `<html lang="${lang}"><head><title>Clinic</title></head><body><h1>Clinic</h1>${body}</body></html>`;

describe("phone findings", () => {
  it("says a shown number is not tap-to-call and names it", () => {
    const { finding } = audit(page("<p>Call us on 0114 258 5525</p>"));

    expect(finding("phone-link-present")?.evidence[0].value).toBe("Shown as text without a tel: link: +44 114 258 5525");
    expect(finding("phone-number-visible")).toBeUndefined();
  });

  it("finds an unlabelled number that is valid for the site's country", () => {
    const { finding } = audit(page("<header>0114 258 5525</header>"));

    expect(finding("phone-link-present")).toBeDefined();
  });

  it("reports a page without any number as having no phone number, not as a number that cannot be tapped", () => {
    const { finding } = audit(page("<p>Book online today.</p><footer>Company No. 04697242. VAT 123 4567 89.</footer>"));

    expect(finding("phone-link-present")).toBeUndefined();
    expect(finding("phone-number-visible")).toMatchObject({ severity: "medium", title: "No phone number is shown" });
  });

  it("reads national numbers on a .com site through its html lang, or by their shape when the country is unknown", () => {
    expect(audit(page("<p>0114 258 5525</p>", "en-GB"), "https://clinic.com/").finding("phone-link-present")).toBeDefined();
    expect(audit(page("<p>0114 258 5525</p>"), "https://clinic.com/").finding("phone-link-present")?.evidence[0].value).toContain("0114 258 5525");
    expect(audit(page("<p>(415) 555-0199</p>"), "https://clinic.com/").finding("phone-link-present")).toBeDefined();
    expect(audit(page("<p>415 555 0199</p>", "en-US"), "https://clinic.com/").finding("phone-link-present")).toBeDefined();
    expect(audit(page("<p>Since 2026-10-24, open 09:00-17:30.</p>"), "https://clinic.com/").finding("phone-number-visible")).toBeDefined();
  });

  it("still reads a UK number when the page's lang or domain points at another country", () => {
    expect(audit(page("<p>Call 0114 258 5525</p>", "en-US"), "https://clinic.com/").finding("phone-link-present")?.evidence[0].value).toContain(
      "0114 258 5525"
    );
    expect(audit(page("<header>0114 258 5525</header>"), "https://clinic.io/").finding("phone-link-present")).toBeDefined();
  });

  it("does not read order, reference, or SKU numbers and opening hours as phones", () => {
    for (const body of [
      "<p>Order 2079460123 has shipped.</p>",
      "<p>Reference: 7700900123</p>",
      "<p>SKU0123456789</p>",
      "<p>Open 0900-1730 0900-1300</p>",
      "<p>Order 123-456-7890</p>"
    ]) {
      const { finding } = audit(page(body));
      expect(finding("phone-link-present"), body).toBeUndefined();
      expect(finding("phone-number-visible"), body).toBeDefined();
    }
    expect(audit(page("<p>Ref: 4155550199</p>", "en-US"), "https://clinic.com/").finding("phone-link-present")).toBeUndefined();
  });

  it("names each number once", () => {
    expect(audit(page("<p>Call 0114 258 5525</p>")).finding("phone-link-present")?.evidence[0].value).toBe(
      "Shown as text without a tel: link: +44 114 258 5525"
    );
  });

  it("passes both checks when the page has a tel: link", () => {
    const { finding } = audit(page('<a href="tel:+441142585525">0114 258 5525</a>'));

    expect(finding("phone-link-present")).toBeUndefined();
    expect(finding("phone-number-visible")).toBeUndefined();
  });

  it("does not count numbers hidden from visitors", () => {
    const { finding } = audit(page('<p style="display:none">0114 258 5525</p>'));

    expect(finding("phone-link-present")).toBeUndefined();
    expect(finding("phone-number-visible")).toBeDefined();
  });

  it("gives the missing number its own pitch reason", () => {
    const { report } = audit(page("<p>Welcome.</p>"));

    expect(pitchPoints(report).find((point) => point.findingId === "phone-number-visible")?.whyItMatters).toBe(
      "No phone number is shown, so visitors who want to call have to look elsewhere."
    );
  });
});

describe("public email extraction", () => {
  it("ignores error-tracking keys and template addresses", () => {
    const contact = (body: string) => extractPublicContact(`<html><body>${body}</body></html>`, "https://clinic.test/").publicEmail;

    expect(contact('<script>dsn="605a7baede844d278b89dc95ae0a9123@sentry-next.wixpress.com"</script><p>605a7baede844d278b89dc95ae0a9123@sentry-next.wixpress.com</p>')).toBeUndefined();
    expect(contact("<p>Email: your@email.com</p>")).toBeUndefined();
    expect(contact('<a href="mailto:name@domain.com">Email</a>')).toBeUndefined();
    expect(contact('<a href="mailto:hello@clinic.test">Email</a><p>your@email.com</p>')).toBe("hello@clinic.test");
    expect(contact("<p>email@smithsolicitors.co.uk</p>")).toBe("email@smithsolicitors.co.uk");
    expect(contact("<p>Write to info<span>@</span>clinic.co.uk</p>")).toBe("info@clinic.co.uk");
  });

  it("does not run an address together with the next element's text", () => {
    const contact = extractPublicContact(
      '<html><body><p>info@conquestlaw.co.uk</p><div><img alt="Address"><p>Address</p><p>12 High Street</p></div></body></html>',
      "https://conquestlaw.co.uk/"
    );

    expect(contact.publicEmail).toBe("info@conquestlaw.co.uk");
  });
});
