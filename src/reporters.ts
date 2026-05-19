import type { AuditReport, Finding, ReportBrandConfig, ReportRenderOptions } from "./types.js";

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function overallScore(report: AuditReport): number {
  const scores = Object.values(report.scores);
  return scores.length === 0 ? 0 : Math.round(scores.reduce((total, score) => total + score.score, 0) / scores.length);
}

function priorityFindings(report: AuditReport): Finding[] {
  return [...report.findings]
    .sort((left, right) => severityRank(left) - severityRank(right))
    .slice(0, 3);
}

function executiveSummary(report: AuditReport): { impact: string; firstFix: string; findings: Finding[] } {
  const findings = priorityFindings(report);
  const firstFinding = findings[0];
  const score = overallScore(report);
  return {
    impact:
      score < 50
        ? "The site has visible trust and conversion gaps that can reduce local customer inquiries."
        : score < 80
          ? "The site has focused improvement opportunities that can make outreach or conversion stronger."
          : "The site is relatively healthy; improvements should focus on smaller trust and conversion refinements.",
    firstFix: firstFinding?.recommendation ?? "Keep monitoring the page as content and templates change.",
    findings
  };
}

function brandName(brand: ReportBrandConfig | undefined): string {
  return brand?.name ?? "Open Local Audit";
}

function renderMarkdownVisualEvidence(report: AuditReport): string[] {
  if (!report.visualEvidence || report.visualEvidence.length === 0) {
    return [];
  }

  return [
    "## Visual Evidence",
    "",
    "| Label | Path |",
    "| --- | --- |",
    ...report.visualEvidence.map((item) => `| ${escapeCell(item.label)} | ${escapeCell(item.path)} |`),
    ""
  ];
}

function renderMarkdownExecutiveSummary(report: AuditReport): string[] {
  const summary = executiveSummary(report);
  return [
    "## Executive Summary",
    "",
    `- Overall health: ${overallScore(report)}/100`,
    `- Business impact: ${summary.impact}`,
    `- Recommended first fix: ${summary.firstFix}`,
    "",
    "Top 3 issues:",
    "",
    ...(summary.findings.length > 0
      ? summary.findings.map((finding) => `- ${finding.title}`)
      : ["- No findings were detected by the current rule set."]),
    ""
  ];
}

function lighthouseRows(report: AuditReport): Array<[string, string]> {
  if (!report.lighthouse) {
    return [];
  }

  const categories = report.lighthouse.categories;
  return [
    ["Performance", categories.performance?.toString() ?? "N/A"],
    ["Accessibility", categories.accessibility?.toString() ?? "N/A"],
    ["Best practices", categories.bestPractices?.toString() ?? "N/A"],
    ["SEO", categories.seo?.toString() ?? "N/A"]
  ];
}

function renderMarkdownLighthouse(report: AuditReport): string[] {
  if (!report.lighthouse) {
    return [];
  }

  return [
    "## Lighthouse Summary",
    "",
    "| Category | Score |",
    "| --- | ---: |",
    ...lighthouseRows(report).map(([label, score]) => `| ${label} | ${score} |`),
    "",
    ...(report.lighthouse.warnings && report.lighthouse.warnings.length > 0
      ? ["Warnings:", "", ...report.lighthouse.warnings.map((warning) => `- ${warning}`), ""]
      : [])
  ];
}

function renderMarkdownContactReadiness(report: AuditReport): string[] {
  if (!report.contact || report.contact.contactConfidence === "None") {
    return [];
  }

  return [
    "## Contact Readiness",
    "",
    "| Signal | Value |",
    "| --- | --- |",
    `| Confidence | ${escapeCell(report.contact.contactConfidence)} |`,
    `| Public email | ${escapeCell(report.contact.publicEmail ?? "")} |`,
    `| Public phone | ${escapeCell(report.contact.publicPhone ?? "")} |`,
    `| WhatsApp | ${escapeCell(report.contact.whatsappUrl ?? "")} |`,
    `| Contact page | ${escapeCell(report.contact.contactPageUrl ?? "")} |`,
    `| Social profiles | ${escapeCell(report.contact.socialProfiles.join("; "))} |`,
    ""
  ];
}

function renderHtmlVisualEvidence(report: AuditReport): string {
  if (!report.visualEvidence || report.visualEvidence.length === 0) {
    return "";
  }

  const rows = report.visualEvidence
    .map(
      (item) =>
        `<tr><td>${escapeHtml(item.label)}</td><td><a href="${escapeHtml(item.path)}">${escapeHtml(item.path)}</a></td></tr>`
    )
    .join("\n");

  return `    <h2>Visual Evidence</h2>
    <table>
      <thead><tr><th>Label</th><th>Path</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
`;
}

function renderHtmlLighthouse(report: AuditReport): string {
  if (!report.lighthouse) {
    return "";
  }

  const rows = lighthouseRows(report)
    .map(([label, score]) => `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(score)}</td></tr>`)
    .join("\n");
  const warnings =
    report.lighthouse.warnings && report.lighthouse.warnings.length > 0
      ? `<p class="meta">${report.lighthouse.warnings.map(escapeHtml).join("<br>")}</p>`
      : "";

  return `    <section>
    <h2>Lighthouse Summary</h2>
    <table>
      <thead><tr><th>Category</th><th>Score</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
${warnings}
    </section>
`;
}

function renderHtmlContactReadiness(report: AuditReport): string {
  if (!report.contact || report.contact.contactConfidence === "None") {
    return "";
  }

  const rows = [
    ["Confidence", report.contact.contactConfidence],
    ["Public email", report.contact.publicEmail ?? ""],
    ["Public phone", report.contact.publicPhone ?? ""],
    ["WhatsApp", report.contact.whatsappUrl ?? ""],
    ["Contact page", report.contact.contactPageUrl ?? ""],
    ["Social profiles", report.contact.socialProfiles.join("; ")]
  ]
    .map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`)
    .join("\n");

  return `    <section>
    <h2>Contact Readiness</h2>
    <table>
      <thead><tr><th>Signal</th><th>Value</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
    </section>
`;
}

function renderHtmlExecutiveSummary(report: AuditReport): string {
  const summary = executiveSummary(report);
  const findings =
    summary.findings.length > 0
      ? summary.findings.map((finding) => `<li>${escapeHtml(finding.title)}</li>`).join("\n")
      : "<li>No findings were detected by the current rule set.</li>";

  return `    <section>
    <h2>Executive Summary</h2>
    <p><strong>Business impact:</strong> ${escapeHtml(summary.impact)}</p>
    <p><strong>Recommended first fix:</strong> ${escapeHtml(summary.firstFix)}</p>
    <h3>Top 3 issues</h3>
    <ul>
${findings}
    </ul>
    </section>
`;
}

export function renderJsonReport(report: AuditReport, pretty = true): string {
  return `${JSON.stringify(report, null, pretty ? 2 : 0)}\n`;
}

export function renderMarkdownReport(report: AuditReport, options: ReportRenderOptions = {}): string {
  const findings = [...report.findings].sort((left, right) => severityRank(left) - severityRank(right));
  const lines: string[] = [
    `# ${brandName(options.brand)} Report`,
    "",
    `- URL: ${report.url}`,
    `- Final URL: ${report.finalUrl}`,
    `- Scanned at: ${report.scannedAt}`,
    `- Status code: ${report.statusCode}`,
    `- Profile: ${report.profile ?? "generic"}`,
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

  lines.splice(lines.indexOf("## Findings"), 0, ...renderMarkdownVisualEvidence(report));
  lines.splice(lines.indexOf("## Findings"), 0, ...renderMarkdownLighthouse(report));
  lines.splice(lines.indexOf("## Findings"), 0, ...renderMarkdownContactReadiness(report));
  lines.splice(lines.indexOf("## Findings"), 0, ...renderMarkdownExecutiveSummary(report));

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

export function renderHtmlReport(report: AuditReport, options: ReportRenderOptions = {}): string {
  const findings = [...report.findings].sort((left, right) => severityRank(left) - severityRank(right));
  const reportBrand = options.brand;
  const reportBrandName = brandName(reportBrand);
  const reportOverallScore = overallScore(report);
  const scoreRows = Object.values(report.scores)
    .map((score) => `<tr><td>${escapeHtml(score.label)}</td><td>${score.score}/${score.max}</td></tr>`)
    .join("\n");
  const findingRows = findings.length
    ? findings
        .map((finding) => {
          const evidence = finding.evidence.map((item) => `${item.label}: ${item.value}`).join("; ");
          return `<tr><td>${finding.severity}</td><td>${escapeHtml(finding.title)}</td><td>${escapeHtml(evidence)}</td><td>${escapeHtml(finding.recommendation)}</td></tr>`;
        })
        .join("\n")
    : `<tr><td colspan="4">No findings were detected by the current rule set.</td></tr>`;
  const recommendations =
    report.recommendations.length > 0
      ? report.recommendations.map((recommendation) => `<li>${escapeHtml(recommendation)}</li>`).join("\n")
      : "<li>Keep monitoring the page as content and templates change.</li>";
  const visualEvidence = renderHtmlVisualEvidence(report);
  const lighthouse = renderHtmlLighthouse(report);
  const contact = renderHtmlContactReadiness(report);
  const executive = renderHtmlExecutiveSummary(report);
  const footer =
    reportBrand?.footerText || reportBrand?.contact
      ? `<footer class="meta">${escapeHtml([reportBrand.footerText, reportBrand.contact].filter(Boolean).join(" | "))}</footer>`
      : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(reportBrandName)} Report - ${escapeHtml(report.finalUrl)}</title>
    <style>
      :root { color-scheme: light; --ink: #172026; --muted: #5f6b75; --line: #d8dee5; --panel: #f6f8fa; --brand: ${escapeHtml(reportBrand?.primaryColor ?? "#145a73")}; --accent: ${escapeHtml(reportBrand?.accentColor ?? "#2f7d5f")}; }
      * { box-sizing: border-box; }
      body { background: #eef2f5; color: var(--ink); font-family: Arial, sans-serif; line-height: 1.5; margin: 0; }
      .report-shell { max-width: 1120px; margin: 0 auto; padding: 2rem; }
      .hero { background: #ffffff; border: 1px solid var(--line); border-radius: 8px; padding: 1.5rem; }
      .eyebrow { color: var(--brand); font-size: 0.78rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
      .meta { color: var(--muted); }
      .score-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); margin: 1rem 0; }
      .score-card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 1rem; }
      .score-card strong { display: block; font-size: 1.8rem; }
      section { background: #ffffff; border: 1px solid var(--line); border-radius: 8px; margin-top: 1rem; padding: 1.25rem; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border-bottom: 1px solid var(--line); padding: 0.65rem; text-align: left; vertical-align: top; }
      th { background: var(--panel); color: var(--muted); font-size: 0.82rem; text-transform: uppercase; }
      tr:last-child td { border-bottom: 0; }
    </style>
  </head>
  <body>
    <main class="report-shell">
    <header class="hero">
      <div class="eyebrow">${escapeHtml(reportBrandName)}</div>
      <h1>${escapeHtml(reportBrandName)} Report</h1>
      <p class="meta">URL: ${escapeHtml(report.url)}<br>Final URL: ${escapeHtml(report.finalUrl)}<br>Scanned at: ${escapeHtml(report.scannedAt)}<br>Status code: ${report.statusCode}<br>Profile: ${escapeHtml(report.profile ?? "generic")}</p>
      <div class="score-grid" aria-label="Overall Health">
        <div class="score-card"><span>Overall Health</span><strong>${reportOverallScore}/100</strong></div>
        <div class="score-card"><span>Priority Findings</span><strong>${report.summary.high + report.summary.medium}</strong></div>
        <div class="score-card"><span>Total Findings</span><strong>${report.summary.totalFindings}</strong></div>
      </div>
    </header>
    <section>
    <h2>Score Summary</h2>
    <table>
      <thead><tr><th>Category</th><th>Score</th></tr></thead>
      <tbody>
${scoreRows}
      </tbody>
    </table>
    </section>
${executive}${contact}${lighthouse}${visualEvidence}    <section>
    <h2>Findings</h2>
    <table>
      <thead><tr><th>Severity</th><th>Finding</th><th>Evidence</th><th>Recommendation</th></tr></thead>
      <tbody>
${findingRows}
      </tbody>
    </table>
    </section>
    <section>
    <h2>Recommendations</h2>
    <ul>
${recommendations}
    </ul>
    </section>
${footer}
    </main>
  </body>
</html>
`;
}
