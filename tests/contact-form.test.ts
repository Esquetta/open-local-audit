import { describe, expect, it } from "vitest";
import { auditSnapshot } from "../src/audit.js";
import { extractPublicContact } from "../src/contact.js";
import { renderHtmlReport, renderMarkdownReport } from "../src/reporters.js";
import type { PageSnapshot } from "../src/types.js";

const pageUrl = "https://clinic.test/";

function page(body: string): string {
  return `<!doctype html><html><head><title>Clinic</title></head><body>${body}</body></html>`;
}

function contactFormUrl(body: string): string | undefined {
  return extractPublicContact(page(body), pageUrl).contactFormUrl;
}

function snapshot(body: string): PageSnapshot {
  return {
    url: pageUrl,
    finalUrl: pageUrl,
    statusCode: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    html: page(body)
  };
}

function contactFormFinding(body: string) {
  return auditSnapshot(snapshot(body)).findings.find((finding) => finding.id === "contact-form-present");
}

const newsletterForm = `
  <form action="/subscribe" method="post">
    <input type="email" name="EMAIL" placeholder="Your email">
    <input type="checkbox" name="consent">
    <button type="submit">Sign me up</button>
  </form>`;

describe("contact form detection", () => {
  it("counts a form with a message box as an enquiry form", () => {
    expect(
      contactFormUrl(`<form action="/send"><input name="your-name"><textarea name="your-message"></textarea><button>Send</button></form>`)
    ).toBe(pageUrl);
  });

  it("counts a two-field form with an email or phone field", () => {
    expect(contactFormUrl(`<form><input type="text" name="fullname"><input type="email" name="addr"><input type="submit"></form>`)).toBe(pageUrl);
    expect(contactFormUrl(`<form><input id="first"><input type="tel" id="mobile"></form>`)).toBe(pageUrl);
  });

  it("does not count two plain fields that do not look like contact details", () => {
    expect(contactFormUrl(`<form><input name="postcode"><input name="treatment"></form>`)).toBeUndefined();
  });

  it("does not count a newsletter signup as an enquiry form", () => {
    expect(contactFormUrl(newsletterForm)).toBeUndefined();
    expect(
      contactFormUrl(`
        <form action="https://clinic.us1.list-manage.com/subscribe/post" id="mc-embedded-subscribe-form">
          <input type="text" name="FNAME"><input type="email" name="EMAIL">
          <input type="submit" value="Subscribe">
        </form>`)
    ).toBeUndefined();
  });

  it("does not count search forms", () => {
    expect(contactFormUrl(`<form role="search"><input name="name"><input type="email" name="email"><textarea></textarea></form>`)).toBeUndefined();
    expect(contactFormUrl(`<form action="/search"><input name="q"><input name="email"></form>`)).toBeUndefined();
    expect(contactFormUrl(`<form><input type="search" name="query"></form>`)).toBeUndefined();
    expect(contactFormUrl(`<form><input name="s"></form>`)).toBeUndefined();
  });

  it("ignores a hidden captcha response textarea", () => {
    expect(contactFormUrl(`<form><input type="email" name="email"><textarea name="g-recaptcha-response" style="display:none"></textarea></form>`)).toBeUndefined();
  });

  it("counts embedded form providers in iframes and scripts", () => {
    expect(contactFormUrl(`<iframe src="https://docs.google.com/forms/d/e/abc/viewform?embedded=true"></iframe>`)).toBe(pageUrl);
    expect(contactFormUrl(`<iframe src="https://form.jotform.com/123456"></iframe>`)).toBe(pageUrl);
    expect(contactFormUrl(`<iframe src="https://tally.so/embed/abc"></iframe>`)).toBe(pageUrl);
    expect(contactFormUrl(`<script src="//js.hsforms.net/forms/embed/v2.js"></script>`)).toBe(pageUrl);
    expect(contactFormUrl(`<script src="https://embed.typeform.com/next/embed.js"></script>`)).toBe(pageUrl);
    expect(contactFormUrl(`<iframe src="https://docs.google.com/document/d/abc"></iframe>`)).toBeUndefined();
  });

  it("keeps contact confidence based on public channels only", () => {
    const contact = extractPublicContact(page(`<form><input name="name"><textarea name="message"></textarea></form>`), pageUrl);

    expect(contact.contactFormUrl).toBe(pageUrl);
    expect(contact.contactConfidence).toBe("None");
    expect(contact.contactSource).toBe("");
  });

  it("does not treat booking or enquiry links as a contact page for outreach", () => {
    const contact = extractPublicContact(
      page(`<a href="https://www.fresha.com/a/clinic">Book now</a><a href="/enquiries/">Enquire</a><a href="/get-in-touch">Get in touch</a>`),
      pageUrl
    );

    expect(contact.contactPageUrl).toBeUndefined();
    expect(contact.contactConfidence).toBe("None");
    expect(contactFormFinding(`<a href="https://www.fresha.com/a/clinic">Book now</a>`)).toBeUndefined();
  });
});

describe("contact-form-present rule", () => {
  it("passes with an enquiry form", () => {
    expect(contactFormFinding(`<form><input name="name"><textarea name="message"></textarea></form>`)).toBeUndefined();
  });

  it("passes with a same-site contact or booking page link", () => {
    expect(contactFormFinding(`<a href="/contact-us">Contact</a>`)).toBeUndefined();
    expect(contactFormFinding(`<a href="/contact.html">Reach us</a>`)).toBeUndefined();
    expect(contactFormFinding(`<a href="/enquiries/">Send us a message</a>`)).toBeUndefined();
    expect(contactFormFinding(`<a href="https://www.clinic.test/visit">Book now</a>`)).toBeUndefined();
    expect(contactFormFinding(`<a href="/page-2">Get in touch</a>`)).toBeUndefined();
  });

  it("passes with an off-site booking platform or booking link", () => {
    expect(contactFormFinding(`<a href="https://clinic.portal.dentally.co/">Our online portal</a>`)).toBeUndefined();
    expect(contactFormFinding(`<a href="https://calendly.com/clinic/consultation">Free consultation</a>`)).toBeUndefined();
    expect(contactFormFinding(`<a href="https://bookings.example-platform.test/clinic">Book online</a>`)).toBeUndefined();
    expect(contactFormFinding(`<a href="https://tables.example-platform.test/reservations/clinic">See times</a>`)).toBeUndefined();
  });

  it("passes with a mailto link", () => {
    expect(contactFormFinding(`<a href="mailto:hello@clinic.test">Email us</a>`)).toBeUndefined();
  });

  it("fails when contact links point off-site or back to the same page", () => {
    expect(contactFormFinding(`<a href="https://webagency.test/contact">Website by Web Agency - contact us</a>`)).toBeDefined();
    expect(contactFormFinding(`<a href="#contact">Contact</a>`)).toBeDefined();
  });

  it("fails with newsletter-only evidence and an owner-readable recommendation", () => {
    const finding = contactFormFinding(`<a href="tel:+441234567890">Call us</a>${newsletterForm}`);

    expect(finding).toMatchObject({
      title: "No way to send an enquiry from the page",
      category: "trust-contact",
      severity: "medium",
      recommendation:
        "Add a short enquiry form or a clear link to a contact page so visitors who don't want to call can still reach you.",
      evidence: [{ value: "No enquiry form, contact page link, or email link; only a newsletter signup form" }]
    });
  });

  it("fails without any enquiry path", () => {
    expect(contactFormFinding(`<p>Call 01234 567890</p>`)?.evidence[0]?.value).toBe("No enquiry form, contact page link, or email link");
  });
});

describe("contact form in reports", () => {
  it("shows the contact form in Markdown and HTML Contact Readiness", () => {
    const report = auditSnapshot(snapshot(`<form><input name="name"><textarea name="message"></textarea></form>`), "2026-10-10T00:00:00.000Z");

    expect(renderMarkdownReport(report)).toContain(`| Contact form | ${pageUrl} |`);
    expect(renderHtmlReport(report)).toContain(`<tr><td>Contact form</td><td>${pageUrl}</td></tr>`);
  });
});
