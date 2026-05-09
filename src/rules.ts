import { load, type CheerioAPI } from "cheerio";
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
