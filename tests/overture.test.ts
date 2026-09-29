import { afterEach, describe, expect, it, vi } from "vitest";

const duckdb = vi.hoisted(() => ({
  create: vi.fn(),
  connect: vi.fn(),
  close: vi.fn(),
  interrupt: vi.fn(),
  run: vi.fn(),
  runAndReadAll: vi.fn()
}));

vi.mock("@duckdb/node-api", () => ({
  DuckDBInstance: { create: duckdb.create }
}));

import {
  fetchOvertureCandidates,
  overtureCategoryMappings
} from "../src/overture.js";

const originalFetch = globalThis.fetch;

function configureDuckDb(rows: Array<Record<string, unknown>>) {
  duckdb.create.mockResolvedValue({
    connect: duckdb.connect,
    closeSync: duckdb.close
  });
  duckdb.connect.mockResolvedValue({
    interrupt: duckdb.interrupt,
    run: duckdb.run,
    runAndReadAll: duckdb.runAndReadAll,
    closeSync: duckdb.close
  });
  duckdb.runAndReadAll.mockResolvedValue({ getRowObjectsJS: () => rows });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.clearAllMocks();
});

describe("Overture Places discovery", () => {
  it("keeps social profiles as contacts instead of treating them as business websites", async () => {
    configureDuckDb([
      { id: "social-only", websites: ["http://instagram.com/fashion_kuafor/"], socials: ["https://facebook.com/fashion"] },
      { id: "short-link", websites: ["http://fbf.bz/b/ab4"] },
      { id: "own-site", websites: ["https://www.facebook.com/shop", "https://shop.example/"], socials: [] }
    ]);
    const candidates = await fetchOvertureCandidates({ bbox: [28.9, 40.9, 29.1, 41.1], category: "beauty", release: "2026-09-23.1" });
    expect(candidates.find((item) => item.sourceId === "social-only")?.websiteUri).toBeUndefined();
    expect(candidates.find((item) => item.sourceId === "social-only")?.sourceMetadata?.socials).toContain("http://instagram.com/fashion_kuafor/");
    expect(candidates.find((item) => item.sourceId === "short-link")?.websiteUri).toBeUndefined();
    expect(candidates.find((item) => item.sourceId === "own-site")?.websiteUri).toBe("https://shop.example/");
  });
  it("maps current Places rows to deterministic candidates and selects bounded taxonomy data", async () => {
    configureDuckDb([
      {
        id: "zeta",
        label: "Zeta Dental",
        category: "dentist",
        address: "1 Main Street",
        country: "TR",
        locality: "Istanbul",
        region: "TR-34",
        latitude: 41.01,
        longitude: 28.97,
        websites: ["ftp://invalid.example", "https://fdesign.example"],
        phones: ["+90 212 000 0000"],
        emails: ["hello@zeta.example"],
        socials: ["https://www.instagram.com/zeta"],
        confidence: 0.98,
        operating_status: "open",
        sources: [
          {
            provider: "meta",
            dataset: "Meta",
            license: "CDLA-Permissive-2.0",
            record_id: "495287836994321"
          }
        ]
      },
      {
        id: "alpha",
        label: "Alpha Dental",
        category: "dentist",
        websites: ["mailto:invalid@example.com"]
      }
    ]);

    await expect(
      fetchOvertureCandidates({
        bbox: [28.9, 40.9, 29.1, 41.1],
        category: "dental",
        defaultProfile: "dental",
        release: "2026-09-23.1"
      })
    ).resolves.toEqual([
      {
        source: "overture",
        sourceId: "alpha",
        label: "Alpha Dental",
        segment: "dental",
        profile: "dental",
        sourceMetadata: {
          address: undefined,
          country: undefined,
          locality: undefined,
          region: undefined,
          latitude: undefined,
          longitude: undefined,
          phones: [],
          emails: [],
          socials: [],
          confidence: undefined,
          operatingStatus: undefined,
          datasetRelease: "2026-09-23.1",
        sourceUrl: "https://docs.overturemaps.org/guides/places/",
        sourceUrls: [],
        sourceProvenance: [],
          retrievedAt: expect.any(String)
        }
      },
      {
        source: "overture",
        sourceId: "zeta",
        label: "Zeta Dental",
        segment: "dental",
        profile: "dental",
        websiteUri: "https://fdesign.example/",
        sourceMetadata: {
          address: "1 Main Street",
          country: "TR",
          locality: "Istanbul",
          region: "TR-34",
          latitude: 41.01,
          longitude: 28.97,
          phones: ["+90 212 000 0000"],
          emails: ["hello@zeta.example"],
          socials: ["https://www.instagram.com/zeta"],
          confidence: 0.98,
          operatingStatus: "open",
          datasetRelease: "2026-09-23.1",
          sourceUrl: "https://www.facebook.com/495287836994321",
          sourceUrls: ["https://www.facebook.com/495287836994321"],
          sourceProvenance: [
            {
              provider: "meta",
              dataset: "Meta",
              license: "CDLA-Permissive-2.0",
              recordId: "495287836994321"
            }
          ],
          retrievedAt: expect.any(String)
        }
      }
    ]);

    const sql = duckdb.runAndReadAll.mock.calls[0]?.[0] as string;
    expect(sql).toContain("s3://overturemaps-us-west-2/release/2026-09-23.1/theme=places/type=place/*");
    expect(sql).toContain("bbox.xmin BETWEEN $west AND $east");
    expect(sql).toContain("bbox.ymin BETWEEN $south AND $north");
    expect(sql).toContain("taxonomy.primary IN ('dentist', 'dental_clinic')");
    expect(sql).toContain("list_has_any(taxonomy.hierarchy, ['dentist', 'dental_clinic'])");
    expect(duckdb.runAndReadAll.mock.calls[0]?.[1]).toEqual({
      west: 28.9,
      south: 40.9,
      east: 29.1,
      north: 41.1,
      limit: 25
    });
    expect(duckdb.run.mock.calls).toEqual([
      ["INSTALL httpfs"],
      ["LOAD httpfs"],
      ["SET http_timeout=15"],
      ["SET http_retries=1"],
      ["SET s3_region='us-west-2'"]
    ]);
  });

  it("rejects unsafe categories, releases, and bounding boxes before creating a native query", async () => {
    await expect(
      fetchOvertureCandidates({
        bbox: [28.9, 40.9, 29.1, 41.1],
        category: "dental'; DROP TABLE places; --"
      })
    ).rejects.toThrow("Unsupported Overture category");
    await expect(
      fetchOvertureCandidates({
        bbox: [28.9, 40.9, 29.1, 41.1],
        category: "dental",
        release: "../../private"
      })
    ).rejects.toThrow("Invalid Overture release");
    await expect(
      fetchOvertureCandidates({
        bbox: [29.1, 40.9, 28.9, 41.1],
        category: "dental"
      })
    ).rejects.toThrow("Bounding box must have west < east and south < north");
    await expect(
      fetchOvertureCandidates({
        bbox: [-10, -5, 10, 5],
        category: "dental"
      })
    ).rejects.toThrow("Bounding box must span at most 5 degrees per axis");
    expect(duckdb.create).not.toHaveBeenCalled();
  });

  it("excludes explicitly closed and low-confidence places while preserving unknown confidence", async () => {
    configureDuckDb([
      { id: "closed", label: "Closed", confidence: 0.99, operating_status: "closed_permanently" },
      { id: "low", label: "Low", confidence: 0.49 },
      { id: "unknown", label: "Unknown" },
      { id: "high", label: "High", confidence: 0.5 }
    ]);

    await expect(
      fetchOvertureCandidates({
        bbox: [28.9, 40.9, 29.1, 41.1],
        category: "restaurant",
        release: "2026-09-23.1"
      })
    ).resolves.toEqual([
      expect.objectContaining({ sourceId: "high" }),
      expect.objectContaining({ sourceId: "unknown" })
    ]);
  });

  it("uses the official STAC latest release when no release is supplied", async () => {
    configureDuckDb([]);
    globalThis.fetch = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ latest: "2026-09-23.1" })));

    await fetchOvertureCandidates({ bbox: [28.9, 40.9, 29.1, 41.1], category: "restaurant" });

    expect(globalThis.fetch).toHaveBeenCalledWith("https://stac.overturemaps.org/catalog.json", {
      signal: expect.any(AbortSignal)
    });
    expect(duckdb.runAndReadAll.mock.calls[0]?.[0]).toContain("release/2026-09-23.1/");
  });

  it("interrupts and closes DuckDB after a query timeout", async () => {
    let rejectQuery: (reason: Error) => void = () => undefined;
    const interrupt = vi.fn(() => rejectQuery(new Error("Interrupted")));
    duckdb.create.mockResolvedValue({ connect: duckdb.connect, closeSync: duckdb.close });
    duckdb.connect.mockResolvedValue({
      interrupt,
      run: duckdb.run,
      runAndReadAll: duckdb.runAndReadAll,
      closeSync: duckdb.close
    });
    duckdb.runAndReadAll.mockImplementation(
      () => new Promise((_, reject: (reason: Error) => void) => { rejectQuery = reject; })
    );

    await expect(
      fetchOvertureCandidates({
        bbox: [28.9, 40.9, 29.1, 41.1],
        category: "gym",
        release: "2026-09-23.1",
        timeoutMs: 1
      })
    ).rejects.toThrow("Overture query timed out after 1ms");

    expect(interrupt).toHaveBeenCalledOnce();
    expect(duckdb.close).toHaveBeenCalledTimes(2);
  });

  it("closes the native instance when connection setup fails", async () => {
    duckdb.create.mockResolvedValue({ connect: duckdb.connect, closeSync: duckdb.close });
    duckdb.connect.mockRejectedValue(new Error("connection failed"));

    await expect(
      fetchOvertureCandidates({
        bbox: [28.9, 40.9, 29.1, 41.1],
        category: "gym",
        release: "2026-09-23.1"
      })
    ).rejects.toThrow("connection failed");

    expect(duckdb.close).toHaveBeenCalledOnce();
  });

  it("documents mappings for the supported business categories", () => {
    expect(overtureCategoryMappings).toMatchObject({
      dental: ["dentist", "dental_clinic"],
      restaurant: ["restaurant"],
      beauty: expect.any(Array),
      hotel: expect.arrayContaining(["hotel"]),
      gym: expect.any(Array)
    });
  });
});
