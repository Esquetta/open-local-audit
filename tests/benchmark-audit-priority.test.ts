import { describe, expect, it } from "vitest";
import {
  evaluateComparison,
  prepareComparison,
  type WebsiteObservation
} from "../scripts/benchmark-audit-priority.js";
import type { PlaceCandidate } from "../src/discovery.js";

describe("audit priority comparison", () => {
  it("uses the same frozen observations for both selections and excludes conflict contacts", () => {
    const candidates: PlaceCandidate[] = [
      { source: "overture", sourceId: "first", label: "First Dental", websiteUri: "https://shared.test", sourceMetadata: { emails: ["first@test"], phones: ["+12125550100"], address: "1 Main Street", locality: "New York", country: "US" } },
      { source: "overture", sourceId: "missing", label: "Missing Dental", websiteUri: "https://missing.test", sourceMetadata: { address: "2 Main Street", locality: "New York", country: "US" } },
      { source: "overture", sourceId: "conflict", label: "Conflict Dental", websiteUri: "https://shared.test", sourceMetadata: { phones: ["+12125550999"], address: "99 Main Street", locality: "New York", country: "US" } },
      { source: "overture", sourceId: "extra", label: "Extra Dental", websiteUri: "https://extra.test", sourceMetadata: { phones: ["+12125550199"] } }
    ];
    const plan = prepareComparison(candidates, 3);
    const observations = new Map<string, WebsiteObservation>([
      ["https://shared.test", { url: "https://shared.test", status: "success", contact: { publicEmail: "first@test", publicPhone: "+12125550100", socialProfiles: [], contactConfidence: "High" }, businessIdentities: [{ pageUrl: "https://shared.test", kind: "structured", name: "First Dental", phones: ["+12125550100"], address: { street: "1 Main Street", locality: "New York", country: "US" } }] }],
      ["https://missing.test", { url: "https://missing.test", status: "success", contact: { publicEmail: "new@test", socialProfiles: [], contactConfidence: "Medium" }, businessIdentities: [] }],
      ["https://extra.test", { url: "https://extra.test", status: "success", contact: { socialProfiles: [], contactConfidence: "None" }, businessIdentities: [] }]
    ]);

    const result = evaluateComparison(plan, observations);

    expect(plan.unionWebsiteUrls).toEqual(["https://shared.test", "https://missing.test", "https://extra.test"]);
    expect(result.modes["source-order"].selected.map((item) => item.sourceId)).toEqual(["overture:first", "overture:missing", "overture:conflict"]);
    expect(result.modes["missing-contact"].selected.map((item) => item.sourceId)).toEqual(["overture:missing", "overture:conflict", "overture:extra"]);
    expect(result.modes["missing-contact"].selected[1]).toMatchObject({
      sourceId: "overture:conflict",
      identity: { status: "conflict" }
    });
    expect(result.modes["missing-contact"].selected[1]?.acceptedWebsiteContact).toBeUndefined();
    expect(result.modes["missing-contact"].selected[0]?.acceptedWebsiteContact?.contactConfidence).toBe("Low");
    expect(result.modes["missing-contact"].newContactFields).toEqual({ email: 1, phone: 0, whatsapp: 0, contactPage: 0, social: 0 });
  });
});
