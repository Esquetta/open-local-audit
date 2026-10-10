import { load, type CheerioAPI } from "cheerio";
import type { PublicContact } from "./types.js";

const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Contact extraction keeps its narrow patterns because a contact page link raises contact confidence and picks the
// outreach channel; the broader link patterns below only decide whether a visitor can reach the business.
const contactPagePathPattern = /(?:^|\/)(contact|contact-us|iletisim|reach-us|booking|appointment)(?:\/|$)/i;
const contactPageTextPattern = /contact|iletisim|appointment|booking/i;
const contactPathPattern =
  /(?:^|\/)(contact|contact-us|get-in-touch|enquir(?:e|y|ies)|iletisim|reach-us|book|booking|appointments?)(?:\.[a-z]+)?(?:\/|$)/i;
const contactTextPattern = /contact|get in touch|enquir|iletisim|iletişim|appointment|\bbook(?:ings?)?\b/i;
const bookingPathPattern = /(?:^|[/._-])(book|booking|bookings|appointments?|reserve|reservations?)(?:[/._-]|$)/i;
const bookingTextPattern = /\b(?:book(?:ings?)?|appointments?|reserve|reservations?)\b/i;
const bookingHostPattern =
  /dentally|setmore|calendly|fresha|treatwell|booksy|simplybook|acuityscheduling|mindbody|resdiary|opentable|zocdoc|vagaro|gettimely|phorest|youcanbook/i;
const embeddedFormPattern = /forms\.gle|docs\.google\.com\/forms|typeform\.com|jotform|formstack|hsforms|wufoo|cognitoforms|tally\.so/i;
const textInputTypes = new Set(["", "text", "email", "tel"]);
const ignoredInputTypes = new Set(["hidden", "submit", "button", "reset", "image", "checkbox", "radio"]);
const enquiryFieldPattern = /name|phone|e-?mail|message/i;
const newsletterCuePattern = /newsletter|subscri|mailchimp|list-manage/i;
const socialHosts = ["facebook.com", "instagram.com", "linkedin.com", "x.com", "twitter.com", "tiktok.com", "youtube.com"];
const placeholderSocialPattern = /\/(yourbusiness|example|placeholder|your-company|yourcompany)(?:\/?$)/i;

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeUrl(raw: string, baseUrl: string): string | undefined {
  try {
    const url = new URL(raw, baseUrl);
    if (!/^https?:$/.test(url.protocol)) {
      return undefined;
    }

    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function normalizeEmail(value: string): string | undefined {
  const email = value.trim().replace(/^mailto:/i, "").split("?")[0].trim().toLowerCase();
  if (!emailPattern.test(email)) {
    emailPattern.lastIndex = 0;
    return undefined;
  }

  emailPattern.lastIndex = 0;
  if (/\.(png|jpe?g|gif|svg|webp|ico)$/i.test(email) || /@(example\.com|example\.org)$/i.test(email)) {
    return undefined;
  }

  return email;
}

function normalizePhone(value: string): string | undefined {
  const phone = value.trim().replace(/^tel:/i, "").replace(/[^\d+]/g, "");
  const digitCount = phone.replace(/\D/g, "").length;
  return digitCount >= 7 ? phone : undefined;
}

function isSocialUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    return socialHosts.some((socialHost) => host === socialHost || host.endsWith(`.${socialHost}`));
  } catch {
    return false;
  }
}

function isPlaceholderSocial(url: string): boolean {
  try {
    const parsed = new URL(url);
    return placeholderSocialPattern.test(parsed.pathname);
  } catch {
    return true;
  }
}

function isContactLink(url: string, text: string): boolean {
  return contactPathPattern.test(new URL(url).pathname) || contactTextPattern.test(text);
}

function siteHost(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
}

function isBookingLink(url: string, text: string): boolean {
  const parsed = new URL(url);
  return bookingHostPattern.test(parsed.hostname) || bookingPathPattern.test(parsed.pathname) || bookingTextPattern.test(text);
}

// Links to another page of the same site (or a subdomain) that look like a contact or booking page, or
// off-site links to a booking page. An off-site link that only says "contact" (such as a web agency footer) does not count.
// Anchors back to the audited page itself are skipped: that page's own forms and email links are checked directly.
export function hasContactOrBookingLink($: CheerioAPI, pageUrl: string): boolean {
  const page = normalizeUrl(pageUrl, pageUrl);
  if (!page) {
    return false;
  }

  const host = siteHost(page);
  return $("a[href]")
    .toArray()
    .some((element) => {
      const url = normalizeUrl($(element).attr("href")?.trim() ?? "", page);
      if (!url || url === page) {
        return false;
      }

      const linkHost = siteHost(url);
      const text = $(element).text().trim();
      return linkHost === host || linkHost.endsWith(`.${host}`) ? isContactLink(url, text) : isBookingLink(url, text);
    });
}

export interface PageForms {
  enquiryForm: boolean;
  newsletterForm: boolean;
}

// An enquiry form has a message box, or at least two text-like fields that look like contact details.
// Search forms and newsletter signups are not enquiry forms; embedded form providers count as one.
export function detectPageForms($: CheerioAPI, pageUrl: string): PageForms {
  let enquiryForm = false;
  let newsletterForm = false;

  for (const form of $("form").toArray()) {
    const $form = $(form);
    const fields = $form
      .find("input")
      .toArray()
      .map((input) => ({
        type: ($(input).attr("type") ?? "").trim().toLowerCase(),
        name: $(input).attr("name") ?? "",
        label: `${$(input).attr("name") ?? ""} ${$(input).attr("id") ?? ""}`
      }))
      .filter((input) => !ignoredInputTypes.has(input.type));
    const textFields = fields.filter((input) => textInputTypes.has(input.type));
    // reCAPTCHA/hCaptcha inject a hidden response textarea into rendered pages; it is not a message box.
    const hasTextarea = $form.find("textarea").not('[name*="captcha"], [id*="captcha"]').length > 0;
    const isEmail = (input: (typeof fields)[number]) => input.type === "email" || /e-?mail/i.test(input.label);

    const isSearch =
      $form.closest('[role="search"]').length > 0 ||
      /search/i.test($form.attr("action") ?? "") ||
      (fields.length === 1 && (fields[0].type === "search" || /^(q|s|search)$/i.test(fields[0].name)));
    if (isSearch) {
      continue;
    }

    const newsletterCue = [
      $form.attr("action"),
      $form.attr("id"),
      $form.attr("class"),
      ...$form
        .find('button, input[type="submit"]')
        .toArray()
        .map((button) => `${$(button).text()} ${$(button).attr("value") ?? ""}`)
    ].join(" ");
    const isNewsletter =
      !hasTextarea &&
      ((fields.length === 1 && isEmail(fields[0])) || (newsletterCuePattern.test(newsletterCue) && textFields.some(isEmail)));
    if (isNewsletter) {
      newsletterForm = true;
      continue;
    }

    if (
      hasTextarea ||
      (textFields.length >= 2 &&
        textFields.some((input) => input.type === "email" || input.type === "tel" || enquiryFieldPattern.test(input.label)))
    ) {
      enquiryForm = true;
    }
  }

  const embeddedForm = $("iframe[src], script[src]")
    .toArray()
    .some((element) => {
      const src = normalizeUrl($(element).attr("src")?.trim() ?? "", pageUrl);
      if (!src) {
        return false;
      }

      const url = new URL(src);
      return embeddedFormPattern.test(`${url.hostname}${url.pathname}`);
    });

  return { enquiryForm: enquiryForm || embeddedForm, newsletterForm };
}

function confidenceFor(contact: Omit<PublicContact, "contactConfidence" | "contactSource">, sourceCount: number): PublicContact["contactConfidence"] {
  if (sourceCount >= 3 || (contact.publicEmail && contact.publicPhone)) {
    return "High";
  }

  if (sourceCount > 0) {
    return "Medium";
  }

  return "None";
}

export function extractPublicContact(html: string, finalUrl: string): PublicContact {
  const $ = load(html);
  const emails: string[] = [];
  const phones: string[] = [];
  const whatsappUrls: string[] = [];
  const contactPageUrls: string[] = [];
  const socialProfiles: string[] = [];
  const sources: string[] = [];

  for (const element of $("a[href]").toArray()) {
    const href = $(element).attr("href")?.trim();
    if (!href) {
      continue;
    }

    if (/^mailto:/i.test(href)) {
      const email = normalizeEmail(href);
      if (email) {
        emails.push(email);
        sources.push("mailto");
      }
      continue;
    }

    if (/^tel:/i.test(href)) {
      const phone = normalizePhone(href);
      if (phone) {
        phones.push(phone);
        sources.push("tel");
      }
      continue;
    }

    const url = normalizeUrl(href, finalUrl);
    if (!url) {
      continue;
    }

    if (/\/\/(?:api\.)?whatsapp\.com|\/\/wa\.me/i.test(url)) {
      whatsappUrls.push(url);
      sources.push("whatsapp");
      continue;
    }

    if (isSocialUrl(url) && !isPlaceholderSocial(url)) {
      socialProfiles.push(url);
      sources.push("social");
      continue;
    }

    const text = $(element).text().trim();
    if (contactPagePathPattern.test(new URL(url).pathname) || contactPageTextPattern.test(text)) {
      contactPageUrls.push(url);
      sources.push("contact-page");
    }
  }

  if (emails.length === 0) {
    const textEmail = $("body").text().match(emailPattern)?.map((match) => normalizeEmail(match)).find(Boolean);
    if (textEmail) {
      emails.push(textEmail);
      sources.push("text-email");
    }
  }

  const base = {
    publicEmail: unique(emails)[0],
    publicPhone: unique(phones)[0],
    whatsappUrl: unique(whatsappUrls)[0],
    contactPageUrl: unique(contactPageUrls)[0],
    contactFormUrl: detectPageForms($, finalUrl).enquiryForm ? finalUrl : undefined,
    socialProfiles: unique(socialProfiles)
  };
  const uniqueSources = unique(sources);

  return {
    ...base,
    contactConfidence: confidenceFor(base, uniqueSources.length),
    contactSource: uniqueSources.join(", ")
  };
}
