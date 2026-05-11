import type { AuditProfile, Finding } from "./types.js";

export const auditProfiles: AuditProfile[] = ["generic", "dental", "beauty", "restaurant", "contractor"];

type FindingOverride = {
  severity?: Finding["severity"];
  recommendation?: string;
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

export function applyProfileAdjustments(findings: Finding[], profile: AuditProfile): Finding[] {
  if (profile === "generic") {
    return findings;
  }

  const overrides = profileOverrides[profile];
  return findings.map((finding) => {
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
}
