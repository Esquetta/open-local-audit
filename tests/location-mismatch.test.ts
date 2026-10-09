import { describe, expect, it } from "vitest";
import { buildProspectRows, type ProspectRowInput } from "../src/discovery.js";

function lead(label: string, phone: string, locality: string): ProspectRowInput {
  return {
    candidate: { source: "overture", sourceId: label, label, websiteUri: `https://${label}.example`, sourceMetadata: { phones: [phone], locality, country: "GB" } },
    resolution: { hasWebsite: true, websiteUrl: `https://${label}.example`, status: "resolved" }
  };
}

const leeds = ["0113 245 0001", "+44 113 245 0002", "0113 245 0003", "0113 245 0004", "0113 245 0005"].map((phone, index) =>
  lead(`leeds-${index}`, phone, "Leeds")
);

function rowFor(rows: ReturnType<typeof buildProspectRows>, label: string) {
  return rows.find((row) => row.label === label);
}

describe("location mismatch", () => {
  it("flags a lead listed in the main locality whose landline area code belongs elsewhere", () => {
    const rows = buildProspectRows([...leeds, lead("twenty-2", "01934 620220", "Leeds")]);

    expect(rowFor(rows, "twenty-2")).toMatchObject({
      priority: "medium",
      nextAction: "Confirm the business location before outreach; its phone area code does not match this search."
    });
    expect(rowFor(rows, "twenty-2")?.opportunityReasons).toContain(
      "Phone area code 01934 differs from 0113, which most leads in this search use; the business may be listed in the wrong place"
    );
    expect(rows.filter((row) => row.label?.startsWith("leeds")).every((row) => !row.opportunityReasons.some((reason) => reason.includes("area code")))).toBe(true);
  });

  it("leaves neighbouring towns, mobiles and small or mixed searches alone", () => {
    const flagged = (inputs: ProspectRowInput[]) =>
      buildProspectRows(inputs).filter((row) => row.opportunityReasons.some((reason) => reason.includes("area code"))).map((row) => row.label);

    expect(flagged([...leeds, lead("batley", "01924 473396", "Batley"), lead("mobile", "07827 123456", "Leeds")])).toEqual([]);
    expect(flagged([...leeds.slice(0, 3), lead("twenty-2", "01934 620220", "Leeds")])).toEqual([]);
    expect(
      flagged([...leeds.slice(0, 3), ...["0161 000 0001", "0161 000 0002", "0161 000 0003"].map((phone, index) => lead(`mcr-${index}`, phone, "Leeds"))])
    ).toEqual([]);
  });
});
