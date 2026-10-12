import { describe, expect, it } from "vitest";
import { auditSnapshot } from "../src/audit.js";
import type { PageSnapshot } from "../src/types.js";

function snapshot(body: string, htmlAttributes = ' lang="en"'): PageSnapshot {
  return {
    url: "https://clinic.test/",
    finalUrl: "https://clinic.test/",
    statusCode: 200,
    headers: {},
    html: `<html${htmlAttributes}><head><title>Clinic</title></head><body>${body}</body></html>`
  };
}

function finding(id: string, page: PageSnapshot) {
  return auditSnapshot(page).findings.find((item) => item.id === id);
}

describe("page language checks", () => {
  it("accepts valid language codes", () => {
    for (const lang of ["en", "en-GB", "tr-TR", "zh-Hant-TW", "fil"]) {
      expect(finding("html-lang-present", snapshot("<p>Hi</p>", ` lang="${lang}"`)), lang).toBeUndefined();
    }
  });

  it("flags a missing, empty, or invalid lang attribute", () => {
    expect(finding("html-lang-present", snapshot("<p>Hi</p>", ""))?.evidence[0]?.value).toBe(
      "No lang attribute on the <html> element"
    );
    expect(finding("html-lang-present", snapshot("<p>Hi</p>", ' lang=" "'))?.evidence[0]?.value).toBe(
      "The lang attribute on the <html> element is empty"
    );
    const invalid = finding("html-lang-present", snapshot("<p>Hi</p>", ' lang="english"'));
    expect(invalid?.evidence[0]?.value).toBe('lang="english" is not a valid language code');
    expect(invalid?.severity).toBe("low");
    expect(invalid?.category).toBe("mobile-usability");
  });
});

describe("form label checks", () => {
  it("accepts explicit, wrapping, ARIA, title, and placeholder names", () => {
    const page = snapshot(`
      <span id="phone-label">Phone</span>
      <form>
        <label for="name">Your name</label><input id="name" name="name">
        <label>Email <input type="email" name="email"></label>
        <input name="phone" aria-labelledby="phone-label">
        <input name="postcode" aria-label="Postcode">
        <input name="company" title="Company">
        <input type="search" name="q" placeholder="Search treatments">
        <select name="service" aria-label="Service"><option>Implants</option></select>
        <input type="hidden" name="token"><input type="submit" value="Send"><button>Send</button>
      </form>`);

    expect(finding("form-labels-present", page)).toBeUndefined();
  });

  it("ignores hidden fields and the aria-hidden Mailchimp spam trap", () => {
    const page = snapshot(
      '<div hidden><input name="a"></div><div style="display: none"><textarea name="b"></textarea></div><input name="c" style="visibility:hidden">' +
        '<div style="position: absolute; left: -5000px;" aria-hidden="true"><input type="text" name="b_abc_def" tabindex="-1" value=""></div>'
    );

    expect(finding("form-labels-present", page)).toBeUndefined();
  });

  it("flags fields without an accessible name, including empty labels and broken references", () => {
    const page = snapshot(`
      <form>
        <label for="name">Name</label><input id="name" name="name">
        <input type="email" name="email">
        <label for="msg"> </label><textarea id="msg" name="message"></textarea>
        <select id="service"><option>Implants</option></select>
        <input name="phone" aria-labelledby="missing-id">
      </form>`);
    const result = finding("form-labels-present", page);

    expect(result?.severity).toBe("low");
    expect(result?.category).toBe("mobile-usability");
    expect(result?.evidence[0]?.value).toBe(
      "4 of 5 form fields have no label: input[type=email][name=email]; textarea[name=message]; select#service; input[name=phone]"
    );
  });
});

describe("link text checks", () => {
  it("accepts descriptive, labelled, and image links and skips script or fragment links", () => {
    const page = snapshot(`
      <a href="/implants">Read more about dental implants</a>
      <a href="/whitening" aria-label="Teeth whitening prices">Read more</a>
      <a href="/"><img src="/logo.png" alt="Clinic home"></a>
      <a href="#">More</a><a href="javascript:void(0)">Click here</a><a>here</a>
      <div hidden><a href="/x">Read more</a></div>`);

    expect(finding("link-text-descriptive", page)).toBeUndefined();
  });

  it("flags generic link text in English, Turkish, and German, ignoring case and arrows", () => {
    const page = snapshot(`
      <a href="/implants">Read more »</a>
      <a href="/whitening">  CLICK HERE </a>
      <a href="/tr/hizmetler">Devamını oku</a>
      <a href="/de/leistungen">Mehr erfahren →</a>
      <a href="/a">More</a><a href="/b">here</a><a href="/c">Learn more</a>`);
    const result = finding("link-text-descriptive", page);

    expect(result?.severity).toBe("low");
    expect(result?.category).toBe("search-basics");
    expect(result?.evidence[0]?.value).toBe(
      '7 links use generic text: "Read more »" (/implants); "CLICK HERE" (/whitening); "Devamını oku" (/tr/hizmetler); "Mehr erfahren →" (/de/leistungen); "More" (/a); and 2 more'
    );
  });
});
