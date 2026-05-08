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
  return $('script[type="application/ld+json"]')
    .toArray()
    .some((element) => {
      const raw = $(element).text();
      try {
        const parsed = JSON.parse(raw) as unknown;
        const nodes = Array.isArray(parsed) ? parsed : [parsed];

        return nodes.some((node) => {
          if (!node || typeof node !== "object") {
            return false;
          }

          const typeValue = (node as { "@type"?: unknown })["@type"];
          const types = Array.isArray(typeValue) ? typeValue : [typeValue];
          return types.some((type) => typeof type === "string" && matcher(type));
        });
      } catch {
        return false;
      }
    });
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
