import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildProspectRows,
  fetchGooglePlacesCandidates,
  readManualDiscoveryCsv,
  renderProspectRowsCsv,
  resolveCandidateWebsite
} from "../src/discovery.js";

describe("lead discovery", () => {
  it("reads manual CSV candidates with website and profile fields", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-local-audit-discovery-"));
    try {
      const input = join(dir, "places.csv");
      await writeFile(
        input,
        "label,website,segment,profile,sourceId,query\nExample Dental,example.com,dental,dental,place-1,dis klinigi\nNo Site Clinic,,dental,,place-2,dis klinigi\n",
        "utf8"
      );

      await expect(readManualDiscoveryCsv(input, { defaultProfile: "beauty" })).resolves.toEqual([
        {
          source: "manual-csv",
          sourceId: "place-1",
          query: "dis klinigi",
          label: "Example Dental",
          segment: "dental",
          profile: "dental",
          websiteUri: "https://example.com"
        },
        {
          source: "manual-csv",
          sourceId: "place-2",
          query: "dis klinigi",
          label: "No Site Clinic",
          segment: "dental",
          profile: "beauty"
        }
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects malformed manual CSV headers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-local-audit-discovery-"));
    try {
      const input = join(dir, "places.csv");
      await writeFile(input, "foo,bar\nvalue,another\n", "utf8");

      await expect(readManualDiscoveryCsv(input)).rejects.toThrow(
        "Manual discovery CSV requires a label, name, or business column"
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("requires an API key for Google Places discovery", async () => {
    await expect(fetchGooglePlacesCandidates("dentist Kadikoy", { apiKey: "" })).rejects.toThrow(
      "GOOGLE_MAPS_API_KEY is required when --provider google-places is used"
    );
  });

  it("requests Google Places Text Search with strict field masks", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchLike: typeof fetch = async (url, init) => {
      calls.push({ url: url.toString(), init });
      return new Response(
        JSON.stringify({
          places: [
            {
              id: "place-1",
              displayName: { text: "Example Dental" },
              websiteUri: "https://example-dental.test"
            },
            {
              id: "place-2",
              displayName: { text: "No Site Clinic" }
            }
          ]
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    };

    await expect(
      fetchGooglePlacesCandidates("dentist Kadikoy", {
        apiKey: "test-key",
        defaultProfile: "dental",
        fetch: fetchLike
      })
    ).resolves.toEqual([
      {
        source: "google-places",
        sourceId: "place-1",
        query: "dentist Kadikoy",
        label: "Example Dental",
        profile: "dental",
        websiteUri: "https://example-dental.test"
      },
      {
        source: "google-places",
        sourceId: "place-2",
        query: "dentist Kadikoy",
        label: "No Site Clinic",
        profile: "dental"
      }
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://places.googleapis.com/v1/places:searchText");
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.headers).toEqual({
      "Content-Type": "application/json",
      "X-Goog-Api-Key": "test-key",
      "X-Goog-FieldMask": "places.id,places.displayName,places.websiteUri"
    });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      textQuery: "dentist Kadikoy"
    });
  });

  it("resolves website presence without accepting invalid or non-http URLs", () => {
    expect(resolveCandidateWebsite({ websiteUri: "example.com" })).toEqual({
      hasWebsite: true,
      websiteUrl: "https://example.com",
      status: "resolved"
    });
    expect(resolveCandidateWebsite({})).toEqual({
      hasWebsite: false,
      status: "missing",
      reason: "No website URL provided"
    });
    expect(resolveCandidateWebsite({ websiteUri: "ftp://example.com" })).toMatchObject({
      hasWebsite: false,
      status: "invalid"
    });
  });

  it("builds prospect rows with priority and next action guidance", () => {
    const rows = buildProspectRows([
      {
        candidate: {
          source: "manual-csv",
          label: "No Site Clinic",
          segment: "dental",
          profile: "dental"
        },
        resolution: {
          hasWebsite: false,
          status: "missing",
          reason: "No website URL provided"
        }
      },
      {
        candidate: {
          source: "manual-csv",
          label: "Weak Site",
          segment: "beauty",
          profile: "beauty",
          websiteUri: "https://weak.test"
        },
        resolution: {
          hasWebsite: true,
          websiteUrl: "https://weak.test",
          status: "resolved"
        },
        audit: {
          status: "success",
          score: 45,
          topFinding: "Phone action is missing",
          reportPath: "weak-test/open-local-audit-report.html"
        }
      },
      {
        candidate: {
          source: "manual-csv",
          label: "Strong Site",
          segment: "restaurant",
          profile: "restaurant",
          websiteUri: "https://strong.test"
        },
        resolution: {
          hasWebsite: true,
          websiteUrl: "https://strong.test",
          status: "resolved"
        },
        audit: {
          status: "success",
          score: 88,
          topFinding: "Menu signal is missing",
          reportPath: "strong-test/open-local-audit-report.html"
        }
      }
    ]);

    expect(rows.map((row) => [row.label, row.hasWebsite, row.auditStatus, row.priority])).toEqual([
      ["No Site Clinic", "no", "not-audited", "high"],
      ["Weak Site", "yes", "success", "high"],
      ["Strong Site", "yes", "success", "low"]
    ]);
    expect(rows[0].nextAction).toContain("Build a basic website");
    expect(rows[1].nextAction).toContain("Prioritize outreach");
    expect(rows[2].nextAction).toContain("Monitor");
  });

  it("renders prospect rows as escaped CSV", () => {
    const csv = renderProspectRowsCsv([
      {
        source: "manual-csv",
        label: "Clinic, A",
        profile: "dental",
        hasWebsite: "no",
        auditStatus: "not-audited",
        priority: "high",
        nextAction: "Build a basic website before deeper audit."
      }
    ]);

    expect(csv.split(/\r?\n/)[0]).toBe(
      "source,sourceId,label,segment,profile,hasWebsite,websiteUrl,auditStatus,score,topFinding,priority,nextAction,reportPath,error"
    );
    expect(csv).toContain('"Clinic, A"');
  });
});
