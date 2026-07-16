import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readWorkflowConfig } from "../src/workflow-config.js";

describe("workflow configuration", () => {
  let directory: string;
  let configPath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "open-local-audit-workflow-config-"));
    configPath = join(directory, "config", "workflow.json");
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function writeConfig(config: unknown): Promise<void> {
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify(config), "utf8");
  }

  function validManualConfig(): Record<string, unknown> {
    return {
      version: 1,
      outDir: "./output",
      discovery: {
        provider: "manual-csv",
        input: "./input/places.csv"
      },
      shortlist: {}
    };
  }

  it("resolves configuration paths and every managed output from the config directory", async () => {
    await writeConfig({
      ...validManualConfig(),
      review: { csv: "./operator/review.csv" }
    });

    const result = await readWorkflowConfig(configPath);
    const configDirectory = dirname(resolve(configPath));
    const outDir = join(configDirectory, "output");

    expect(result).toMatchObject({
      outDir,
      discovery: {
        provider: "manual-csv",
        input: join(configDirectory, "input", "places.csv")
      },
      review: {
        csv: join(configDirectory, "operator", "review.csv")
      },
      paths: {
        leadsCsv: join(outDir, "leads.csv"),
        discoverySummaryJson: join(outDir, "discovery-summary.json"),
        shortlistCsv: join(outDir, "shortlist.csv"),
        shortlistSummaryJson: join(outDir, "shortlist-summary.json"),
        reviewSummaryJson: join(outDir, "review-summary.json"),
        workflowSummaryJson: join(outDir, "workflow-summary.json"),
        reportsDir: join(outDir, "reports"),
        packagesDir: join(outDir, "packages")
      }
    });
  });

  it("applies workflow defaults", async () => {
    await writeConfig(validManualConfig());

    const result = await readWorkflowConfig(configPath);

    expect(result).toMatchObject({
      discovery: {
        profile: "generic",
        concurrency: 1
      },
      shortlist: {
        top: 20,
        sort: "opportunity-desc"
      },
      packageReports: false
    });
    expect(result).not.toHaveProperty("review");
  });

  it("applies the Google Places limit default", async () => {
    await writeConfig({
      ...validManualConfig(),
      discovery: { provider: "google-places", query: "dentist Kadikoy" }
    });

    await expect(readWorkflowConfig(configPath)).resolves.toMatchObject({
      discovery: { limit: 10 }
    });
  });

  it("rejects unknown root and nested fields", async () => {
    const invalidConfigs = [
      { ...validManualConfig(), unexpected: true },
      {
        ...validManualConfig(),
        discovery: { provider: "manual-csv", input: "places.csv", unexpected: true }
      },
      { ...validManualConfig(), shortlist: { unexpected: true } },
      { ...validManualConfig(), review: { csv: "review.csv", unexpected: true } }
    ];

    for (const [index, config] of invalidConfigs.entries()) {
      configPath = join(directory, `config-${index}.json`);
      await writeConfig(config);
      await expect(readWorkflowConfig(configPath)).rejects.toThrow(/unrecognized key/i);
    }
  });

  it("rejects unsupported versions", async () => {
    await writeConfig({ ...validManualConfig(), version: 2 });

    await expect(readWorkflowConfig(configPath)).rejects.toThrow();
  });

  it("requires an input for manual CSV discovery", async () => {
    await writeConfig({
      ...validManualConfig(),
      discovery: { provider: "manual-csv" }
    });

    await expect(readWorkflowConfig(configPath)).rejects.toThrow();
  });

  it("requires a nonblank Google Places query", async () => {
    for (const [index, query] of [undefined, "   "].entries()) {
      configPath = join(directory, `google-${index}.json`);
      await writeConfig({
        ...validManualConfig(),
        discovery: { provider: "google-places", ...(query === undefined ? {} : { query }) }
      });
      await expect(readWorkflowConfig(configPath)).rejects.toThrow();
    }
  });

  it("rejects Google Places limits above 50", async () => {
    await writeConfig({
      ...validManualConfig(),
      discovery: { provider: "google-places", query: "dentist Kadikoy", limit: 51 }
    });

    await expect(readWorkflowConfig(configPath)).rejects.toThrow();
  });

  it("accepts omitted or zero maxAudits and rejects negative values", async () => {
    const discoveries = [
      { provider: "manual-csv", input: "places.csv" },
      { provider: "google-places", query: "dentist Kadikoy" }
    ];

    for (const [providerIndex, discovery] of discoveries.entries()) {
      for (const [valueIndex, maxAudits] of [undefined, 0].entries()) {
        configPath = join(directory, `max-audits-${providerIndex}-${valueIndex}.json`);
        await writeConfig({
          ...validManualConfig(),
          discovery: { ...discovery, ...(maxAudits === undefined ? {} : { maxAudits }) }
        });
        const result = await readWorkflowConfig(configPath);
        expect(result.discovery).toMatchObject({ provider: discovery.provider });
        if (maxAudits === undefined) {
          expect(result.discovery).not.toHaveProperty("maxAudits");
        } else {
          expect(result.discovery).toHaveProperty("maxAudits", maxAudits);
        }
      }

      configPath = join(directory, `max-audits-negative-${providerIndex}.json`);
      await writeConfig({ ...validManualConfig(), discovery: { ...discovery, maxAudits: -1 } });
      await expect(readWorkflowConfig(configPath)).rejects.toThrow();
    }
  });

  it("accepts shortlist minOpportunityScore boundaries and rejects out-of-range values", async () => {
    for (const minOpportunityScore of [0, 100]) {
      configPath = join(directory, `min-opportunity-${minOpportunityScore}.json`);
      await writeConfig({ ...validManualConfig(), shortlist: { minOpportunityScore } });
      await expect(readWorkflowConfig(configPath)).resolves.toMatchObject({ shortlist: { minOpportunityScore } });
    }

    for (const minOpportunityScore of [-1, 101]) {
      configPath = join(directory, `min-opportunity-${minOpportunityScore}.json`);
      await writeConfig({ ...validManualConfig(), shortlist: { minOpportunityScore } });
      await expect(readWorkflowConfig(configPath)).rejects.toThrow();
    }
  });

  it("rejects a review object without csv", async () => {
    await writeConfig({ ...validManualConfig(), review: {} });

    await expect(readWorkflowConfig(configPath)).rejects.toThrow();
  });

  it("rejects unknown Google Places discovery fields", async () => {
    await writeConfig({
      ...validManualConfig(),
      discovery: { provider: "google-places", query: "dentist Kadikoy", unexpected: true }
    });

    await expect(readWorkflowConfig(configPath)).rejects.toThrow(/unrecognized key/i);
  });

  it("accepts all seven shortlist sort values and rejects unsupported values", async () => {
    const sortValues = [
      "opportunity-desc",
      "score-desc",
      "company-asc",
      "last-reviewed-asc",
      "contact-confidence-desc",
      "priority-desc",
      "source-asc"
    ];

    for (const [index, sort] of sortValues.entries()) {
      configPath = join(directory, `sort-${index}.json`);
      await writeConfig({ ...validManualConfig(), shortlist: { sort } });
      await expect(readWorkflowConfig(configPath)).resolves.toMatchObject({ shortlist: { sort } });
    }

    configPath = join(directory, "sort-invalid.json");
    await writeConfig({ ...validManualConfig(), shortlist: { sort: "newest-first" } });
    await expect(readWorkflowConfig(configPath)).rejects.toThrow();
  });

  it("accepts only real YYYY-MM-DD calendar dates for staleBefore", async () => {
    configPath = join(directory, "valid-date.json");
    await writeConfig({ ...validManualConfig(), review: { csv: "review.csv", staleBefore: "2024-02-29" } });
    await expect(readWorkflowConfig(configPath)).resolves.toMatchObject({
      review: { staleBefore: "2024-02-29" }
    });

    for (const [index, staleBefore] of ["2023-02-29", "2026-02-30", "2026-2-03", "2026-02-03T00:00:00Z"].entries()) {
      configPath = join(directory, `invalid-date-${index}.json`);
      await writeConfig({ ...validManualConfig(), review: { csv: "review.csv", staleBefore } });
      await expect(readWorkflowConfig(configPath)).rejects.toThrow();
    }
  });

  it("reports malformed JSON with workflow config path context", async () => {
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, '{ "version": 1,', "utf8");

    await expect(readWorkflowConfig(configPath)).rejects.toThrow(
      `Workflow config ${resolve(configPath)} contains invalid JSON`
    );
  });

  it("preserves missing workflow config file errors", async () => {
    await expect(readWorkflowConfig(configPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
