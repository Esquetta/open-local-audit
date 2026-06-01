import { describe, expect, it } from "vitest";
import {
  buildLeadShortlist,
  readShortlistReviewCsv,
  renderShortlistJson,
  renderShortlistMarkdown
} from "../src/shortlist.js";

describe("lead shortlist", () => {
  it("ranks discovery leads by opportunity, priority, contact confidence, and score", () => {
    const result = buildLeadShortlist(
      [
        "leadKey,label,websiteUrl,segment,profile,priority,score,opportunityScore,topFinding,opportunityReasons,contactConfidence,preferredContactChannel,contactabilityReason,reportPath",
        "url:https://low.test,Low Lead,https://low.test,dental,dental,low,98,50,Minor issue,Low reason,High,email,Public email found,low/open-local-audit-report.html",
        "url:https://best.test,Best Lead,https://best.test,dental,dental,medium,70,95,Missing CTA,High opportunity,Medium,phone,Phone found,best/open-local-audit-report.html",
        "url:https://tie.test,Tie Lead,https://tie.test,dental,dental,high,75,95,Missing title,Tie opportunity,High,email,Public email found,tie/open-local-audit-report.html"
      ].join("\n"),
      { top: 2 }
    );

    expect(result.totalRows).toBe(3);
    expect(result.selected).toBe(2);
    expect(result.leads.map((lead) => lead.companyName)).toEqual(["Tie Lead", "Best Lead"]);
    expect(result.leads[0]).toMatchObject({
      rank: 1,
      opportunityScore: 95,
      priority: "high",
      contactConfidence: "High",
      reason: "Tie opportunity"
    });
  });

  it("supports CRM export column names", () => {
    const result = buildLeadShortlist(
      [
        "companyName,website,segment,profile,priority,score,opportunityScore,topFinding,contactConfidence,preferredContactChannel,contactabilityReason,publicEmail,publicPhone,contactPageUrl,source,leadKey,reportPath",
        "CRM Lead,https://crm.test,clinic,clinic,medium,82,74,Low contrast,High,email,Public email found,hello@crm.test,'+902120000000,https://crm.test/contact,manual-csv,url:https://crm.test,crm/open-local-audit-report.html"
      ].join("\n")
    );

    expect(result.leads[0]).toMatchObject({
      companyName: "CRM Lead",
      website: "https://crm.test",
      reportPath: "crm/open-local-audit-report.html",
      reason: "Low contrast"
    });
  });

  it("renders markdown and JSON shortlist reports", () => {
    const result = buildLeadShortlist(
      [
        "companyName,website,priority,score,opportunityScore,contactConfidence,preferredContactChannel,topFinding,reportPath",
        "Lead A,https://a.test,high,80,90,High,email,Missing CTA,a/open-local-audit-report.html"
      ].join("\n")
    );

    expect(renderShortlistMarkdown(result)).toContain(
      "| 1 | Lead A | https://a.test | high | 90 | 80 | High | email | Missing CTA | new |  |  | a/open-local-audit-report.html |"
    );
    expect(JSON.parse(renderShortlistJson(result))).toMatchObject({
      totalRows: 1,
      suppressedRows: 0,
      selected: 1,
      leads: [{ companyName: "Lead A" }]
    });
  });

  it("suppresses completed review rows and carries active review metadata", () => {
    const reviewRows = readShortlistReviewCsv(
      [
        "leadKey,websiteUrl,label,reviewStatus,reviewReason,lastReviewedAt",
        "url:https://old.test,https://old.test,Old Lead,contacted,Already contacted,2026-06-01",
        "url:https://fresh.test,https://fresh.test,Fresh Lead,pending,Needs manual review,2026-06-02"
      ].join("\n")
    );
    const result = buildLeadShortlist(
      [
        "leadKey,label,websiteUrl,priority,score,opportunityScore,topFinding,contactConfidence,preferredContactChannel,reportPath",
        "url:https://old.test,Old Lead,https://old.test,high,90,99,Missing CTA,High,email,old/open-local-audit-report.html",
        "url:https://fresh.test,Fresh Lead,https://fresh.test,medium,80,88,Missing title,Medium,phone,fresh/open-local-audit-report.html"
      ].join("\n"),
      { reviewRows }
    );

    expect(result.totalRows).toBe(2);
    expect(result.suppressedRows).toBe(1);
    expect(result.leads).toHaveLength(1);
    expect(result.leads[0]).toMatchObject({
      companyName: "Fresh Lead",
      reviewStatus: "pending",
      reviewReason: "Needs manual review",
      lastReviewedAt: "2026-06-02"
    });
  });

  it("matches review rows by normalized website when lead keys are absent", () => {
    const result = buildLeadShortlist(
      [
        "label,websiteUrl,priority,score,opportunityScore,topFinding,contactConfidence",
        "Website Match,https://www.match.test/,high,90,95,Missing CTA,High",
        "Fresh Lead,https://fresh.test,medium,80,88,Missing title,Medium"
      ].join("\n"),
      {
        reviewRows: readShortlistReviewCsv(
          "websiteUrl,reviewStatus,reviewReason,lastReviewedAt\nhttps://match.test,suppressed,Duplicate,2026-06-01\n"
        )
      }
    );

    expect(result.suppressedRows).toBe(1);
    expect(result.leads.map((lead) => lead.companyName)).toEqual(["Fresh Lead"]);
  });

  it("requires a header and at least one lead row", () => {
    expect(() => buildLeadShortlist("companyName,website\n")).toThrow(
      "shortlist requires a CSV file with a header and at least one lead row"
    );
  });

  it("requires a positive top value", () => {
    expect(() => buildLeadShortlist("companyName,website\nLead A,https://a.test\n", { top: 0 })).toThrow(
      "shortlist --top must be a positive integer"
    );
  });
});
