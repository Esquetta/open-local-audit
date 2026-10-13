import { describe, expect, it } from "vitest";
import { auditSnapshot } from "../src/audit.js";
import type { PageSnapshot } from "../src/types.js";

function snapshot(head: string, body: string, headers: Record<string, string> = {}): PageSnapshot {
  return {
    url: "https://clinic.test/",
    finalUrl: "https://clinic.test/",
    statusCode: 200,
    headers,
    html: `<html lang="en"><head><title>Clinic</title>${head}</head><body>${body}</body></html>`
  };
}

function finding(id: string, page: PageSnapshot) {
  return auditSnapshot(page).findings.find((item) => item.id === id);
}

const gtag =
  '<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123"></script><script>gtag("config", "G-ABC123");</script>';
const metaPixel =
  "<script>!function(f,b,e,v,n,t,s){t.src=v}(window, document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init', '1234');</script>";

describe("privacy policy link checks", () => {
  it("accepts same-site privacy links by text, path, or rel, in several languages", () => {
    for (const link of [
      '<a href="/legal">Privacy Policy</a>',
      '<a href="/privacy-notice">Legal</a>',
      '<a href="https://www.clinic.test/gizlilik-politikasi">Gizlilik</a>',
      '<a href="/datenschutz">Datenschutzerklärung</a>',
      '<a href="/kvkk">KVKK Aydınlatma Metni</a>',
      '<a rel="privacy-policy" href="/p/42">Policy</a>'
    ]) {
      expect(finding("privacy-policy-link-present", snapshot("", `<footer>${link}</footer>`)), link).toBeUndefined();
    }
  });

  it("accepts privacy links on the parent domain", () => {
    const page: PageSnapshot = { ...snapshot("", '<a href="https://clinic.test/privacy">Privacy</a>'), finalUrl: "https://book.clinic.test/" };

    expect(finding("privacy-policy-link-present", page)).toBeUndefined();
  });

  it("keeps auditing when a link path has a percent sign that does not decode", () => {
    const page = snapshot("", '<a href="/offers/20%-off">Offers</a><a href="/%FCber-uns">Über uns</a><a href="/privacy">Privacy</a>');

    expect(finding("privacy-policy-link-present", page)).toBeUndefined();
    expect(finding("privacy-policy-link-present", snapshot("", '<a href="/offers/20%-off">Offers</a>'))).toBeDefined();
  });

  it("accepts privacy policies hosted by policy providers", () => {
    expect(
      finding("privacy-policy-link-present", snapshot("", '<a href="https://www.iubenda.com/privacy-policy/123">Privacy</a>'))
    ).toBeUndefined();
  });

  it("does not count another company's privacy policy", () => {
    const page = snapshot(
      "",
      'This site is protected by reCAPTCHA and the Google <a href="https://policies.google.com/privacy">Privacy Policy</a> applies.'
    );

    expect(finding("privacy-policy-link-present", page)?.evidence[0]?.value).toBe("No privacy policy link found");
  });

  it("flags pages without a privacy link and says when the page collects data", () => {
    const page = snapshot(
      gtag,
      '<form><label>Name <input name="name"></label><label>Message <textarea name="message"></textarea></label></form><a href="/cookies">Cookie policy</a>'
    );
    const result = finding("privacy-policy-link-present", page);

    expect(result?.severity).toBe("medium");
    expect(result?.category).toBe("trust-contact");
    expect(result?.evidence[0]?.value).toBe("No privacy policy link found; the page has an enquiry form and loads Google Analytics or Ads");
  });
});

describe("cookie consent checks", () => {
  it("passes pages without trackers", () => {
    expect(finding("cookie-consent-present", snapshot("", "<p>Hello</p>"))).toBeUndefined();
  });

  it("flags analytics and advertising tags that load without a consent tool", () => {
    const result = finding("cookie-consent-present", snapshot(`${gtag}${metaPixel}`, "<p>Hello</p>"));

    expect(result?.severity).toBe("medium");
    expect(result?.category).toBe("trust-contact");
    expect(result?.evidence[0]?.value).toBe("Google Analytics or Ads, Meta Pixel load with no consent tool found");
  });

  it("detects the Google Tag Manager snippet and tracking cookies set by the server", () => {
    const page = snapshot(
      "<script>(function(w,d,s,l,i){j.src='https://www.googletagmanager.com/gtm.js?id='+i;})(window,document,'script','dataLayer','GTM-X');</script>",
      "<p>Hello</p>",
      { "set-cookie": "_ga=GA1.1.1; Path=/\nsession=abc; HttpOnly\n_fbp=fb.1.1; Path=/" }
    );

    expect(finding("cookie-consent-present", page)?.evidence[0]?.value).toBe(
      "Google Tag Manager loads with no consent tool found; tracking cookies set by the server: _ga, _fbp"
    );
  });

  it("flags tracking cookies set by the server even without tracker scripts", () => {
    const page = snapshot("", "<p>Hello</p>", { "set-cookie": "_gid=GA1.1.1; Path=/" });

    expect(finding("cookie-consent-present", page)?.evidence[0]?.value).toBe(
      "No consent tool found; tracking cookies set by the server: _gid"
    );
  });

  it("accepts known consent tools, Google consent mode defaults, and cookie banner markup", () => {
    for (const consent of [
      '<script id="Cookiebot" src="https://consent.cookiebot.com/uc.js" data-cbid="x"></script>',
      '<script src="https://cdn.cookielaw.org/scripttemplates/otSDKStub.js"></script>',
      '<script src="https://cdn-cookieyes.com/client_data/abc/script.js"></script>',
      "<script>gtag('consent', 'default', { ad_storage: 'denied', analytics_storage: 'denied' });</script>",
      '<div id="cookie-notice" role="dialog">We use cookies</div>',
      '<div class="cmplz-cookiebanner"></div>',
      '<div fs-cc="banner"></div>',
      '<script src="https://fundingchoicesmessages.google.com/i/pub-123?ers=1"></script>',
      '<script src="https://js.hs-banner.com/123.js"></script>'
    ]) {
      expect(finding("cookie-consent-present", snapshot(`${consent}${gtag}`, "<p>Hello</p>")), consent).toBeUndefined();
    }
  });

  it("does not count tags that a consent tool holds back as text/plain", () => {
    const blocked =
      '<script type="text/plain" src="https://www.googletagmanager.com/gtag/js?id=G-ABC123"></script>';

    expect(finding("cookie-consent-present", snapshot(blocked, "<p>Hello</p>"))).toBeUndefined();
    expect(finding("cookie-consent-present", snapshot(blocked.replace('"text/plain"', '"Text/Plain; charset=utf-8"'), "<p>Hello</p>"))).toBeUndefined();
  });

  it("ignores tracker text inside JSON, import map, and template blocks", () => {
    for (const type of ["application/ld+json", "application/json", "importmap", "text/template", "text/x-handlebars-template"]) {
      const block = `<script type="${type}">{"url": "https://www.googletagmanager.com/gtag/js?id=G-ABC123"}</script>`;

      expect(finding("cookie-consent-present", snapshot(block, "<p>Hello</p>")), type).toBeUndefined();
    }
  });

  it("counts trackers that script optimisers load later under their own types", () => {
    for (const type of ["a1b2c3d4e5-text/javascript", "litespeed/javascript", "rocketlazyloadscript", "text/partytown", "application/x-javascript"]) {
      const delayed = `<script type="${type}" src="https://www.googletagmanager.com/gtag/js?id=G-ABC123"></script>`;

      expect(finding("cookie-consent-present", snapshot(delayed, "<p>Hello</p>"))?.evidence[0]?.value, type).toBe(
        "Google Analytics or Ads loads with no consent tool found"
      );
    }
  });

  it("accepts website builder consent code", () => {
    for (const consent of ['"consentPolicy":{"essential":true}', "window.Shopify.customerPrivacy", '<div class="sqs-cookie-banner-v2"></div>']) {
      expect(finding("cookie-consent-present", snapshot(`<script>${consent}</script>${gtag}`, "<p>Hello</p>")), consent).toBeUndefined();
    }
  });

  it("does not crash on a page URL that cannot be parsed", () => {
    const page: PageSnapshot = { ...snapshot("", '<a href="https://clinic.test/privacy">Privacy</a>'), finalUrl: "" };

    expect(finding("privacy-policy-link-present", page)).toBeDefined();
  });

  it("does not treat a cookie policy link or cookie text as a consent tool", () => {
    expect(
      finding("cookie-consent-present", snapshot(gtag, '<a href="/cookies">Cookies</a><p>We use cookies.</p>'))
    ).toBeDefined();
  });
});
