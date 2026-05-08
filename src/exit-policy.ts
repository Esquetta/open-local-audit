import type { AuditReport, Severity } from "./types.js";

export type FailOnThreshold = "none" | Exclude<Severity, "info">;

const ranks: Record<Exclude<Severity, "info">, number> = {
  high: 0,
  medium: 1,
  low: 2
};

export function shouldFailOnThreshold(report: AuditReport, threshold: FailOnThreshold): boolean {
  if (threshold === "none") {
    return false;
  }

  return report.findings.some((finding) => {
    if (finding.severity === "info") {
      return false;
    }

    return ranks[finding.severity] <= ranks[threshold];
  });
}
