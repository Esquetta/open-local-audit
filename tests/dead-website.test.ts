import { describe, expect, it } from "vitest";
import { buildProspectRows } from "../src/discovery.js";
import { buildPitchBrief, renderPitchBriefsMarkdown } from "../src/pitch-brief.js";
import type { ShortlistLead } from "../src/shortlist.js";
import { enrichWebsite } from "../src/website-enrichment.js";
import { domainUnresolvedError } from "../src/website-errors.js";

function noSuchName(hostname: string): Error {
  return Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND" });
}

const page = async (input: string | URL | Request) =>
  input.toString().endsWith("/robots.txt") ? new Response("", { status: 404 }) : new Response("<title>Clinic</title>", { headers: { "content-type": "text/html" } });

describe("listed websites whose domain does not resolve", () => {
  it("tries the bare host when the www host has no DNS record, and the other way round", async () => {
    const requests: string[] = [];
    const resolve = async (hostname: string) => {
      if (hostname.startsWith("www.")) throw noSuchName(hostname);
      return ["93.184.216.34"];
    };
    const result = await enrichWebsite("http://www.clinic.example/", {
      resolve,
      fetch: async (input) => {
        requests.push(input.toString());
        return page(input);
      }
    });

    expect(result.status).toBe("success");
    expect(result.snapshot?.finalUrl).toBe("http://clinic.example/");
    expect(result.warnings).toContain("www.clinic.example does not resolve; tried clinic.example");
    expect(requests.every((url) => url.startsWith("http://clinic.example/"))).toBe(true);

    const bare = await enrichWebsite("https://clinic.example/", {
      resolve: async (hostname) => {
        if (!hostname.startsWith("www.")) throw noSuchName(hostname);
        return ["93.184.216.34"];
      },
      fetch: page
    });
    expect(bare.snapshot?.finalUrl).toBe("https://www.clinic.example/");
  });

  it("reports a domain with no DNS record as such, instead of a robots.txt failure", async () => {
    const result = await enrichWebsite("http://www.lapsed.example/", {
      resolve: async (hostname) => {
        throw noSuchName(hostname);
      },
      fetch: page
    });

    expect(result.status).toBe("failed");
    expect(result.error).toBe(`${domainUnresolvedError}: www.lapsed.example (also tried lapsed.example)`);
  });

  it("does not blame the listed website when a redirect or its robots.txt points at a host without DNS", async () => {
    const resolve = async (hostname: string) => {
      if (hostname === "www.moved.example") throw noSuchName(hostname);
      return ["93.184.216.34"];
    };
    const redirected = await enrichWebsite("https://moved.example/", {
      resolve,
      fetch: async (input) => {
        const url = input.toString();
        if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
        return new Response(null, { status: 301, headers: { location: "https://www.moved.example/" } });
      }
    });
    expect(redirected.status).toBe("failed");
    expect(redirected.error).toBe("redirect target www.moved.example does not resolve");

    const robotsRedirect = await enrichWebsite("https://moved.example/", {
      resolve,
      fetch: async (input) =>
        input.toString().endsWith("/robots.txt")
          ? new Response(null, { status: 301, headers: { location: "https://www.moved.example/robots.txt" } })
          : page(input)
    });
    expect(robotsRedirect.status).toBe("blocked");
    expect(robotsRedirect.error).toBe("robots.txt could not be reached");
  });

  it("keeps other resolver failures as unreachable, since they may be temporary", async () => {
    const result = await enrichWebsite("http://www.flaky.example/", {
      resolve: async () => {
        throw Object.assign(new Error("getaddrinfo EAI_AGAIN"), { code: "EAI_AGAIN" });
      },
      fetch: page
    });

    expect(result.status).toBe("blocked");
    expect(result.error).toBe("robots.txt could not be reached");
  });

  it("ranks the lead as a high-priority website-build opportunity and warns against emailing the dead domain", () => {
    const [row] = buildProspectRows([
      {
        candidate: { source: "overture", sourceId: "abc", label: "Lapsed Accountants", websiteUri: "http://www.lapsed.example/" },
        resolution: { hasWebsite: true, websiteUrl: "http://www.lapsed.example/", status: "resolved" },
        audit: {
          status: "failed",
          error: `${domainUnresolvedError}: www.lapsed.example (also tried lapsed.example)`,
          // With no page there is no identity evidence, as in real discovery runs.
          identity: { status: "uncertain", reasons: ["No identity evidence"], evidence: [] }
        }
      }
    ]);

    expect(row).toMatchObject({
      auditStatus: "failed",
      priority: "high",
      opportunityScore: 95,
      opportunityReasons: ["Listed website domain does not resolve (site down; the domain may have lapsed)", "Website-build opportunity"],
      recommendedOffer: "Starter website build",
      estimatedNeed: "High",
      preferredContactChannel: "manual-review"
    });
    expect(row.nextAction).toBe("Confirm the business still trades, then offer a new website: its listed website domain no longer resolves.");
    expect(row.outreachAction).toContain("email at that domain may bounce");

    const [other] = buildProspectRows([
      {
        candidate: { source: "overture", sourceId: "def", label: "Blocked Accountants", websiteUri: "https://blocked.example/" },
        resolution: { hasWebsite: true, websiteUrl: "https://blocked.example/", status: "resolved" },
        audit: { status: "failed", error: "robots.txt did not permit crawling" }
      }
    ]);
    expect(other).toMatchObject({ priority: "medium", opportunityScore: 60, opportunityReasons: ["Audit failed and needs manual review"] });
  });

  it("gives pitch briefs a rescue offer and the checks to run before contacting", () => {
    const lead = {
      rank: 1,
      companyName: "Lapsed Accountants",
      website: "http://www.lapsed.example/",
      leadKey: "overture:abc",
      priority: "high",
      opportunityScore: 95,
      reason: "Listed website domain does not resolve (site down; the domain may have lapsed); Website-build opportunity",
      preferredContactChannel: "manual-review",
      contactabilityReason: "The listed website domain does not resolve, so the site is down and email at that domain may not work either."
    } as unknown as ShortlistLead;
    const brief = buildPitchBrief(lead, undefined, "none");

    expect(renderPitchBriefsMarkdown([brief], "2026-10-26T12:00:00.000Z")).toContain(
      "The listed website does not load: its domain has no DNS record. Check the site in a browser to confirm before using it as the pitch."
    );
    expect(brief.offer).toBe("Website rescue or starter website: the listed website no longer loads because its domain does not resolve.");
    expect(brief.checks).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Confirm the business still trades/),
        "Avoid emailing an address at that domain; it may bounce. Call or use another public channel."
      ])
    );
    expect(brief.checks.some((check) => check.startsWith("Re-check each pitch point"))).toBe(false);
  });
});
