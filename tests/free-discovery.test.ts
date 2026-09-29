import { describe, expect, it } from "vitest";
import { buildProspectRows, renderProspectRowsCsv, resolveCandidateWebsite, type PlaceCandidate } from "../src/discovery.js";
import { discoveryProviderSchema } from "../src/schema.js";

describe("free discovery data contract", () => {
  it("accepts the keyless provider", () => {
    expect(discoveryProviderSchema.safeParse("overture").success).toBe(true);
  });
  it("does not turn an absent source website into a website-build opportunity", () => {
    const candidate = { source: "overture", sourceId: "1", label: "Sample Clinic" } as PlaceCandidate;
    const row = buildProspectRows([{ candidate, resolution: resolveCandidateWebsite(candidate) }])[0];
    expect(row.hasWebsite).toBe("unknown");
    expect(row.opportunityScore).toBe(0);
    expect(row.estimatedNeed).toBe("Unknown");
    expect(row.recommendedOffer).not.toContain("build");
  });
  it("retains source contact and business provenance without claiming a website audit", () => {
    const candidate = {
      source: "overture", sourceId: "1", label: "Sample Clinic",
      sourceMetadata: { address: "1 Main Street", country: "TR", phones: ["+902121234567"], emails: ["info@sample.test"], socials: [], datasetRelease: "2026-09-23.1", sourceUrl: "https://docs.overturemaps.org/", retrievedAt: "2026-09-29T00:00:00.000Z" }
    } as PlaceCandidate;
    const row = buildProspectRows([{ candidate, resolution: resolveCandidateWebsite(candidate) }])[0];
    expect(row).toMatchObject({ publicPhone: "+902121234567", publicEmail: "info@sample.test", address: "1 Main Street", country: "TR", auditStatus: "not-audited", contactConfidence: "Low", preferredContactChannel: "email" });
    expect(row.contactabilityReason).toContain("source");
    const csv = renderProspectRowsCsv([row]);
    expect(csv).toContain("datasetRelease");
    expect(csv).toContain("1 Main Street");
  });
});
