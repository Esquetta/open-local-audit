import { existsSync, readFileSync } from "node:fs";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildLeadShortlist,
  readShortlistReviewCsv,
  renderShortlistCsv,
  renderShortlistSummaryJson
} from "../src/shortlist.js";

describe("runShortlistReport", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads a discovery CSV, writes markdown and summary outputs, creates parent directories, and returns the exact shortlist result", async () => {
    const dir = mkdtempSync(join(tmpdir(), "open-local-audit-shortlist-runner-"));

    try {
      const input = join(dir, "input", "discovery.csv");
      const out = join(dir, "nested", "reports", "shortlist.md");
      const summaryJson = join(dir, "nested", "summaries", "shortlist-summary.json");
      mkdirSync(dirname(input), { recursive: true });
      writeFileSync(
        input,
        [
          "leadKey,label,websiteUrl,segment,profile,priority,score,opportunityScore,topFinding,opportunityReasons,contactConfidence,preferredContactChannel,contactabilityReason,reportPath,source,auditStatus,hasWebsite",
          "url:https://tie.test,Tie Lead,https://tie.test,dental,dental,high,75,95,Missing title,Tie opportunity,High,email,Public email found,tie/open-local-audit-report.html,manual-csv,success,yes",
          "url:https://best.test,Best Lead,https://best.test,dental,dental,medium,70,95,Missing CTA,High opportunity,Medium,phone,Phone found,best/open-local-audit-report.html,manual-csv,success,yes",
          "url:https://low.test,Low Lead,https://low.test,dental,dental,low,98,50,Minor issue,Low reason,High,email,Public email found,low/open-local-audit-report.html,manual-csv,success,yes"
        ].join("\n"),
        "utf8"
      );

      const expected = buildLeadShortlist(readFileSync(input, "utf8"), {
        top: 2,
        segment: "dental",
        sort: "opportunity-desc"
      });

      const { runShortlistReport } = await import("../src/shortlist-runner.js");
      const result = await runShortlistReport({
        input,
        out,
        summaryJson,
        format: "markdown",
        shortlist: {
          top: 2,
          segment: "dental",
          sort: "opportunity-desc"
        }
      });

      expect(result).toEqual(expected);
      expect(readFileSync(out, "utf8")).toContain("# Lead Shortlist");
      expect(JSON.parse(readFileSync(summaryJson, "utf8"))).toEqual(JSON.parse(renderShortlistSummaryJson(expected)));
      expect(existsSync(dirname(out))).toBe(true);
      expect(existsSync(dirname(summaryJson))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes a CSV shortlist report and summary selected count from a CRM export", async () => {
    const dir = mkdtempSync(join(tmpdir(), "open-local-audit-shortlist-runner-csv-"));

    try {
      const input = join(dir, "crm.csv");
      const out = join(dir, "reports", "shortlist.csv");
      const summaryJson = join(dir, "summary", "shortlist.json");
      writeFileSync(
        input,
        [
          "companyName,website,segment,profile,priority,score,opportunityScore,topFinding,contactConfidence,preferredContactChannel,contactabilityReason,source,leadKey,reportPath,auditStatus,hasWebsite",
          "CRM Lead A,https://crm-a.test,clinic,clinic,high,88,91,Missing CTA,High,email,Public email found,crm-import,url:https://crm-a.test,crm-a/open-local-audit-report.html,success,yes",
          "CRM Lead B,https://crm-b.test,clinic,clinic,medium,72,75,Missing Title,Medium,phone,Phone found,crm-import,url:https://crm-b.test,crm-b/open-local-audit-report.html,success,yes"
        ].join("\n"),
        "utf8"
      );

      const expected = buildLeadShortlist(readFileSync(input, "utf8"), {
        top: 1,
        sort: "score-desc"
      });

      const { runShortlistReport } = await import("../src/shortlist-runner.js");
      const result = await runShortlistReport({
        input,
        out,
        summaryJson,
        format: "csv",
        shortlist: {
          top: 1,
          sort: "score-desc"
        }
      });

      expect(result).toEqual(expected);
      expect(readFileSync(out, "utf8")).toBe(renderShortlistCsv(expected));
      expect(JSON.parse(readFileSync(summaryJson, "utf8")).selected).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads an optional review CSV and applies existing suppression and review-state rules", async () => {
    const dir = mkdtempSync(join(tmpdir(), "open-local-audit-shortlist-runner-review-"));

    try {
      const input = join(dir, "input.csv");
      const reviewCsv = join(dir, "review.csv");
      const out = join(dir, "reports", "shortlist.csv");
      writeFileSync(
        input,
        [
          "leadKey,label,websiteUrl,priority,score,opportunityScore,topFinding,contactConfidence,preferredContactChannel,reportPath,source",
          "url:https://old.test,Old Lead,https://old.test,high,90,99,Missing CTA,High,email,old/open-local-audit-report.html,manual-csv",
          "url:https://fresh.test,Fresh Lead,https://fresh.test,medium,80,88,Missing title,Medium,phone,fresh/open-local-audit-report.html,manual-csv"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        reviewCsv,
        [
          "leadKey,websiteUrl,label,reviewStatus,reviewReason,lastReviewedAt",
          "url:https://old.test,https://old.test,Old Lead,contacted,Already contacted,2026-06-01",
          "url:https://fresh.test,https://fresh.test,Fresh Lead,pending,Needs manual review,2026-06-02"
        ].join("\n"),
        "utf8"
      );

      const expected = buildLeadShortlist(readFileSync(input, "utf8"), {
        reviewRows: readShortlistReviewCsv(readFileSync(reviewCsv, "utf8"))
      });

      const { runShortlistReport } = await import("../src/shortlist-runner.js");
      const result = await runShortlistReport({
        input,
        out,
        reviewCsv,
        format: "csv",
        shortlist: {}
      });

      expect(result).toEqual(expected);
      expect(result.suppressedRows).toBe(1);
      expect(result.leads[0]).toMatchObject({
        companyName: "Fresh Lead",
        reviewStatus: "pending",
        reviewReason: "Needs manual review",
        lastReviewedAt: "2026-06-02"
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not read a review CSV when reviewCsv is omitted", async () => {
    const dir = mkdtempSync(join(tmpdir(), "open-local-audit-shortlist-runner-no-review-"));

    try {
      const input = join(dir, "input.csv");
      const out = join(dir, "reports", "shortlist.md");
      writeFileSync(
        input,
        [
          "companyName,website,priority,score,opportunityScore,topFinding,contactConfidence",
          "Lead A,https://a.test,high,80,90,Missing CTA,High"
        ].join("\n"),
        "utf8"
      );

      vi.resetModules();
      const readFileSpy = vi.fn<(path: string, encoding: BufferEncoding) => Promise<string>>();
      vi.doMock("node:fs/promises", async () => {
        const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
        return {
          ...actual,
          readFile: readFileSpy.mockImplementation((path, encoding) => actual.readFile(path, encoding))
        };
      });

      const { runShortlistReport } = await import("../src/shortlist-runner.js");
      await runShortlistReport({
        input,
        out,
        format: "markdown",
        shortlist: {}
      });

      expect(readFileSpy).toHaveBeenCalledTimes(1);
      expect(readFileSpy).toHaveBeenCalledWith(input, "utf8");
    } finally {
      vi.doUnmock("node:fs/promises");
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
