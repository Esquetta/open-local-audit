import { describe, expect, it } from "vitest";
import { readLeadKeysFromReviewInput, upsertReviewCsv, upsertReviewCsvMany } from "../src/review.js";

describe("review CSV upsert", () => {
  it("updates an existing review row by lead key while preserving extra columns", () => {
    const result = upsertReviewCsv(
      [
        "leadKey,label,reviewStatus,reviewReason,lastReviewedAt,opportunityScore",
        "url:https://old.test,Old Lead,pending,Needs call,2026-06-01,88"
      ].join("\n"),
      {
        leadKey: "url:https://old.test",
        status: "contacted",
        reason: "Email sent",
        reviewedAt: "2026-06-24T09:00:00+03:00"
      }
    );

    expect(result).toMatchObject({
      action: "updated",
      leadKey: "url:https://old.test",
      reviewStatus: "contacted",
      lastReviewedAt: "2026-06-24T06:00:00.000Z"
    });
    expect(result.content).toBe(
      [
        "leadKey,label,reviewStatus,reviewReason,lastReviewedAt,opportunityScore",
        "url:https://old.test,Old Lead,contacted,Email sent,2026-06-24T06:00:00.000Z,88",
        ""
      ].join("\n")
    );
  });

  it("adds a new row and missing review columns", () => {
    const result = upsertReviewCsv("leadKey,label\nexisting,Existing Lead\n", {
      leadKey: "new-lead",
      status: "qualified",
      reason: "=Strong fit",
      reviewedAt: "2026-06-24"
    });

    expect(result.action).toBe("added");
    expect(result.content).toBe(
      [
        "leadKey,label,reviewStatus,reviewReason,lastReviewedAt",
        "existing,Existing Lead,,,",
        "new-lead,,qualified,'=Strong fit,2026-06-24T00:00:00.000Z",
        ""
      ].join("\n")
    );
  });

  it("creates a review CSV when content is empty", () => {
    const result = upsertReviewCsv("", {
      leadKey: "fresh-lead",
      status: "in-review",
      reviewedAt: "2026-06-24T10:00:00Z"
    });

    expect(result.content).toBe(
      [
        "leadKey,reviewStatus,reviewReason,lastReviewedAt",
        "fresh-lead,in-review,,2026-06-24T10:00:00.000Z",
        ""
      ].join("\n")
    );
  });

  it("rejects unsupported review statuses", () => {
    expect(() =>
      upsertReviewCsv("leadKey\nfresh-lead\n", {
        leadKey: "fresh-lead",
        status: "maybe-later"
      })
    ).toThrow("review --status must be one of:");
  });

  it("upserts multiple review rows with one timestamp", () => {
    const result = upsertReviewCsvMany(
      [
        "leadKey,label,reviewStatus,reviewReason,lastReviewedAt",
        "existing-lead,Existing Lead,pending,Needs review,2026-06-20"
      ].join("\n"),
      {
        leadKeys: ["existing-lead", "new-lead", "", "new-lead"],
        status: "in-review",
        reason: "Selected from shortlist",
        reviewedAt: "2026-06-30T10:00:00+03:00"
      }
    );

    expect(result).toMatchObject({
      added: 1,
      updated: 1,
      skipped: 2,
      total: 2,
      reviewStatus: "in-review",
      lastReviewedAt: "2026-06-30T07:00:00.000Z"
    });
    expect(result.content).toBe(
      [
        "leadKey,label,reviewStatus,reviewReason,lastReviewedAt",
        "existing-lead,Existing Lead,in-review,Selected from shortlist,2026-06-30T07:00:00.000Z",
        "new-lead,,in-review,Selected from shortlist,2026-06-30T07:00:00.000Z",
        ""
      ].join("\n")
    );
  });

  it("reads lead keys from shortlist CSV and JSON input", () => {
    expect(
      readLeadKeysFromReviewInput(
        [
          "rank,companyName,leadKey",
          "1,Lead A,url:https://a.test",
          "2,Lead B,url:https://b.test"
        ].join("\n")
      )
    ).toEqual(["url:https://a.test", "url:https://b.test"]);

    expect(
      readLeadKeysFromReviewInput(
        JSON.stringify({
          leads: [{ leadKey: "url:https://a.test" }, { leadKey: "url:https://b.test" }, { companyName: "No Key" }]
        })
      )
    ).toEqual(["url:https://a.test", "url:https://b.test"]);
  });

  it("rejects CSV review input without a lead key column", () => {
    expect(() => readLeadKeysFromReviewInput("companyName\nLead A\n")).toThrow(
      "review --input CSV requires a leadKey column"
    );
  });
});
