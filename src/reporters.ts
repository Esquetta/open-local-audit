import type { AuditReport, Finding } from "./types.js";

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function severityRank(finding: Finding): number {
  const ranks = {
    high: 0,
    medium: 1,
    low: 2,
    info: 3
  };

  return ranks[finding.severity];
}

export function renderJsonReport(report: AuditReport, pretty = true): string {
  return `${JSON.stringify(report, null, pretty ? 2 : 0)}\n`;
}

export function renderMarkdownReport(report: AuditReport): string {
  const findings = [...report.findings].sort((left, right) => severityRank(left) - severityRank(right));
  const lines: string[] = [
    `# Open Local Audit Report`,
    "",
    `- URL: ${report.url}`,
    `- Final URL: ${report.finalUrl}`,
    `- Scanned at: ${report.scannedAt}`,
    `- Status code: ${report.statusCode}`,
    "",
    "## Score Summary",
    "",
    "| Category | Score |",
    "| --- | ---: |",
    ...Object.values(report.scores).map((score) => `| ${escapeCell(score.label)} | ${score.score}/${score.max} |`),
    "",
    "## Findings",
    ""
  ];

  if (findings.length === 0) {
    lines.push("No findings were detected by the current rule set.", "");
  } else {
    lines.push("| Severity | Finding | Evidence | Recommendation |", "| --- | --- | --- | --- |");
    for (const finding of findings) {
      const evidence = finding.evidence.map((item) => `${item.label}: ${item.value}`).join("; ");
      lines.push(
        `| ${finding.severity} | ${escapeCell(finding.title)} | ${escapeCell(evidence)} | ${escapeCell(finding.recommendation)} |`
      );
    }
    lines.push("");
  }

  lines.push("## Recommendations", "");
  if (report.recommendations.length === 0) {
    lines.push("- Keep monitoring the page as content and templates change.");
  } else {
    for (const recommendation of report.recommendations) {
      lines.push(`- ${recommendation}`);
    }
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}
