import { load } from "cheerio";
import { getCountries, parsePhoneNumberFromString } from "libphonenumber-js/max";
import type { PlaceCandidate } from "./discovery.js";

export interface ObservedBusinessIdentity {
  pageUrl: string;
  kind: "structured" | "page";
  name?: string;
  phones: string[];
  address?: { street?: string; locality?: string; region?: string; postalCode?: string; country?: string };
}

export interface BusinessIdentityEvidence {
  field: "name" | "phone" | "address";
  state: "match" | "different" | "missing" | "ambiguous";
  sourceValues: string[];
  websiteValues: string[];
  pageUrl?: string;
  reason: string;
}

export interface BusinessIdentityResult {
  status: "matched" | "uncertain" | "conflict";
  reasons: string[];
  evidence: BusinessIdentityEvidence[];
}

type Address = NonNullable<ObservedBusinessIdentity["address"]>;

const MAX_ENTITY_DEPTH = 6;
const MAX_IDENTITIES = 24;
const businessTypes = new Set([
  "organization", "localbusiness", "dentist", "restaurant", "beautysalon", "hotel", "gym", "exercisegym", "healthclub", "medicalclinic", "physician", "store", "automotiverepair", "autorepair", "bakery", "barbershop", "cafeorcoffeeshop", "dayspa", "florist", "hairsalon", "hardwarestore", "lodgingbusiness", "nailsalon", "pharmacy", "professionalservice", "realestateagent", "travelagency"
]);
const genericNameTokens = new Set(["arztpraxis", "beauty", "business", "cafe", "clinic", "company", "dental", "dentist", "dentistry", "dis", "group", "gym", "hair", "hotel", "klinik", "klinigi", "limited", "ltd", "nail", "restaurant", "salon", "shop", "store", "zahnarzt", "zahnklinik"]);
const supportedCountries = new Set(getCountries());
const countryAliases: Record<string, string> = {
  "de": "DE", "deutschland": "DE", "germany": "DE",
  "gb": "GB", "great britain": "GB", "uk": "GB", "united kingdom": "GB",
  "tr": "TR", "turkey": "TR", "turkiye": "TR",
  "us": "US", "united states": "US", "united states of america": "US", "usa": "US"
};

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function normalizeText(value: string): string {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("en-US").replace(/ß/g, "ss").replace(/ı/g, "i").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

function countryCode(value: unknown): string | undefined {
  const country = text(value);
  if (!country) return undefined;
  const code = countryAliases[normalizeText(country)] ?? (country.length === 2 ? country.toUpperCase() : undefined);
  return code && supportedCountries.has(code as ReturnType<typeof getCountries>[number]) ? code : undefined;
}

function normalizedPhone(value: unknown, defaultCountry?: string): string | undefined {
  const raw = text(value)?.replace(/^tel:/i, "");
  if (!raw) return undefined;
  const parsed = parsePhoneNumberFromString(raw, defaultCountry ? { defaultCountry: defaultCountry as Parameters<typeof parsePhoneNumberFromString>[1] extends { defaultCountry?: infer Country } ? Country : never, extract: false } : { extract: false });
  return parsed?.isValid() ? parsed.number : undefined;
}

function phoneValues(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [value];
  return Array.from(new Set(raw.map((entry) => text(entry)?.replace(/^tel:/i, "")).filter((entry): entry is string => Boolean(entry))));
}

function schemaTypes(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value]).flatMap((entry) => {
    const type = text(entry);
    if (!type) return [];
    try {
      const url = new URL(type);
      return url.hostname.toLowerCase() === "schema.org" ? [url.pathname.split("/").filter(Boolean).pop()?.toLowerCase() ?? ""] : [];
    } catch {
      return [type.toLowerCase().replace(/\s+/g, "")];
    }
  });
}

function isBusinessEntity(entity: Record<string, unknown>, pageUrl: string): boolean {
  if (!schemaTypes(entity["@type"]).some((type) => businessTypes.has(type))) return false;
  for (const key of ["url", "@id"]) {
    const link = text(entity[key]);
    if (!link || link.startsWith("#")) continue;
    try {
      if (!sameBusinessHost(new URL(link, pageUrl).hostname, new URL(pageUrl).hostname)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function sameBusinessHost(first: string, second: string): boolean {
  return first.replace(/^www\./i, "").toLowerCase() === second.replace(/^www\./i, "").toLowerCase();
}

function schemaAddress(value: unknown): Address | undefined {
  const item = record(value);
  if (!item) {
    const street = text(value);
    return street ? { street } : undefined;
  }
  const address = {
    street: text(item.streetAddress),
    locality: text(item.addressLocality),
    region: text(item.addressRegion),
    postalCode: text(item.postalCode),
    country: text(item.addressCountry)
  };
  return Object.values(address).some(Boolean) ? address : undefined;
}

function structuredIdentity(entity: Record<string, unknown>, pageUrl: string): ObservedBusinessIdentity {
  const address = schemaAddress(entity.address);
  return {
    pageUrl,
    kind: "structured",
    name: text(entity.name),
    phones: phoneValues(entity.telephone),
    ...(address ? { address } : {})
  };
}

export function extractBusinessIdentities(html: string, pageUrl: string): ObservedBusinessIdentity[] {
  const $ = load(html);
  const identities: ObservedBusinessIdentity[] = [];
  const seen = new Set<string>();
  const add = (identity: ObservedBusinessIdentity): void => {
    if (identities.length >= MAX_IDENTITIES) return;
    const key = JSON.stringify(identity);
    if (!seen.has(key)) {
      seen.add(key);
      identities.push(identity);
    }
  };
  const visit = (value: unknown, depth: number): void => {
    if (depth > MAX_ENTITY_DEPTH || identities.length >= MAX_IDENTITIES) return;
    if (Array.isArray(value)) {
      value.slice(0, MAX_IDENTITIES).forEach((entry) => visit(entry, depth + 1));
      return;
    }
    const entity = record(value);
    if (!entity) return;
    if (isBusinessEntity(entity, pageUrl)) add(structuredIdentity(entity, pageUrl));
    for (const child of [entity["@graph"], entity.mainEntity, entity.itemListElement]) visit(child, depth + 1);
  };

  for (const script of $("script[type='application/ld+json']").toArray()) {
    try {
      visit(JSON.parse($(script).text()), 0);
    } catch {
      continue;
    }
  }

  const title = $("title").first().text().trim() || $("meta[property='og:site_name']").attr("content")?.trim();
  if (title) add({ pageUrl, kind: "page", name: title, phones: [] });
  return identities;
}

function candidateAddress(metadata: Record<string, unknown>): Address | undefined {
  const address = {
    street: text(metadata.address),
    locality: text(metadata.locality),
    region: text(metadata.region),
    country: text(metadata.country)
  };
  return Object.values(address).some(Boolean) ? address : undefined;
}

function sourceValues(candidate: Pick<PlaceCandidate, "label" | "sourceMetadata">): { name?: string; phones: string[]; address?: Address } {
  const metadata = candidate.sourceMetadata ?? {};
  const address = candidateAddress(metadata);
  return {
    name: text(candidate.label),
    phones: phoneValues(metadata.phones),
    ...(address ? { address } : {})
  };
}

function evidence(field: BusinessIdentityEvidence["field"], state: BusinessIdentityEvidence["state"], source: string[], website: string[], pageUrl: string | undefined, reason: string): BusinessIdentityEvidence {
  return { field, state, sourceValues: source, websiteValues: website, ...(pageUrl ? { pageUrl } : {}), reason };
}

function compareName(source: string | undefined, website: string | undefined, pageUrl: string, weak: boolean): BusinessIdentityEvidence {
  if (!source || !website) return evidence("name", "missing", source ? [source] : [], website ? [website] : [], pageUrl, "Business name was not available on both sides.");
  if (weak) return evidence("name", "ambiguous", [source], [website], pageUrl, "Page title or site name is weak identity evidence.");
  const normalizedSource = normalizeText(source);
  const normalizedWebsite = normalizeText(website);
  const sourceTokens = normalizedSource.split(" ").filter((token) => !genericNameTokens.has(token));
  const websiteTokens = normalizedWebsite.split(" ").filter((token) => !genericNameTokens.has(token));
  if (!sourceTokens.length || !websiteTokens.length) return evidence("name", "ambiguous", [source], [website], pageUrl, "Generic industry labels cannot establish a business-name match.");
  if (normalizedSource === normalizedWebsite) return evidence("name", "match", [source], [website], pageUrl, "Structured business names agree after formatting normalization.");
  if (sourceTokens.some((token) => websiteTokens.includes(token))) return evidence("name", "ambiguous", [source], [website], pageUrl, "Business names share distinctive words but do not exactly agree.");
  return evidence("name", "different", [source], [website], pageUrl, "Structured business names differ.");
}

function comparePhones(source: string[], website: string[], sourceCountry: string | undefined, websiteCountry: string | undefined, pageUrl: string): BusinessIdentityEvidence {
  const sourceNumbers = source.map((phone) => normalizedPhone(phone, sourceCountry)).filter((phone): phone is string => Boolean(phone));
  const websiteNumbers = website.map((phone) => normalizedPhone(phone, websiteCountry ?? sourceCountry)).filter((phone): phone is string => Boolean(phone));
  if (!sourceNumbers.length || !websiteNumbers.length) return evidence("phone", "missing", sourceNumbers.length ? sourceNumbers : source, websiteNumbers.length ? websiteNumbers : website, pageUrl, "No valid whole phone number was available on both sides.");
  return sourceNumbers.some((phone) => websiteNumbers.includes(phone))
    ? evidence("phone", "match", sourceNumbers, websiteNumbers, pageUrl, "Valid normalized phone numbers agree.")
    : evidence("phone", "different", sourceNumbers, websiteNumbers, pageUrl, "Valid normalized phone numbers differ.");
}

function streetDetails(value: string): { canonical: string; numbers: string[]; roadWords: string[] } {
  const aliases: Record<string, string> = { cad: "cadde", cd: "cadde", sok: "sokak", st: "street", str: "strasse" };
  const tokens = normalizeText(value).split(" ").map((token) => aliases[token] ?? token);
  return {
    canonical: tokens.join(" "),
    numbers: tokens.filter((token) => /^\d+[a-z]?$/i.test(token)),
    roadWords: tokens.filter((token) => !/^\d+[a-z]?$/i.test(token) && !["cadde", "sokak", "street", "strasse"].includes(token))
  };
}

function compareAddress(source: Address | undefined, website: Address | undefined, pageUrl: string): BusinessIdentityEvidence {
  const sourceDisplay = source ? [source.street, source.locality, source.region, source.postalCode, source.country].filter((value): value is string => Boolean(value)) : [];
  const websiteDisplay = website ? [website.street, website.locality, website.region, website.postalCode, website.country].filter((value): value is string => Boolean(value)) : [];
  if (!source?.street || !source.locality || !website?.street || !website.locality) return evidence("address", "missing", sourceDisplay, websiteDisplay, pageUrl, "Complete street and locality were not available on both sides.");
  const sourceCountry = countryCode(source.country);
  const websiteCountry = countryCode(website.country);
  if (sourceCountry && websiteCountry && sourceCountry !== websiteCountry) return evidence("address", "different", sourceDisplay, websiteDisplay, pageUrl, "Explicit address countries differ.");
  const sourceStreet = streetDetails(source.street);
  const websiteStreet = streetDetails(website.street);
  const sameStreet = sourceStreet.canonical === websiteStreet.canonical;
  const sameLocality = normalizeText(source.locality) === normalizeText(website.locality);
  if (sameStreet && sameLocality) return evidence("address", "match", sourceDisplay, websiteDisplay, pageUrl, "Street and locality agree after formatting normalization.");
  const differentNumbers = sourceStreet.numbers.length > 0 && websiteStreet.numbers.length > 0 && !sourceStreet.numbers.some((number) => websiteStreet.numbers.includes(number));
  const differentRoads = sourceStreet.roadWords.length > 0 && websiteStreet.roadWords.length > 0 && !sourceStreet.roadWords.some((word) => websiteStreet.roadWords.includes(word));
  if (sameLocality && (differentNumbers || differentRoads)) return evidence("address", "different", sourceDisplay, websiteDisplay, pageUrl, "Complete addresses identify different streets or house numbers in the same locality.");
  return evidence("address", "ambiguous", sourceDisplay, websiteDisplay, pageUrl, "Address formatting or locality variation is not enough to establish a contradiction.");
}

function meaningfulSourceAddress(address: Address | undefined): boolean {
  return Boolean(address?.street && address.locality);
}

export function compareBusinessIdentity(candidate: Pick<PlaceCandidate, "label" | "sourceMetadata">, observations: readonly ObservedBusinessIdentity[]): BusinessIdentityResult {
  const source = sourceValues(candidate);
  const allEvidence: BusinessIdentityEvidence[] = [];
  const outcomes: Array<{ matched: boolean; conflict: boolean; unresolved: boolean; relevant: boolean; reasons: string[] }> = [];

  for (const observation of observations) {
    const name = compareName(source.name, observation.name, observation.pageUrl, observation.kind === "page");
    const phone = observation.kind === "structured" ? comparePhones(source.phones, observation.phones, countryCode(source.address?.country), countryCode(observation.address?.country), observation.pageUrl) : evidence("phone", "missing", source.phones, [], observation.pageUrl, "Page-level identity does not supply a structured phone number.");
    const address = observation.kind === "structured" ? compareAddress(source.address, observation.address, observation.pageUrl) : evidence("address", "missing", source.address ? [source.address.street, source.address.locality].filter((value): value is string => Boolean(value)) : [], [], observation.pageUrl, "Page-level identity does not supply a structured address.");
    const fields = [name, phone, address];
    allEvidence.push(...fields);
    if (observation.kind === "page") {
      outcomes.push({ matched: false, conflict: false, unresolved: true, relevant: false, reasons: ["Only weak page title or site-name evidence was available."] });
      continue;
    }
    const agreements = fields.filter((item) => item.state === "match").length;
    const disagreements = fields.filter((item) => item.state === "different").length;
    const addressRequired = meaningfulSourceAddress(source.address);
    const matched = disagreements === 0 && agreements >= 2 && (!addressRequired || address.state === "match");
    const conflict = disagreements >= 2;
    outcomes.push({
      matched,
      conflict,
      unresolved: !matched && !conflict,
      relevant: true,
      reasons: matched
        ? [`Structured identity at ${observation.pageUrl} agrees on ${fields.filter((item) => item.state === "match").map((item) => item.field).join(", ")}.`]
        : conflict
          ? [`Structured identity at ${observation.pageUrl} differs on ${fields.filter((item) => item.state === "different").map((item) => item.field).join(", ")}.`]
          : [`Structured identity at ${observation.pageUrl} has insufficient or mixed evidence.`]
    });
  }

  const matched = outcomes.filter((outcome) => outcome.matched);
  const hasConflict = outcomes.some((outcome) => outcome.conflict);
  if (matched.length && hasConflict) {
    return { status: "uncertain", reasons: outcomes.filter((outcome) => outcome.matched || outcome.conflict).flatMap((outcome) => outcome.reasons), evidence: allEvidence };
  }
  if (matched.length) return { status: "matched", reasons: matched.flatMap((outcome) => outcome.reasons), evidence: allEvidence };
  const unresolved = outcomes.some((outcome) => outcome.relevant && outcome.unresolved);
  if (hasConflict && !unresolved) return { status: "conflict", reasons: outcomes.filter((outcome) => outcome.conflict).flatMap((outcome) => outcome.reasons), evidence: allEvidence };
  return {
    status: "uncertain",
    reasons: outcomes.length ? outcomes.flatMap((outcome) => outcome.reasons) : ["No website business identity evidence was found."],
    evidence: allEvidence
  };
}
