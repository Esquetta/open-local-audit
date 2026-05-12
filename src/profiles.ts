import { load, type CheerioAPI } from "cheerio";
import type { AuditProfile, Finding, FindingCategory, PageSnapshot, Severity } from "./types.js";

export const auditProfiles: AuditProfile[] = ["generic", "dental", "beauty", "restaurant", "contractor"];

type FindingOverride = {
  severity?: Finding["severity"];
  recommendation?: string;
};

type ProfileFindingRule = {
  id: string;
  title: string;
  category: FindingCategory;
  severity: Severity;
  source: string;
  recommendation: string;
  isPresent: (context: ProfileRuleContext) => boolean;
  evidence: string;
};

type ProfileRuleContext = {
  $: CheerioAPI;
  text: string;
};

const profileOverrides: Record<Exclude<AuditProfile, "generic">, Record<string, FindingOverride>> = {
  dental: {
    "review-cue-present": {
      severity: "medium",
      recommendation: "Add visible patient reviews, ratings, or testimonials to strengthen dental trust signals."
    }
  },
  beauty: {
    "image-alt-coverage": {
      severity: "medium",
      recommendation: "Add descriptive alt text to service and portfolio images so beauty work is easier to understand."
    }
  },
  restaurant: {
    "opening-hours-present": {
      severity: "medium",
      recommendation: "Show current opening hours, reservation availability, and holiday hours for diners."
    }
  },
  contractor: {
    "service-detail-depth": {
      severity: "high",
      recommendation: "List concrete services, project types, and service-area coverage so contractor leads can qualify quickly."
    }
  }
};

function hasAction($: CheerioAPI, pattern: RegExp): boolean {
  return $("a, button")
    .toArray()
    .some((element) => {
      const href = $(element).attr("href") ?? "";
      const label = $(element).attr("aria-label") ?? "";
      const text = $(element).text();
      return pattern.test(`${href} ${label} ${text}`);
    });
}

function hasPageSignal($: CheerioAPI, text: string, pattern: RegExp): boolean {
  const attributes = $("[href], [aria-label], [alt], [title], [class], [id]")
    .toArray()
    .map((element) =>
      [
        $(element).attr("href"),
        $(element).attr("aria-label"),
        $(element).attr("alt"),
        $(element).attr("title"),
        $(element).attr("class"),
        $(element).attr("id")
      ]
        .filter(Boolean)
        .join(" ")
    )
    .join(" ");

  return pattern.test(`${text} ${attributes}`);
}

function createFinding(rule: ProfileFindingRule): Finding {
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
        value: rule.evidence
      }
    ]
  };
}

const profileFindingRules: Record<Exclude<AuditProfile, "generic">, ProfileFindingRule[]> = {
  dental: [
    {
      id: "dental-appointment-cta",
      title: "Dental appointment CTA is missing",
      category: "trust-contact",
      severity: "medium",
      source: "dental profile",
      recommendation: "Add a clear appointment CTA for new patients, such as booking, scheduling, or consultation.",
      isPresent: ({ $ }) => hasAction($, /\b(book|schedule|appointment|consultation|new patient)\b/i),
      evidence: "No dental appointment, scheduling, or consultation CTA found"
    },
    {
      id: "dental-insurance-payment-cue",
      title: "Dental insurance or payment cue is missing",
      category: "trust-contact",
      severity: "low",
      source: "dental profile",
      recommendation: "Mention accepted insurance, payment plans, or financing so patients can qualify cost expectations.",
      isPresent: ({ text }) => /\b(insurance|insured|payment plans?|financing|finance|medicaid|medicare)\b/i.test(text),
      evidence: "No dental insurance, payment plan, or financing cue found"
    }
  ],
  beauty: [
    {
      id: "beauty-booking-cta",
      title: "Beauty booking CTA is missing",
      category: "trust-contact",
      severity: "medium",
      source: "beauty profile",
      recommendation: "Add a service booking CTA so visitors can quickly reserve a salon or beauty appointment.",
      isPresent: ({ $ }) => hasAction($, /\b(book|booking|schedule|appointment|reserve)\b/i),
      evidence: "No beauty booking or appointment CTA found"
    },
    {
      id: "beauty-portfolio-signal",
      title: "Beauty portfolio or gallery signal is missing",
      category: "trust-contact",
      severity: "medium",
      source: "beauty profile",
      recommendation: "Show a gallery, portfolio, or before-and-after examples so visitors can judge service quality.",
      isPresent: ({ $, text }) => hasPageSignal($, text, /\b(gallery|portfolio|before\s*(?:and|&|-)?\s*after|results?|photos?)\b/i),
      evidence: "No gallery, portfolio, or before-and-after signal found"
    }
  ],
  restaurant: [
    {
      id: "restaurant-menu-signal",
      title: "Restaurant menu signal is missing",
      category: "trust-contact",
      severity: "high",
      source: "restaurant profile",
      recommendation: "Add a visible menu link or menu section so diners can evaluate the restaurant before visiting.",
      isPresent: ({ $, text }) => hasPageSignal($, text, /\b(menu|dishes|food list|wine list|drinks?)\b/i),
      evidence: "No menu link, menu section, or menu wording found"
    },
    {
      id: "restaurant-reservation-order-signal",
      title: "Restaurant reservation or ordering signal is missing",
      category: "trust-contact",
      severity: "medium",
      source: "restaurant profile",
      recommendation: "Add reservation, online ordering, delivery, or takeout options where they are available.",
      isPresent: ({ $, text }) => hasPageSignal($, text, /\b(reservations?|reserve|order online|delivery|takeout|take-out|pickup)\b/i),
      evidence: "No reservation, ordering, delivery, or takeout signal found"
    }
  ],
  contractor: [
    {
      id: "contractor-estimate-cta",
      title: "Contractor estimate CTA is missing",
      category: "trust-contact",
      severity: "high",
      source: "contractor profile",
      recommendation: "Add a quote or estimate CTA so project leads know the next step to request work.",
      isPresent: ({ $ }) => hasAction($, /\b(estimate|quote|bid|consultation|request|schedule)\b/i),
      evidence: "No quote, estimate, or consultation CTA found"
    },
    {
      id: "contractor-license-insured-service-area-cue",
      title: "Contractor license, insurance, or service-area cue is missing",
      category: "trust-contact",
      severity: "medium",
      source: "contractor profile",
      recommendation: "Mention license, insurance, bonding, and service-area coverage to build contractor trust.",
      isPresent: ({ text }) =>
        /\b(licensed|license|insured|insurance|bonded)\b/i.test(text) &&
        /\b(service area|serving|serves|coverage area|available in)\b/i.test(text),
      evidence: "No combined license, insurance, and service-area cue found"
    }
  ]
};

function profileFindings(profile: AuditProfile, snapshot?: PageSnapshot): Finding[] {
  if (profile === "generic" || !snapshot) {
    return [];
  }

  const $ = load(snapshot.html);
  const context: ProfileRuleContext = {
    $,
    text: $("body").text().replace(/\s+/g, " ").trim()
  };

  return profileFindingRules[profile].filter((rule) => !rule.isPresent(context)).map(createFinding);
}

export function applyProfileAdjustments(
  findings: Finding[],
  profile: AuditProfile,
  snapshot?: PageSnapshot
): Finding[] {
  if (profile === "generic") {
    return findings;
  }

  const overrides = profileOverrides[profile];
  const adjustedFindings = findings.map((finding) => {
    const override = overrides[finding.id];
    if (!override) {
      return finding;
    }

    return {
      ...finding,
      severity: override.severity ?? finding.severity,
      recommendation: override.recommendation ?? finding.recommendation
    };
  });

  return [...adjustedFindings, ...profileFindings(profile, snapshot)];
}
