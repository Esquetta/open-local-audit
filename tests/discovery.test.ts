import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildDiscoverySummary,
  buildProspectRows,
  findDuplicateProspectGroups,
  findFuzzyDuplicateProspectGroups,
  fetchGooglePlacesCandidates,
  filterSuppressedProspects,
  mergeDiscoveryReviewRows,
  readLeadSuppressionCsv,
  readLeadReviewCsv,
  readManualDiscoveryCsv,
  renderDiscoveryReviewCsv,
  renderProspectRowsCsv,
  resolveCandidateWebsite,
  stableLeadKey
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
        limit: 5,
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
      textQuery: "dentist Kadikoy",
      maxResultCount: 5
    });
  });

  it("clamps Google Places discovery limit to the supported range", async () => {
    const calls: Array<RequestInit | undefined> = [];
    const fetchLike: typeof fetch = async (_url, init) => {
      calls.push(init);
      return new Response(JSON.stringify({ places: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };

    await fetchGooglePlacesCandidates("dentist Kadikoy", {
      apiKey: "test-key",
      limit: 500,
      fetch: fetchLike
    });

    expect(JSON.parse(String(calls[0]?.body))).toEqual({
      textQuery: "dentist Kadikoy",
      maxResultCount: 50
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

  it("builds stable lead keys from source id, website, or label", () => {
    expect(
      stableLeadKey({
        candidate: {
          source: "google-places",
          sourceId: "Place-123",
          label: "Example Dental",
          websiteUri: "https://example.test"
        },
        resolution: {
          hasWebsite: true,
          websiteUrl: "https://example.test/",
          status: "resolved"
        }
      })
    ).toBe("google-places:Place-123");

    expect(
      stableLeadKey({
        candidate: {
          source: "manual-csv",
          label: "Example Dental",
          websiteUri: "HTTPS://Example.test/path/"
        },
        resolution: {
          hasWebsite: true,
          websiteUrl: "https://Example.test/path/",
          status: "resolved"
        }
      })
    ).toBe("url:https://example.test/path");

    expect(
      stableLeadKey({
        candidate: {
          source: "manual-csv",
          label: "  Example   Dental  "
        },
        resolution: {
          hasWebsite: false,
          status: "missing"
        }
      })
    ).toBe("label:manual-csv:example dental");
  });

  it("reads suppression entries and filters matching reviewed leads", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-local-audit-suppression-"));
    try {
      const input = join(dir, "suppression.csv");
      await writeFile(
        input,
        "source,sourceId,label,websiteUrl,reviewStatus,reviewReason,lastReviewedAt\nmanual-csv,,Old Clinic,https://old.example/,rejected,Not a fit,2026-05-13\ngoogle-places,place-2,New Clinic,,new,,\nmanual-csv,,Contacted Clinic,https://contacted.example,contacted,Already emailed,2026-05-13\nmanual-csv,,Key Only Clinic,https://keyonly.example,,,\n",
        "utf8"
      );

      const entries = await readLeadSuppressionCsv(input);
      expect(entries.map((entry) => [entry.leadKey, entry.reviewStatus, entry.reviewReason])).toEqual([
        ["url:https://old.example", "rejected", "Not a fit"],
        ["google-places:place-2", "new", undefined],
        ["url:https://contacted.example", "contacted", "Already emailed"],
        ["url:https://keyonly.example", undefined, undefined]
      ]);

      const result = filterSuppressedProspects(
        [
          {
            candidate: {
              source: "manual-csv",
              label: "Old Clinic",
              websiteUri: "https://old.example"
            },
            resolution: {
              hasWebsite: true,
              websiteUrl: "https://old.example/",
              status: "resolved"
            }
          },
          {
            candidate: {
              source: "google-places",
              sourceId: "place-2",
              label: "New Clinic"
            },
            resolution: {
              hasWebsite: false,
              status: "missing"
            }
          },
          {
            candidate: {
              source: "manual-csv",
              label: "Fresh Clinic"
            },
            resolution: {
              hasWebsite: false,
              status: "missing"
            }
          }
        ],
        entries
      );

      expect(result.suppressedCount).toBe(1);
      expect(result.included.map((input) => input.candidate.label)).toEqual(["New Clinic", "Fresh Clinic"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("merges existing review decisions into the review CSV queue", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-local-audit-review-"));
    try {
      const input = join(dir, "review.csv");
      await writeFile(
        input,
        "leadKey,source,sourceId,label,websiteUrl,reviewStatus,reviewReason,lastReviewedAt\nurl:https://old.example,manual-csv,,Old Dental,https://old.example,rejected,Not a fit,2026-05-13\n",
        "utf8"
      );

      const existing = await readLeadReviewCsv(input);
      const rows = buildProspectRows([
        {
          candidate: {
            source: "manual-csv",
            label: "Fresh Dental"
          },
          resolution: {
            hasWebsite: false,
            status: "missing"
          }
        }
      ]);
      const merged = mergeDiscoveryReviewRows(rows, existing);

      expect(merged.map((row) => [row.leadKey, row.reviewStatus, row.reviewReason])).toEqual([
        ["url:https://old.example", "rejected", "Not a fit"],
        ["label:manual-csv:fresh dental", "pending", undefined]
      ]);
      const csv = renderDiscoveryReviewCsv(merged);
      expect(csv.split(/\r?\n/)[0]).toBe(
        "leadKey,source,sourceId,label,websiteUrl,reviewStatus,reviewReason,lastReviewedAt,opportunityScore,priority,nextAction"
      );
      expect(csv).toContain("Fresh Dental");
      expect(csv).toContain("rejected");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("groups duplicate prospects by stable lead key", () => {
    const rows = buildProspectRows([
      {
        candidate: {
          source: "manual-csv",
          label: "First",
          websiteUri: "https://duplicate.example/"
        },
        resolution: {
          hasWebsite: true,
          websiteUrl: "https://duplicate.example/",
          status: "resolved"
        }
      },
      {
        candidate: {
          source: "manual-csv",
          label: "Second",
          websiteUri: "https://duplicate.example"
        },
        resolution: {
          hasWebsite: true,
          websiteUrl: "https://duplicate.example",
          status: "resolved"
        }
      },
      {
        candidate: {
          source: "manual-csv",
          label: "Unique"
        },
        resolution: {
          hasWebsite: false,
          status: "missing"
        }
      }
    ]);

    expect(findDuplicateProspectGroups(rows)).toEqual([
      {
        leadKey: "url:https://duplicate.example",
        count: 2,
        labels: ["First", "Second"],
        sources: ["manual-csv"]
      }
    ]);
  });

  it("reports advisory fuzzy duplicate candidates without repeating exact-only groups", () => {
    const rows = buildProspectRows([
      {
        candidate: {
          source: "manual-csv",
          label: "Kadikoy Smile Dental",
          websiteUri: "https://smile.example/location-a"
        },
        resolution: {
          hasWebsite: true,
          websiteUrl: "https://smile.example/location-a",
          status: "resolved"
        }
      },
      {
        candidate: {
          source: "manual-csv",
          label: "Kadikoy Smile Clinic",
          websiteUri: "https://smile.example/location-b"
        },
        resolution: {
          hasWebsite: true,
          websiteUrl: "https://smile.example/location-b",
          status: "resolved"
        }
      },
      {
        candidate: {
          source: "manual-csv",
          label: "First Exact",
          websiteUri: "https://exact.example"
        },
        resolution: {
          hasWebsite: true,
          websiteUrl: "https://exact.example",
          status: "resolved"
        }
      },
      {
        candidate: {
          source: "manual-csv",
          label: "Second Exact",
          websiteUri: "https://exact.example/"
        },
        resolution: {
          hasWebsite: true,
          websiteUrl: "https://exact.example/",
          status: "resolved"
        }
      }
    ]);

    expect(findDuplicateProspectGroups(rows)).toEqual([
      {
        leadKey: "url:https://exact.example",
        count: 2,
        labels: ["First Exact", "Second Exact"],
        sources: ["manual-csv"]
      }
    ]);
    expect(findFuzzyDuplicateProspectGroups(rows)).toEqual([
      {
        matchKey: "domain:smile.example",
        confidence: "high",
        matchReasons: ["Shared website domain: smile.example", "Similar business labels"],
        count: 2,
        labels: ["Kadikoy Smile Clinic", "Kadikoy Smile Dental"],
        leadKeys: ["url:https://smile.example/location-a", "url:https://smile.example/location-b"],
        sources: ["manual-csv"]
      }
    ]);
  });

  it("uses label similarity cautiously for fuzzy duplicate review", () => {
    const rows = buildProspectRows([
      {
        candidate: {
          source: "manual-csv",
          label: "Kadikoy Smile Dental"
        },
        resolution: {
          hasWebsite: false,
          status: "missing"
        }
      },
      {
        candidate: {
          source: "google-places",
          label: "Kadikoy Smile Clinic"
        },
        resolution: {
          hasWebsite: false,
          status: "missing"
        }
      },
      {
        candidate: {
          source: "manual-csv",
          label: "Dental Clinic"
        },
        resolution: {
          hasWebsite: false,
          status: "missing"
        }
      },
      {
        candidate: {
          source: "google-places",
          label: "Dental Clinic"
        },
        resolution: {
          hasWebsite: false,
          status: "missing"
        }
      }
    ]);

    expect(findFuzzyDuplicateProspectGroups(rows)).toEqual([
      {
        matchKey: "label:kadikoy-smile",
        confidence: "medium",
        matchReasons: ["Similar business labels"],
        count: 2,
        labels: ["Kadikoy Smile Clinic", "Kadikoy Smile Dental"],
        leadKeys: ["label:google-places:kadikoy smile clinic", "label:manual-csv:kadikoy smile dental"],
        sources: ["google-places", "manual-csv"]
      }
    ]);
  });

  it("keeps fuzzy duplicate groups deterministic and merges matching evidence", () => {
    const rows = buildProspectRows([
      {
        candidate: {
          source: "google-places",
          label: "Second Contact",
          websiteUri: "https://contact.example/b"
        },
        resolution: {
          hasWebsite: true,
          websiteUrl: "https://contact.example/b",
          status: "resolved"
        },
        audit: {
          status: "success",
          contact: {
            publicEmail: "HELLO@contact.example",
            publicPhone: "+90 212 000 0000",
            socialProfiles: [],
            contactConfidence: "High"
          }
        }
      },
      {
        candidate: {
          source: "manual-csv",
          label: "First Contact",
          websiteUri: "https://contact.example/a"
        },
        resolution: {
          hasWebsite: true,
          websiteUrl: "https://contact.example/a",
          status: "resolved"
        },
        audit: {
          status: "success",
          contact: {
            publicEmail: "hello@contact.example",
            publicPhone: "+902120000000",
            socialProfiles: [],
            contactConfidence: "High"
          }
        }
      }
    ]);
    const expected = [
      {
        matchKey: "domain:contact.example",
        confidence: "high",
        matchReasons: [
          "Shared public email: hello@contact.example",
          "Shared public phone number",
          "Shared website domain: contact.example"
        ],
        count: 2,
        labels: ["First Contact", "Second Contact"],
        leadKeys: ["url:https://contact.example/a", "url:https://contact.example/b"],
        sources: ["google-places", "manual-csv"]
      }
    ];

    expect(findFuzzyDuplicateProspectGroups(rows)).toEqual(expected);
    expect(findFuzzyDuplicateProspectGroups([...rows].reverse())).toEqual(expected);
  });

  it("does not treat shared profile hosts as high-confidence domain duplicates", () => {
    const rows = buildProspectRows([
      {
        candidate: {
          source: "manual-csv",
          label: "Cafe One",
          websiteUri: "https://linktr.ee/cafeone"
        },
        resolution: {
          hasWebsite: true,
          websiteUrl: "https://linktr.ee/cafeone",
          status: "resolved"
        }
      },
      {
        candidate: {
          source: "manual-csv",
          label: "Bike Shop Two",
          websiteUri: "https://linktr.ee/bikeshoptwo"
        },
        resolution: {
          hasWebsite: true,
          websiteUrl: "https://linktr.ee/bikeshoptwo",
          status: "resolved"
        }
      }
    ]);

    expect(findFuzzyDuplicateProspectGroups(rows)).toEqual([]);
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
          reportPath: "weak-test/open-local-audit-report.html",
          contact: {
            publicEmail: "hello@weak.test",
            publicPhone: "+902120000000",
            whatsappUrl: "https://wa.me/902120000000",
            contactPageUrl: "https://weak.test/contact",
            socialProfiles: ["https://www.instagram.com/weaksite"],
            contactConfidence: "High",
            contactSource: "mailto, tel, whatsapp, contact-page, social"
          }
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

    expect(
      rows.map((row) => [
        row.label,
        row.leadKey,
        row.hasWebsite,
        row.auditStatus,
        row.priority,
        row.opportunityScore,
        row.reviewStatus
      ])
    ).toEqual([
      ["No Site Clinic", "label:manual-csv:no site clinic", "no", "not-audited", "high", 95, "new"],
      ["Weak Site", "url:https://weak.test", "yes", "success", "high", 90, "new"],
      ["Strong Site", "url:https://strong.test", "yes", "success", "low", 30, "new"]
    ]);
    expect(rows[0].nextAction).toContain("Build a basic website");
    expect(rows[0].opportunityReasons).toContain("No website URL found");
    expect(rows[1].nextAction).toContain("Prioritize outreach");
    expect(rows[1].opportunityReasons).toContain("Audit score is below 60");
    expect(rows[1].opportunityReasons).toContain("Top finding: Phone action is missing");
    expect(rows[1].pitchAngle).toBe("Fix visible conversion blockers");
    expect(rows[1].recommendedOffer).toBe("Conversion-focused website tune-up");
    expect(rows[1].estimatedNeed).toBe("High");
    expect(rows[1].outreachPriorityReason).toContain("Audit score is below 60");
    expect(rows[1].publicEmail).toBe("hello@weak.test");
    expect(rows[1].publicPhone).toBe("+902120000000");
    expect(rows[1].whatsappUrl).toBe("https://wa.me/902120000000");
    expect(rows[1].contactPageUrl).toBe("https://weak.test/contact");
    expect(rows[1].socialProfiles).toEqual(["https://www.instagram.com/weaksite"]);
    expect(rows[1].contactConfidence).toBe("High");
    expect(rows[1].preferredContactChannel).toBe("email");
    expect(rows[1].outreachAction).toBe("Send a personalized audit summary by email.");
    expect(rows[1].contactabilityReason).toBe("Public email found on the audited website.");
    expect(rows[2].preferredContactChannel).toBe("manual-review");
    expect(rows[2].outreachAction).toBe("Find a public contact path manually before outreach.");
    expect(rows[2].contactabilityReason).toBe("No public contact channel found on the audited website.");
    expect(rows[2].nextAction).toContain("Monitor");
    expect(rows[2].opportunityReasons).toContain("Audit score is 80 or higher");
  });

  it("prefers WhatsApp, phone, and contact-page outreach handoff channels after email", () => {
    const rows = buildProspectRows([
      {
        candidate: {
          source: "manual-csv",
          label: "WhatsApp Lead",
          websiteUri: "https://whatsapp.test"
        },
        resolution: {
          hasWebsite: true,
          websiteUrl: "https://whatsapp.test",
          status: "resolved"
        },
        audit: {
          status: "success",
          score: 58,
          contact: {
            whatsappUrl: "https://wa.me/902120000000",
            socialProfiles: [],
            contactConfidence: "Medium",
            contactSource: "whatsapp"
          }
        }
      },
      {
        candidate: {
          source: "manual-csv",
          label: "Phone Lead",
          websiteUri: "https://phone.test"
        },
        resolution: {
          hasWebsite: true,
          websiteUrl: "https://phone.test",
          status: "resolved"
        },
        audit: {
          status: "success",
          score: 62,
          contact: {
            publicPhone: "+902129999999",
            socialProfiles: [],
            contactConfidence: "Medium",
            contactSource: "tel"
          }
        }
      },
      {
        candidate: {
          source: "manual-csv",
          label: "Contact Page Lead",
          websiteUri: "https://contact-page.test"
        },
        resolution: {
          hasWebsite: true,
          websiteUrl: "https://contact-page.test",
          status: "resolved"
        },
        audit: {
          status: "success",
          score: 72,
          contact: {
            contactPageUrl: "https://contact-page.test/contact",
            socialProfiles: [],
            contactConfidence: "Medium",
            contactSource: "contact-page"
          }
        }
      }
    ]);

    expect(rows.map((row) => [row.label, row.preferredContactChannel, row.outreachAction])).toEqual([
      ["WhatsApp Lead", "whatsapp", "Send a short WhatsApp message with the top audit issue."],
      ["Phone Lead", "phone", "Call with the top audit issue and offer a review."],
      ["Contact Page Lead", "contact-page", "Use the website contact page with the top audit issue."]
    ]);
  });

  it("builds discovery summary metrics from prospect rows", () => {
    const summary = buildDiscoverySummary([
      {
        source: "manual-csv",
        leadKey: "label:manual-csv:no site clinic",
        label: "No Site Clinic",
        profile: "dental",
        hasWebsite: "no",
        auditStatus: "not-audited",
        priority: "high",
        opportunityScore: 95,
        opportunityReasons: ["No website URL found", "Website-build opportunity"],
        pitchAngle: "Launch a credible local website",
        recommendedOffer: "Starter website build",
        estimatedNeed: "High",
        outreachPriorityReason: "No website URL found; Website-build opportunity",
        preferredContactChannel: "manual-review",
        outreachAction: "Find or create a website path before outreach.",
        contactabilityReason: "No website URL found.",
        reviewStatus: "new",
        nextAction: "Build a basic website before deeper audit."
      },
      {
        source: "manual-csv",
        leadKey: "url:https://weak.test",
        label: "Weak Site",
        profile: "dental",
        hasWebsite: "yes",
        auditStatus: "success",
        score: 45,
        priority: "high",
        opportunityScore: 90,
        opportunityReasons: ["Audit score is below 60", "Top finding: Phone action is missing"],
        pitchAngle: "Fix visible conversion blockers",
        recommendedOffer: "Conversion-focused website tune-up",
        estimatedNeed: "High",
        outreachPriorityReason: "Audit score is below 60; Top finding: Phone action is missing",
        preferredContactChannel: "manual-review",
        outreachAction: "Find a public contact path manually before outreach.",
        contactabilityReason: "No public contact channel found on the audited website.",
        reviewStatus: "new",
        nextAction: "Prioritize outreach with the top audit issue."
      },
      {
        source: "manual-csv",
        leadKey: "url:https://failed.test",
        label: "Failed Site",
        profile: "dental",
        hasWebsite: "yes",
        auditStatus: "failed",
        priority: "medium",
        opportunityScore: 60,
        opportunityReasons: ["Audit failed and needs manual review"],
        pitchAngle: "Manually qualify technical blockers",
        recommendedOffer: "Manual audit follow-up",
        estimatedNeed: "Medium",
        outreachPriorityReason: "Audit failed and needs manual review",
        preferredContactChannel: "manual-review",
        outreachAction: "Review the failed audit before outreach.",
        contactabilityReason: "Audit failed before contactability could be trusted.",
        reviewStatus: "new",
        nextAction: "Review the site manually because the audit failed."
      }
    ]);

    expect(summary).toEqual({
      totalCandidates: 3,
      suppressedCandidates: 0,
      withWebsite: 2,
      withoutWebsite: 1,
      unknownWebsite: 0,
      audited: 1,
      auditFailed: 1,
      notAudited: 1,
      averageScore: 45,
      priority: {
        high: 2,
        medium: 1,
        low: 0
      }
    });
  });

  it("renders prospect rows as escaped CSV", () => {
    const csv = renderProspectRowsCsv([
      {
        leadKey: "label:manual-csv:clinic a",
        source: "manual-csv",
        label: "Clinic, A",
        profile: "dental",
        hasWebsite: "no",
        auditStatus: "not-audited",
        opportunityScore: 95,
        opportunityReasons: ["No website URL found", "Website-build opportunity"],
        pitchAngle: "Launch a credible local website",
        recommendedOffer: "Starter website build",
        estimatedNeed: "High",
        outreachPriorityReason: "No website URL found; Website-build opportunity",
        publicEmail: "hello@clinic-a.test",
        publicPhone: "+902120000000",
        whatsappUrl: "https://wa.me/902120000000",
        contactPageUrl: "https://clinic-a.test/contact",
        socialProfiles: ["https://www.instagram.com/clinic-a"],
        contactConfidence: "High",
        contactSource: "mailto, tel, whatsapp, contact-page, social",
        preferredContactChannel: "email",
        outreachAction: "Send a personalized audit summary by email.",
        contactabilityReason: "Public email found on the audited website.",
        priority: "high",
        reviewStatus: "new",
        nextAction: "Build a basic website before deeper audit."
      }
    ]);

    expect(csv.split(/\r?\n/)[0]).toBe(
      "leadKey,source,sourceId,label,segment,profile,hasWebsite,websiteUrl,auditStatus,score,topFinding,opportunityScore,opportunityReasons,pitchAngle,recommendedOffer,estimatedNeed,outreachPriorityReason,publicEmail,publicPhone,whatsappUrl,contactPageUrl,socialProfiles,contactConfidence,contactSource,preferredContactChannel,outreachAction,contactabilityReason,priority,nextAction,reviewStatus,reviewReason,lastReviewedAt,reportPath,error"
    );
    expect(csv).toContain('"Clinic, A"');
    expect(csv).toContain("No website URL found; Website-build opportunity");
    expect(csv).toContain("Starter website build");
    expect(csv).toContain("hello@clinic-a.test");
    expect(csv).toContain("https://www.instagram.com/clinic-a");
  });

  it("neutralizes spreadsheet formulas in prospect CSV cells", () => {
    const csv = renderProspectRowsCsv([
      {
        leadKey: "label:manual-csv:formula",
        source: "manual-csv",
        label: "=cmd|' /C calc'!A0",
        profile: "generic",
        hasWebsite: "no",
        auditStatus: "not-audited",
        opportunityScore: 95,
        opportunityReasons: ["No website URL found", "Website-build opportunity"],
        pitchAngle: "Launch a credible local website",
        recommendedOffer: "Starter website build",
        estimatedNeed: "High",
        outreachPriorityReason: "No website URL found; Website-build opportunity",
        publicEmail: "=lead@example.test",
        socialProfiles: ["+https://social.example/formula"],
        contactConfidence: "Medium",
        contactSource: "text-email, social",
        preferredContactChannel: "=email",
        outreachAction: "+send outreach",
        contactabilityReason: "@public email found",
        priority: "high",
        reviewStatus: "new",
        nextAction: "+call this lead"
      }
    ]);

    expect(csv).toContain("'=cmd|' /C calc'!A0");
    expect(csv).toContain("'+call this lead");
    expect(csv).toContain("'=lead@example.test");
    expect(csv).toContain("'+https://social.example/formula");
    expect(csv).toContain("'=email");
    expect(csv).toContain("'+send outreach");
    expect(csv).toContain("'@public email found");
  });
});
