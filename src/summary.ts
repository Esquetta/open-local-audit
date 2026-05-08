import type { AuditReport } from "./types.js";

export function renderTerminalSummary(report: AuditReport): string {
  const averageScore = Math.round(
    Object.values(report.scores).reduce((total, score) => total + score.score, 0) / Object.values(report.scores).length
  );
  const topIssue = report.findings[0]?.title ?? "No findings detected";

  return [
    `Overall score: ${averageScore}/100`,
    `High: ${report.summary.high}`,
    `Medium: ${report.summary.medium}`,
    `Low: ${report.summary.low}`,
    `Top issue: ${topIssue}`
  ].join("\n");
}
