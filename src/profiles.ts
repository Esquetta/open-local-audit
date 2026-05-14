import { load, type CheerioAPI } from "cheerio";
import type { AuditProfile, Finding, FindingCategory, PageSnapshot, Severity } from "./types.js";

export const auditProfiles: AuditProfile[] = [
  "generic",
  "dental",
  "beauty",
  "restaurant",
  "contractor",
  "lawyer",
  "clinic",
  "gym",
  "hotel",
  "auto-service"
];

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
  },
  lawyer: {},
  clinic: {},
  gym: {},
  hotel: {},
  "auto-service": {}
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
  ],
  lawyer: [
    {
      id: "lawyer-consultation-cta",
      title: "Legal consultation CTA is missing",
      category: "trust-contact",
      severity: "high",
      source: "lawyer profile",
      recommendation: "Add a consultation CTA so legal prospects know how to request an initial review.",
      isPresent: ({ $ }) => hasAction($, /\b(consultation|case review|book|schedule|contact attorney|speak with)\b/i),
      evidence: "No legal consultation or case-review CTA found"
    },
    {
      id: "lawyer-practice-area-cue",
      title: "Practice-area cue is missing",
      category: "trust-contact",
      severity: "medium",
      source: "lawyer profile",
      recommendation: "List practice areas so visitors can quickly confirm whether the firm handles their legal need.",
      isPresent: ({ text }) =>
        /\b(practice areas?|family law|immigration|criminal defense|business law|estate|injury|litigation)\b/i.test(text),
      evidence: "No clear legal practice-area cue found"
    }
  ],
  clinic: [
    {
      id: "clinic-appointment-cta",
      title: "Clinic appointment CTA is missing",
      category: "trust-contact",
      severity: "high",
      source: "clinic profile",
      recommendation: "Add an appointment CTA so patients can schedule care without searching for the next step.",
      isPresent: ({ $ }) => hasAction($, /\b(appointment|schedule|book|visit|new patient)\b/i),
      evidence: "No clinic appointment or scheduling CTA found"
    },
    {
      id: "clinic-insurance-patient-cue",
      title: "Clinic insurance or patient cue is missing",
      category: "trust-contact",
      severity: "medium",
      source: "clinic profile",
      recommendation: "Mention insurance, new patient forms, or patient intake details so visitors can prepare before booking.",
      isPresent: ({ text }) => /\b(insurance|new patients?|patient forms?|intake|accepted plans?)\b/i.test(text),
      evidence: "No clinic insurance, patient form, or intake cue found"
    }
  ],
  gym: [
    {
      id: "gym-trial-membership-cta",
      title: "Gym trial or membership CTA is missing",
      category: "trust-contact",
      severity: "high",
      source: "gym profile",
      recommendation: "Add a trial, membership, or signup CTA so fitness prospects can start quickly.",
      isPresent: ({ $ }) => hasAction($, /\b(trial|membership|join|sign up|signup|start)\b/i),
      evidence: "No gym trial, membership, or signup CTA found"
    },
    {
      id: "gym-class-schedule-cue",
      title: "Gym class schedule cue is missing",
      category: "trust-contact",
      severity: "medium",
      source: "gym profile",
      recommendation: "Show class schedules, training options, or program details so visitors can evaluate fit.",
      isPresent: ({ text }) => /\b(class schedule|classes|personal training|programs?|yoga|strength|training)\b/i.test(text),
      evidence: "No class schedule, training, or program cue found"
    }
  ],
  hotel: [
    {
      id: "hotel-booking-availability-cta",
      title: "Hotel booking or availability CTA is missing",
      category: "trust-contact",
      severity: "high",
      source: "hotel profile",
      recommendation: "Add a booking or availability CTA so guests can check rooms without extra friction.",
      isPresent: ({ $ }) => hasAction($, /\b(book|booking|availability|reserve|rooms?|check in)\b/i),
      evidence: "No hotel booking, room, or availability CTA found"
    },
    {
      id: "hotel-amenities-location-cue",
      title: "Hotel amenities or location cue is missing",
      category: "trust-contact",
      severity: "medium",
      source: "hotel profile",
      recommendation: "Mention amenities and location advantages so guests can compare the property quickly.",
      isPresent: ({ text }) =>
        /\b(amenities|breakfast|parking|wi-?fi|pool|airport|city center|nearby|location)\b/i.test(text),
      evidence: "No amenities or location advantage cue found"
    }
  ],
  "auto-service": [
    {
      id: "auto-service-appointment-cta",
      title: "Auto service appointment CTA is missing",
      category: "trust-contact",
      severity: "high",
      source: "auto-service profile",
      recommendation: "Add a service appointment CTA so vehicle owners can book repair or maintenance.",
      isPresent: ({ $ }) => hasAction($, /\b(schedule|appointment|service|book|repair|maintenance)\b/i),
      evidence: "No auto service appointment or repair CTA found"
    },
    {
      id: "auto-service-repair-trust-cue",
      title: "Auto service repair trust cue is missing",
      category: "trust-contact",
      severity: "medium",
      source: "auto-service profile",
      recommendation: "Mention repairs, certified mechanics, warranty, diagnostics, or maintenance services to build trust.",
      isPresent: ({ text }) =>
        /\b(certified|mechanic|warranty|diagnostics?|brake|oil change|repair|maintenance)\b/i.test(text),
      evidence: "No repair, certification, warranty, or maintenance cue found"
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
