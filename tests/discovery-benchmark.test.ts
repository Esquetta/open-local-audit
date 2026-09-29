import { describe, expect, it, vi } from "vitest";
import {
  buildBenchmarkCases,
  runBenchmarkCases,
  summarizeBenchmark,
  type BenchmarkCaseResult
} from "../scripts/benchmark-discovery.js";

describe("free discovery benchmark harness", () => {
  it("covers every requested country, city, and category and pins the first returned release", async () => {
    const cases = buildBenchmarkCases();

    expect(cases).toHaveLength(24);
    expect(new Set(cases.map((item) => item.country))).toEqual(new Set(["TR", "US", "DE", "GB"]));
    expect(cases.filter((item) => item.country === "TR").map((item) => item.city)).toEqual([
      "Istanbul", "Istanbul", "Istanbul", "Ankara", "Ankara", "Ankara"
    ]);
    expect(new Set(cases.map((item) => item.category))).toEqual(new Set(["dental", "restaurant", "beauty"]));
    expect(cases.every((item) => item.bbox.split(",").length === 4)).toBe(true);

    const runner = vi.fn(async (options: { release?: string }) => {
      if (runner.mock.calls.length === 2) throw new Error("transient Overture failure");
      return {
        rows: [{ datasetRelease: "2026-09-23.1" }],
        summary: { totalCandidates: 1 },
        metrics: { discoveryMs: 12, auditMs: 20, totalMs: 35, sourceCoverage: { denominator: 1, website: 1, phone: 0, email: 0, address: 0 }, websites: [] }
      };
    });

    const results = await runBenchmarkCases(cases, {
      outDir: "reports/test",
      limit: 10,
      maxAudits: 3,
      repeats: 1,
      now: () => 100
    }, runner as never);

    expect(runner).toHaveBeenCalledTimes(24);
    expect(results[1]).toMatchObject({ status: "failed", error: "transient Overture failure", returnedCount: 0 });
    expect(runner.mock.calls[0]?.[0]).toMatchObject({ provider: "overture", release: undefined, limit: 10, maxAudits: 3 });
    expect(runner.mock.calls.slice(1).every(([options]) => options.release === "2026-09-23.1")).toBe(true);
  });

  it("retains failed cases while excluding them from duration percentiles and handling zero-row coverage", () => {
    const cases = buildBenchmarkCases().slice(0, 3);
    const results: BenchmarkCaseResult[] = [
      {
        case: cases[0]!,
        status: "success",
        elapsedMs: 40,
        requestedLimit: 10,
        requestedRelease: null,
        returnedCount: 0,
        datasetReleases: [],
        sourceCoverage: { denominator: 0, website: 0, phone: 0, email: 0, address: 0 },
        coverage: { denominator: 0, website: 0, phone: 0, email: 0, address: 0 },
        metrics: { discoveryMs: 10, auditMs: 20, totalMs: 30, websites: [] },
        rows: []
      },
      {
        case: cases[1]!,
        status: "failed",
        elapsedMs: 90,
        requestedLimit: 10,
        requestedRelease: "2026-09-23.1",
        error: "Overture query timed out",
        returnedCount: 0,
        datasetReleases: [],
        sourceCoverage: { denominator: 0, website: 0, phone: 0, email: 0, address: 0 },
        coverage: { denominator: 0, website: 0, phone: 0, email: 0, address: 0 },
        rows: []
      },
      {
        case: cases[2]!,
        status: "success",
        elapsedMs: 80,
        requestedLimit: 10,
        requestedRelease: "2026-09-23.1",
        returnedCount: 2,
        datasetReleases: ["2026-09-23.1"],
        sourceCoverage: { denominator: 2, website: 1, phone: 0, email: 0, address: 2 },
        coverage: { denominator: 2, website: 1, phone: 1, email: 0, address: 2 },
        metrics: { discoveryMs: 30, auditMs: 40, totalMs: 70, websites: [] },
        rows: []
      }
    ];

    const summary = summarizeBenchmark(results);

    expect(summary.counts).toEqual({ attempted: 3, succeeded: 2, failed: 1, returned: 2 });
    expect(summary.failures).toEqual([{ caseId: cases[1]!.id, error: "Overture query timed out", elapsedMs: 90 }]);
    expect(summary.durations.totalMs).toEqual({ p50: 50, p95: 68, sampleSize: 2 });
    expect(summary.coverage).toEqual({
      source: {
        denominator: 2,
        website: { count: 1, percent: 50 },
        phone: { count: 0, percent: 0 },
        email: { count: 0, percent: 0 },
        address: { count: 2, percent: 100 }
      },
      postWebsite: {
        denominator: 2,
        website: { count: 1, percent: 50 },
        phone: { count: 1, percent: 50 },
        email: { count: 0, percent: 0 },
        address: { count: 2, percent: 100 }
      }
    });
    expect(summary.websiteOutcomes).toEqual({ attempted: 0, success: 0, blocked: 0, failed: 0, other: 0 });
    expect(summarizeBenchmark([results[0]!]).coverage.postWebsite.website).toEqual({ count: 0, percent: undefined });
  });
});
