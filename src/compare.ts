import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { brandName, escapeCell, escapeHtml, overallScore, severityRank } from "./reporters.js";
import type { AuditProfile, AuditReport, Finding, FindingCategory, ReportRenderOptions } from "./types.js";

export interface ScoreChange {
  label: string;
  before: number;
  after: number;
  max: number;
  change: number;
}

export interface AuditComparison {
  url: string;
  profile: AuditProfile;
  beforeScannedAt: string;
  afterScannedAt: string;
  overall: { before: number; after: number; change: number };
  scores: Partial<Record<FindingCategory, ScoreChange>>;
  fixed: Finding[];
  introduced: Finding[];
  remaining: Finding[];
  screenshots: { before?: string; after?: string };
}

export interface ComparisonScreenshot {
  data: Buffer;
  type: "png" | "jpeg";
}

export interface ComparisonRenderOptions extends ReportRenderOptions {
  screenshots?: { before?: ComparisonScreenshot; after?: ComparisonScreenshot };
}

function siteHost(url: string): string {
  return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
}

function bySeverity(findings: Finding[]): Finding[] {
  return [...findings].sort((left, right) => severityRank(left) - severityRank(right));
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

export async function readComparisonReport(path: string): Promise<AuditReport> {
  let reportPath = path;
  let content: string;
  try {
    if ((await stat(path)).isDirectory()) {
      reportPath = join(path, "open-local-audit-report.json");
    }
    content = await readFile(reportPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`${reportPath} was not found`);
    }
    throw error;
  }

  let report: Partial<AuditReport>;
  try {
    report = JSON.parse(content.replace(/^\uFEFF/, "")) as Partial<AuditReport>;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`${reportPath} is not valid JSON`);
    }
    throw error;
  }

  if (
    typeof report.finalUrl !== "string" ||
    !URL.canParse(report.finalUrl) ||
    typeof report.scannedAt !== "string" ||
    Number.isNaN(Date.parse(report.scannedAt)) ||
    typeof report.scores !== "object" ||
    report.scores === null ||
    !Array.isArray(report.findings)
  ) {
    throw new Error(`${reportPath} is not an Open Local Audit JSON report`);
  }

  // Screenshot paths are written relative to the report directory. Only files inside that directory are used, so a
  // report from elsewhere cannot pull unrelated local images into a customer-facing comparison.
  const reportDir = dirname(reportPath);
  const inside = (path: unknown): string | undefined => {
    if (typeof path !== "string" || !path.trim()) {
      return undefined;
    }
    const resolved = resolve(reportDir, path);
    const fromReport = relative(reportDir, resolved);
    return fromReport && !fromReport.startsWith("..") && !isAbsolute(fromReport) ? resolved : undefined;
  };
  const visualEvidence = Array.isArray(report.visualEvidence)
    ? report.visualEvidence.flatMap((item) => {
        const path = inside(item?.path);
        const screenshot = inside(item?.screenshotPath);
        return path ? [{ ...item, path, ...(screenshot ? { screenshotPath: screenshot } : { screenshotPath: undefined }) }] : [];
      })
    : undefined;
  return { ...report, visualEvidence } as AuditReport;
}

function screenshotPath(report: AuditReport): string | undefined {
  return report.visualEvidence?.find((item) => item.screenshotPath)?.screenshotPath;
}

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function readScreenshot(path: string | undefined): Promise<ComparisonScreenshot | undefined> {
  if (!path) {
    return undefined;
  }

  let data: Buffer;
  try {
    data = await readFile(path);
  } catch {
    return undefined;
  }
  if (data.subarray(0, 8).equals(pngSignature)) {
    return { data, type: "png" };
  }
  return data[0] === 0xff && data[1] === 0xd8 ? { data, type: "jpeg" } : undefined;
}

export async function loadComparisonScreenshots(
  comparison: AuditComparison
): Promise<NonNullable<ComparisonRenderOptions["screenshots"]>> {
  return {
    before: await readScreenshot(comparison.screenshots.before),
    after: await readScreenshot(comparison.screenshots.after)
  };
}

export function compareReports(before: AuditReport, after: AuditReport): AuditComparison {
  if (siteHost(before.finalUrl) !== siteHost(after.finalUrl)) {
    throw new Error(`Reports are for different sites: ${before.finalUrl} and ${after.finalUrl}`);
  }

  const beforeProfile = before.profile ?? "generic";
  const afterProfile = after.profile ?? "generic";
  if (beforeProfile !== afterProfile) {
    throw new Error(`Reports use different profiles: ${beforeProfile} and ${afterProfile}`);
  }

  if (Date.parse(before.scannedAt) > Date.parse(after.scannedAt)) {
    throw new Error("The before report was scanned after the after report; swap the report order");
  }

  const beforeIds = new Set(before.findings.map((finding) => finding.id));
  const afterIds = new Set(after.findings.map((finding) => finding.id));
  const scores: AuditComparison["scores"] = {};
  for (const [category, score] of Object.entries(after.scores) as Array<[FindingCategory, AuditReport["scores"][FindingCategory]]>) {
    const previous = before.scores[category];
    if (previous) {
      scores[category] = {
        label: score.label,
        before: previous.score,
        after: score.score,
        max: score.max,
        change: score.score - previous.score
      };
    }
  }

  const overallBefore = overallScore(before);
  const overallAfter = overallScore(after);
  return {
    url: after.finalUrl,
    profile: afterProfile,
    beforeScannedAt: before.scannedAt,
    afterScannedAt: after.scannedAt,
    overall: { before: overallBefore, after: overallAfter, change: overallAfter - overallBefore },
    scores,
    fixed: bySeverity(before.findings.filter((finding) => !afterIds.has(finding.id))),
    introduced: bySeverity(after.findings.filter((finding) => !beforeIds.has(finding.id))),
    remaining: bySeverity(after.findings.filter((finding) => beforeIds.has(finding.id))),
    screenshots: { before: screenshotPath(before), after: screenshotPath(after) }
  };
}

export function renderComparisonJson(comparison: AuditComparison): string {
  return `${JSON.stringify(comparison, null, 2)}\n`;
}

export function renderComparisonMarkdown(comparison: AuditComparison, options: ReportRenderOptions = {}): string {
  const evidence = (finding: Finding) => finding.evidence.map((item) => `${item.label}: ${item.value}`).join("; ");
  const section = (title: string, empty: string, header: string[], rows: string[][]): string[] => [
    `## ${title}`,
    "",
    ...(rows.length === 0
      ? [empty]
      : [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`)]),
    ""
  ];

  const lines = [
    `# ${brandName(options.brand)} Progress Report`,
    "",
    `- Site: ${comparison.url}`,
    `- Before: ${comparison.beforeScannedAt}`,
    `- After: ${comparison.afterScannedAt}`,
    `- Profile: ${comparison.profile}`,
    "",
    "## Summary",
    "",
    `- Overall health: ${comparison.overall.before}/100 -> ${comparison.overall.after}/100 (${signed(comparison.overall.change)})`,
    `- Fixed issues: ${comparison.fixed.length}`,
    `- Still open: ${comparison.remaining.length}`,
    `- New issues: ${comparison.introduced.length}`,
    "",
    "## Score Changes",
    "",
    "| Category | Before | After | Change |",
    "| --- | ---: | ---: | ---: |",
    ...Object.values(comparison.scores).map(
      (score) => `| ${escapeCell(score.label)} | ${score.before}/${score.max} | ${score.after}/${score.max} | ${signed(score.change)} |`
    ),
    "",
    ...section(
      "Fixed Issues",
      "No issues from the earlier audit were fixed.",
      ["Severity", "Finding"],
      comparison.fixed.map((finding) => [finding.severity, finding.title])
    ),
    ...section(
      "Still Open",
      "No issues from the earlier audit are still open.",
      ["Severity", "Finding", "Recommendation"],
      comparison.remaining.map((finding) => [finding.severity, finding.title, finding.recommendation])
    ),
    ...section(
      "New Issues",
      "No new issues were found.",
      ["Severity", "Finding", "Evidence", "Recommendation"],
      comparison.introduced.map((finding) => [finding.severity, finding.title, evidence(finding), finding.recommendation])
    ),
    ...(comparison.screenshots.before || comparison.screenshots.after
      ? [
          "## Screenshots",
          "",
          `- Before: ${comparison.screenshots.before ? "Captured" : "Not captured"}`,
          `- After: ${comparison.screenshots.after ? "Captured" : "Not captured"}`,
          "",
          "Use the HTML or PDF format to see them side by side.",
          ""
        ]
      : [])
  ];

  return `${lines.join("\n")}\n`;
}

export function renderComparisonHtml(comparison: AuditComparison, options: ComparisonRenderOptions = {}): string {
  const brand = options.brand;
  const name = brandName(brand);
  const table = (empty: string, header: string[], rows: string[][]): string =>
    rows.length === 0
      ? `<p>${escapeHtml(empty)}</p>`
      : `<table>
      <thead><tr>${header.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("")}</tr></thead>
      <tbody>
${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("\n")}
      </tbody>
    </table>`;
  const evidence = (finding: Finding) => finding.evidence.map((item) => `${item.label}: ${item.value}`).join("; ");
  const scoreRows = Object.values(comparison.scores).map((score) => [
    score.label,
    `${score.before}/${score.max}`,
    `${score.after}/${score.max}`,
    signed(score.change)
  ]);
  const footer =
    brand?.footerText || brand?.contact
      ? `<footer class="meta">${escapeHtml([brand.footerText, brand.contact].filter(Boolean).join(" | "))}</footer>\n`
      : "";
  const figure = (label: string, scannedAt: string, screenshot: ComparisonScreenshot | undefined): string => {
    const image = screenshot
      ? `<img src="data:image/${screenshot.type};base64,${screenshot.data.toString("base64")}" alt="${escapeHtml(label)} screenshot">`
      : "<p>Not captured</p>";
    return `<figure>${image}<figcaption>${escapeHtml(label)} (${escapeHtml(scannedAt)})</figcaption></figure>`;
  };
  const screenshots =
    options.screenshots?.before || options.screenshots?.after
      ? `    <section>
    <h2>Before and After</h2>
    <div class="shots">${figure("Before", comparison.beforeScannedAt, options.screenshots.before)}${figure("After", comparison.afterScannedAt, options.screenshots.after)}</div>
    </section>
`
      : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(name)} Progress Report - ${escapeHtml(comparison.url)}</title>
    <style>
      :root { color-scheme: light; --ink: #172026; --muted: #5f6b75; --line: #d8dee5; --panel: #f6f8fa; --brand: ${escapeHtml(brand?.primaryColor ?? "#145a73")}; --accent: ${escapeHtml(brand?.accentColor ?? "#2f7d5f")}; }
      * { box-sizing: border-box; }
      body { background: #eef2f5; color: var(--ink); font-family: Arial, sans-serif; line-height: 1.5; margin: 0; }
      .report-shell { max-width: 1120px; margin: 0 auto; padding: 2rem; }
      .hero, section { background: #ffffff; border: 1px solid var(--line); border-radius: 8px; padding: 1.25rem; }
      section { margin-top: 1rem; }
      .eyebrow { color: var(--brand); font-size: 0.78rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
      .meta { color: var(--muted); }
      .score-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); margin: 1rem 0; }
      .score-card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 1rem; }
      .score-card strong { display: block; font-size: 1.8rem; }
      .score-card .fixed { color: var(--accent); }
      table { border-collapse: collapse; width: 100%; }
      th, td { border-bottom: 1px solid var(--line); padding: 0.65rem; text-align: left; vertical-align: top; }
      th { background: var(--panel); color: var(--muted); font-size: 0.82rem; text-transform: uppercase; }
      tr:last-child td { border-bottom: 0; }
      .shots { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
      figure { margin: 0; }
      figure img { border: 1px solid var(--line); border-radius: 8px; display: block; max-height: 900px; object-fit: cover; object-position: top; width: 100%; }
      figcaption { color: var(--muted); margin-top: 0.4rem; }
    </style>
  </head>
  <body>
    <main class="report-shell">
    <header class="hero">
      <div class="eyebrow">${escapeHtml(name)}</div>
      <h1>${escapeHtml(name)} Progress Report</h1>
      <p class="meta">Site: ${escapeHtml(comparison.url)}<br>Before: ${escapeHtml(comparison.beforeScannedAt)}<br>After: ${escapeHtml(comparison.afterScannedAt)}<br>Profile: ${escapeHtml(comparison.profile)}</p>
      <div class="score-grid">
        <div class="score-card"><span>Overall Health</span><strong>${comparison.overall.before} &rarr; ${comparison.overall.after}</strong><span>${signed(comparison.overall.change)} points</span></div>
        <div class="score-card"><span>Fixed Issues</span><strong class="fixed">${comparison.fixed.length}</strong></div>
        <div class="score-card"><span>Still Open</span><strong>${comparison.remaining.length}</strong></div>
        <div class="score-card"><span>New Issues</span><strong>${comparison.introduced.length}</strong></div>
      </div>
    </header>
    <section>
    <h2>Score Changes</h2>
    ${table("No category scores were found.", ["Category", "Before", "After", "Change"], scoreRows)}
    </section>
    <section>
    <h2>Fixed Issues</h2>
    ${table("No issues from the earlier audit were fixed.", ["Severity", "Finding"], comparison.fixed.map((finding) => [finding.severity, finding.title]))}
    </section>
    <section>
    <h2>Still Open</h2>
    ${table("No issues from the earlier audit are still open.", ["Severity", "Finding", "Recommendation"], comparison.remaining.map((finding) => [finding.severity, finding.title, finding.recommendation]))}
    </section>
    <section>
    <h2>New Issues</h2>
    ${table("No new issues were found.", ["Severity", "Finding", "Evidence", "Recommendation"], comparison.introduced.map((finding) => [finding.severity, finding.title, evidence(finding), finding.recommendation]))}
    </section>
${screenshots}${footer}    </main>
  </body>
</html>
`;
}

export async function renderComparisonPdf(comparison: AuditComparison, options: ComparisonRenderOptions = {}): Promise<Buffer> {
  const brand = options.brand;
  const name = brandName(brand);
  const primaryColor = brand?.primaryColor ?? "#145a73";
  const accentColor = brand?.accentColor ?? "#2f7d5f";
  // pdfkit is loaded on demand so the CLI does not pay for it on every start.
  const { default: PDFDocument } = await import("pdfkit");
  const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: `${name} Progress Report`, Author: name } });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolveBuffer, reject) => {
    doc.on("end", () => resolveBuffer(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const sectionTitle = (title: string) => {
    doc.moveDown(1);
    doc.font("Helvetica-Bold").fontSize(14).fillColor(primaryColor).text(title);
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(10).fillColor("#172026");
  };
  const findingList = (findings: Finding[], empty: string, withRecommendation: boolean) => {
    if (findings.length === 0) {
      doc.text(empty);
      return;
    }
    for (const finding of findings) {
      doc.font("Helvetica-Bold").text(`${finding.severity.toUpperCase()} - ${finding.title}`);
      if (withRecommendation) {
        doc.font("Helvetica").text(finding.recommendation);
      }
      doc.font("Helvetica").moveDown(0.3);
    }
  };

  doc.rect(0, 0, doc.page.width, 92).fill(primaryColor);
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(22).text(`${name} Progress Report`, 48, 32);
  doc.font("Helvetica").fontSize(10).text(comparison.url, 48, 60);
  doc.fillColor("#172026").fontSize(10).text("", 48, 118);
  doc.text(`Before: ${comparison.beforeScannedAt}`);
  doc.text(`After: ${comparison.afterScannedAt}`);
  doc.text(`Profile: ${comparison.profile}`);
  doc.moveDown(0.8);
  doc
    .font("Helvetica-Bold")
    .fontSize(18)
    .fillColor(accentColor)
    .text(`Overall Health: ${comparison.overall.before} -> ${comparison.overall.after} (${signed(comparison.overall.change)})`);
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#172026")
    .text(`Fixed: ${comparison.fixed.length}    Still open: ${comparison.remaining.length}    New: ${comparison.introduced.length}`);

  sectionTitle("Score Changes");
  for (const score of Object.values(comparison.scores)) {
    doc.text(`${score.label}: ${score.before}/${score.max} -> ${score.after}/${score.max} (${signed(score.change)})`);
  }
  sectionTitle("Fixed Issues");
  findingList(comparison.fixed, "No issues from the earlier audit were fixed.", false);
  sectionTitle("Still Open");
  findingList(comparison.remaining, "No issues from the earlier audit are still open.", true);
  sectionTitle("New Issues");
  findingList(comparison.introduced, "No new issues were found.", true);

  const shots = [
    ["Before", comparison.beforeScannedAt, options.screenshots?.before],
    ["After", comparison.afterScannedAt, options.screenshots?.after]
  ] as const;
  if (shots.some(([, , shot]) => shot)) {
    doc.addPage();
    doc.font("Helvetica-Bold").fontSize(14).fillColor(primaryColor).text("Before and After");
    const top = doc.y + 8;
    const width = (doc.page.width - 48 * 2 - 16) / 2;
    shots.forEach(([label, scannedAt, shot], index) => {
      const x = 48 + index * (width + 16);
      doc.font("Helvetica").fontSize(9).fillColor("#5f6b75").text(`${label} (${scannedAt})`, x, top, { width });
      if (shot) {
        doc.image(shot.data, x, top + 16, { fit: [width, doc.page.height - top - 96], align: "center" });
      } else {
        doc.text("Not captured", x, top + 16, { width });
      }
    });
  }

  if (brand?.footerText || brand?.contact) {
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#5f6b75")
      .text([brand.footerText, brand.contact].filter(Boolean).join(" | "), 48, doc.page.height - 64, { width: doc.page.width - 96 });
  }

  doc.end();
  return await finished;
}
