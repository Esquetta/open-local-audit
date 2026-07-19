import { constants } from "node:fs";
import { existsSync } from "node:fs";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as workflowPreflight from "../src/workflow-preflight.js";
import { runWorkflowPreflight } from "../src/workflow-preflight.js";

describe("workflow preflight", () => {
  let directory: string;
  let configPath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "open-local-audit-workflow-preflight-"));
    configPath = join(directory, "config", "workflow.json");
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function writeConfig(config: unknown): Promise<void> {
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify(config), "utf8");
  }

  function manualConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      version: 1,
      outDir: "./output",
      discovery: { provider: "manual-csv", input: "./input/places.csv" },
      shortlist: {},
      ...overrides
    };
  }

  async function writeManualInput(): Promise<string> {
    const inputPath = join(directory, "config", "input", "places.csv");
    await mkdir(dirname(inputPath), { recursive: true });
    await writeFile(inputPath, "name\nExample\n", "utf8");
    return inputPath;
  }

  it("reports a valid manual workflow as ready without creating its output tree", async () => {
    await writeConfig(manualConfig());
    await writeManualInput();

    const result = await runWorkflowPreflight(configPath);

    expect(result).toMatchObject({
      version: 1,
      status: "ready",
      provider: "manual-csv",
      stages: ["discovery", "shortlist"],
      limits: { maxCandidates: null, maxAudits: null },
      checks: expect.arrayContaining([
        expect.objectContaining({ id: "configuration", status: "pass" }),
        expect.objectContaining({ id: "discovery-input", status: "pass" }),
        expect.objectContaining({ id: "output-access", status: "pass" })
      ])
    });
    expect(result.outputs?.outDir).toBe(join(directory, "config", "output"));
    expect(existsSync(join(directory, "config", "output"))).toBe(false);
  });

  it("blocks missing and non-file manual inputs", async () => {
    await writeConfig(manualConfig());

    await expect(runWorkflowPreflight(configPath)).resolves.toMatchObject({
      status: "blocked",
      checks: expect.arrayContaining([expect.objectContaining({ id: "discovery-input", status: "fail" })])
    });

    const inputPath = await writeManualInput();
    await rm(inputPath);
    await mkdir(inputPath);

    await expect(runWorkflowPreflight(configPath)).resolves.toMatchObject({
      status: "blocked",
      checks: expect.arrayContaining([expect.objectContaining({ id: "discovery-input", status: "fail" })])
    });
  });

  it("blocks a manual input when read access is denied", async () => {
    await writeConfig(manualConfig());
    const inputPath = await writeManualInput();

    const result = await runWorkflowPreflight(configPath, {
      access: async (path, mode) => {
        if (path === inputPath && mode === constants.R_OK) {
          throw Object.assign(new Error("denied"), { code: "EACCES" });
        }
        await access(path, mode);
      }
    });

    expect(result).toMatchObject({
      status: "blocked",
      checks: expect.arrayContaining([expect.objectContaining({ id: "discovery-input", status: "fail" })])
    });
  });

  it("checks Google key presence without exposing the returned key", async () => {
    const key = "google-preflight-sentinel-key";
    await writeConfig(
      manualConfig({ discovery: { provider: "google-places", query: "dentist Kadikoy", limit: 7 } })
    );

    const ready = await runWorkflowPreflight(configPath, { resolveGoogleMapsApiKey: () => key });
    const blocked = await runWorkflowPreflight(configPath, { resolveGoogleMapsApiKey: () => "   " });

    expect(ready).toMatchObject({
      status: "ready",
      provider: "google-places",
      limits: { maxCandidates: 7, maxAudits: null },
      checks: expect.arrayContaining([expect.objectContaining({ id: "google-api-key", status: "pass" })])
    });
    expect(JSON.stringify(ready)).not.toContain(key);
    expect(blocked).toMatchObject({
      status: "blocked",
      checks: expect.arrayContaining([expect.objectContaining({ id: "google-api-key", status: "fail" })])
    });
  });

  it("reports configured review CSV readiness without blocking a missing file", async () => {
    const reviewPath = join(directory, "config", "review.csv");
    await writeConfig(manualConfig({ review: { csv: "./review.csv" } }));
    await writeManualInput();

    await expect(runWorkflowPreflight(configPath)).resolves.toMatchObject({
      status: "ready",
      stages: ["discovery", "shortlist", "review"],
      checks: expect.arrayContaining([expect.objectContaining({ id: "review-csv", status: "warn" })])
    });

    await writeFile(reviewPath, "id\n1\n", "utf8");
    await expect(runWorkflowPreflight(configPath)).resolves.toMatchObject({
      status: "ready",
      checks: expect.arrayContaining([expect.objectContaining({ id: "review-csv", status: "pass" })])
    });

    await rm(reviewPath);
    await mkdir(reviewPath);
    await expect(runWorkflowPreflight(configPath)).resolves.toMatchObject({
      status: "blocked",
      checks: expect.arrayContaining([expect.objectContaining({ id: "review-csv", status: "fail" })])
    });
  });

  it("converts invalid JSON and strict schema errors into configuration failures", async () => {
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, '{ "version": 1,', "utf8");

    const invalidJson = await runWorkflowPreflight(configPath);

    expect(invalidJson).toEqual({
      version: 1,
      status: "blocked",
      checks: [{ id: "configuration", status: "fail", message: expect.any(String) }]
    });

    await writeConfig(manualConfig({ unexpected: true }));
    const invalidSchema = await runWorkflowPreflight(configPath);

    expect(invalidSchema).toEqual({
      version: 1,
      status: "blocked",
      checks: [{ id: "configuration", status: "fail", message: expect.any(String) }]
    });
  });

  it("uses the nearest existing writable output ancestor without creating missing parents", async () => {
    await writeConfig(manualConfig({ outDir: "./missing/child/output" }));
    await writeManualInput();

    const result = await runWorkflowPreflight(configPath);

    expect(result).toMatchObject({
      status: "ready",
      checks: expect.arrayContaining([expect.objectContaining({ id: "output-access", status: "pass" })])
    });
    expect(existsSync(join(directory, "config", "missing"))).toBe(false);
  });

  it("blocks an inaccessible output ancestor without probing by writing", async () => {
    await writeConfig(manualConfig());
    await writeManualInput();
    const configDirectory = join(directory, "config");

    const result = await runWorkflowPreflight(configPath, {
      access: async (path, mode) => {
        if (path === configDirectory && mode === constants.W_OK) {
          throw Object.assign(new Error("denied"), { code: "EACCES" });
        }
        await access(path, mode);
      }
    });

    expect(result).toMatchObject({
      status: "blocked",
      checks: expect.arrayContaining([expect.objectContaining({ id: "output-access", status: "fail" })])
    });
    expect(existsSync(join(configDirectory, "output"))).toBe(false);
  });

  it("maps managed-path inspection issues to blocking checks", async () => {
    await writeConfig(manualConfig());
    await writeManualInput();
    const linkedPath = join(directory, "config", "output", "reports");

    const result = await runWorkflowPreflight(configPath, {
      inspectWorkflowManagedPaths: async () => ({
        status: "unsafe",
        issues: [
          {
            id: "reports-linked",
            message: "Managed reports directory must not be linked",
            path: linkedPath
          },
          {
            id: "packages-escape",
            message: "Managed packages directory escapes output directory",
            path: join(directory, "config", "output", "packages")
          }
        ]
      })
    });

    expect(result).toMatchObject({
      status: "blocked",
      checks: expect.arrayContaining([
        expect.objectContaining({
          id: "managed-paths",
          status: "fail",
          message: "Managed reports directory must not be linked",
          path: linkedPath
        }),
        expect.objectContaining({
          id: "managed-paths",
          status: "fail",
          message: "Managed packages directory escapes output directory",
          path: join(directory, "config", "output", "packages")
        })
      ])
    });
  });

  it("reports stages and limits for packaging and audit caps", async () => {
    await writeConfig(
      manualConfig({
        discovery: { provider: "google-places", query: "plumber", limit: 3, maxAudits: 2 },
        review: { csv: "./review.csv" },
        packageReports: true
      })
    );

    const result = await runWorkflowPreflight(configPath, { resolveGoogleMapsApiKey: () => "present" });

    expect(result).toMatchObject({
      status: "ready",
      stages: ["discovery", "shortlist", "review", "packaging"],
      limits: { maxCandidates: 3, maxAudits: 2 }
    });
  });

  it("does not expose fetch or discovery execution from the preflight module", () => {
    expect(workflowPreflight).not.toHaveProperty("fetch");
    expect(workflowPreflight).not.toHaveProperty("discoverBusinesses");
  });
});
