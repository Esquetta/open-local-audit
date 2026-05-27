import { describe, expect, it } from "vitest";
import {
  renderExportValidationMarkdown,
  validateCrmExportCsv
} from "../src/export-validation.js";

const crmHeader =
  "companyName,website,segment,profile,priority,score,opportunityScore,topFinding,contactConfidence,preferredContactChannel,contactabilityReason,publicEmail,publicPhone,contactPageUrl,source,leadKey,reportPath";

describe("CRM export validation", () => {
  it("accepts a complete CRM export row", () => {
    const result = validateCrmExportCsv(
      `${crmHeader}\nClinic A,https://clinic-a.test,dental,dental,high,82,74,Low contrast,High,email,Public email found,hello@clinic-a.test,'+902120000000,https://clinic-a.test/contact,manual-csv,url:https://clinic-a.test,clinic-a/open-local-audit-report.html\n`
    );

    expect(result.summary).toEqual({
      preset: "crm",
      rows: 1,
      errors: 0,
      warnings: 0,
      valid: true
    });
    expect(result.issues).toEqual([]);
  });

  it("reports missing CRM preset columns before row checks", () => {
    const result = validateCrmExportCsv("companyName,website\nClinic A,https://clinic-a.test\n");

    expect(result.summary.valid).toBe(false);
    expect(result.summary.errors).toBeGreaterThan(0);
    expect(result.issues).toContainEqual({
      severity: "error",
      code: "missing-column",
      column: "leadKey",
      message: "Missing required CRM column: leadKey"
    });
    expect(result.issues.some((issue) => issue.code === "missing-company-name")).toBe(false);
  });

  it("reports row-level import blockers and advisory contact issues", () => {
    const result = validateCrmExportCsv(
      [
        crmHeader,
        "Clinic A,https://clinic-a.test,dental,dental,medium,82,74,Low contrast,Low,manual-review,Needs review,,,,manual-csv,url:https://clinic-a.test,clinic-a/open-local-audit-report.html",
        ",,dental,dental,medium,70,60,Missing title,None,manual-review,No public contact,,,,manual-csv,url:https://clinic-a.test,clinic-b/open-local-audit-report.html"
      ].join("\n")
    );

    expect(result.summary).toEqual({
      preset: "crm",
      rows: 2,
      errors: 3,
      warnings: 4,
      valid: false
    });
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "low-contact-confidence",
      "manual-contact-review",
      "missing-company-name",
      "missing-website",
      "duplicate-lead-key",
      "low-contact-confidence",
      "manual-contact-review"
    ]);
  });

  it("renders a compact markdown validation report", () => {
    const markdown = renderExportValidationMarkdown(
      validateCrmExportCsv(`${crmHeader}\nClinic A,https://clinic-a.test,dental,dental,high,82,74,Low contrast,High,email,Public email found,,,,manual-csv,url:https://clinic-a.test,\n`)
    );

    expect(markdown).toContain("# CRM Export Validation");
    expect(markdown).toContain("- Rows: 1");
    expect(markdown).toContain("No import issues found.");
  });
});
