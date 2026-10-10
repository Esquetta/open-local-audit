import { describe, expect, it } from "vitest";
import { parseCsvLine } from "../src/csv.js";
import { buildProspectRows, renderProspectRowsCsv, type DiscoveryProviderName, type ProspectRowInput } from "../src/discovery.js";

const skipAction = "Skip unless you are targeting the head office; this lead looks like a chain branch or public body.";

function lead(label: string, websiteUrl: string | undefined, source: DiscoveryProviderName = "overture", sourceId = label): ProspectRowInput {
  return {
    candidate: { source, sourceId, label, websiteUri: websiteUrl },
    resolution: websiteUrl ? { hasWebsite: true, websiteUrl, status: "resolved" } : { hasWebsite: false, status: "missing" }
  };
}

function chainReasonsOf(inputs: ProspectRowInput[]): Record<string, string | undefined> {
  return Object.fromEntries(buildProspectRows(inputs).map((row) => [row.label, row.chainReason]));
}

describe("chain and public-body detection", () => {
  it("flags public-sector domains from the pilots", () => {
    expect(
      chainReasonsOf([
        lead("leeds-dental-institute", "https://www.leedsth.nhs.uk/patients-visitors/our-hospitals/leeds-dental-institute/"),
        lead("the-parade", "https://www.nhs.uk/services/dentist/the-parade-dental/V104943", "google-places"),
        lead("council", "https://www.leeds.gov.uk/", "manual-csv")
      ])
    ).toEqual({
      "leeds-dental-institute": "Website is on a public-sector domain (nhs.uk); this is not a small-business lead",
      "the-parade": "Website is on a public-sector domain (nhs.uk); this is not a small-business lead",
      council: "Website is on a public-sector domain (gov.uk); this is not a small-business lead"
    });
  });

  it("flags a website host shared by several leads and counts the same source id once", () => {
    const branch = (slug: string, sourceId = slug) =>
      lead(slug, `https://www.mydentist.co.uk/dentists/practices/england/yorkshire-and-the-humber/leeds/${slug}`, "overture", sourceId);

    expect(chainReasonsOf([branch("3a-austhorpe-road"), branch("kirkstall-road"), lead("other", "https://MyDentist.co.uk/"), lead("solo", "https://solo-dental.co.uk/")])).toEqual({
      "3a-austhorpe-road": "3 leads in this search share mydentist.co.uk; this looks like a multi-location brand",
      "kirkstall-road": "3 leads in this search share mydentist.co.uk; this looks like a multi-location brand",
      other: "3 leads in this search share mydentist.co.uk; this looks like a multi-location brand",
      solo: undefined
    });
    expect(chainReasonsOf([lead("first", "https://smile.example/", "overture", "same"), lead("second", "https://www.smile.example/", "overture", "same")])).toEqual({
      first: undefined,
      second: undefined
    });
  });

  it("does not treat social, profile, directory, or booking pages as chains", () => {
    expect(
      chainReasonsOf([
        lead("salon-a", "https://www.facebook.com/pages/salon-a/123"),
        lead("salon-b", "https://facebook.com/salon-b"),
        lead("salon-c", "https://linktr.ee/salonc"),
        lead("salon-d", "https://linktr.ee/salond"),
        lead("salon-e", "https://sites.google.com/view/salon-e"),
        lead("salon-f", "https://www.treatwell.co.uk/place/salon-f/"),
        lead("salon-g", "https://www.fresha.com/a/salon-g-leeds/booking")
      ])
    ).toEqual({
      "salon-a": undefined,
      "salon-b": undefined,
      "salon-c": undefined,
      "salon-d": undefined,
      "salon-e": undefined,
      "salon-f": undefined,
      "salon-g": undefined
    });
  });

  it("does not flag two source records with the same business name on one website", () => {
    expect(
      chainReasonsOf([
        lead("Smile Studio", "https://smile.example/", "overture", "place-1"),
        lead("Smile Studio", "https://www.smile.example/", "overture", "place-2")
      ])
    ).toEqual({ "Smile Studio": undefined });
  });

  it("flags branch pages on larger sites but not single-segment or language-only paths", () => {
    expect(
      chainReasonsOf([
        lead("rodericks", "https://www.rodericksdentalpartners.co.uk/our-practices/lady-pit-lane-dental-practice"),
        lead("travelodge", "https://www.travelodge.co.uk/hotels/123/Manchester-Central-hotel", "google-places"),
        lead("localised", "https://brand.example/en-gb/our-practices/x/", "manual-csv"),
        lead("home", "https://home.example/home"),
        lead("landing", "https://landing.example/dentist-leeds"),
        lead("contact", "https://contact.example/en/contact"),
        lead("index", "https://index.example/en/practice/index.html"),
        lead("root", "https://root.example/")
      ])
    ).toEqual({
      rodericks: "Website URL is a branch page on a larger site (/our-practices/…)",
      travelodge: "Website URL is a branch page on a larger site (/hotels/…)",
      localised: "Website URL is a branch page on a larger site (/our-practices/…)",
      home: undefined,
      landing: undefined,
      contact: undefined,
      index: undefined,
      root: undefined
    });
  });

  it("never flags leads without a website", () => {
    expect(chainReasonsOf([lead("no-site-a", undefined, "manual-csv", "a"), lead("no-site-b", undefined, "manual-csv", "b"), lead("skipped", undefined)])).toEqual({
      "no-site-a": undefined,
      "no-site-b": undefined,
      skipped: undefined
    });
  });

  it("demotes flagged leads to low priority with a capped opportunity score and keeps them in the export", () => {
    const audited: ProspectRowInput = {
      ...lead("rodericks", "https://www.rodericksdentalpartners.co.uk/our-practices/lady-pit-lane-dental-practice"),
      audit: { status: "success", score: 40, topFinding: "Missing title" }
    };
    const rows = buildProspectRows([audited, lead("independent", "https://independent-dental.example/")]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ priority: "low", nextAction: skipAction, opportunityScore: 20 });
    expect(rows[0].opportunityReasons).toEqual([
      "Audit score is below 60",
      "Top finding: Missing title",
      "Website URL is a branch page on a larger site (/our-practices/…)"
    ]);
    expect(rows[1]).toMatchObject({ priority: "medium", opportunityScore: 55, chainReason: undefined });

    const conflict: ProspectRowInput = { ...audited, audit: { status: "success", identity: { status: "conflict", reasons: [], evidence: [] } } };
    expect(buildProspectRows([conflict])[0].opportunityScore).toBe(0);

    const csvRows = renderProspectRowsCsv(rows).trim().split(/\r?\n/).map(parseCsvLine);
    const column = csvRows[0].indexOf("chainReason");
    expect(csvRows[0].slice(column - 2, column + 1)).toEqual(["dotnetStack", "dotnetLegacyFramework", "chainReason"]);
    expect(csvRows.slice(1).map((row) => row[column])).toEqual(["Website URL is a branch page on a larger site (/our-practices/…)", ""]);
    expect(renderProspectRowsCsv(rows, "crm").split("\n")[0]).not.toContain("chainReason");
  });

  it("keeps both reasons and applies the chain effects when a lead also has a location mismatch", () => {
    const local = (label: string, phone: string, websiteUrl: string): ProspectRowInput => ({
      candidate: { source: "overture", sourceId: label, label, websiteUri: websiteUrl, sourceMetadata: { phones: [phone], locality: "Leeds", country: "GB" } },
      resolution: { hasWebsite: true, websiteUrl, status: "resolved" }
    });
    const leeds = ["0113 245 0001", "0113 245 0002", "0113 245 0003", "0113 245 0004", "0113 245 0005"].map((phone, index) =>
      local(`leeds-${index}`, phone, `https://leeds-${index}.example`)
    );
    const rows = buildProspectRows([...leeds, local("branch", "01934 620220", "https://www.rodericksdentalpartners.co.uk/our-practices/lady-pit-lane-dental-practice")]);
    const branch = rows.find((row) => row.label === "branch");

    expect(branch).toMatchObject({ priority: "low", nextAction: skipAction, opportunityScore: 20 });
    expect(branch?.opportunityReasons.slice(-2)).toEqual([
      "Phone area code 01934 differs from 0113, which most leads in this search use; the business may be listed in the wrong place",
      "Website URL is a branch page on a larger site (/our-practices/…)"
    ]);
  });
});
