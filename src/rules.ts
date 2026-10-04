import { load, type CheerioAPI } from "cheerio";
import { findPhoneNumbersInText, getCountries, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";
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

function flattenJsonLd(value: unknown): JsonLdNode[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenJsonLd(item));
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const node = value as JsonLdNode;
  const graphNodes = flattenJsonLd(node["@graph"]);
  return [node, ...graphNodes];
}

function jsonLdNodes($: CheerioAPI): JsonLdNode[] {
  return $('script[type="application/ld+json"]')
    .toArray()
    .flatMap((element) => {
      const raw = $(element).text();
      try {
        const parsed = JSON.parse(raw) as unknown;
        return flattenJsonLd(parsed);
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
    jsonLdTypes(node).some((type) => type.endsWith("LocalBusiness") || type === "LocalBusiness")
  );
}

function hasObjectField(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasStringField(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function hasLocalBusinessContactFields($: CheerioAPI): boolean {
  const nodes = localBusinessNodes($);
  if (nodes.length === 0) {
    return true;
  }

  return nodes.some(
    (node) => hasStringField(node.telephone) && hasObjectField(node.address) && hasStringField(node.openingHours)
  );
}

function stringValues(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

// A closed <dialog> is hidden by the browser without any attribute or style.
const hiddenElements = "script, style, noscript, template, [hidden], [aria-hidden='true'], dialog:not([open])";

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
const phoneLabelWords = "phone|tel|telephone|call|mobile|cell|whatsapp|telefon|telefono|teléfono|téléphone|tél|gsm|cep|ara|ruf|☎|📞";

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
  "gardens", "grove", "parade", "esplanade", "circuit", "way"
]);

const fillerAddressTokens = new Set(["no", "nr", "the", "and", "jr"]);

function addressTokens(value: string): string[] {
  return value
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
  /(?<![\p{L}\p{N}])(?:phone|tel|telephone|fax|call|mobile|cell|whatsapp|e-?mail|telefon|telefono|teléfono|t[eé]l[eé]phone|tél|gsm|cep|ruf)(?![\p{L}\p{N}])|[@☎📞]/iu;

// Distances and durations after a number ("5 minutes", "2 km") mean directions, not an address.
const distanceUnits = String.raw`(?:minutes?|mins?|hours?|hrs?|seconds?|secs?|days?|weeks?|km|kms|kilomet(?:er|re)s?|miles?|mi|blocks?|ft|feet|yards?|m|meters?|metres?)\b`;

// House numbers as addressTokens normalizes them: "12", "12A", "12-A", "12-14", "2/14", "12 1/2" and "12½".
const houseNumberPattern = String.raw`\d+(?:\s*[-–/]\s*\d+|\s+\d+\/\d+|[-/]?[a-z]|[½¼¾])?`;

function hasComparableAddress(text: string, inAddressElement = false): boolean {
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
    String.raw`\b(?!\d+\s+${distanceUnits})(?:(?!(?:19|20)\d\d(?![\p{L}\p{N}]))${houseNumberPattern}|(?:19|20)\d\d(?=\s.*\b(?:street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr|court|ct|place|pl|parkway|pkwy|square|sq|highway|hwy)\.?\s*(?:[,;|]|$)))\s+(?:(?:\p{L}+|\d+(?:st|nd|rd|th))\.?\s+){1,6}(?:street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr|court|ct|place|pl|parkway|pkwy|square|sq|highway|hwy)\b`,
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
  // An address label or <address> already marks the text as an address, so lowercase "via roma 14" counts there.
  const anyCasePrefixStreetNumber = new RegExp(prefixStreetNumber.source, "iu");

  return (
    // Inside <address> any house-number-and-name structure counts ("14 Main Crescent"), not only listed street types.
    (inAddressElement && labelledStructure.test(text)) ||
    (addressValue !== undefined &&
      (labelledStructure.test(addressValue) ||
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

function visibleAddressRegions($: CheerioAPI, body: VisibleBody): string[][] {
  // Compare against whole visible lines (block elements) that show an address, plus numbered <address> elements,
  // so inline markup cannot split an address and unrelated blocks cannot supply street words.
  const allLines = visibleLines(body);
  // A label alone in its block ("<div>Address:</div><div>14 Main Crescent</div>") labels the next block.
  const labelledNextLines = allLines.flatMap((line, index) =>
    index + 1 < allLines.length && /^(?:address|adres|adresse|anschrift|direcci[oó]n|indirizzo)\s*:?$/iu.test(line)
      ? [`${line.replace(/\s*:?$/, "")}: ${allLines[index + 1]}`]
      : []
  );
  const lines = [...allLines, ...labelledNextLines].filter((line) => hasComparableAddress(line));
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
    if (!containsInOrder(rest, region)) {
      return false;
    }

    if (words.length === 0) {
      return houseNumber === undefined || region.includes(houseNumber);
    }

    // The street words must appear together and in order, with the house number directly before or after them.
    for (let start = 0; start + words.length <= region.length; start += 1) {
      if (!matchesAt(words, region, start)) {
        continue;
      }

      const end = start + words.length - 1;
      if (houseNumber === undefined || region[start - 1] === houseNumber || region[end + 1] === houseNumber) {
        return true;
      }
    }

    return false;
  });
}

function localBusinessNapMismatches($: CheerioAPI): string[] {
  const nodes = localBusinessNodes($);
  if (nodes.length === 0) {
    return [];
  }

  const index = jsonLdIndex($);
  const body = visibleBody($);
  const regions = visibleAddressRegions($, body);
  const mismatches: string[] = [];

  for (const node of nodes) {
    for (const telephone of stringValues(node.telephone)) {
      const country = schemaCountry(node, index) ?? parsePhoneNumberFromString(telephone.trim())?.country;
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
      for (const streetAddress of streetAddresses(node, index)) {
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

function hasServiceLocationCopy(text: string): boolean {
  const hasService = /\b(service|services|clinic|dental|salon|restaurant|repair|legal|appointment|booking|consultation)\b/i.test(
    text
  );
  const hasLocation = /\b(istanbul|ankara|izmir|bursa|antalya|kadikoy|nearby|neighborhood|service area|located in|serves)\b/i.test(
    text
  );

  return hasService && hasLocation;
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
    evidence: ({ $ }) => `${$("h1").length} H1 elements`
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
    check: ({ $ }) => hasLink($, (href) => href.toLowerCase().startsWith("tel:")),
    evidence: () => "No tel: link found"
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
    check: ({ $ }) => hasJsonLdType($, (type) => type.endsWith("LocalBusiness") || type === "LocalBusiness"),
    evidence: () => "No LocalBusiness JSON-LD type found"
  },
  {
    id: "localbusiness-schema-contact-fields",
    title: "LocalBusiness structured data is missing contact fields",
    category: "search-basics",
    severity: "medium",
    source: "JSON-LD",
    recommendation: "Add telephone, address, and openingHours fields to LocalBusiness schema.",
    check: ({ $ }) => hasLocalBusinessContactFields($),
    evidence: () => "LocalBusiness schema is missing telephone, address, or openingHours"
  },
  {
    id: "localbusiness-schema-nap-consistency",
    title: "LocalBusiness structured data does not match the visible phone or address",
    category: "search-basics",
    severity: "medium",
    source: "JSON-LD",
    recommendation:
      "Make the LocalBusiness schema telephone and streetAddress match the phone number and address shown on the page, so search engines and customers see one consistent listing.",
    check: ({ $ }) => localBusinessNapMismatches($).length === 0,
    evidence: ({ $ }) => localBusinessNapMismatches($).join("; ")
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
    check: ({ text }) => hasServiceLocationCopy(text),
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
