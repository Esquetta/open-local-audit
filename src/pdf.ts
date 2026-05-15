import PDFDocument from "pdfkit";
import type { AuditReport, Severity } from "./types.js";

function overallScore(report: AuditReport): number {
  const scores = Object.values(report.scores);
  return scores.length === 0 ? 0 : Math.round(scores.reduce((total, score) => total + score.score, 0) / scores.length);
}

function severityLabel(severity: Severity): string {
  return severity.toUpperCase();
}

function writeKeyValue(doc: PDFKit.PDFDocument, label: string, value: string): void {
  doc.font("Helvetica-Bold").text(`${label}: `, { continued: true });
  doc.font("Helvetica").text(value);
}

function writeSectionTitle(doc: PDFKit.PDFDocument, title: string): void {
  doc.moveDown(1);
  doc.font("Helvetica-Bold").fontSize(14).fillColor("#145a73").text(title);
  doc.moveDown(0.3);
  doc.font("Helvetica").fontSize(10).fillColor("#172026");
}

export async function renderPdfReport(report: AuditReport): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margin: 48,
    info: {
      Title: "Open Local Audit Report",
      Author: "Open Local Audit"
    }
  });
  const chunks: Buffer[] = [];

  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.rect(0, 0, doc.page.width, 92).fill("#145a73");
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(22).text("Open Local Audit Report", 48, 32);
  doc.font("Helvetica").fontSize(10).text("Evidence-backed local business website audit", 48, 60);
  doc.fillColor("#172026").fontSize(10).text("", 48, 118);

  writeKeyValue(doc, "URL", report.url);
  writeKeyValue(doc, "Final URL", report.finalUrl);
  writeKeyValue(doc, "Scanned at", report.scannedAt);
  writeKeyValue(doc, "Profile", report.profile ?? "generic");
  doc.moveDown(0.8);
  doc.font("Helvetica-Bold").fontSize(18).fillColor("#2f7d5f").text(`Overall Health: ${overallScore(report)}/100`);
  doc.font("Helvetica").fontSize(10).fillColor("#172026").text(
    `Priority Findings: ${report.summary.high + report.summary.medium}    Total Findings: ${report.summary.totalFindings}`
  );

  writeSectionTitle(doc, "Score Summary");
  for (const score of Object.values(report.scores)) {
    writeKeyValue(doc, score.label, `${score.score}/${score.max}`);
  }

  if (report.lighthouse) {
    writeSectionTitle(doc, "Lighthouse Summary");
    const categories = report.lighthouse.categories;
    writeKeyValue(doc, "Performance", categories.performance?.toString() ?? "N/A");
    writeKeyValue(doc, "Accessibility", categories.accessibility?.toString() ?? "N/A");
    writeKeyValue(doc, "Best practices", categories.bestPractices?.toString() ?? "N/A");
    writeKeyValue(doc, "SEO", categories.seo?.toString() ?? "N/A");
  }

  writeSectionTitle(doc, "Priority Findings");
  for (const finding of report.findings.slice(0, 8)) {
    doc.font("Helvetica-Bold").fillColor("#172026").text(`${severityLabel(finding.severity)} - ${finding.title}`);
    doc.font("Helvetica").fillColor("#172026").text(finding.recommendation);
    doc.moveDown(0.35);
  }

  writeSectionTitle(doc, "Recommendations");
  for (const recommendation of report.recommendations.slice(0, 10)) {
    doc.text(`- ${recommendation}`);
  }

  doc.end();
  return await finished;
}
