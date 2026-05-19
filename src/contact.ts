import { load } from "cheerio";
import type { PublicContact } from "./types.js";

const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const contactPathPattern = /(?:^|\/)(contact|contact-us|iletisim|reach-us|booking|appointment)(?:\/|$)/i;
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
    if (contactPathPattern.test(new URL(url).pathname) || /contact|iletisim|appointment|booking/i.test(text)) {
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
    socialProfiles: unique(socialProfiles)
  };
  const uniqueSources = unique(sources);

  return {
    ...base,
    contactConfidence: confidenceFor(base, uniqueSources.length),
    contactSource: uniqueSources.join(", ")
  };
}
