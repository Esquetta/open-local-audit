import { describe, expect, it } from "vitest";
import { selectAuditCandidates } from "../src/audit-selection.js";
import type { ProspectRowInput } from "../src/discovery.js";

function prospect(
  websiteUrl: string | undefined,
  metadata: Record<string, unknown> = {},
  status: ProspectRowInput["resolution"]["status"] = "resolved"
): ProspectRowInput {
  return {
    candidate: { source: "overture", websiteUri: websiteUrl, sourceMetadata: metadata },
    resolution: { hasWebsite: status === "resolved", status, ...(websiteUrl ? { websiteUrl } : {}) }
  };
}

describe("selectAuditCandidates", () => {
  it("preserves the existing eligible source-order first-N behavior by default", () => {
    const result = selectAuditCandidates([
      prospect(undefined, {}, "skipped"),
      prospect("https://first.test"),
      prospect("https://second.test"),
      prospect("https://third.test")
    ], { maxAudits: 2 });

    expect(result.selectedIndices).toEqual([1, 2]);
    expect(result.decisions.map((decision) => [decision.selected, decision.reason, decision.rank])).toEqual([
      [false, "No resolved HTTP(S) website URL", undefined],
      [true, "Selected by source order", 1],
      [true, "Selected by source order", 2],
      [false, "Audit budget exhausted", 3]
    ]);
  });

  it("rejects missing and invalid resolved website URLs without implying a missing website", () => {
    const result = selectAuditCandidates([
      prospect(undefined),
      prospect("not a URL"),
      prospect("ftp://example.test"),
      prospect("https://valid.test")
    ]);

    expect(result.selectedIndices).toEqual([3]);
    expect(result.decisions).toEqual([
      { selected: false, reason: "No resolved HTTP(S) website URL" },
      { selected: false, reason: "Resolved website URL is invalid or unsupported" },
      { selected: false, reason: "Resolved website URL is invalid or unsupported" },
      { selected: true, reason: "Selected by source order", rank: 1 }
    ]);
  });

  it("does not select candidates when the audit budget is zero or dry-run is enabled", () => {
    const candidates = [prospect("https://one.test"), prospect("https://two.test")];

    expect(selectAuditCandidates(candidates, { maxAudits: 0 })).toMatchObject({
      selectedIndices: [],
      decisions: [
        { selected: false, reason: "Auditing is disabled by maxAudits", rank: 1 },
        { selected: false, reason: "Auditing is disabled by maxAudits", rank: 2 }
      ]
    });
    expect(selectAuditCandidates(candidates, { dryRun: true })).toMatchObject({
      selectedIndices: [],
      decisions: [
        { selected: false, reason: "Auditing is disabled in dry run", rank: 1 },
        { selected: false, reason: "Auditing is disabled in dry run", rank: 2 }
      ]
    });
  });

  it("prioritizes missing source email, then source phone, then source order", () => {
    const result = selectAuditCandidates([
      prospect("https://email-present.test", { emails: ["hello@test"], phones: ["+902121234567"], confidence: 0.9 }),
      prospect("https://phone-missing.test", { emails: ["hello@test"], phones: [], confidence: 0.99 }),
      prospect("https://email-missing.test", { emails: [], phones: ["+902121234567"], confidence: 0.1 }),
      prospect("https://both-missing.test", { confidence: 0.2 })
    ], { priority: "missing-contact" });

    expect(result.selectedIndices).toEqual([3, 2, 1, 0]);
    expect(result.decisions.map((decision) => [decision.selected, decision.reason, decision.rank])).toEqual([
      [true, "Selected by source order", 4],
      [true, "Selected because source phone is missing", 3],
      [true, "Selected because source email is missing", 2],
      [true, "Selected because source email and phone are missing", 1]
    ]);
  });

  it("keeps equal contact gaps in source order without comparing provider confidence scales", () => {
    const result = selectAuditCandidates([
      prospect("https://corrupt.test", { emails: "bad", phones: {}, confidence: "0.99" }),
      prospect("https://unknown.test", { emails: ["hello@test"], phones: ["+902121234567"] }),
      prospect("https://known.test", { emails: ["hello@test"], phones: ["+902121234567"], confidence: 0.8 }),
      prospect("https://out-of-range.test", { emails: ["hello@test"], phones: ["+902121234567"], confidence: 7 })
    ], { priority: "missing-contact" });

    expect(result.selectedIndices).toEqual([0, 1, 2, 3]);
  });

  it("keeps ties deterministic and binds decisions to the original candidate indices", () => {
    const result = selectAuditCandidates([
      prospect("https://one.test", { emails: ["one@test"], phones: ["+902121234567"] }),
      prospect("https://two.test", { emails: ["two@test"], phones: ["+902121234567"] }),
      prospect("https://three.test", { emails: ["three@test"], phones: ["+902121234567"] })
    ], { priority: "missing-contact", maxAudits: 2 });

    expect(result.selectedIndices).toEqual([0, 1]);
    expect(result.decisions).toEqual([
      { selected: true, reason: "Selected by source order", rank: 1 },
      { selected: true, reason: "Selected by source order", rank: 2 },
      { selected: false, reason: "Audit budget exhausted", rank: 3 }
    ]);
  });

  it("does not mutate input arrays or objects", () => {
    const input = [prospect("https://one.test", { emails: [], phones: [] })];
    const before = structuredClone(input);

    selectAuditCandidates(input, { priority: "missing-contact" });

    expect(input).toEqual(before);
  });

  it.each([
    [{ priority: "other" as never }],
    [{ priority: null as never }],
    [{ maxAudits: -1 }],
    [{ maxAudits: 1.5 }],
    [{ maxAudits: Infinity }]
  ])("rejects invalid selection options: %o", (options) => {
    expect(() => selectAuditCandidates([], options)).toThrow();
  });
});
