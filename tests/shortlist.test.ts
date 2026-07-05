import { describe, expect, it } from "vitest";
import {
  buildLeadShortlist,
  readShortlistReviewCsv,
  renderShortlistCsv,
  renderShortlistJson,
  renderShortlistMarkdown,
  renderShortlistSummaryJson
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
      "| 1 | Lead A | https://a.test |  |  |  | high | 90 | 80 | High | email | Missing CTA | new |  |  | a/open-local-audit-report.html |"
    );
    expect(JSON.parse(renderShortlistJson(result))).toMatchObject({
      totalRows: 1,
      suppressedRows: 0,
      filteredRows: 0,
      selected: 1,
      leads: [{ companyName: "Lead A" }]
    });
  });

  it("renders an automation summary JSON", () => {
    const result = buildLeadShortlist(
      [
        "companyName,website,priority,score,opportunityScore,contactConfidence,reviewStatus",
        "Lead A,https://a.test,high,80,90,High,pending"
      ].join("\n")
    );

    expect(JSON.parse(renderShortlistSummaryJson(result))).toEqual({
      totalRows: 1,
      suppressedRows: 0,
      filteredRows: 0,
      selected: 1,
      leads: [
        {
          rank: 1,
          companyName: "Lead A",
          website: "https://a.test",
          opportunityScore: 90,
          score: 80,
          reviewStatus: "pending"
        }
      ]
    });
  });

  it("renders a CSV shortlist report with review context and safe cells", () => {
    const result = buildLeadShortlist(
      [
        "companyName,website,segment,profile,priority,score,opportunityScore,contactConfidence,preferredContactChannel,topFinding,reviewStatus,reviewReason,lastReviewedAt,leadKey,reportPath",
        "Lead A,https://a.test,dental,dental,high,80,90,High,email,Missing CTA,pending,=Needs review,2026-06-03,url:https://a.test,a/open-local-audit-report.html"
      ].join("\n")
    );

    expect(renderShortlistCsv(result)).toBe(
      [
        "rank,companyName,website,segment,profile,priority,source,auditStatus,hasWebsite,opportunityScore,score,contactConfidence,preferredContactChannel,reason,reviewStatus,reviewReason,lastReviewedAt,leadKey,reportPath",
        "1,Lead A,https://a.test,dental,dental,high,,,,90,80,High,email,Missing CTA,pending,'=Needs review,2026-06-03,url:https://a.test,a/open-local-audit-report.html",
        ""
      ].join("\n")
    );
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

  it("filters leads below the minimum opportunity score before ranking", () => {
    const result = buildLeadShortlist(
      [
        "companyName,website,priority,score,opportunityScore,topFinding,contactConfidence",
        "Low Opportunity,https://low.test,high,95,60,Missing title,High",
        "Strong Opportunity,https://strong.test,medium,70,92,Missing CTA,Medium",
        "No Opportunity Score,https://unknown.test,high,99,,Missing meta,High"
      ].join("\n"),
      { minOpportunityScore: 80 }
    );

    expect(result.totalRows).toBe(3);
    expect(result.suppressedRows).toBe(0);
    expect(result.filteredRows).toBe(2);
    expect(result.leads.map((lead) => lead.companyName)).toEqual(["Strong Opportunity"]);
    expect(renderShortlistMarkdown(result)).toContain("- Filtered rows: 2");
  });

  it("filters leads by segment, profile, priority, and contact confidence", () => {
    const result = buildLeadShortlist(
      [
        "companyName,website,segment,profile,priority,score,opportunityScore,topFinding,contactConfidence",
        "Dental Match,https://match.test,Dental,dental,High,80,92,Missing CTA,High",
        "Wrong Segment,https://segment.test,beauty,dental,high,90,95,Missing title,High",
        "Wrong Profile,https://profile.test,dental,clinic,high,90,95,Missing title,High",
        "Wrong Priority,https://priority.test,dental,dental,medium,90,95,Missing title,High",
        "Wrong Confidence,https://confidence.test,dental,dental,high,90,95,Missing title,Medium"
      ].join("\n"),
      {
        segment: "dental",
        profile: "DENTAL",
        priority: "high",
        contactConfidence: "HIGH"
      }
    );

    expect(result.filteredRows).toBe(4);
    expect(result.leads.map((lead) => lead.companyName)).toEqual(["Dental Match"]);
  });

  it("filters leads by active review status after suppression", () => {
    const result = buildLeadShortlist(
      [
        "companyName,website,priority,score,opportunityScore,topFinding,contactConfidence,reviewStatus,leadKey",
        "Pending Lead,https://pending.test,high,80,92,Missing CTA,High,Pending,",
        "New Lead,https://new.test,high,80,90,Missing CTA,High,new,",
        "Contacted Lead,https://contacted.test,high,80,95,Missing CTA,High,new,url:https://contacted.test"
      ].join("\n"),
      {
        reviewStatus: "pending",
        reviewRows: readShortlistReviewCsv(
          "leadKey,reviewStatus,reviewReason,lastReviewedAt\nurl:https://contacted.test,contacted,Already contacted,2026-06-05\n"
        )
      }
    );

    expect(result.suppressedRows).toBe(1);
    expect(result.filteredRows).toBe(1);
    expect(result.leads.map((lead) => lead.companyName)).toEqual(["Pending Lead"]);
  });

  it("excludes leads by active review status after suppression", () => {
    const result = buildLeadShortlist(
      [
        "companyName,website,priority,score,opportunityScore,topFinding,contactConfidence,reviewStatus,leadKey",
        "Pending Lead,https://pending.test,high,80,92,Missing CTA,High,pending,",
        "Deferred Lead,https://deferred.test,high,80,90,Missing CTA,High,Deferred,",
        "Contacted Lead,https://contacted.test,high,80,95,Missing CTA,High,pending,url:https://contacted.test"
      ].join("\n"),
      {
        excludeReviewStatus: "deferred",
        reviewRows: readShortlistReviewCsv(
          "leadKey,reviewStatus,reviewReason,lastReviewedAt\nurl:https://contacted.test,contacted,Already contacted,2026-06-05\n"
        )
      }
    );

    expect(result.suppressedRows).toBe(1);
    expect(result.filteredRows).toBe(1);
    expect(result.leads.map((lead) => lead.companyName)).toEqual(["Pending Lead"]);
  });

  it("filters leads without a review date after suppression", () => {
    const result = buildLeadShortlist(
      [
        "companyName,website,priority,score,opportunityScore,topFinding,contactConfidence,lastReviewedAt,leadKey",
        "Reviewed Lead,https://reviewed.test,high,80,98,Missing CTA,High,2026-06-10,reviewed-lead",
        "Unreviewed Lead,https://unreviewed.test,high,80,95,Missing CTA,High,,unreviewed-lead",
        'Whitespace Review Lead,https://whitespace.test,high,80,92,Missing CTA,High,"   ",whitespace-lead',
        "Suppressed Unreviewed Lead,https://suppressed.test,high,80,99,Missing CTA,High,,suppressed-lead"
      ].join("\n"),
      {
        unreviewed: true,
        reviewRows: readShortlistReviewCsv(
          "leadKey,reviewStatus,reviewReason,lastReviewedAt\nsuppressed-lead,contacted,Already contacted,2026-06-11\n"
        )
      }
    );

    expect(result.suppressedRows).toBe(1);
    expect(result.filteredRows).toBe(1);
    expect(result.leads.map((lead) => lead.companyName)).toEqual(["Unreviewed Lead", "Whitespace Review Lead"]);
  });

  it("filters leads reviewed before a strict UTC calendar threshold after suppression", () => {
    const result = buildLeadShortlist(
      [
        "companyName,website,priority,score,opportunityScore,topFinding,contactConfidence,lastReviewedAt,leadKey",
        "Older Lead,https://older.test,high,90,96,Missing CTA,High,2026-06-18,older-lead",
        "Older Timestamp Lead,https://older-timestamp.test,medium,85,94,Missing Title,Medium,2026-06-18T23:59:59Z,older-timestamp-lead",
        "Zone-less Timestamp Lead,https://zoneless.test,medium,84,93,Missing Schema,Medium,2026-06-18T23:59:59,zoneless-timestamp-lead",
        "Equal Lead,https://equal.test,high,88,93,Missing Meta,High,2026-06-19,equal-lead",
        "Newer Lead,https://newer.test,high,87,92,Missing Headline,High,2026-06-20,newer-lead",
        "Blank Review Lead,https://blank.test,high,86,91,Missing Copy,High,,blank-lead",
        "Invalid Calendar Lead,https://invalid-calendar.test,high,95,97,Missing Hours,High,2026-02-30,invalid-calendar-lead",
        "Suppressed Older Lead,https://suppressed.test,high,99,99,Missing Footer,High,2026-06-10,suppressed-lead"
      ].join("\n"),
      {
        reviewedBefore: "2026-06-19",
        reviewRows: readShortlistReviewCsv(
          "leadKey,reviewStatus,reviewReason,lastReviewedAt\nsuppressed-lead,contacted,Already contacted,2026-06-11\n"
        )
      }
    );

    expect(result.suppressedRows).toBe(1);
    expect(result.filteredRows).toBe(5);
    expect(result.selected).toBe(2);
    expect(result.leads.map((lead) => lead.companyName)).toEqual(["Older Lead", "Older Timestamp Lead"]);
  });

  it("rejects invalid reviewed-before thresholds", () => {
    for (const reviewedBefore of ["2026/06/19", "2026-6-19", "2026-02-30", "not-a-date"]) {
      expect(() =>
        buildLeadShortlist("companyName,website\nLead A,https://a.test\n", { reviewedBefore })
      ).toThrow("shortlist --reviewed-before must be a valid date in YYYY-MM-DD format");
    }
  });

  it("combines reviewed-before and unreviewed with AND semantics", () => {
    const result = buildLeadShortlist(
      [
        "companyName,website,priority,score,opportunityScore,topFinding,contactConfidence,lastReviewedAt",
        "Older Lead,https://older.test,high,90,96,Missing CTA,High,2026-06-18",
        "Equal Lead,https://equal.test,high,88,93,Missing Meta,High,2026-06-19"
      ].join("\n"),
      {
        reviewedBefore: "2026-06-19",
        unreviewed: true
      }
    );

    expect(result.filteredRows).toBe(2);
    expect(result.leads).toEqual([]);
  });

  it("requires leads to have a website after suppression", () => {
    const result = buildLeadShortlist(
      [
        "companyName,website,priority,score,opportunityScore,topFinding,contactConfidence",
        "Website Lead,https://website.test,high,80,92,Missing CTA,High",
        "No Website Lead,,high,80,90,Missing CTA,High"
      ].join("\n"),
      { requireWebsite: true }
    );

    expect(result.suppressedRows).toBe(0);
    expect(result.filteredRows).toBe(1);
    expect(result.leads.map((lead) => lead.companyName)).toEqual(["Website Lead"]);
  });

  it("filters leads missing a website after suppression", () => {
    const result = buildLeadShortlist(
      [
        "companyName,website,priority,score,opportunityScore,topFinding,contactConfidence,leadKey",
        "Website Lead,https://website.test,high,80,92,Missing CTA,High,website-lead",
        "No Website Lead,,high,80,90,Missing CTA,High,no-website-lead",
        "Suppressed No Website Lead,,high,80,95,Missing CTA,High,suppressed-lead"
      ].join("\n"),
      {
        missingWebsite: true,
        reviewRows: readShortlistReviewCsv(
          "leadKey,reviewStatus,reviewReason,lastReviewedAt\nsuppressed-lead,contacted,Already contacted,2026-06-17\n"
        )
      }
    );

    expect(result.suppressedRows).toBe(1);
    expect(result.filteredRows).toBe(1);
    expect(result.leads.map((lead) => lead.companyName)).toEqual(["No Website Lead"]);
  });

  it("requires leads to have contact confidence after suppression", () => {
    const result = buildLeadShortlist(
      [
        "companyName,website,priority,score,opportunityScore,topFinding,contactConfidence",
        "Contact Lead,https://contact.test,high,80,92,Missing CTA,Medium",
        "No Contact Lead,https://none.test,high,80,90,Missing CTA,None",
        "Blank Contact Lead,https://blank.test,high,80,88,Missing CTA,"
      ].join("\n"),
      { requireContact: true }
    );

    expect(result.suppressedRows).toBe(0);
    expect(result.filteredRows).toBe(2);
    expect(result.leads.map((lead) => lead.companyName)).toEqual(["Contact Lead"]);
  });

  it("filters leads missing contact confidence after suppression", () => {
    const result = buildLeadShortlist(
      [
        "companyName,website,priority,score,opportunityScore,topFinding,contactConfidence,leadKey",
        "Contact Lead,https://contact.test,high,80,92,Missing CTA,Medium,contact-lead",
        "No Contact Lead,https://none.test,high,80,90,Missing CTA,None,no-contact-lead",
        "Blank Contact Lead,https://blank.test,high,80,88,Missing CTA,,blank-contact-lead",
        "Suppressed No Contact Lead,https://suppressed.test,high,80,95,Missing CTA,None,suppressed-lead"
      ].join("\n"),
      {
        missingContact: true,
        reviewRows: readShortlistReviewCsv(
          "leadKey,reviewStatus,reviewReason,lastReviewedAt\nsuppressed-lead,contacted,Already contacted,2026-06-16\n"
        )
      }
    );

    expect(result.suppressedRows).toBe(1);
    expect(result.filteredRows).toBe(1);
    expect(result.leads.map((lead) => lead.companyName)).toEqual(["No Contact Lead", "Blank Contact Lead"]);
  });

  it("requires leads to have a report path after suppression", () => {
    const result = buildLeadShortlist(
      [
        "companyName,website,priority,score,opportunityScore,topFinding,contactConfidence,reportPath",
        "Report Lead,https://report.test,high,80,92,Missing CTA,High,report/open-local-audit-report.html",
        "No Report Lead,https://missing.test,high,80,90,Missing CTA,High,"
      ].join("\n"),
      { requireReport: true }
    );

    expect(result.suppressedRows).toBe(0);
    expect(result.filteredRows).toBe(1);
    expect(result.leads.map((lead) => lead.companyName)).toEqual(["Report Lead"]);
  });

  it("filters leads missing a report path after suppression", () => {
    const result = buildLeadShortlist(
      [
        "companyName,website,priority,score,opportunityScore,topFinding,contactConfidence,reportPath,leadKey",
        "Report Lead,https://report.test,high,80,92,Missing CTA,High,report/open-local-audit-report.html,report-lead",
        "Missing Report Lead,https://missing.test,high,80,90,Missing CTA,High,,missing-report-lead",
        "Suppressed Missing Report Lead,https://suppressed.test,high,80,95,Missing CTA,High,,suppressed-lead"
      ].join("\n"),
      {
        missingReport: true,
        reviewRows: readShortlistReviewCsv(
          "leadKey,reviewStatus,reviewReason,lastReviewedAt\nsuppressed-lead,contacted,Already contacted,2026-06-15\n"
        )
      }
    );

    expect(result.suppressedRows).toBe(1);
    expect(result.filteredRows).toBe(1);
    expect(result.leads.map((lead) => lead.companyName)).toEqual(["Missing Report Lead"]);
  });

  it("filters leads by preferred contact channel after suppression", () => {
    const result = buildLeadShortlist(
      [
        "companyName,website,priority,score,opportunityScore,topFinding,contactConfidence,preferredContactChannel,leadKey",
        "Email Lead,https://email.test,high,80,92,Missing CTA,High,email,email-lead",
        "Phone Lead,https://phone.test,high,80,90,Missing CTA,High,phone,phone-lead",
        "Suppressed Email Lead,https://suppressed.test,high,80,95,Missing CTA,High,email,suppressed-lead"
      ].join("\n"),
      {
        preferredContactChannel: "email",
        reviewRows: readShortlistReviewCsv(
          "leadKey,reviewStatus,reviewReason,lastReviewedAt\nsuppressed-lead,contacted,Already contacted,2026-06-14\n"
        )
      }
    );

    expect(result.suppressedRows).toBe(1);
    expect(result.filteredRows).toBe(1);
    expect(result.leads.map((lead) => lead.companyName)).toEqual(["Email Lead"]);
  });

  it("filters leads by discovery source after suppression", () => {
    const result = buildLeadShortlist(
      [
        "companyName,website,priority,score,opportunityScore,topFinding,contactConfidence,source,leadKey",
        "Manual Lead,https://manual.test,high,80,92,Missing CTA,High,manual-csv,manual-lead",
        "Places Lead,https://places.test,high,80,90,Missing CTA,High,google-places,places-lead",
        "Suppressed Manual Lead,https://suppressed.test,high,80,95,Missing CTA,High,manual-csv,suppressed-lead"
      ].join("\n"),
      {
        source: "manual-csv",
        reviewRows: readShortlistReviewCsv(
          "leadKey,reviewStatus,reviewReason,lastReviewedAt\nsuppressed-lead,contacted,Already contacted,2026-06-13\n"
        )
      }
    );

    expect(result.suppressedRows).toBe(1);
    expect(result.filteredRows).toBe(1);
    expect(result.leads.map((lead) => lead.companyName)).toEqual(["Manual Lead"]);
  });

  it("filters leads by audit status after suppression", () => {
    const result = buildLeadShortlist(
      [
        "companyName,website,priority,score,opportunityScore,topFinding,contactConfidence,status,leadKey",
        "Success Lead,https://success.test,high,80,92,Missing CTA,High,success,success-lead",
        "Failed Lead,https://failed.test,high,80,90,Missing CTA,High,Failed,failed-lead",
        "Suppressed Success Lead,https://suppressed.test,high,80,95,Missing CTA,High,success,suppressed-lead"
      ].join("\n"),
      {
        auditStatus: "success",
        reviewRows: readShortlistReviewCsv(
          "leadKey,reviewStatus,reviewReason,lastReviewedAt\nsuppressed-lead,contacted,Already contacted,2026-06-12\n"
        )
      }
    );

    expect(result.suppressedRows).toBe(1);
    expect(result.filteredRows).toBe(1);
    expect(result.leads.map((lead) => lead.companyName)).toEqual(["Success Lead"]);
  });

  it("filters leads by minimum contact confidence threshold after suppression", () => {
    const result = buildLeadShortlist(
      [
        "companyName,website,priority,score,opportunityScore,topFinding,contactConfidence,leadKey",
        "High Lead,https://high.test,high,80,92,Missing CTA,High,high-lead",
        "Medium Lead,https://medium.test,high,80,90,Missing CTA,Medium,medium-lead",
        "Low Lead,https://low.test,high,80,88,Missing CTA,Low,low-lead",
        "None Lead,https://none.test,high,80,86,Missing CTA,None,none-lead",
        "Blank Lead,https://blank.test,high,80,84,Missing CTA,,blank-lead",
        "Suppressed High Lead,https://suppressed.test,high,80,99,Missing CTA,High,suppressed-lead"
      ].join("\n"),
      {
        minContactConfidence: "medium",
        reviewRows: readShortlistReviewCsv(
          "leadKey,reviewStatus,reviewReason,lastReviewedAt\nsuppressed-lead,contacted,Already contacted,2026-06-11\n"
        )
      }
    );

    expect(result.suppressedRows).toBe(1);
    expect(result.filteredRows).toBe(3);
    expect(result.leads.map((lead) => lead.companyName)).toEqual(["High Lead", "Medium Lead"]);
  });

  it("filters leads by website presence status after suppression", () => {
    const result = buildLeadShortlist(
      [
        "companyName,website,priority,score,opportunityScore,topFinding,contactConfidence,hasWebsite,leadKey",
        "Yes Lead,https://yes.test,high,80,92,Missing CTA,High,yes,yes-lead",
        "No Lead,,high,80,90,Missing CTA,High,no,no-lead",
        "Unknown Lead,,high,80,88,Missing CTA,High,unknown,unknown-lead",
        "Suppressed Yes Lead,https://suppressed.test,high,80,99,Missing CTA,High,yes,suppressed-lead"
      ].join("\n"),
      {
        hasWebsite: "yes",
        reviewRows: readShortlistReviewCsv(
          "leadKey,reviewStatus,reviewReason,lastReviewedAt\nsuppressed-lead,contacted,Already contacted,2026-06-10\n"
        )
      }
    );

    expect(result.suppressedRows).toBe(1);
    expect(result.filteredRows).toBe(2);
    expect(result.leads.map((lead) => lead.companyName)).toEqual(["Yes Lead"]);
  });

  it("filters leads by top finding after suppression", () => {
    const result = buildLeadShortlist(
      [
        "companyName,website,priority,score,opportunityScore,topFinding,contactConfidence,leadKey",
        "CTA Lead,https://cta.test,high,80,92,Missing CTA,High,cta-lead",
        "Meta Lead,https://meta.test,high,80,90,Missing meta,High,meta-lead",
        "Suppressed CTA Lead,https://suppressed.test,high,80,95,Missing CTA,High,suppressed-lead"
      ].join("\n"),
      {
        topFinding: "Missing CTA",
        reviewRows: readShortlistReviewCsv(
          "leadKey,reviewStatus,reviewReason,lastReviewedAt\nsuppressed-lead,contacted,Already contacted,2026-06-09\n"
        )
      }
    );

    expect(result.suppressedRows).toBe(1);
    expect(result.filteredRows).toBe(1);
    expect(result.leads.map((lead) => lead.companyName)).toEqual(["CTA Lead"]);
  });

  it("rejects invalid min-contact-confidence thresholds", () => {
    for (const level of ["highest", "unknown", ""]) {
      expect(() =>
        buildLeadShortlist("companyName,website\nLead A,https://a.test\n", { minContactConfidence: level })
      ).toThrow("shortlist --min-contact-confidence must be high, medium, low, or none");
    }
  });

  it("sorts leads by contact confidence, priority, and source", () => {
    const content = [
      "companyName,website,priority,score,opportunityScore,topFinding,contactConfidence,source",
      "Low Conf,https://low.test,medium,80,90,Missing CTA,Low,manual-csv",
      "High Conf,https://high.test,low,80,88,Missing CTA,High,google-places",
      "Medium Conf,https://medium.test,high,80,86,Missing CTA,Medium,batch"
    ].join("\n");

    expect(buildLeadShortlist(content, { sort: "contact-confidence-desc" }).leads.map((lead) => lead.companyName)).toEqual([
      "High Conf",
      "Medium Conf",
      "Low Conf"
    ]);
    expect(buildLeadShortlist(content, { sort: "priority-desc" }).leads.map((lead) => lead.companyName)).toEqual([
      "Medium Conf",
      "Low Conf",
      "High Conf"
    ]);
    expect(buildLeadShortlist(content, { sort: "source-asc" }).leads.map((lead) => lead.companyName)).toEqual([
      "Medium Conf",
      "High Conf",
      "Low Conf"
    ]);
  });

  it("sorts leads by score, company, or last-reviewed date", () => {
    const content = [
      "companyName,website,priority,score,opportunityScore,topFinding,contactConfidence,lastReviewedAt",
      "Beta Lead,https://beta.test,medium,99,70,Missing CTA,Medium,2026-06-03",
      "Alpha Lead,https://alpha.test,high,75,95,Missing title,High,2026-06-01",
      "Gamma Lead,https://gamma.test,low,82,88,Missing meta,Low,"
    ].join("\n");

    expect(buildLeadShortlist(content, { sort: "score-desc" }).leads.map((lead) => lead.companyName)).toEqual([
      "Beta Lead",
      "Gamma Lead",
      "Alpha Lead"
    ]);
    expect(buildLeadShortlist(content, { sort: "company-asc" }).leads.map((lead) => lead.companyName)).toEqual([
      "Alpha Lead",
      "Beta Lead",
      "Gamma Lead"
    ]);
    expect(buildLeadShortlist(content, { sort: "last-reviewed-asc" }).leads.map((lead) => lead.companyName)).toEqual([
      "Alpha Lead",
      "Beta Lead",
      "Gamma Lead"
    ]);
  });

  it("rejects unsupported shortlist sort modes", () => {
    expect(() =>
      buildLeadShortlist("companyName,website\nLead A,https://a.test\n", { sort: "unknown" as never })
    ).toThrow("shortlist --sort must be opportunity-desc, score-desc, company-asc, last-reviewed-asc, contact-confidence-desc, priority-desc, or source-asc");
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

  it("requires a numeric minimum opportunity score", () => {
    expect(() =>
      buildLeadShortlist("companyName,website\nLead A,https://a.test\n", { minOpportunityScore: Number.NaN })
    ).toThrow("shortlist --min-opportunity-score must be a number");
  });

  it("requires a numeric minimum score", () => {
    expect(() =>
      buildLeadShortlist("companyName,website\nLead A,https://a.test\n", { minScore: Number.NaN })
    ).toThrow("shortlist --min-score must be a number");
  });

  it("filters leads below the minimum audit score before ranking", () => {
    const result = buildLeadShortlist(
      [
        "companyName,website,priority,score,opportunityScore,topFinding,contactConfidence",
        "Low Audit,https://low.test,high,55,92,Missing title,High",
        "Strong Audit,https://strong.test,medium,88,70,Missing CTA,Medium",
        "No Audit Score,https://unknown.test,high,,95,Missing meta,High"
      ].join("\n"),
      { minScore: 80 }
    );

    expect(result.totalRows).toBe(3);
    expect(result.suppressedRows).toBe(0);
    expect(result.filteredRows).toBe(2);
    expect(result.leads.map((lead) => lead.companyName)).toEqual(["Strong Audit"]);
    expect(renderShortlistMarkdown(result)).toContain("- Filtered rows: 2");
  });
});
