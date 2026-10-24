import { load, type CheerioAPI } from "cheerio";
import { findPhoneNumbersInText, getCountries, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";
import { createRequire } from "node:module";
import { detectPageForms, hasContactOrBookingLink } from "./contact.js";
import { cookieNames } from "./dotnet-stack.js";
import {
  applyTypeContext,
  contextBase,
  expandNodeId,
  isLocalBusinessType,
  noTypeContext,
  type JsonLdTypeContext
} from "./local-business-types.js";
import type { Finding, FindingCategory, PageSnapshot, Severity } from "./types.js";

type Rule = {
  id: string;
  title: string;
  category: FindingCategory;
  severity: Severity;
  source: string;
  recommendation: string;
  check: (context: RuleContext) => boolean;
  evidence: (context: RuleContext) => string;
};

type RuleContext = {
  $: CheerioAPI;
  snapshot: PageSnapshot;
  text: string;
};

type JsonLdNode = Record<string, unknown>;

function finding(rule: Rule, context: RuleContext): Finding {
  return {
    id: rule.id,
    title: rule.title,
    severity: rule.severity,
    category: rule.category,
    source: rule.source,
    recommendation: rule.recommendation,
    evidence: [
      {
        label: rule.source,
        value: rule.evidence(context)
      }
    ]
  };
}

function hasLink($: CheerioAPI, matcher: (href: string) => boolean): boolean {
  return $("a")
    .toArray()
    .some((element) => matcher($(element).attr("href") ?? ""));
}

function hasJsonLdType($: CheerioAPI, matcher: (type: string) => boolean): boolean {
  return jsonLdNodes($).some((node) => jsonLdTypes(node).some(matcher));
}

function jsonLdTypes(node: JsonLdNode): string[] {
  const typeValue = node["@type"];
  const types = Array.isArray(typeValue) ? typeValue : [typeValue];
  return types.filter((type): type is string => typeof type === "string");
}

// Where each flattened node was found: the active JSON-LD context that expands its @type and @id, the
// context its nested node objects use, and the script block it came from, which scopes blank node labels.
type JsonLdNodeScope = { context: JsonLdTypeContext; nestedContext: JsonLdTypeContext; block: number };
const nodeScopes = new WeakMap<JsonLdNode, JsonLdNodeScope>();

// Flattens top-level and @graph or @included node objects; with embedded set, also node objects nested
// as property values, such as an address or a mainEntity.
function flattenJsonLd(value: unknown, block: number, context: JsonLdTypeContext = noTypeContext, embedded = false): JsonLdNode[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenJsonLd(item, block, context, embedded));
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const node = value as JsonLdNode;
  const localContext = node["@context"];
  const nodeContext = applyTypeContext(context, localContext);
  // A context with "@propagate": false, alone or in a context array, applies to this node only; nested
  // nodes return to the previous context, which no longer gets the lenient no-context reading.
  const localContexts = Array.isArray(localContext) ? localContext : [localContext];
  const propagates = !localContexts.some((entry) => hasObjectField(entry) && (entry as JsonLdNode)["@propagate"] === false);
  const childContext = propagates ? nodeContext : { ...context, declared: true };
  nodeScopes.set(node, { context: nodeContext, nestedContext: childContext, block });
  // @graph and @included both hold further node objects of the same document.
  const nestedKeys = embedded
    ? Object.keys(node).filter((key) => !key.startsWith("@") || ["@graph", "@included", "@list", "@set"].includes(key))
    : ["@graph", "@included"];
  return [node, ...nestedKeys.flatMap((key) => flattenJsonLd(node[key], block, childContext, embedded))];
}

function jsonLdNodes($: CheerioAPI, embedded = false): JsonLdNode[] {
  return $('script[type="application/ld+json"]')
    .toArray()
    .flatMap((element, block) => {
      const raw = $(element).text();
      try {
        const parsed = JSON.parse(raw) as unknown;
        return flattenJsonLd(parsed, block, noTypeContext, embedded);
      } catch {
        return [];
      }
    });
}

function hasInvalidJsonLd($: CheerioAPI): boolean {
  return $('script[type="application/ld+json"]')
    .toArray()
    .some((element) => {
      try {
        JSON.parse($(element).text());
        return false;
      } catch {
        return true;
      }
    });
}

function hasSuccessfulResource(statusCode: number | undefined): boolean {
  return typeof statusCode === "number" && statusCode >= 200 && statusCode < 400;
}

function localBusinessNodes($: CheerioAPI): JsonLdNode[] {
  return jsonLdNodes($).filter((node) =>
    jsonLdTypes(node).some((type) => isLocalBusinessType(type, nodeScopes.get(node)?.context))
  );
}

function hasObjectField(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasStringField(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

// A day or time is a non-empty string, or a JSON-LD value or node object carrying one, such as
// {"@id": "https://schema.org/Monday"} or {"@value": "09:00"}.
function hasOpeningHoursValue(value: unknown): boolean {
  if (hasStringField(value)) {
    return true;
  }

  if (!hasObjectField(value)) {
    return false;
  }

  const fields = value as JsonLdNode;
  return ["@id", "@value", "name"].some((key) => hasStringField(fields[key]));
}

function hasOpeningHoursData(specification: unknown): boolean {
  if (!hasObjectField(specification)) {
    return false;
  }

  const fields = specification as JsonLdNode;
  return ["dayOfWeek", "opens", "closes"].some((field) => {
    const values = Array.isArray(fields[field]) ? (fields[field] as unknown[]) : [fields[field]];
    return values.some(hasOpeningHoursValue);
  });
}

// JSON-LD @id values are IRIs relative to the document base: the page URL, or its <base href>.
function documentBase($: CheerioAPI, snapshot: PageSnapshot): string {
  const pageUrl = snapshot.finalUrl || snapshot.url;
  try {
    return new URL($("base[href]").first().attr("href") ?? "", pageUrl).href;
  } catch {
    return pageUrl;
  }
}

// An @id as a lookup key: compact IRIs expand through the JSON-LD context and relative IRIs resolve
// against the context's @base or the document base, while blank node labels such as "_:b0" stay local
// to their script block.
function nodeKey(id: string, context: JsonLdTypeContext, block: number, documentBaseIri: string): string {
  const expanded = expandNodeId(id, context);
  if (expanded.startsWith("_:")) {
    return `${block} ${expanded}`;
  }

  try {
    return new URL(expanded, contextBase(documentBaseIri, context) ?? undefined).href;
  } catch {
    return expanded;
  }
}

function nodeIdKey(node: JsonLdNode, base: string): string | undefined {
  const scope = nodeScopes.get(node);
  return scope && typeof node["@id"] === "string" ? nodeKey(node["@id"], scope.context, scope.block, base) : undefined;
}

// The key of a node reference such as {"@id": "#hours"} found in the owner node's property. As in JSON-LD
// expansion, an object holding only @id keeps the owner's context even when that context does not
// propagate, while any other nested object returns to the previous context; the property term's own
// scoped @context then applies, and finally the reference's own @context.
function referenceKey(reference: unknown, owner: JsonLdNode, property: string, base: string): string | undefined {
  const scope = nodeScopes.get(owner);
  if (!scope || !hasObjectField(reference)) {
    return undefined;
  }

  const fields = reference as JsonLdNode;
  const idOnly = Object.keys(fields).length === 1;
  const propertyContext = applyTypeContext(idOnly ? scope.context : scope.nestedContext, scope.context.terms.get(property)?.scopedContext);
  const context = idOnly ? propertyContext : applyTypeContext(propertyContext, fields["@context"]);
  return typeof fields["@id"] === "string" ? nodeKey(fields["@id"], context, scope.block, base) : undefined;
}

// Every JSON-LD node with each @id, embedded ones included, keyed as above; nodes sharing an @id
// describe the same thing.
function jsonLdNodesById($: CheerioAPI, base: string): Map<string, JsonLdNode[]> {
  const nodesById = new Map<string, JsonLdNode[]>();
  for (const node of jsonLdNodes($, true)) {
    const key = nodeIdKey(node, base);
    if (key !== undefined) {
      nodesById.set(key, [...(nodesById.get(key) ?? []), node]);
    }
  }

  return nodesById;
}

// A node together with every other node that shares its @id.
function nodeFragments(node: JsonLdNode, nodesById: Map<string, JsonLdNode[]>, base: string): JsonLdNode[] {
  const key = nodeIdKey(node, base);
  return key === undefined ? [node] : (nodesById.get(key) ?? [node]);
}

// openingHours may be one string or a list; openingHoursSpecification is one object or a list of them,
// each with a day or time, or an {"@id": ...} reference to nodes elsewhere in the graph that have one.
function hasOpeningHoursField(node: JsonLdNode, nodesById: Map<string, JsonLdNode[]>, base: string): boolean {
  const specifications = Array.isArray(node.openingHoursSpecification)
    ? node.openingHoursSpecification
    : [node.openingHoursSpecification];
  return (
    stringValues(node.openingHours).length > 0 ||
    specifications.some((specification) => {
      const reference = referenceKey(specification, node, "openingHoursSpecification", base);
      const referenced = reference === undefined ? [] : (nodesById.get(reference) ?? []);
      return hasOpeningHoursData(specification) || referenced.some(hasOpeningHoursData);
    })
  );
}

// The business's fields may be split across nodes that share its @id.
function hasLocalBusinessContactFields($: CheerioAPI, snapshot: PageSnapshot): boolean {
  const nodes = localBusinessNodes($);
  if (nodes.length === 0) {
    return true;
  }

  const base = documentBase($, snapshot);
  const nodesById = jsonLdNodesById($, base);
  return nodes.some((node) => {
    const fragments = nodeFragments(node, nodesById, base);
    return (
      fragments.some((fragment) => hasStringField(fragment.telephone)) &&
      fragments.some((fragment) => hasObjectField(fragment.address)) &&
      fragments.some((fragment) => hasOpeningHoursField(fragment, nodesById, base))
    );
  });
}

function stringValues(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

// A closed <dialog> is hidden by the browser without any attribute or style.
// aria-hidden only hides content from assistive technology, so it stays visible here.
const hiddenElements = "script, style, noscript, template, [hidden], dialog:not([open])";

// Inline CSS allows whitespace and !important around values ("display : none !important"), so read the declarations.
const hiddenStyle = /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!\s*important\s*)?(?:;|$)/i;

type VisibleBody = ReturnType<CheerioAPI>;

const blockElements =
  "address, article, aside, blockquote, dd, details, dialog, div, dl, dt, figcaption, footer, form, h1, h2, h3, h4, h5, h6, header, label, li, main, nav, ol, p, section, summary, table, td, th, tr, ul";

function visibleBody($: CheerioAPI): VisibleBody {
  const body = $("body").clone();
  body.find(hiddenElements).remove();
  // A closed <details> shows only its summary; its other content, text nodes included, is hidden.
  body.find("details:not([open])").each((_, element) => {
    $(element)
      .contents()
      .filter((_, node) => !(node.type === "tag" && node.name.toLowerCase() === "summary"))
      .remove();
  });
  body
    .find("[style]")
    .filter((_, element) => hiddenStyle.test($(element).attr("style") ?? ""))
    .remove();
  // Mark block boundaries so text from neighbouring elements is not read as one line.
  body.find("br").replaceWith("\n");
  body.find(blockElements).append("\n");
  return body;
}

function visibleLines(element: VisibleBody): string[] {
  return element
    .text()
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function collapsedText(element: VisibleBody): string {
  return element.text().replace(/\s+/g, " ").trim();
}

const supportedPhoneCountries = new Set<string>(getCountries());

type JsonLdIndex = Map<string, JsonLdNode>;

function jsonLdIndex($: CheerioAPI): JsonLdIndex {
  return new Map(
    jsonLdNodes($).flatMap((node) => (typeof node["@id"] === "string" ? [[node["@id"], node] as const] : []))
  );
}

function schemaAddresses(node: JsonLdNode, index: JsonLdIndex): unknown[] {
  const addresses = Array.isArray(node.address) ? node.address : [node.address];
  return addresses.map((address) => {
    // Follow {"@id": ...} references to PostalAddress nodes elsewhere in the graph.
    const reference = hasObjectField(address) ? (address as JsonLdNode)["@id"] : undefined;
    return typeof reference === "string" && index.has(reference) ? { ...index.get(reference), ...(address as JsonLdNode) } : address;
  });
}

function schemaCountry(node: JsonLdNode, index: JsonLdIndex): CountryCode | undefined {
  return schemaAddresses(node, index)
    .filter(hasObjectField)
    .flatMap((address) => {
      const value = (address as JsonLdNode).addressCountry;
      if (!hasObjectField(value)) {
        return stringValues(value);
      }

      const reference = (value as JsonLdNode)["@id"];
      const country = typeof reference === "string" ? { ...index.get(reference), ...(value as JsonLdNode) } : (value as JsonLdNode);
      return stringValues(country.name);
    })
    .map(countryCodeFromName)
    .find((code) => code !== undefined);
}

const countryNameAliases: Record<string, string> = {
  deutschland: "DE",
  "great britain": "GB",
  turkey: "TR",
  uk: "GB",
  usa: "US",
  "united states of america": "US"
};

// addressCountry is often written in the site's own language ("España", "Türkiye"), so read names in common locales too.
const countryNameLocales = ["en", "es", "fr", "de", "it", "pt", "nl", "tr", "sv", "da", "nb", "fi", "pl", "cs", "el", "ru", "uk", "ja", "zh", "ko", "ar", "he", "id"];

let localizedCountryNames: Map<string, CountryCode> | undefined;

function normalizedCountryName(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").replace(/\u0131/g, "i").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function countryCodeFromName(value: string): CountryCode | undefined {
  const trimmed = value.trim();
  if (/^[A-Za-z]{2}$/.test(trimmed)) {
    const code = trimmed.toUpperCase();
    // Unsupported two-letter values may still be common names ("UK"), so fall through to the aliases.
    if (supportedPhoneCountries.has(code)) {
      return code as CountryCode;
    }
  }

  if (!localizedCountryNames) {
    const names = new Map<string, CountryCode>();
    for (const locale of countryNameLocales) {
      const displayNames = new Intl.DisplayNames([locale], { type: "region" });
      for (const code of getCountries()) {
        const name = displayNames.of(code);
        // Earlier locales win, so an English name is never reassigned by a translation.
        if (name && name !== code && !names.has(normalizedCountryName(name))) {
          names.set(normalizedCountryName(name), code);
        }
      }
    }
    localizedCountryNames = names;
  }

  const name = normalizedCountryName(trimmed);
  return localizedCountryNames.get(name) ?? (countryNameAliases[name] as CountryCode | undefined);
}

type VisiblePhone = {
  e164: string;
  ext?: string;
  display: string;
};

function parsedPhone(value: string, country: CountryCode | undefined): VisiblePhone | undefined {
  const parsed = parsePhoneNumberFromString(value.replace(/^tel:/i, "").trim(), country ? { defaultCountry: country } : {});
  return parsed?.isValid() ? { e164: parsed.number, ext: parsed.ext, display: parsed.formatInternational() } : undefined;
}

// Extensions must agree when both sides give one; a number shown without its extension still matches.
function samePhone(visible: VisiblePhone, schema: VisiblePhone): boolean {
  return visible.e164 === schema.e164 && (!visible.ext || !schema.ext || visible.ext === schema.ext);
}

// Words between the label and the number may not name an identifier, so "Call ID: 4155550199" is not read as a phone.
const phoneLabelWords =
  "phone|tel|telephone|call|mobile|cell|whatsapp|telefon|telefone|telefono|teléfono|téléphone|tél|telemóvel|telemovel|celular|gsm|cep|ara|ruf|☎|📞";

const phoneLabel = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:${phoneLabelWords})(?![\p{L}\p{N}])\.?[^\p{L}\p{N}]*(?:(?!(?:id|ids|ref|reference|order|ticket|case|account|acct|customer|invoice|booking|reservation|confirmation|tracking|serial|pin|code|log|session)(?![\p{L}\p{N}]))\p{L}+[^\p{L}\p{N}]+){0,3}$`,
  "iu"
);

// A block holding only a label ("Phone:", "Call us", "Telefon numarası") — not prose that merely mentions a phone.
const standalonePhoneLabel = new RegExp(
  String.raw`^[^\p{L}\p{N}]*(?:${phoneLabelWords})(?:\s+(?:us|number|no|nr|numarası|numarasi|nummer|numéro|número|numero))?\.?[^\p{L}\p{N}]*$`,
  "iu"
);

const phoneListSeparator = /^[\s,/|;–—-]*(?:(?:or|and|ve|veya|oder|und|ou|et|o|y)[\s,/|;–—-]*)?$/i;

// Label/value markup (<dt>Phone</dt><dd>...</dd>, <th>Address</th><td>...</td>) puts the label on its own line, so join each pair.
function labelValuePairs($: CheerioAPI, body: VisibleBody): string[] {
  return [
    ...body
      .find("dt")
      .toArray()
      .map((element) => {
        const values = $(element).nextUntil("dt", "dd").toArray();
        return `${collapsedText($(element))}: ${values.map((value) => collapsedText($(value))).join(" ")}`;
      }),
    ...body
      .find("tr")
      .toArray()
      .map((element) => {
        const [label, ...values] = $(element).children("th, td").toArray();
        return label ? `${collapsedText($(label))}: ${values.map((value) => collapsedText($(value))).join(" ")}` : "";
      })
  ].filter(Boolean);
}

function visiblePhones($: CheerioAPI, body: VisibleBody, country: CountryCode | undefined): VisiblePhone[] {
  const linkPhones = body
    .find("a[href^='tel:' i]")
    .toArray()
    .map((element) => parsedPhone($(element).attr("href") ?? "", country));
  // Only trust numbers in body text when a phone label precedes them on the same line, so IDs and codes are not read as phones.
  // A label also covers the numbers listed right after it ("Phone: 0212 ... / 0216 ...").
  // A label alone in its block ("<div>Phone:</div><div>(415) 555-0199</div>") labels the next block's number.
  const lines = visibleLines(body);
  const labelledNextLines = lines.flatMap((line, index) =>
    index + 1 < lines.length && standalonePhoneLabel.test(line) ? [`${line} ${lines[index + 1]}`] : []
  );
  const textPhones = [...lines, ...labelledNextLines, ...labelValuePairs($, body)].flatMap((line) => {
    let labelledEnd: number | undefined;
    return findPhoneNumbersInText(line, country ? { defaultCountry: country } : {}).map(({ number, startsAt, endsAt }) => {
      const labelled =
        phoneLabel.test(line.slice(0, startsAt)) ||
        (labelledEnd !== undefined && phoneListSeparator.test(line.slice(labelledEnd, startsAt)));
      labelledEnd = labelled ? endsAt : undefined;
      return labelled && number.isValid() ? { e164: number.number, ext: number.ext, display: number.formatInternational() } : undefined;
    });
  });

  const phones = [...linkPhones, ...textPhones].filter((phone): phone is VisiblePhone => phone !== undefined);
  return Array.from(new Map(phones.map((phone) => [`${phone.e164};${phone.ext ?? ""}`, phone])).values());
}

// The country whose national number format a page uses: its country-code domain (".co.uk" is GB), else a regional
// html lang such as "en-GB".
function pageCountry($: CheerioAPI, snapshot: PageSnapshot): CountryCode | undefined {
  const candidates: string[] = [];
  try {
    const tld = new URL(snapshot.finalUrl).hostname.toLowerCase().split(".").at(-1) ?? "";
    candidates.push(tld === "uk" ? "GB" : tld.toUpperCase());
  } catch {
    // An unparsable URL gives no country.
  }
  candidates.push(($("html").attr("lang") ?? "").split(/[-_]/)[1]?.toUpperCase() ?? "");
  return candidates.find((code) => code.length === 2 && supportedPhoneCountries.has(code)) as CountryCode | undefined;
}

// Numbers by their shape, counted even when the page's country is wrong or unknown (a UK business on a .com site keeps
// WordPress's default lang="en-US"): a trunk-prefixed national number of 10 or 11 digits such as "0114 258 5525", and,
// where the country may be the US or Canada, "(415) 555-0199", "415-555-0199", or "415 555 0199".
const trunkPhonePattern = /(?<![\p{L}\p{N}+])\(?0\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}(?![\p{L}\p{N}])/gu;
const northAmericanPhonePattern = /(?<![\p{L}\p{N}+])(?:\(\d{3}\)\s?\d{3}[\s.-]\d{4}|\d{3}[\s.-]\d{3}[\s.-]\d{4})(?![\p{L}\p{N}])/gu;

const shownPhoneCache = new WeakMap<CheerioAPI, string[]>();

// Phone numbers a visitor can see: tel: links, labelled numbers, unlabelled numbers written with an international or
// trunk prefix (so order and reference numbers are not read as phones), and numbers that only have a phone's shape.
function shownPhoneNumbers($: CheerioAPI, snapshot: PageSnapshot): string[] {
  const cached = shownPhoneCache.get($);
  if (cached) {
    return cached;
  }
  const body = visibleBody($);
  const country = pageCountry($, snapshot);
  const lines = visibleLines(body);
  const parsed = lines.flatMap((line) =>
    findPhoneNumbersInText(line, country ? { defaultCountry: country } : {})
      .filter(({ number, startsAt }) => number.isValid() && /^[+(0]/.test(line.slice(startsAt)))
      .map(({ number }) => number.formatInternational())
  );
  const patterns = [trunkPhonePattern, ...(!country || country === "US" || country === "CA" ? [northAmericanPhonePattern] : [])];
  const shaped = lines.flatMap((line) =>
    patterns.flatMap((pattern) =>
      [...line.matchAll(pattern)]
        .map((match) => match[0])
        .filter((value) => pattern !== trunkPhonePattern || [10, 11].includes(value.replace(/\D/g, "").length))
        .map((value) => parsedPhone(value, country)?.display ?? value)
    )
  );
  const numbers = [...new Set([...visiblePhones($, body, country).map((phone) => phone.display), ...parsed, ...shaped])];
  shownPhoneCache.set($, numbers);
  return numbers;
}

// Abbreviations map to one canonical form so "St." and "Street" match while "Street" and "Road" stay different.
const canonicalAddressTokens: Record<string, string> = {
  st: "street",
  rd: "road",
  ave: "avenue",
  av: "avenue",
  avenida: "avenue",
  avda: "avenue",
  bd: "boulevard",
  pza: "plaza",
  blvd: "boulevard",
  ln: "lane",
  dr: "drive",
  hwy: "highway",
  rte: "route",
  pkwy: "parkway",
  cres: "crescent",
  cresc: "crescent",
  ter: "terrace",
  terr: "terrace",
  cir: "circle",
  crcl: "circle",
  trl: "trail",
  aly: "alley",
  plz: "plaza",
  hts: "heights",
  xing: "crossing",
  expy: "expressway",
  fwy: "freeway",
  tpke: "turnpike",
  crt: "court",
  gdns: "gardens",
  grv: "grove",
  pde: "parade",
  esp: "esplanade",
  cct: "circuit",
  wy: "way",
  pl: "place",
  ct: "court",
  sq: "square",
  ste: "suite",
  apt: "apartment",
  bldg: "building",
  rm: "room",
  fl: "floor",
  n: "north",
  s: "south",
  e: "east",
  w: "west",
  ne: "northeast",
  nw: "northwest",
  se: "southeast",
  sw: "southwest",
  cadde: "caddesi",
  cad: "caddesi",
  cd: "caddesi",
  sok: "sokak",
  sk: "sokak",
  sokagi: "sokak",
  mah: "mahallesi",
  mahalle: "mahallesi",
  str: "strasse",
  ул: "улица"
};

const compassLetters = new Set(["n", "s", "e", "w", "ne", "nw", "se", "sw"]);

// Every street suffix the canonical map knows, so "12 S Crescent" keeps "S" as the street's name.
const streetTypes = new Set([
  "street", "road", "avenue", "boulevard", "lane", "drive", "highway", "route", "parkway", "place", "court", "square",
  "crescent", "terrace", "circle", "trail", "alley", "plaza", "heights", "crossing", "expressway", "freeway", "turnpike",
  "gardens", "grove", "parade", "esplanade", "circuit", "way",
  // Localized suffixes written as separate words ("S Straße", "S Caddesi").
  "strasse", "gasse", "weg", "platz", "allee", "straat", "laan", "gatan", "vej", "gata", "caddesi", "sokak", "улица"
]);

const fillerAddressTokens = new Set(["no", "nr", "the", "and", "jr"]);

// Zero code points of common native decimal digit sets (Arabic-Indic, Persian, Indic scripts, Thai, fullwidth, ...).
const nativeDigitZeros = [
  0x660, 0x6f0, 0x7c0, 0x966, 0x9e6, 0xa66, 0xae6, 0xb66, 0xbe6, 0xc66, 0xce6, 0xd66, 0xde6, 0xe50, 0xed0, 0xf20, 0x1040,
  0x1090, 0x17e0, 0x1810, 0xff10
];

// House numbers written in native digits ("١٢") compare as ASCII digits ("12").
function asciiDigits(value: string): string {
  return value.replace(/[^\x00-\x7f]/gu, (char) => {
    const code = char.codePointAt(0) ?? 0;
    const zero = nativeDigitZeros.find((start) => code >= start && code <= start + 9);
    return zero === undefined ? char : String(code - zero);
  });
}

function addressTokens(value: string): string[] {
  return asciiDigits(value)
    .replace(/\s*([½¼¾])/gu, (_, fraction: string) => ` ${{ "½": "1/2", "¼": "1/4", "¾": "3/4" }[fraction]}`)
    // Keep fractional house numbers ("12 1/2") as one token so the fraction is not read as separate numbers.
    .replace(/(\d+)\s+(\d+)\/(\d+)(?![\p{L}\p{N}])/gu, "$1x$2x$3")
    // Likewise keep ranges ("12-14") as one token so "12-14" and "14-16" stay different house numbers.
    .replace(/(?<![\p{L}\p{N}])(\d+)\s*[-–]\s*(\d+)(?![\p{L}\p{N}])/gu, "$1to$2")
    // And unit/street pairs ("2/14 Main Street", "No: 12/3") so the unit number stays bound to its street number.
    .replace(/(?<![\p{L}\p{N}])(\d+)\s*\/\s*(\d+)(?![\p{L}\p{N}])/gu, "$1of$2")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/ı/g, "i")
    .toLowerCase()
    .replace(/ß/g, "ss")
    // "P.O. Box", "PO Box" and "Post Office Box" are one word.
    .replace(/(?<![\p{L}\p{N}])(?:p\s*\.?\s*o\s*\.?|post\s+office)\s*box(?![\p{L}\p{N}])/gu, "pobox")
    // Join house-number suffixes so "12-A", "12/A" and "12A" compare equal; "123 N" stays a directional.
    .replace(/(\p{N})[/-](\p{L})(?![\p{L}\p{N}])/gu, "$1$2")
    // Keep "#" before a unit identifier ("#100") as its own token so the identifier stays bound to it.
    .replace(/#\s*(?=[\p{L}\p{N}])/gu, " # ")
    .split(/[^\p{L}\p{N}#]+/u)
    .flatMap((token) => (token.length > 1 && token.includes("#") ? token.split("#").filter(Boolean) : [token]))
    .filter((token) => token && !fillerAddressTokens.has(token))
    .map((token, index, tokens) => {
      // A compass letter right before the street type is the street's name ("12 S Street"), not a direction.
      if (compassLetters.has(token) && streetTypes.has(canonicalAddressTokens[tokens[index + 1]] ?? tokens[index + 1])) {
        return token;
      }

      // "St" opening a street name ("12 St John St") is Saint; elsewhere it is Street.
      if (token === "st" && /^\p{L}/u.test(tokens[index + 1] ?? "") && (index === 0 || /^\d/.test(tokens[index - 1]))) {
        return "saint";
      }

      return canonicalAddressTokens[token] ?? token.replace(/(?<=\p{L})strasse$/u, "str");
    })
    // "#" after a label ("Suite #100") adds nothing, and without a following identifier it is just punctuation.
    .filter((token, index, tokens) => token !== "#" || (index + 1 < tokens.length && !subAddressLabels.has(tokens[index - 1] ?? "")));
}

function streetAddresses(node: JsonLdNode, index: JsonLdIndex): string[] {
  return schemaAddresses(node, index).flatMap((address) => {
    if (typeof address === "string") {
      return stringValues(address);
    }

    if (hasObjectField(address)) {
      return stringValues((address as JsonLdNode).streetAddress);
    }

    return [];
  });
}

const contactLine =
  /(?<![\p{L}\p{N}])(?:phone|tel|telephone|fax|call|mobile|cell|whatsapp|e-?mail|telefon|telefone|telefono|teléfono|t[eé]l[eé]phone|tél|telem[oó]vel|celular|gsm|cep|ruf)(?![\p{L}\p{N}])|[@☎📞]/iu;

// Distances and durations after a number ("5 minutes", "2 km") mean directions, not an address.
const distanceUnits = String.raw`(?:minutes?|mins?|hours?|hrs?|seconds?|secs?|days?|weeks?|km|kms|kilomet(?:er|re)s?|miles?|mi|blocks?|ft|feet|yards?|m|meters?|metres?)\b`;

// House numbers as addressTokens normalizes them: "12", "12A", "12-A", "12-14", "2/14", "12 1/2" and "12½".
const houseNumberPattern = String.raw`\d+(?:\s*[-–/]\s*\d+|\s+\d+\/\d+|[-/]?[a-z]|[½¼¾])?`;

// Suffixes that may follow a house number and name in unlabelled text ("14 Main Crescent"). Words that are common in prose
// on their own ("way", "ter", "esp") are left to labelled values and <address>.
const numberStreetTypes =
  "street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr|court|ct|place|pl|parkway|pkwy|square|sq|highway|hwy|" +
  "crescent|cres|terrace|terr|circle|cir|trail|trl|alley|aly|plaza|plz|heights|hts|crossing|xing|turnpike|tpke|gardens|gdns|" +
  "grove|grv|parade|pde|esplanade|circuit|cct|expressway|expy|freeway|fwy";

function hasComparableAddress(rawText: string, inAddressElement = false): boolean {
  const text = asciiDigits(rawText);
  const labelledAddress =
    /(?<!(?:e-?mail|web|website|site|url|uri|internet|homepage|ip|ipv4|ipv6|mac|hardware|wallet|bitcoin|server|network)\s)\b(?:address|adres|adresse|anschrift|direcci[oó]n|indirizzo)(?:\s*:\s*([^\n]{0,80})|\s+(\d[^\n]{0,79}))/iu;
  // Without a colon the value must open with the house number, so prose such as "our address changed in 2020" is skipped.
  // The number must belong to the address itself, not to a link, phone or email that follows on the same line.
  const labelledMatch = labelledAddress.exec(text);
  const addressValue = (labelledMatch?.[1] ?? labelledMatch?.[2])
    ?.replace(/(?:https?:\/\/|www\.)\S*/giu, "")
    // A period ends the value unless it closes a short abbreviation ("St.", "P.O.") or sits inside a number.
    .split(/[;|]|(?<!(?:^|[^\p{L}])\p{L}{1,3})\.(?!\d)/u)[0]
    .split(contactLine)[0]
    // A labelled postal code ("ZIP 94105") is not a street.
    .replace(/(?<![\p{L}\p{N}])(?:zip(?:\s*code)?|post(?:al)?\s*code|postcode|plz|code\s*postal|c[oó]digo\s*postal|cap|cp|posta\s*kodu)\s*:?\s*[\p{L}\p{N}-]*\d[\p{L}\p{N}-]*/giu, "");
  // Name, street type, number ("Example Street 12"). The name is required and a distance unit may not follow the number,
  // so directions such as "Drive 5 minutes" are not read as an address.
  const streetNumber = new RegExp(
    String.raw`\p{L}{2,}\.?\s+(?:street|st|road|rd|avenue|ave|boulevard|blvd|lane|drive|court|place|parkway|square|highway|cadde|caddesi|cad|cd|sokak|sok|sk|stra(?:ss|ß)e|str)\b\.?\s*(?:no:?\s*)?\d+[a-z]?(?![\p{L}\p{N}]|\s*${distanceUnits})`,
    "iu"
  );
  // A year-like number ("2026 Main Street Festival") only counts when the street type ends the address (line end or comma).
  const numberStreet = new RegExp(
    String.raw`\b(?!\d+\s+${distanceUnits})(?:(?!(?:19|20)\d\d(?![\p{L}\p{N}]))${houseNumberPattern}|(?:19|20)\d\d(?=\s.*\b(?:${numberStreetTypes})\.?\s*(?:[,;|]|$)))\s+(?:(?:\p{L}+|\d+(?:st|nd|rd|th))\.?\s+){1,6}(?:${numberStreetTypes})\b`,
    "iu"
  );
  // Street types written before the name, as in French, Spanish, Italian and Portuguese ("14 Rue de Rivoli", "5 Calle Mayor").
  const numberPrefixStreet = new RegExp(
    String.raw`\b${houseNumberPattern},?\s+(?:rue|avenue|av|boulevard|bd|chemin|all[ée]e|impasse|quai|place|via|viale|piazza|corso|calle|carrer|avenida|plaza|paseo|rua|travessa)\.?\s+\p{L}`,
    "iu"
  );

  // Compound street names with the type as a suffix ("Hauptstraße 5", "Kalverstraat 12", "Storgatan 3").
  const compoundStreet =
    /\p{L}{2,}(?:stra(?:ss|ß)e|str\.?|weg|gasse|platz|allee|damm|straat|laan|gracht|gade|gatan|vägen|vej|veien|gata)\s*\d/iu;
  const postBox = /\b(?:p\.?\s*o\.?\s*box|post\s+office\s+box|postfach|apartado|bo[iî]te\s+postale)\s*\d/iu;

  // Street type, then name, then number ("Via Roma 14", "Rue de Rivoli 14"); capitalized so prose such as "via email" is skipped.
  const prefixStreetNumber =
    /(?<![\p{L}\p{N}])(?:Rue|Avenue|Av|Boulevard|Bd|Chemin|All[ée]e|Impasse|Quai|Place|Via|Viale|Piazza|Corso|Calle|Carrer|Avenida|Plaza|Paseo|Rua|Travessa)\.?(?:\s+\p{L}+\.?){1,5},?\s+(?:n[°ºo]\.?\s*)?\d/u;
  // A numbered road after the house number ("200 Route 66", "100 County Road 12").
  const numberRoute = new RegExp(
    String.raw`\b${houseNumberPattern}\s+(?:(?:county|state|farm|ranch|forest|township|parish|provincial)\s+)?(?:route|rte|highway|hwy|interstate|road|rd|us|sr|cr|fm)\.?\s+\d`,
    "iu"
  );
  // A labelled value without a known street type still needs address structure: it opens with a house number and a name
  // ("14 Kungsgatan"), or with a name ending in a capitalized word and then the number ("Kungsgatan 14",
  // "улица Ленина 5"). Text such as "unavailable until 2027" or "unavailable, error 404" has neither.
  const labelledStructure = new RegExp(
    String.raw`^\s*(?:${houseNumberPattern},?\s+\p{L}{2,}|(?:\p{L}[\p{L}'’-]*\.?,?\s+){0,3}\p{Lu}[\p{L}'’-]*\.?,?\s+(?:no\.?:?\s*)?(?!(?:19|20)\d\d(?![\p{L}\p{N}])|\d{5})${houseNumberPattern}(?![\p{L}\p{N}]))`,
    "u"
  );
  const streetPatterns = [streetNumber, numberStreet, numberPrefixStreet, compoundStreet, postBox, numberRoute];
  // Status and error placeholders ("404 Not Found", "500 Internal Server Error") have a number and a word but are not addresses.
  const placeholderValue =
    /(?<![\p{L}\p{N}])(?:not\s+found|error|forbidden|unauthori[sz]ed|bad\s+request|unavailable|internal\s+server|bad\s+gateway|gateway\s+timeout|timed\s+out|moved\s+permanently|too\s+many\s+requests)(?![\p{L}\p{N}])/iu;
  const hasLabelledStructure = (value: string) => labelledStructure.test(value) && !placeholderValue.test(value);
  // An address label or <address> already marks the text as an address, so lowercase "via roma 14" counts there.
  const anyCasePrefixStreetNumber = new RegExp(prefixStreetNumber.source, "iu");

  return (
    // Inside <address> any house-number-and-name structure counts ("14 Main Crescent"), not only listed street types.
    (inAddressElement && hasLabelledStructure(text)) ||
    (addressValue !== undefined &&
      (hasLabelledStructure(addressValue) ||
        anyCasePrefixStreetNumber.test(addressValue) ||
        streetPatterns.some((pattern) => pattern.test(addressValue)))) ||
    (inAddressElement ? anyCasePrefixStreetNumber : prefixStreetNumber).test(text) ||
    streetPatterns.some((pattern) => pattern.test(text))
  );
}

// Drop the contact details from a line ("14 Main Crescent, Phone: 415-555-0199") but keep its postal text.
function postalPart(line: string): string {
  return line
    .split(/\s*[,;|·•]\s*/)
    .map((part) => {
      const contact = part.search(contactLine);
      if (contact === -1) {
        return part;
      }
      const before = part.slice(0, contact).trim();
      return /\d/.test(before) ? before : "";
    })
    .filter((part) => part.length > 0)
    .join(", ");
}

const subAddressLine =
  /^\s*(?:(?:suite|ste|unit|apt|apartment|floor|fl|room|rm|building|bldg|kat|daire|blok|etage|stock|piso)(?!\p{L})\.?\s*[\p{L}\p{N}]|#\s*\p{N})/iu;

function visibleAddressRegions($: CheerioAPI, body: VisibleBody): string[][] {
  // Compare against whole visible lines (block elements) that show an address, plus numbered <address> elements,
  // so inline markup cannot split an address and unrelated blocks cannot supply street words.
  const allLines = visibleLines(body);
  // A label alone in its block ("<div>Address:</div><div>14 Main Crescent</div>") labels the next block.
  // Unit lines rendered as their own blocks ("<div>12 Main Street</div><div>Suite 100</div>") continue the address above.
  const continuation = (index: number) => {
    let end = index + 1;
    while (end < allLines.length && subAddressLine.test(allLines[end])) {
      end += 1;
    }
    return allLines.slice(index, end).join(" ");
  };
  const labelledNextLines = allLines.flatMap((line, index) =>
    index + 1 < allLines.length && /^(?:address|adres|adresse|anschrift|direcci[oó]n|indirizzo)\s*:?$/iu.test(line)
      ? [`${line.replace(/\s*:?$/, "")}: ${continuation(index + 1)}`]
      : []
  );
  const continuedLines = allLines.map((_, index) => continuation(index)).filter((line, index) => line !== allLines[index]);
  const lines = [...allLines, ...labelledNextLines, ...continuedLines].filter((line) => hasComparableAddress(line));
  // An address broken with <br> ("12 Main Street<br>Suite 100") continues within its innermost block, so add those blocks whole.
  const addressBlocks = body
    .find(blockElements)
    .toArray()
    .filter((element) => $(element).find(blockElements).length === 0)
    .map((element) => visibleLines($(element)))
    .filter((blockLines) => blockLines.length > 1 && blockLines.some((line) => hasComparableAddress(line)))
    .map((blockLines) => blockLines.join(" "));
  const addressElements = body
    .find("address")
    .toArray()
    .map((element) => {
      // <address> often holds contact details too; keep only the postal lines.
      const clone = $(element).clone();
      clone.find("a[href^='tel:' i], a[href^='mailto:' i]").remove();
      return visibleLines(clone)
        .map(postalPart)
        .filter((line) => line.length > 0)
        .join(" ");
    })
    .filter((text) => hasComparableAddress(text, true));

  const labelledPairs = labelValuePairs($, body).filter((text) => hasComparableAddress(text));

  return [...lines, ...addressBlocks, ...addressElements, ...labelledPairs].map(addressTokens);
}

const unspacedScript = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

function addressWordMatches(word: string, pageToken: string): boolean {
  // "#100" is the same unit as "Suite 100", "Unit 100" or "Apt 100", but not as "Room 100" or "Floor 100".
  if ((word === "#" || pageToken === "#") && hashUnitLabels.has(word) && hashUnitLabels.has(pageToken)) {
    return true;
  }

  // Scripts written without spaces (such as CJK) arrive as long runs, so match their words inside page tokens.
  return pageToken === word || (unspacedScript.test(word) && pageToken.includes(word));
}

function isHouseNumber(token: string): boolean {
  // Ordinals such as "5th" are part of a street name, not a house number.
  return /^\d/.test(token) && /^[\x00-\x7f]+$/.test(token) && !/^\d+(?:st|nd|rd|th)$/.test(token);
}

// A number after these words names the road ("Highway 66"), not the house.
const numberedRoadWords = new Set(["highway", "route", "interstate", "freeway", "expressway", "motorway", "us", "sr", "cr", "fm", "rr"]);

// "County Road 12" and "State Street 5" style designators: a number after road or route here names the road.
const numberedRoadQualifiers = new Set(["county", "state", "farm", "ranch", "forest", "township", "parish", "provincial"]);

// Street types written before the name ("Calle 12", "Rue 5"): a number right after them can be the street's name.
const prefixStreetWords = new Set(["rue", "avenue", "chemin", "impasse", "quai", "via", "viale", "piazza", "corso", "calle", "carrer", "carrera", "plaza", "paseo", "rua", "travessa"]);

function isRoadNumber(tokens: string[], index: number, leadingNumber: boolean): boolean {
  // After a leading house number ("100 Road 12", "100 Calle 12"), a number after road, route or a prefix street type can only name the street.
  return (
    numberedRoadWords.has(tokens[index - 1]) ||
    (["road", "route"].includes(tokens[index - 1]) && (leadingNumber || numberedRoadQualifiers.has(tokens[index - 2]))) ||
    (leadingNumber && index === 2 && prefixStreetWords.has(tokens[1]))
  );
}

const hashUnitLabels = new Set(["#", "suite", "unit", "apartment"]);

const subAddressLabels = new Set(["#", "floor", "suite", "room", "unit", "apartment", "building", "kat", "daire", "blok", "etage", "stock", "piso"]);

type AddressToken = { token: string; segment: number };

function matchesAt(group: string[], region: string[], start: number): boolean {
  return group.every((token, offset) => addressWordMatches(token, region[start + offset] ?? ""));
}

function containsInOrder(rest: AddressToken[], region: string[]): boolean {
  // A sub-address label and everything after it in the same comma-separated part ("Suite A-1") must appear together,
  // so its identifier cannot be assembled from other numbers on the page. Other parts only need to appear in order.
  const groups: string[][] = [];
  rest.forEach(({ token, segment }, index) => {
    const previous = rest[index - 1];
    if (!subAddressLabels.has(token) && previous && previous.segment === segment && subAddressLabels.has(groups.at(-1)?.[0] ?? "")) {
      groups.at(-1)?.push(token);
    } else {
      groups.push([token]);
    }
  });

  let position = 0;
  return groups.every((group) => {
    while (position + group.length <= region.length && !matchesAt(group, region, position)) {
      position += 1;
    }

    position += group.length;
    return position <= region.length;
  });
}

const addressLabelTokens = new Set(["address", "adres", "adresse", "anschrift", "direccion", "dirección", "indirizzo"]);

// A house number (not a unit number) followed within a few words by a street type starts another street address.
function isAddressStart(region: string[], index: number): boolean {
  if (!isHouseNumber(region[index]) || subAddressLabels.has(region[index - 1])) {
    return false;
  }

  // Prefix-style streets ("99 Calle 15", "14 Rue de Rivoli") put the street type right after the number.
  if (prefixStreetWords.has(region[index + 1])) {
    return true;
  }

  for (let offset = index + 1; offset < Math.min(region.length, index + 7); offset += 1) {
    if (streetTypes.has(region[offset])) {
      return true;
    }
    if (isHouseNumber(region[offset])) {
      return false;
    }
  }

  return false;
}

function streetAddressVisible(streetAddress: string, regions: string[][]): boolean {
  const parts: AddressToken[] = streetAddress
    .split(/[,;\n]/)
    .flatMap((part, segment) => addressTokens(part).map((token) => ({ token, segment })));
  const tokens = parts.map(({ token }) => token);
  if (tokens.length === 0) {
    return true;
  }

  // Split "12 Main Street, Floor 2" or "Main Street 12, Floor 2" into house number, street words and the rest.
  const leadingNumber = isHouseNumber(tokens[0]);
  const wordsStart = leadingNumber ? 1 : 0;
  let wordsEnd = wordsStart;
  while (
    wordsEnd < tokens.length &&
    !subAddressLabels.has(tokens[wordsEnd]) &&
    (!isHouseNumber(tokens[wordsEnd]) || (wordsEnd > wordsStart && isRoadNumber(tokens, wordsEnd, leadingNumber)))
  ) {
    wordsEnd += 1;
  }

  const words = tokens.slice(wordsStart, wordsEnd);
  const trailingNumber = !leadingNumber && wordsEnd < tokens.length && isHouseNumber(tokens[wordsEnd]);
  const houseNumber = leadingNumber ? tokens[0] : trailingNumber ? tokens[wordsEnd] : undefined;
  const rest = parts.slice(trailingNumber ? wordsEnd + 1 : wordsEnd);

  return regions.some((region) => {
    // Remaining parts (floor, suite, room) must appear in the same order so their identifiers stay with their labels.
    if (words.length === 0) {
      return containsInOrder(rest, region) && (houseNumber === undefined || region.includes(houseNumber));
    }

    // The street words must appear together and in order, with the house number directly before or after them.
    for (let start = 0; start + words.length <= region.length; start += 1) {
      if (!matchesAt(words, region, start)) {
        continue;
      }

      const end = start + words.length - 1;
      if (houseNumber !== undefined && region[start - 1] !== houseNumber && region[end + 1] !== houseNumber) {
        continue;
      }

      // The rest must belong to this street's address, not to another address on the same line: stop at the next
      // address label or street address, and only look before the street when no other address precedes it.
      const ownStart = leadingNumber && region[start - 1] === houseNumber ? start - 1 : start;
      let label = ownStart - 1;
      while (label >= 0 && !addressLabelTokens.has(region[label])) {
        label -= 1;
      }
      const precededByAddress = region.some((_, index) => index > label && index < ownStart && isAddressStart(region, index));
      const from = precededByAddress ? ownStart : label + 1;
      const next = region.findIndex(
        (token, index) => index > end && (addressLabelTokens.has(token) || (index > end + 1 && isAddressStart(region, index)))
      );
      if (containsInOrder(rest, region.slice(from, next === -1 ? region.length : next))) {
        return true;
      }
    }

    return false;
  });
}

// As with the contact fields, the business's telephone and address may sit on any node sharing its @id.
function localBusinessNapMismatches($: CheerioAPI, snapshot: PageSnapshot): string[] {
  const nodes = localBusinessNodes($);
  if (nodes.length === 0) {
    return [];
  }

  const index = jsonLdIndex($);
  const base = documentBase($, snapshot);
  const nodesById = jsonLdNodesById($, base);
  const body = visibleBody($);
  const regions = visibleAddressRegions($, body);
  const mismatches: string[] = [];

  for (const node of nodes) {
    const fragments = nodeFragments(node, nodesById, base);
    const fragmentCountry = fragments.map((fragment) => schemaCountry(fragment, index)).find((code) => code !== undefined);
    for (const telephone of fragments.flatMap((fragment) => stringValues(fragment.telephone))) {
      const country = fragmentCountry ?? parsePhoneNumberFromString(telephone.trim())?.country;
      const phones = visiblePhones($, body, country);
      if (phones.length === 0) {
        continue;
      }

      const visibleList = phones.map((phone) => phone.display).join(", ");
      const schemaPhone = parsedPhone(telephone, country);
      if (!schemaPhone) {
        // Without a country, a national-format schema number cannot be judged invalid.
        if (country || telephone.trim().startsWith("+")) {
          mismatches.push(`Schema telephone ${telephone.trim()} is not a valid phone number; visible phone numbers: ${visibleList}`);
        }
      } else if (!phones.some((phone) => samePhone(phone, schemaPhone))) {
        mismatches.push(`Schema telephone ${telephone.trim()} not found among visible phone numbers: ${visibleList}`);
      }
    }

    if (regions.length > 0) {
      for (const streetAddress of fragments.flatMap((fragment) => streetAddresses(fragment, index))) {
        if (!streetAddressVisible(streetAddress, regions)) {
          mismatches.push(`Schema streetAddress "${streetAddress.trim()}" not found in visible page text`);
        }
      }
    }
  }

  return Array.from(new Set(mismatches));
}

function hasOrganizationSchema($: CheerioAPI): boolean {
  return hasJsonLdType($, (type) => type === "Organization" || type.endsWith("Organization"));
}

function hasVisibleAddress(text: string): boolean {
  return /\b(address|street|avenue|road|suite|floor|cadde|caddesi|sokak|mahalle|no:?)\b/i.test(text);
}

function hasOpeningHours(text: string): boolean {
  return /\b(opening hours|hours|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon-fri|mo-fr|\d{1,2}:\d{2})\b/i.test(
    text
  );
}

const serviceWord = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:services?|clinic|dental|dentists?|dentistry|orthodontists?|salon|restaurant|repairs?|legal|appointments?|booking|consultations?|gym|fitness|hotels?|solicitors?|lawyers?|attorneys?|law\s+firm|plumbers?|plumbing|electricians?|hair\p{L}*|barbers?|beauty|physio\p{L}*|massage|spa|caf[eé]|bakery|vets?|veterinary|accountants?|accountancy|cleaning|builders?|roofing|garage|mechanics?|opticians?|pharmacy|zahnarzt\p{L}*|praxis|friseur\p{L}*|\p{L}*anwalt\p{L}*|kanzlei|klini[kğ]\p{L}*|diş|kuaför|avukat\p{L}*|hizmet\p{L}*)(?![\p{L}\p{N}])`,
  "iu"
);
const locationWord =
  /(?<![\p{L}\p{N}])(?:[iİ]stanbul|ankara|[iİ]zmir|bursa|antalya|kad[iı]k[oö]y|nearby|neighbou?rhood|service area|located in|serves)(?![\p{L}\p{N}])/iu;
// "Family dentist in Leeds", "Plumbers serving Greater Manchester". The place is read case-sensitively below,
// because \p{Lu} also matches lowercase letters under the i flag.
const placePhrase = /(?<![\p{L}\p{N}])(?:in|near|serving|across|around|covering)\s+(?:the\s+)?([\p{L}'’-]+)/giu;
// Capitalized words after "in" or "near" that are not places ("Get in Touch", "Dentist Near Me", "Zahnarzt in Ihrer Nähe").
const notPlaces = new Set(
  (
    "me you us touch person stock store our your their my this that these those all every each one english turkish german " +
    "french spanish ihrer ihrem ihren ihre unserer unserem minutes hours days weeks time advance addition case order " +
    "january february march april may june july august september october november december " +
    "monday tuesday wednesday thursday friday saturday sunday"
  ).split(" ")
);
const ukPostcode = /(?<![\p{L}\p{N}])[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}(?![\p{L}\p{N}])/u;
const usZipCode =
  /,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\s+\d{5}(?:-\d{4})?(?![\p{L}\p{N}])/u;
// Five-digit postal code before the town, as in Germany, France, Spain, Italy and Turkey ("80331 München").
const postcodeTown = /(?<![\p{L}\p{N}])\d{5}\s+\p{Lu}\p{Ll}/u;

function hasServiceNearPlace(text: string): boolean {
  return Array.from(text.matchAll(placePhrase)).some((match) => {
    const place = match[1];
    const before = text.slice(0, match.index).split(/\s+/).slice(-6).join(" ");
    return /^\p{Lu}/u.test(place) && !notPlaces.has(place.toLowerCase()) && serviceWord.test(before);
  });
}

function hasVisibleSchemaLocality($: CheerioAPI, text: string): boolean {
  const index = jsonLdIndex($);
  return localBusinessNodes($)
    .flatMap((node) => schemaAddresses(node, index))
    .filter(hasObjectField)
    .flatMap((address) => stringValues((address as JsonLdNode).addressLocality))
    .some((locality) =>
      new RegExp(String.raw`(?<![\p{L}\p{N}])${locality.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\p{L}\p{N}])`, "iu").test(text)
    );
}

function hasServiceLocationCopy($: CheerioAPI, text: string): boolean {
  if (serviceWord.test(text) && locationWord.test(text)) {
    return true;
  }

  // Any country: a service named next to a place, or a service with a visible postcode, street address, or LocalBusiness town.
  // Visible text keeps block boundaries, which body text joins ("Kliniğiİzmir").
  const body = visibleBody($);
  const visibleText = collapsedText(body);
  return (
    hasServiceNearPlace(visibleText) ||
    (serviceWord.test(visibleText) &&
      (locationWord.test(visibleText) ||
        ukPostcode.test(visibleText) ||
        usZipCode.test(visibleText) ||
        postcodeTown.test(visibleText) ||
        hasVisibleSchemaLocality($, visibleText) ||
        visibleAddressRegions($, body).length > 0))
  );
}

function hasPrimaryCta($: CheerioAPI): boolean {
  return $("a, button")
    .toArray()
    .some((element) => {
      const href = $(element).attr("href") ?? "";
      const text = $(element).text();
      return /book|booking|appointment|schedule|reserve|contact|get-?quote/i.test(`${href} ${text}`);
    });
}

function hasPlaceholderCopy(text: string): boolean {
  return /\b(lorem ipsum|coming soon|under construction|placeholder|sample text)\b/i.test(text);
}

function hasCurrentDateSignals($: CheerioAPI, currentYear = new Date().getFullYear()): boolean {
  const candidateText = $("footer, [class*='footer' i], [id*='footer' i]")
    .toArray()
    .map((element) => $(element).text())
    .join(" ");
  const scopedText = candidateText || $("body").text();
  const dateCuePattern =
    /(?:copyright|copy|all rights reserved|last updated|updated|since)[^0-9]{0,30}((?:19|20)\d{2})(?:\s*-\s*((?:19|20)\d{2}))?/gi;
  const matches = Array.from(scopedText.matchAll(dateCuePattern));

  if (matches.length === 0) {
    return true;
  }

  return matches.some((match) => {
    const startYear = Number(match[1]);
    const endYear = match[2] ? Number(match[2]) : startYear;
    return Math.max(startYear, endYear) >= currentYear;
  });
}

function dateSignalEvidence($: CheerioAPI): string {
  const text = $("footer, [class*='footer' i], [id*='footer' i]").text() || $("body").text();
  const match = text.match(
    /(?:copyright|copy|all rights reserved|last updated|updated|since)[^0-9]{0,30}(?:19|20)\d{2}(?:\s*-\s*(?:19|20)\d{2})?/i
  );
  return match?.[0].replace(/\s+/g, " ").trim() ?? "No current date or copyright signal found";
}

function hasReviewCue(text: string): boolean {
  return /\b(review|reviews|testimonial|testimonials|rating|rated|stars?|google reviews?)\b/i.test(text);
}

function hasServiceDetailDepth($: CheerioAPI): boolean {
  return $("section, article, main, div")
    .toArray()
    .some((element) => {
      const headingText = $(element).find("h2, h3").first().text();
      if (!/\b(services?|treatments?|repairs?|menu|solutions?)\b/i.test(headingText)) {
        return false;
      }

      const itemCount = $(element).find("li").length;
      const words = $(element).text().trim().split(/\s+/).filter(Boolean).length;
      return itemCount >= 3 || words >= 35;
    });
}

function hasBrandIcons($: CheerioAPI): boolean {
  const relValues = $("link[rel]")
    .toArray()
    .map((element) => ($(element).attr("rel") ?? "").toLowerCase());
  const hasFavicon = relValues.some((rel) => /\b(?:shortcut\s+)?icon\b/.test(rel));
  const hasTouchIcon = relValues.some((rel) => /\bapple-touch-icon\b/.test(rel));

  return hasFavicon && hasTouchIcon;
}

function isPlaceholderSocialHref(href: string): boolean {
  if (!href.trim() || href.trim() === "#") {
    return false;
  }

  let url: URL;
  try {
    url = new URL(href, "https://example.test");
  } catch {
    return false;
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const socialHosts = [
    "facebook.com",
    "instagram.com",
    "linkedin.com",
    "tiktok.com",
    "twitter.com",
    "x.com",
    "youtube.com"
  ];

  if (!socialHosts.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    return false;
  }

  const segments = url.pathname
    .split("/")
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean);
  const placeholderSegments = new Set([
    "yourbusiness",
    "your-business",
    "your_company",
    "yourcompany",
    "username",
    "yourusername",
    "handle",
    "placeholder"
  ]);

  return segments.some((segment) => placeholderSegments.has(segment));
}

const SEARCH_CRAWLERS = new Set(["robots", "googlebot"]);
const PARAMETER_DIRECTIVES = new Set(["unavailable_after", "max-snippet", "max-image-preview", "max-video-preview"]);

function blocksIndexing(directives: string): boolean {
  return directives
    .split(",")
    .some((directive) => ["noindex", "none"].includes(directive.trim().toLowerCase()));
}

function robotsHeaderBlocksIndexing(value: string): boolean {
  let crawler = "robots";
  return value.split(",").some((part) => {
    let directive = part.trim();
    const prefixed = /^([\w-]+)\s*:\s*(.*)$/.exec(directive);
    if (prefixed && !PARAMETER_DIRECTIVES.has(prefixed[1].toLowerCase())) {
      crawler = prefixed[1].toLowerCase();
      directive = prefixed[2];
    }
    return SEARCH_CRAWLERS.has(crawler) && blocksIndexing(directive);
  });
}

type RobotsPolicy = {
  isAllowed: (url: string, userAgent: string) => boolean | undefined;
  getMatchingLineNumber: (url: string, userAgent: string) => number;
};
const robotsParser = createRequire(import.meta.url)("robots-parser") as (url: string, contents: string) => RobotsPolicy;

// Googlebot follows the group that names it, or the "*" group when there is none, as robots-parser does.
function robotsTxtBlock(snapshot: PageSnapshot): string | undefined {
  const robots = snapshot.resources?.robotsTxt;
  if (!robots?.content || !hasSuccessfulResource(robots.statusCode)) {
    return undefined;
  }
  const policy = robotsParser(new URL("/robots.txt", snapshot.finalUrl).toString(), robots.content);
  if (policy.isAllowed(snapshot.finalUrl, "Googlebot") !== false) {
    return undefined;
  }
  const lineNumber = policy.getMatchingLineNumber(snapshot.finalUrl, "Googlebot");
  // Split lines the way robots-parser numbers them, including bare CR line endings.
  const line = robots.content.split(/\r\n|\r|\n/)[lineNumber - 1]?.trim();
  return `robots.txt blocks Googlebot from ${snapshot.finalUrl}${line ? ` (line ${lineNumber}: ${line})` : ""}`;
}

function noindexSignals($: CheerioAPI, snapshot: PageSnapshot): string[] {
  const signals = $("meta[name][content]")
    .toArray()
    .flatMap((element) => {
      const name = ($(element).attr("name") ?? "").trim().toLowerCase();
      const content = ($(element).attr("content") ?? "").trim();
      return SEARCH_CRAWLERS.has(name) && blocksIndexing(content) ? [`meta ${name}: ${content}`] : [];
    });
  const header = snapshot.headers["x-robots-tag"];
  if (header && robotsHeaderBlocksIndexing(header)) {
    signals.push(`X-Robots-Tag: ${header}`);
  }
  return signals;
}

function mixedContentUrls($: CheerioAPI, snapshot: PageSnapshot): string[] {
  if (!snapshot.finalUrl.startsWith("https://")) {
    return [];
  }

  const values = [
    ...$("script[src], iframe[src], img[src], audio[src], video[src], source[src], track[src], embed[src]")
      .toArray()
      .map((element) => $(element).attr("src")),
    ...$("object[data]")
      .toArray()
      .map((element) => $(element).attr("data")),
    ...$("link[href]")
      .toArray()
      .filter((element) => /(^|\s)(stylesheet|icon)(\s|$)/i.test($(element).attr("rel") ?? ""))
      .map((element) => $(element).attr("href")),
    ...$("img[srcset], source[srcset]")
      .toArray()
      .flatMap((element) => ($(element).attr("srcset") ?? "").split(",").map((candidate) => candidate.trim().split(/\s+/)[0]))
  ];
  const urls = new Set<string>();
  for (const value of values) {
    try {
      const url = new URL(value?.trim() ?? "", snapshot.finalUrl);
      if (url.protocol === "http:") {
        urls.add(url.toString());
      }
    } catch {
      continue;
    }
  }
  return Array.from(urls);
}

// Let's Encrypt and most automated issuers renew at 30 days left, so fewer than 14 means automatic renewal is failing.
const certificateWarningDays = 14;

// A month's notice leaves time to fix a failed renewal; healthy domains that renew in their final weeks can show here too.
const domainWarningDays = 30;
const lapsingDomainStatus = /^(?:redemption ?period|pending ?delete)$/i;

function domainRiskStatus(domain: NonNullable<PageSnapshot["domain"]>): string | undefined {
  return domain.status.find((status) => lapsingDomainStatus.test(status.trim())) ??
    (domain.daysRemaining < domainWarningDays ? "expiring" : undefined);
}

function domainEvidence(domain: NonNullable<PageSnapshot["domain"]>): string {
  const date = domain.expiresAt.slice(0, 10);
  const days = domain.daysRemaining;
  const expiry = days < 0 ? `${domain.name} expired ${date}` : `${domain.name} expires ${date} (${days} day${days === 1 ? "" : "s"})`;
  const risk = domainRiskStatus(domain);
  return [expiry, ...(risk && risk !== "expiring" ? [`status: ${risk}`] : []), ...(domain.registrar ? [`registrar ${domain.registrar}`] : [])].join(
    "; "
  );
}

function tlsCertificateEvidence(tls: NonNullable<PageSnapshot["tls"]>): string {
  const date = tls.validTo.slice(0, 10);
  const status =
    tls.daysRemaining < 0
      ? `Certificate expired ${date}`
      : !tls.authorized
        ? `Certificate not trusted: ${tls.error ?? "unknown reason"}`
        : `Certificate expires ${date} (${tls.daysRemaining} day${tls.daysRemaining === 1 ? "" : "s"})`;
  return tls.issuer ? `${status}; issuer ${tls.issuer}` : status;
}

const languageCode = /^[a-z]{2,3}(?:-[a-z0-9]{1,8})*$/i;

function htmlLangEvidence($: CheerioAPI): string | undefined {
  const attribute = $("html").attr("lang");
  const lang = (attribute ?? "").trim();
  if (!lang) {
    return attribute === undefined ? "No lang attribute on the <html> element" : "The lang attribute on the <html> element is empty";
  }
  return languageCode.test(lang) ? undefined : `lang="${lang}" is not a valid language code`;
}

const unlabelledInputTypes = new Set(["hidden", "submit", "button", "reset", "image"]);

function textOf($: CheerioAPI, element: Parameters<CheerioAPI>[0]): string {
  const copy = $(element).clone();
  copy.find("input, select, textarea").remove();
  return copy.text().replace(/\s+/g, " ").trim();
}

function hasAccessibleName($: CheerioAPI, element: Parameters<CheerioAPI>[0]): boolean {
  const control = $(element);
  const ids = (control.attr("aria-labelledby") ?? "").split(/\s+/).filter(Boolean);
  if (ids.some((id) => $("[id]").toArray().some((target) => $(target).attr("id") === id && textOf($, target)))) {
    return true;
  }
  if (["aria-label", "title", "placeholder"].some((name) => (control.attr(name) ?? "").trim())) {
    return true;
  }
  const id = control.attr("id");
  const labels = [
    ...control.closest("label").toArray(),
    ...(id ? $("label[for]").toArray().filter((label) => $(label).attr("for") === id) : [])
  ];
  return labels.some((label) => textOf($, label));
}

function describeControl($: CheerioAPI, element: Parameters<CheerioAPI>[0]): string {
  const control = $(element);
  const tag = (element as { tagName?: string }).tagName?.toLowerCase() ?? "input";
  const type = control.attr("type");
  const name = control.attr("name");
  const id = control.attr("id");
  return `${tag}${type ? `[type=${type}]` : ""}${name ? `[name=${name}]` : id ? `#${id}` : ""}`;
}

function formFields($: CheerioAPI): { total: number; unlabelled: string[] } {
  const fields = visibleBody($)
    .find("input, select, textarea")
    .toArray()
    // Fields under aria-hidden, such as the off-screen Mailchimp spam trap, are not exposed to assistive technology.
    .filter(
      (element) =>
        !unlabelledInputTypes.has(($(element).attr("type") ?? "").trim().toLowerCase()) && $(element).closest('[aria-hidden="true"]').length === 0
    );
  const unlabelled = fields.filter((element) => !hasAccessibleName($, element)).map((element) => describeControl($, element));
  return { total: fields.length, unlabelled };
}

// Lighthouse's English list of non-descriptive link text, plus "continue reading", "find out more", and common Turkish and German equivalents.
const genericLinkText = new Set([
  "click here",
  "click this",
  "go",
  "here",
  "information",
  "learn more",
  "more",
  "more info",
  "more information",
  "right here",
  "read more",
  "see more",
  "start",
  "this",
  "continue reading",
  "find out more",
  "buraya tıklayın",
  "buraya tıkla",
  "tıklayın",
  "tıkla",
  "devamı",
  "devamını oku",
  "daha fazla",
  "detaylar",
  "ayrıntılar",
  "hier",
  "hier klicken",
  "mehr",
  "mehr erfahren",
  "mehr lesen",
  "weiterlesen"
]);

function genericLinks($: CheerioAPI): string[] {
  return visibleBody($)
    .find("a[href]")
    .toArray()
    .flatMap((element) => {
      const link = $(element);
      const href = (link.attr("href") ?? "").trim();
      if (!href || href.startsWith("#") || /^javascript:/i.test(href) || link.attr("aria-labelledby")) {
        return [];
      }
      const label = (link.attr("aria-label") ?? "").trim() ||
        [link.text(), ...link.find("img[alt]").toArray().map((image) => $(image).attr("alt") ?? "")].join(" ");
      const shown = label.replace(/\s+/g, " ").trim();
      const key = shown.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
      return genericLinkText.has(key) ? [`"${shown}" (${href})`] : [];
    });
}

function firstFive(items: string[]): string {
  return [...items.slice(0, 5), ...(items.length > 5 ? [`and ${items.length - 5} more`] : [])].join("; ");
}

const trackers: Array<[string, RegExp]> = [
  [
    "Google Analytics or Ads",
    /googletagmanager\.com\/gtag\/js|google-analytics\.com\/(?:analytics|ga|urchin)\.js|\bgtag\(\s*['"]config['"]|\bga\(\s*['"]create['"]/i
  ],
  ["Google Tag Manager", /googletagmanager\.com\/gtm\.js/i],
  ["Meta Pixel", /connect\.facebook\.net\/[\w-]+\/fbevents\.js|\bfbq\(\s*['"]init['"]/i],
  ["Hotjar", /static\.hotjar\.com|\b_hjSettings\b/i],
  ["Microsoft Clarity", /clarity\.ms\/tag/i],
  ["LinkedIn Insight Tag", /snap\.licdn\.com\/li\.lms-analytics|\b_linkedin_partner_id\b/i],
  ["TikTok Pixel", /analytics\.tiktok\.com/i],
  ["Microsoft Advertising", /bat\.bing\.com\/bat\.js/i]
];

const trackingCookie = /^(?:_ga(?:_\w+)?|_gid|_gat(?:_\w+)?|_gcl_\w+|_fbp|_fbc|_hj\w+|_clck|_clsk|_uetsid|_uetvid|_ttp|li_fat_id)$/;

// Consent platforms, IAB TCF, Google consent mode defaults, website-builder banners, and common cookie banner markup.
// Matching is deliberately broad: a page that shows any sign of a consent step is not flagged.
const consentTool =
  /cookiebot|cookielaw\.org|onetrust|optanon|cookieyes|cookie-law-info|termly\.io|iubenda|complianz|cmplz|osano|usercentrics|cmp\.quantcast\.com|__tcfapi|didomi|cookiefirst|cookie-script\.com|civiccomputing|cookiecontrol|borlabs|klaro|real-cookie-banner|moove[_-]gdpr|cookie[_-]?(?:notice|consent|banner|bar|law)|consent[_-]?(?:banner|manager)|cookiehub|axeptio|tarteaucitron|trustarc|consentmanager|gdpr[_-]?cookie|cc-window|cc-banner|sqs-cookie-banner|\bfs-cc\b|fundingchoicesmessages\.google\.com|hs-banner|hs-eu-cookie|consentPolicy|customerPrivacy|\bgtag\(\s*['"]consent['"]\s*,\s*['"]default['"]/i;

// Consent tools hold tags back as type="text/plain" until visitors accept, and data or template blocks never run.
// Any other type counts, including the types that optimisers such as Rocket Loader ("<hash>-text/javascript"),
// LiteSpeed ("litespeed/javascript"), WP Rocket ("rocketlazyloadscript"), and Partytown use for scripts they run later.
const inertScriptType = /^text\/plain$|json|importmap|speculationrules|template|^text\/html$|handlebars|mustache/;

function loadedTrackers($: CheerioAPI): string[] {
  const scripts = $("script")
    .toArray()
    // Only the MIME type counts, so "text/plain; charset=utf-8" is inert too.
    .filter((element) => !inertScriptType.test(($(element).attr("type") ?? "").split(";")[0].trim().toLowerCase()))
    .map((element) => `${$(element).attr("src") ?? ""} ${$(element).text()}`)
    .join("\n");
  return trackers.filter(([, pattern]) => pattern.test(scripts)).map(([name]) => name);
}

function serverTrackingCookies(snapshot: PageSnapshot): string[] {
  return Array.from(new Set(cookieNames(snapshot.headers["set-cookie"]).filter((name) => trackingCookie.test(name))));
}

function hasConsentTool(snapshot: PageSnapshot): boolean {
  return consentTool.test(snapshot.html);
}

function consentEvidence($: CheerioAPI, snapshot: PageSnapshot): string {
  const names = loadedTrackers($);
  const cookies = serverTrackingCookies(snapshot);
  const scripts = names.length > 0 ? `${names.join(", ")} ${names.length === 1 ? "loads" : "load"} with no consent tool found` : "No consent tool found";
  return cookies.length > 0 ? `${scripts}; tracking cookies set by the server: ${cookies.join(", ")}` : scripts;
}

const privacyLinkText =
  /privacy|privacidad|privacit|gizlilik|kvkk|kişisel veri|datenschutz|confidentialit|données personnelles|protección de datos|data protection|gdpr|privacybeleid|privacyverklaring/i;
const privacyLinkPath = /privacy|privacidad|gizlilik|kvkk|aydinlatma|datenschutz|confidentialit|gdpr|data-protection/i;
const privacyPolicyHosts = ["iubenda.com", "termly.io", "privacypolicies.com", "freeprivacypolicy.com"];

function bareHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

function onHost(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

// The URL parser keeps percent sequences that do not decode, such as "/20%-off", so fall back to the raw path.
function decodedPath(url: URL): string {
  try {
    return decodeURIComponent(url.pathname);
  } catch {
    return url.pathname;
  }
}

function hasPrivacyPolicyLink($: CheerioAPI, snapshot: PageSnapshot): boolean {
  if ($("[rel~='privacy-policy'][href]").length > 0) {
    return true;
  }
  let pageHost: string | undefined;
  try {
    pageHost = bareHost(new URL(snapshot.finalUrl).hostname);
  } catch {
    pageHost = undefined;
  }
  return $("a[href]")
    .toArray()
    .some((element) => {
      let url: URL;
      try {
        url = new URL(($(element).attr("href") ?? "").trim(), snapshot.finalUrl);
      } catch {
        return false;
      }
      const host = bareHost(url.hostname);
      const ownSite = pageHost !== undefined && (onHost(host, pageHost) || onHost(pageHost, host));
      if (!/^https?:$/.test(url.protocol) || !(ownSite || privacyPolicyHosts.some((domain) => onHost(host, domain)))) {
        return false;
      }
      return privacyLinkText.test($(element).text()) || privacyLinkPath.test(decodedPath(url));
    });
}

function privacyEvidence($: CheerioAPI, snapshot: PageSnapshot): string {
  const names = loadedTrackers($);
  const context = [
    ...(detectPageForms($, snapshot.finalUrl).enquiryForm ? ["has an enquiry form"] : []),
    ...(names.length > 0 ? [`loads ${names.join(", ")}`] : [])
  ];
  return `No privacy policy link found${context.length > 0 ? `; the page ${context.join(" and ")}` : ""}`;
}

function hasPlaceholderSocialLinks($: CheerioAPI): boolean {
  return $("a")
    .toArray()
    .some((element) => isPlaceholderSocialHref($(element).attr("href") ?? ""));
}

const rules: Rule[] = [
  {
    id: "http-status-ok",
    title: "Page does not return a successful HTTP status",
    category: "technical-health",
    severity: "high",
    source: "HTTP status",
    recommendation: "Return a 2xx status for the audited page before investing in content or SEO work.",
    check: ({ snapshot }) => snapshot.statusCode >= 200 && snapshot.statusCode < 300,
    evidence: ({ snapshot }) => `${snapshot.statusCode}`
  },
  {
    id: "https-enabled",
    title: "Final URL is not HTTPS",
    category: "technical-health",
    severity: "high",
    source: "Final URL",
    recommendation: "Serve the public site over HTTPS and redirect plain HTTP traffic to the secure URL.",
    check: ({ snapshot }) => snapshot.finalUrl.startsWith("https://"),
    evidence: ({ snapshot }) => snapshot.finalUrl
  },
  {
    id: "tls-certificate-valid",
    title: "HTTPS certificate is invalid or about to expire",
    category: "technical-health",
    severity: "high",
    source: "TLS certificate",
    recommendation:
      "Renew or fix the site's HTTPS certificate so visitors do not see a security warning, and turn on automatic renewal with your host.",
    check: ({ snapshot }) =>
      !snapshot.tls || (snapshot.tls.authorized && snapshot.tls.daysRemaining >= certificateWarningDays),
    evidence: ({ snapshot }) => (snapshot.tls ? tlsCertificateEvidence(snapshot.tls) : "")
  },
  {
    id: "domain-expiry",
    title: "Domain registration is expiring or has lapsed",
    category: "technical-health",
    severity: "medium",
    source: "Domain registration",
    recommendation:
      "Check with your domain registrar that the domain renews automatically and the payment details on file are current; if the domain lapses, the website and email stop working.",
    check: ({ snapshot }) => !snapshot.domain || domainRiskStatus(snapshot.domain) === undefined,
    evidence: ({ snapshot }) => (snapshot.domain ? domainEvidence(snapshot.domain) : "")
  },
  {
    id: "page-indexable",
    title: "Page tells search engines not to index it",
    category: "search-basics",
    severity: "high",
    source: "Robots directives",
    recommendation: "Remove the noindex directive from the page and its X-Robots-Tag header so the page can appear in search results.",
    check: ({ $, snapshot }) => noindexSignals($, snapshot).length === 0,
    evidence: ({ $, snapshot }) => noindexSignals($, snapshot).join("; ")
  },
  {
    id: "robots-txt-allows-page",
    title: "robots.txt blocks search engines from this page",
    category: "search-basics",
    severity: "high",
    source: "robots.txt",
    recommendation:
      "Remove or narrow the robots.txt Disallow rule that matches this page so Google can crawl it and keep it in search results.",
    check: ({ snapshot }) => robotsTxtBlock(snapshot) === undefined,
    evidence: ({ snapshot }) => robotsTxtBlock(snapshot) ?? ""
  },
  {
    id: "mixed-content-absent",
    title: "Secure page loads files over plain HTTP",
    category: "technical-health",
    severity: "medium",
    source: "Page resources",
    recommendation: "Load every script, stylesheet, image, and embed over HTTPS so browsers do not block them or mark the page as not fully secure.",
    check: ({ $, snapshot }) => mixedContentUrls($, snapshot).length === 0,
    evidence: ({ $, snapshot }) => {
      const urls = mixedContentUrls($, snapshot);
      return [...urls.slice(0, 5), ...(urls.length > 5 ? [`and ${urls.length - 5} more`] : [])].join("; ");
    }
  },
  {
    id: "title-present",
    title: "Page title is missing",
    category: "search-basics",
    severity: "medium",
    source: "HTML title",
    recommendation: "Add a clear title that includes the business name, service, and location where useful.",
    check: ({ $ }) => $("title").first().text().trim().length > 0,
    evidence: ({ $ }) => $("title").first().text().trim() || "Missing"
  },
  {
    id: "meta-description-present",
    title: "Meta description is missing",
    category: "search-basics",
    severity: "medium",
    source: "Meta description",
    recommendation: "Add a short owner-readable meta description that explains the service and location.",
    check: ({ $ }) => $('meta[name="description"]').attr("content")?.trim().length ? true : false,
    evidence: ({ $ }) => $('meta[name="description"]').attr("content")?.trim() || "Missing"
  },
  {
    id: "viewport-present",
    title: "Viewport tag is missing",
    category: "mobile-usability",
    severity: "high",
    source: "Viewport meta tag",
    recommendation: "Add a responsive viewport tag so mobile browsers render the page correctly.",
    check: ({ $ }) => $('meta[name="viewport"]').attr("content")?.trim().length ? true : false,
    evidence: ({ $ }) => $('meta[name="viewport"]').attr("content")?.trim() || "Missing"
  },
  {
    id: "single-h1",
    title: "Page should have one clear H1",
    category: "search-basics",
    severity: "medium",
    source: "H1 count",
    recommendation: "Use one visible H1 that clearly names the core service or business.",
    check: ({ $ }) => $("h1").length === 1 && $("h1").first().text().trim().length > 0,
    evidence: ({ $ }) => {
      const h1 = $("h1");
      if (h1.length !== 1) {
        return `${h1.length} H1 elements`;
      }

      // Image alt text is not visible text, so a logo-only H1 does not name the page.
      return h1.find("img").length > 0 ? "The only H1 has no text; it contains only an image" : "The only H1 has no text";
    }
  },
  {
    id: "canonical-present",
    title: "Canonical URL is missing",
    category: "search-basics",
    severity: "low",
    source: "Canonical link",
    recommendation: "Add a canonical link to reduce duplicate URL confusion.",
    check: ({ $ }) => $('link[rel="canonical"]').attr("href")?.trim().length ? true : false,
    evidence: ({ $ }) => $('link[rel="canonical"]').attr("href")?.trim() || "Missing"
  },
  {
    id: "open-graph-present",
    title: "Open Graph metadata is incomplete",
    category: "search-basics",
    severity: "low",
    source: "Open Graph metadata",
    recommendation: "Add og:title, og:description, and og:url so shared links have clear previews.",
    check: ({ $ }) =>
      Boolean(
        $('meta[property="og:title"]').attr("content")?.trim() &&
          $('meta[property="og:description"]').attr("content")?.trim() &&
          $('meta[property="og:url"]').attr("content")?.trim()
      ),
    evidence: ({ $ }) => {
      const missing = ["og:title", "og:description", "og:url"].filter(
        (property) => !$(`meta[property="${property}"]`).attr("content")?.trim()
      );
      return missing.length ? `Missing ${missing.join(", ")}` : "Complete";
    }
  },
  {
    id: "json-ld-valid",
    title: "JSON-LD structured data is invalid",
    category: "search-basics",
    severity: "medium",
    source: "JSON-LD",
    recommendation: "Fix invalid JSON-LD so structured data can be parsed by search engines.",
    check: ({ $ }) => !hasInvalidJsonLd($),
    evidence: () => "At least one application/ld+json script could not be parsed"
  },
  {
    id: "phone-link-present",
    title: "Phone action is missing",
    category: "trust-contact",
    severity: "high",
    source: "Contact links",
    recommendation: "Add a tappable phone link using the tel: format.",
    // Only a number visitors can see but cannot tap counts here; a page without any number gets phone-number-visible.
    check: ({ $, snapshot }) => hasLink($, (href) => href.toLowerCase().startsWith("tel:")) || shownPhoneNumbers($, snapshot).length === 0,
    evidence: ({ $, snapshot }) => `Shown as text without a tel: link: ${shownPhoneNumbers($, snapshot).slice(0, 3).join(", ")}`
  },
  {
    id: "phone-number-visible",
    title: "No phone number is shown",
    category: "trust-contact",
    severity: "medium",
    source: "Contact links",
    recommendation: "Show the business phone number on the page as a tappable phone link (tel:) if customers call the business.",
    check: ({ $, snapshot }) => hasLink($, (href) => href.toLowerCase().startsWith("tel:")) || shownPhoneNumbers($, snapshot).length > 0,
    evidence: () => "No phone number or tel: link found on the page"
  },
  {
    id: "email-link-present",
    title: "Email action is missing",
    category: "trust-contact",
    severity: "low",
    source: "Contact links",
    recommendation: "Add an email link if email is an expected contact path for the business.",
    check: ({ $ }) => hasLink($, (href) => href.toLowerCase().startsWith("mailto:")),
    evidence: () => "No mailto: link found"
  },
  {
    id: "whatsapp-link-present",
    title: "WhatsApp action is missing",
    category: "trust-contact",
    severity: "low",
    source: "Contact links",
    recommendation: "Add a WhatsApp action if customers commonly use WhatsApp for bookings or questions.",
    check: ({ $ }) => hasLink($, (href) => /wa\.me|whatsapp/i.test(href)),
    evidence: () => "No WhatsApp link found"
  },
  {
    id: "localbusiness-schema-present",
    title: "LocalBusiness structured data is missing",
    category: "search-basics",
    severity: "medium",
    source: "JSON-LD",
    recommendation: "Add LocalBusiness schema when the page represents a local business location.",
    check: ({ $ }) => localBusinessNodes($).length > 0,
    evidence: () => "No LocalBusiness JSON-LD type found"
  },
  {
    id: "localbusiness-schema-contact-fields",
    title: "LocalBusiness structured data is missing contact fields",
    category: "search-basics",
    severity: "medium",
    source: "JSON-LD",
    recommendation: "Add telephone, address, and openingHours or openingHoursSpecification fields to LocalBusiness schema.",
    check: ({ $, snapshot }) => hasLocalBusinessContactFields($, snapshot),
    evidence: () => "LocalBusiness schema is missing telephone, address, or opening hours"
  },
  {
    id: "localbusiness-schema-nap-consistency",
    title: "LocalBusiness structured data does not match the visible phone or address",
    category: "search-basics",
    severity: "medium",
    source: "JSON-LD",
    recommendation:
      "Make the LocalBusiness schema telephone and streetAddress match the phone number and address shown on the page, so search engines and customers see one consistent listing.",
    check: ({ $, snapshot }) => localBusinessNapMismatches($, snapshot).length === 0,
    evidence: ({ $, snapshot }) => localBusinessNapMismatches($, snapshot).join("; ")
  },
  {
    id: "organization-schema-present",
    title: "Organization structured data is missing",
    category: "search-basics",
    severity: "low",
    source: "JSON-LD",
    recommendation: "Add Organization schema with a clear name and customer contact point.",
    check: ({ $ }) => hasOrganizationSchema($),
    evidence: () => "No Organization JSON-LD type found"
  },
  {
    id: "visible-address-present",
    title: "Visible address details are missing",
    category: "trust-contact",
    severity: "medium",
    source: "Page text",
    recommendation: "Show a clear address or location cue on the page so customers can confirm where the business operates.",
    check: ({ text }) => hasVisibleAddress(text),
    evidence: () => "No address-like text found"
  },
  {
    id: "opening-hours-present",
    title: "Opening hours are missing",
    category: "trust-contact",
    severity: "low",
    source: "Page text",
    recommendation: "Show opening hours or appointment availability so visitors know when to contact the business.",
    check: ({ text }) => hasOpeningHours(text),
    evidence: () => "No opening-hours text found"
  },
  {
    id: "service-location-copy-present",
    title: "Service and location copy is unclear",
    category: "search-basics",
    severity: "medium",
    source: "Page text",
    recommendation: "Describe the main service and location or service area in plain language.",
    check: ({ $, text }) => hasServiceLocationCopy($, text),
    evidence: () => "No clear service-plus-location phrase found"
  },
  {
    id: "primary-cta-present",
    title: "Primary booking or contact CTA is missing",
    category: "trust-contact",
    severity: "medium",
    source: "CTA links",
    recommendation: "Add a clear booking, appointment, contact, or quote CTA near the main content.",
    check: ({ $ }) => hasPrimaryCta($),
    evidence: () => "No primary booking/contact CTA found"
  },
  {
    id: "contact-form-present",
    title: "No way to send an enquiry from the page",
    category: "trust-contact",
    severity: "medium",
    source: "Contact options",
    recommendation:
      "Add a short enquiry form or a clear link to a contact page so visitors who don't want to call can still reach you.",
    check: ({ $, snapshot }) =>
      detectPageForms($, snapshot.finalUrl).enquiryForm ||
      hasContactOrBookingLink($, snapshot.finalUrl) ||
      hasLink($, (href) => href.toLowerCase().startsWith("mailto:")),
    evidence: ({ $, snapshot }) =>
      `No enquiry form, contact page link, or email link${detectPageForms($, snapshot.finalUrl).newsletterForm ? "; only a newsletter signup form" : ""}`
  },
  {
    id: "privacy-policy-link-present",
    title: "Privacy policy link is missing",
    category: "trust-contact",
    severity: "medium",
    source: "Privacy links",
    recommendation:
      "Link to a privacy policy from every page, usually in the footer, explaining what personal data the site collects through forms, analytics, and cookies and how visitors can contact you about it.",
    check: ({ $, snapshot }) => hasPrivacyPolicyLink($, snapshot),
    evidence: ({ $, snapshot }) => privacyEvidence($, snapshot)
  },
  {
    id: "cookie-consent-present",
    title: "Tracking loads without a cookie consent tool",
    category: "trust-contact",
    severity: "medium",
    source: "Tracking and consent",
    recommendation:
      "Add a cookie consent banner that holds advertising and non-essential analytics tags until visitors accept, as UK and EU cookie rules (PECR and the ePrivacy Directive) generally expect, or remove trackers you do not use.",
    check: ({ $, snapshot }) =>
      (loadedTrackers($).length === 0 && serverTrackingCookies(snapshot).length === 0) || hasConsentTool(snapshot),
    evidence: ({ $, snapshot }) => consentEvidence($, snapshot)
  },
  {
    id: "placeholder-copy-absent",
    title: "Placeholder copy is still visible",
    category: "search-basics",
    severity: "medium",
    source: "Page text",
    recommendation: "Replace placeholder or coming-soon copy with real business-specific content.",
    check: ({ text }) => !hasPlaceholderCopy(text),
    evidence: () => "Placeholder or coming-soon copy found"
  },
  {
    id: "current-date-signals",
    title: "Date or copyright signal looks outdated",
    category: "trust-contact",
    severity: "low",
    source: "Page date signals",
    recommendation: "Update visible copyright or last-updated text so visitors see the business is active.",
    check: ({ $ }) => hasCurrentDateSignals($),
    evidence: ({ $ }) => dateSignalEvidence($)
  },
  {
    id: "review-cue-present",
    title: "Review or testimonial cue is missing",
    category: "trust-contact",
    severity: "low",
    source: "Page text",
    recommendation: "Add a visible review, rating, or testimonial cue when customer feedback is available.",
    check: ({ text }) => hasReviewCue(text),
    evidence: () => "No review, rating, or testimonial cue found"
  },
  {
    id: "service-detail-depth",
    title: "Service details are too shallow",
    category: "search-basics",
    severity: "medium",
    source: "Service content",
    recommendation: "Add a dedicated service section with several concrete services or treatments.",
    check: ({ $ }) => hasServiceDetailDepth($),
    evidence: () => "No detailed service section with at least three items found"
  },
  {
    id: "brand-icons-present",
    title: "Favicon or touch icon is missing",
    category: "technical-health",
    severity: "low",
    source: "Icon links",
    recommendation: "Add favicon and apple-touch-icon links so the site looks branded in browser tabs and saved shortcuts.",
    check: ({ $ }) => hasBrandIcons($),
    evidence: () => "Missing favicon or apple-touch-icon link"
  },
  {
    id: "placeholder-social-links",
    title: "Placeholder social profile link is visible",
    category: "trust-contact",
    severity: "medium",
    source: "Social links",
    recommendation: "Replace placeholder social profile URLs with real business profiles or remove them.",
    check: ({ $ }) => !hasPlaceholderSocialLinks($),
    evidence: () => "A social profile URL contains a placeholder handle"
  },
  {
    id: "redirect-chain-short",
    title: "Page is reached through a chain of redirects",
    category: "technical-health",
    severity: "low",
    source: "Redirect chain",
    recommendation: "Redirect old and plain HTTP URLs straight to the final page in one step so visitors and search engines skip the extra hops.",
    check: ({ snapshot }) => (snapshot.redirects?.length ?? 0) <= 1,
    evidence: ({ snapshot }) =>
      [...(snapshot.redirects ?? []).map((hop) => `${hop.url} (${hop.statusCode})`), snapshot.finalUrl].join(" -> ")
  },
  {
    id: "robots-txt-present",
    title: "robots.txt is missing or unavailable",
    category: "technical-health",
    severity: "low",
    source: "robots.txt",
    recommendation: "Publish a robots.txt file so crawlers can discover crawl guidance.",
    check: ({ snapshot }) => hasSuccessfulResource(snapshot.resources?.robotsTxt?.statusCode),
    evidence: ({ snapshot }) => `${snapshot.resources?.robotsTxt?.statusCode ?? "Not checked"}`
  },
  {
    id: "sitemap-xml-present",
    title: "sitemap.xml is missing or unavailable",
    category: "search-basics",
    severity: "medium",
    source: "sitemap.xml",
    recommendation: "Publish a sitemap.xml file so important pages are easier to discover.",
    check: ({ snapshot }) => hasSuccessfulResource(snapshot.resources?.sitemapXml?.statusCode),
    evidence: ({ snapshot }) => `${snapshot.resources?.sitemapXml?.statusCode ?? "Not checked"}`
  },
  {
    id: "map-link-present",
    title: "Map or directions link is missing",
    category: "trust-contact",
    severity: "medium",
    source: "Links",
    recommendation: "Add a map or directions link so visitors can confirm the business location quickly.",
    check: ({ $ }) => hasLink($, (href) => /google\.com\/maps|maps\.app\.goo\.gl|bing\.com\/maps|directions/i.test(href)),
    evidence: () => "No map or directions link found"
  },
  {
    id: "broken-internal-links",
    title: "Some internal links are broken",
    category: "technical-health",
    severity: "high",
    source: "Internal links",
    recommendation: "Fix or remove broken internal links so visitors and crawlers do not hit dead pages.",
    check: ({ snapshot }) =>
      !snapshot.internalLinks || snapshot.internalLinks.every((link) => link.statusCode > 0 && link.statusCode < 400),
    evidence: ({ snapshot }) => {
      const broken = snapshot.internalLinks?.filter((link) => link.statusCode === 0 || link.statusCode >= 400) ?? [];
      return broken.map((link) => `${link.statusCode} ${link.finalUrl}`).join("; ") || "No broken links";
    }
  },
  {
    id: "image-alt-coverage",
    title: "Some images are missing alt text",
    category: "mobile-usability",
    severity: "low",
    source: "Image alt text",
    recommendation: "Add useful alt text to meaningful images and leave decorative images empty intentionally.",
    check: ({ $ }) => {
      const images = $("img").toArray();
      if (images.length === 0) {
        return true;
      }

      return images.every((element) => $(element).attr("alt") !== undefined);
    },
    evidence: ({ $ }) => {
      const images = $("img").length;
      const missing = $("img")
        .toArray()
        .filter((element) => $(element).attr("alt") === undefined).length;

      return `${missing} of ${images} images missing alt attributes`;
    }
  },
  {
    id: "html-lang-present",
    title: "Page language is not declared",
    category: "mobile-usability",
    severity: "low",
    source: "HTML lang",
    recommendation: 'Set the page language on the <html> element, such as lang="en-GB", so screen readers pronounce the text correctly and browsers offer the right translation.',
    check: ({ $ }) => htmlLangEvidence($) === undefined,
    evidence: ({ $ }) => htmlLangEvidence($) ?? ""
  },
  {
    id: "form-labels-present",
    title: "Some form fields have no label",
    category: "mobile-usability",
    severity: "low",
    source: "Form labels",
    recommendation: "Give every form field a visible label, or at least an aria-label, so screen reader users and people using voice control know what to enter.",
    check: ({ $ }) => formFields($).unlabelled.length === 0,
    evidence: ({ $ }) => {
      const { total, unlabelled } = formFields($);
      return `${unlabelled.length} of ${total} form field${total === 1 ? "" : "s"} ${unlabelled.length === 1 ? "has" : "have"} no label: ${firstFive(unlabelled)}`;
    }
  },
  {
    id: "link-text-descriptive",
    title: "Some links use generic text",
    category: "search-basics",
    severity: "low",
    source: "Link text",
    recommendation: 'Replace link text such as "Read more" or "Click here" with words that say where the link goes, such as "Dental implant prices".',
    check: ({ $ }) => genericLinks($).length === 0,
    evidence: ({ $ }) => {
      const links = genericLinks($);
      return `${links.length} link${links.length === 1 ? " uses" : "s use"} generic text: ${firstFive(links)}`;
    }
  }
];

export function runRules(snapshot: PageSnapshot): Finding[] {
  const $ = load(snapshot.html);
  const context: RuleContext = {
    $,
    snapshot,
    text: $("body").text().replace(/\s+/g, " ").trim()
  };

  return rules.filter((rule) => !rule.check(context)).map((rule) => finding(rule, context));
}

export const ruleCount = rules.length;

// Real sites can mention these phrases, so only short pages count as placeholders. Maintenance copy must be
// about the whole site ("Website temporarily down", "Our site is offline") or open the page ("Under maintenance."), so a short page
// saying "Our booking system is temporarily unavailable" keeps its normal audit. Conditional copy such as
// "If our site is offline, call us" describes a fallback, not the site's state.
const placeholderTextLimit = 600;
const maintenanceCopy =
  /(?:^|[.!?]\s+|\b(?:our|this|the) )(?:web)?site (?:is )?(?:temporarily |currently )?(?:down|unavailable|offline|under maintenance)\b|^(?:we(?:'|’)re |we are )?(?:currently |temporarily )?(?:down for|under(?:going)?) (?:scheduled )?maintenance\b/i;
const parkedCopy =
  /\b(?:(?:this )?domain (?:name )?(?:may be|is) for sale|buy this domain|domain is parked|parked (?:free,? )?(?:courtesy of|by)|this domain has been registered)\b/i;
// "Should" is left out: as a condition it inverts the sentence ("Should our site go offline"), which the
// notice pattern never matches, and otherwise it is advice ("You should be aware that our site is offline").
const conditionalWords = /\b(?:if|when|whenever|unless|in case)\b/i;

// The first maintenance notice whose sentence is not conditional; "If for any reason our site is offline,
// call us" describes a fallback, not the site's state. Semicolons and line breaks between visible blocks end the clause, so
// a "When to contact us" menu item does not hide the notice under it.
function maintenanceNotice(text: string): RegExpMatchArray | undefined {
  for (const match of text.matchAll(new RegExp(maintenanceCopy.source, "gi"))) {
    // A match opening with sentence punctuation starts a new sentence, so nothing before it applies.
    const sentence = /^[.!?]/.test(match[0]) ? "" : (text.slice(0, match.index).split(/[.!?;\n]/).pop() ?? "");
    // A condition right after the notice governs it too ("Our site is offline when scheduled maintenance
    // occurs"), but a later, separate clause does not ("Our site is offline, so if you need help call us").
    const governedAfter = /^\s*,?\s*(?:(?:but|and|yet)\s+)?(?:(?:only|just|even|except|usually|sometimes)\s+)?(?:if|when|whenever|unless|in case)\b/i.test(text.slice((match.index ?? 0) + match[0].length));
    if (!governedAfter && !conditionalWords.test(`${sentence} ${match[0]}`)) {
      return match;
    }
  }

  return undefined;
}

export function detectPlaceholderPage(snapshot: PageSnapshot): Finding | undefined {
  const $ = load(snapshot.html);
  const title = $("title").text().replace(/\s+/g, " ").trim();
  const lines = visibleLines(visibleBody($));
  const body = lines.join("\n");
  const text = `${title} ${lines.join(" ")}`.trim();
  if (text.length > placeholderTextLimit) {
    return undefined;
  }

  // The title and body are matched separately, so a notice opening the body is not read as continuing the
  // title ("Acme Dental" then "Site is temporarily offline.").
  const parked = text.match(parkedCopy);
  const maintenance = parked ? undefined : (maintenanceNotice(body) ?? maintenanceNotice(title));
  const match = parked ?? maintenance;
  if (!match) {
    return undefined;
  }

  return {
    id: "website-placeholder",
    title: parked ? "Domain is parked or for sale instead of hosting the business website" : "Website is down or showing a placeholder page",
    severity: "high",
    category: "technical-health",
    source: "Page content",
    recommendation: parked
      ? "Point the domain at a real business website; a parked or for-sale page tells visitors the business is not online."
      : "Restore or launch the real website; a maintenance or placeholder page tells visitors the business is not online.",
    evidence: [
      {
        label: "Page content",
        value: `${parked ? "Parked domain" : "Placeholder page"}: "${match[0].replace(/^[^a-z]+/i, "")}" in ${text.length} characters of page text`
      }
    ]
  };
}
