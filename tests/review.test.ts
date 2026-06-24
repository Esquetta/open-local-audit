import { describe, expect, it } from "vitest";
import { upsertReviewCsv } from "../src/review.js";

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
});
