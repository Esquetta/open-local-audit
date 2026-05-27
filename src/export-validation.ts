import { cleanInputLines, parseCsvLine } from "./csv.js";

export type ExportValidationPreset = "crm";
export type ExportValidationFormat = "json" | "markdown";
export type ExportValidationSeverity = "error" | "warning";

export interface ExportValidationIssue {
  severity: ExportValidationSeverity;
  code: string;
  message: string;
  row?: number;
  column?: string;
}

export interface ExportValidationSummary {
  preset: ExportValidationPreset;
  rows: number;
  errors: number;
  warnings: number;
  valid: boolean;
}

export interface ExportValidationResult {
  summary: ExportValidationSummary;
  issues: ExportValidationIssue[];
}

const crmRequiredColumns = [
  "companyName",
  "website",
  "segment",
  "profile",
  "priority",
  "score",
  "opportunityScore",
  "topFinding",
  "contactConfidence",
  "preferredContactChannel",
  "contactabilityReason",
  "publicEmail",
  "publicPhone",
  "contactPageUrl",
  "source",
  "leadKey",
  "reportPath"
];

const lowConfidenceValues = new Set(["low", "none", ""]);

function rowValue(row: Record<string, string>, column: string): string {
  return row[column]?.trim() ?? "";
}

function parseCsvRows(content: string): { headers: string[]; rows: Array<Record<string, string>> } {
  const lines = cleanInputLines(content);
  if (lines.length === 0) {
    return {
      headers: [],
      rows: []
    };
  }

  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });

  return {
    headers,
    rows
  };
}

export function validateCrmExportCsv(content: string): ExportValidationResult {
  const { headers, rows } = parseCsvRows(content);
  const issues: ExportValidationIssue[] = [];
  const headerSet = new Set(headers);

  for (const column of crmRequiredColumns) {
    if (!headerSet.has(column)) {
      issues.push({
        severity: "error",
        code: "missing-column",
        column,
        message: `Missing required CRM column: ${column}`
      });
    }
  }

  if (issues.some((issue) => issue.code === "missing-column")) {
    return summarize(rows.length, issues);
  }

  const seenLeadKeys = new Map<string, number>();
  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const companyName = rowValue(row, "companyName");
    const website = rowValue(row, "website");
    const leadKey = rowValue(row, "leadKey");
    const contactConfidence = rowValue(row, "contactConfidence").toLowerCase();
    const preferredContactChannel = rowValue(row, "preferredContactChannel");

    if (!companyName) {
      issues.push({
        severity: "error",
        code: "missing-company-name",
        row: rowNumber,
        column: "companyName",
        message: "CRM row is missing companyName."
      });
    }

    if (!website) {
      issues.push({
        severity: "error",
        code: "missing-website",
        row: rowNumber,
        column: "website",
        message: "CRM row is missing website."
      });
    }

    if (!leadKey) {
      issues.push({
        severity: "error",
        code: "missing-lead-key",
        row: rowNumber,
        column: "leadKey",
        message: "CRM row is missing leadKey."
      });
    } else if (seenLeadKeys.has(leadKey)) {
      issues.push({
        severity: "error",
        code: "duplicate-lead-key",
        row: rowNumber,
        column: "leadKey",
        message: `Duplicate leadKey also appears on row ${seenLeadKeys.get(leadKey)}.`
      });
    } else {
      seenLeadKeys.set(leadKey, rowNumber);
    }

    if (lowConfidenceValues.has(contactConfidence)) {
      issues.push({
        severity: "warning",
        code: "low-contact-confidence",
        row: rowNumber,
        column: "contactConfidence",
        message: "Contact confidence is low or empty; review before CRM import."
      });
    }

    if (preferredContactChannel === "manual-review") {
      issues.push({
        severity: "warning",
        code: "manual-contact-review",
        row: rowNumber,
        column: "preferredContactChannel",
        message: "Preferred contact channel requires manual review."
      });
    }
  });

  return summarize(rows.length, issues);
}

function summarize(rows: number, issues: ExportValidationIssue[]): ExportValidationResult {
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  return {
    summary: {
      preset: "crm",
      rows,
      errors,
      warnings,
      valid: issues.length === 0
    },
    issues
  };
}

export function renderExportValidationJson(result: ExportValidationResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function renderExportValidationMarkdown(result: ExportValidationResult): string {
  const lines = [
    "# CRM Export Validation",
    "",
    `- Rows: ${result.summary.rows}`,
    `- Errors: ${result.summary.errors}`,
    `- Warnings: ${result.summary.warnings}`,
    `- Valid: ${result.summary.valid ? "yes" : "no"}`
  ];

  if (result.issues.length === 0) {
    return `${[...lines, "", "No import issues found."].join("\n")}\n`;
  }

  return `${[
    ...lines,
    "",
    "| Severity | Row | Column | Code | Message |",
    "| --- | ---: | --- | --- | --- |",
    ...result.issues.map((issue) =>
      [
        issue.severity,
        issue.row?.toString() ?? "",
        issue.column ?? "",
        issue.code,
        issue.message.replace(/\|/g, "\\|")
      ].join(" | ")
    )
  ].join("\n")}\n`;
}
