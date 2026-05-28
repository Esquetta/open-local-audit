import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { AuditReport, Finding } from "./types.js";

export interface ReportPackOptions {
  inputDir: string;
  outDir: string;
}

export interface ReportPackManifest {
  generatedAt: string;
  sourceReport: string;
  url: string;
  finalUrl: string;
  score: number;
  files: string[];
}

export interface ReportPackResult {
  outDir: string;
  manifest: ReportPackManifest;
}

const reportFileNames = [
  "open-local-audit-report.json",
  "open-local-audit-report.md",
  "open-local-audit-report.html",
  "open-local-audit-report.pdf"
];

function totalScore(report: AuditReport): number {
  const scores = Object.values(report.scores);
  return scores.length === 0 ? 0 : Math.round(scores.reduce((total, score) => total + score.score, 0) / scores.length);
}

function severityRank(finding: Finding): number {
  return {
    high: 0,
    medium: 1,
    low: 2,
    info: 3
  }[finding.severity];
}

function topFindings(report: AuditReport): Finding[] {
  return [...report.findings].sort((left, right) => severityRank(left) - severityRank(right)).slice(0, 5);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function readAuditReport(inputDir: string): Promise<AuditReport> {
  const reportPath = join(inputDir, "open-local-audit-report.json");
  if (!(await fileExists(reportPath))) {
    throw new Error("package-report requires open-local-audit-report.json in the input directory");
  }

  return JSON.parse(await readFile(reportPath, "utf8")) as AuditReport;
}

function renderReadme(report: AuditReport, manifest: ReportPackManifest): string {
  const findings = topFindings(report);
  return `${[
    "# Open Local Audit Report Pack",
    "",
    `- Website: ${report.finalUrl}`,
    `- Overall score: ${manifest.score}/100`,
    `- Generated: ${manifest.generatedAt}`,
    "",
    "## Included Files",
    "",
    ...manifest.files.map((file) => `- ${file}`),
    "",
    "## Top Findings",
    "",
    ...(findings.length > 0
      ? findings.map((finding) => `- [${finding.severity}] ${finding.title}: ${finding.recommendation}`)
      : ["- No findings were detected by the current rule set."]),
    "",
    "## Notes",
    "",
    "This package is local output only. It does not send outreach, upload reports, or sync data to a CRM."
  ].join("\n")}\n`;
}

function renderNextActions(report: AuditReport): string {
  const findings = topFindings(report);
  return `${[
    "# Next Actions",
    "",
    `Website: ${report.finalUrl}`,
    "",
    "## Recommended Fix Order",
    "",
    ...(findings.length > 0
      ? findings.map((finding, index) => `${index + 1}. ${finding.recommendation}`)
      : ["1. Keep monitoring the page as content and templates change."]),
    "",
    "## Contact Readiness",
    "",
    `- Confidence: ${report.contact?.contactConfidence ?? "None"}`,
    `- Public email: ${report.contact?.publicEmail ?? ""}`,
    `- Public phone: ${report.contact?.publicPhone ?? ""}`,
    `- Contact page: ${report.contact?.contactPageUrl ?? ""}`
  ].join("\n")}\n`;
}

export async function packageReport(options: ReportPackOptions): Promise<ReportPackResult> {
  const report = await readAuditReport(options.inputDir);
  const reportsDir = join(options.outDir, "reports");
  await mkdir(reportsDir, { recursive: true });

  const files: string[] = [];
  for (const fileName of reportFileNames) {
    const sourcePath = join(options.inputDir, fileName);
    if (await fileExists(sourcePath)) {
      const targetPath = join(reportsDir, fileName);
      await copyFile(sourcePath, targetPath);
      files.push(`reports/${basename(targetPath)}`);
    }
  }

  const manifest: ReportPackManifest = {
    generatedAt: new Date().toISOString(),
    sourceReport: "open-local-audit-report.json",
    url: report.url,
    finalUrl: report.finalUrl,
    score: totalScore(report),
    files: ["README.md", "next-actions.md", "manifest.json", ...files]
  };

  await writeFile(join(options.outDir, "README.md"), renderReadme(report, manifest), "utf8");
  await writeFile(join(options.outDir, "next-actions.md"), renderNextActions(report), "utf8");
  await writeFile(join(options.outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return {
    outDir: options.outDir,
    manifest
  };
}
