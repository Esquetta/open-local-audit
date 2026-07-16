import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderProspectRowsCsv } from "../src/discovery.js";
import { runDiscovery, type DiscoveryRunOptions } from "../src/discovery-runner.js";

describe("runDiscovery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns rows and summary and writes discovery outputs in dry-run mode", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-local-audit-discovery-runner-"));
    try {
      const input = join(dir, "input", "manual.csv");
      const exportCsv = join(dir, "nested", "exports", "leads.csv");
      const summaryJson = join(dir, "nested", "summaries", "discovery-summary.json");
      await mkdir(dirname(input), { recursive: true });
      await writeFile(
        input,
        "label,website,segment,profile\nExample Dental,https://example.test,dental,dental\nNo Site Clinic,,dental,dental\n",
        "utf8"
      );

      const result = await runDiscovery({
        provider: "manual-csv",
        input,
        profile: "dental",
        exportCsv,
        summaryJson,
        dryRun: true,
        concurrency: 1
      });

      expect(result.rows.map((row) => [row.label, row.leadKey, row.auditStatus, row.hasWebsite, row.opportunityScore])).toEqual([
        ["Example Dental", "url:https://example.test", "not-audited", "yes", 55],
        ["No Site Clinic", "label:manual-csv:no site clinic", "not-audited", "no", 95]
      ]);
      expect(result.summary).toEqual({
        totalCandidates: 2,
        suppressedCandidates: 0,
        withWebsite: 1,
        withoutWebsite: 1,
        unknownWebsite: 0,
        audited: 0,
        auditFailed: 0,
        notAudited: 2,
        averageScore: undefined,
        priority: {
          high: 1,
          medium: 1,
          low: 0
        }
      });
      expect(readFileSync(exportCsv, "utf8")).toBe(renderProspectRowsCsv(result.rows));
      expect(JSON.parse(readFileSync(summaryJson, "utf8"))).toEqual(result.summary);
      expect(existsSync(dirname(exportCsv))).toBe(true);
      expect(existsSync(dirname(summaryJson))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("requires exportCsv at runtime", async () => {
    await expect(
      runDiscovery({
        provider: "manual-csv",
        input: "manual.csv",
        profile: "generic",
        dryRun: true,
        concurrency: 1
      } as DiscoveryRunOptions)
    ).rejects.toThrow("--export-csv is required for discover output");
  });

  it("requires outDir unless dryRun is used", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-local-audit-discovery-runner-"));
    try {
      const input = join(dir, "manual.csv");
      await writeFile(input, "label,website\nExample Dental,https://example.test\n", "utf8");

      await expect(
        runDiscovery({
          provider: "manual-csv",
          input,
          profile: "generic",
          exportCsv: join(dir, "leads.csv"),
          dryRun: false,
          concurrency: 1
        })
      ).rejects.toThrow("--out-dir is required unless --dry-run is used");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects positional queries for manual CSV discovery", async () => {
    await expect(
      runDiscovery({
        provider: "manual-csv",
        query: "dentist kadikoy",
        input: "manual.csv",
        profile: "generic",
        exportCsv: "leads.csv",
        dryRun: true,
        concurrency: 1
      })
    ).rejects.toThrow("Manual CSV discovery does not accept a positional query; use --input instead");
  });

  it("requires input for manual CSV discovery", async () => {
    await expect(
      runDiscovery({
        provider: "manual-csv",
        profile: "generic",
        exportCsv: "leads.csv",
        dryRun: true,
        concurrency: 1
      })
    ).rejects.toThrow("--input is required when --provider manual-csv is used");
  });

  it("rejects input for Google Places discovery", async () => {
    await expect(
      runDiscovery({
        provider: "google-places",
        query: "dentist kadikoy",
        input: "manual.csv",
        profile: "generic",
        exportCsv: "leads.csv",
        dryRun: true,
        concurrency: 1,
        apiKey: "test-key"
      })
    ).rejects.toThrow("--input is only supported when --provider manual-csv is used");
  });

  it("uses the injected Google API key and provider validation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-local-audit-discovery-runner-google-"));
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      expect(init?.headers).toEqual({
        "Content-Type": "application/json",
        "X-Goog-Api-Key": "test-key",
        "X-Goog-FieldMask": "places.id,places.displayName,places.websiteUri"
      });
      expect(JSON.parse(String(init?.body))).toEqual({
        textQuery: "dentist kadikoy",
        maxResultCount: 10
      });

      return new Response(JSON.stringify({ places: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    try {
      const result = await runDiscovery({
        provider: "google-places",
        query: "dentist kadikoy",
        profile: "dental",
        exportCsv: join(dir, "leads.csv"),
        dryRun: true,
        concurrency: 1,
        apiKey: "test-key"
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.rows).toEqual([]);
      expect(result.summary).toEqual({
        totalCandidates: 0,
        suppressedCandidates: 0,
        withWebsite: 0,
        withoutWebsite: 0,
        unknownWebsite: 0,
        audited: 0,
        auditFailed: 0,
        notAudited: 0,
        averageScore: undefined,
        priority: {
          high: 0,
          medium: 0,
          low: 0
        }
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
