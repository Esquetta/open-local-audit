import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ResolvedWorkflowConfig } from "../src/workflow-config.js";
import { inspectWorkflowManagedPaths, prepareWorkflowManagedDirectories } from "../src/workflow-paths.js";

describe("workflow managed path inspection", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "open-local-audit-workflow-paths-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  function makeConfig(packageReports = false): ResolvedWorkflowConfig {
    const outDir = join(directory, "workflow-output");
    return {
      version: 1,
      outDir,
      discovery: {
        provider: "manual-csv",
        input: join(directory, "input.csv"),
        profile: "generic",
        concurrency: 1
      },
      shortlist: {
        top: 20,
        sort: "opportunity-desc"
      },
      packageReports,
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
    };
  }

  it("treats an absent output tree as safe without creating managed paths", async () => {
    const config = makeConfig(true);

    await expect(inspectWorkflowManagedPaths(config)).resolves.toEqual({ status: "safe", issues: [] });

    expect(existsSync(config.outDir)).toBe(false);
    expect(existsSync(config.paths.reportsDir)).toBe(false);
    expect(existsSync(config.paths.packagesDir)).toBe(false);
  });

  it("accepts existing managed directories contained by the output directory", async () => {
    const config = makeConfig(true);
    await mkdir(config.paths.reportsDir, { recursive: true });
    await mkdir(config.paths.packagesDir, { recursive: true });

    await expect(inspectWorkflowManagedPaths(config)).resolves.toEqual({ status: "safe", issues: [] });
  });

  it("reports a linked managed output directory", async () => {
    const config = makeConfig();
    const outsideDir = join(directory, "outside-output");
    await mkdir(outsideDir, { recursive: true });
    await symlink(outsideDir, config.outDir, process.platform === "win32" ? "junction" : "dir");

    await expect(inspectWorkflowManagedPaths(config)).resolves.toEqual({
      status: "unsafe",
      issues: [
        {
          id: "output-linked",
          message: "Managed output directory must not be linked",
          path: config.outDir
        }
      ]
    });
  });

  it("does not create child directories through a linked managed output directory", async () => {
    const config = makeConfig(true);
    const outsideDir = join(directory, "outside-preparation-output");
    await mkdir(outsideDir, { recursive: true });
    await symlink(outsideDir, config.outDir, process.platform === "win32" ? "junction" : "dir");

    await expect(prepareWorkflowManagedDirectories(config)).rejects.toThrow(
      "Managed output directory must not be linked"
    );

    expect(existsSync(join(outsideDir, "reports"))).toBe(false);
    expect(existsSync(join(outsideDir, "packages"))).toBe(false);
  });

  it("reports a linked managed reports directory", async () => {
    const config = makeConfig();
    const outsideDir = join(directory, "outside-reports");
    await mkdir(config.outDir, { recursive: true });
    await mkdir(outsideDir, { recursive: true });
    await symlink(outsideDir, config.paths.reportsDir, process.platform === "win32" ? "junction" : "dir");

    await expect(inspectWorkflowManagedPaths(config)).resolves.toEqual({
      status: "unsafe",
      issues: [
        {
          id: "reports-linked",
          message: "Managed reports directory must not be linked",
          path: config.paths.reportsDir
        }
      ]
    });
  });

  it("reports a linked enabled managed packages directory", async () => {
    const config = makeConfig(true);
    const outsideDir = join(directory, "outside-packages");
    await mkdir(config.outDir, { recursive: true });
    await mkdir(outsideDir, { recursive: true });
    await symlink(outsideDir, config.paths.packagesDir, process.platform === "win32" ? "junction" : "dir");

    await expect(inspectWorkflowManagedPaths(config)).resolves.toEqual({
      status: "unsafe",
      issues: [
        {
          id: "packages-linked",
          message: "Managed packages directory must not be linked",
          path: config.paths.packagesDir
        }
      ]
    });
  });

  it("reports a managed reports directory whose canonical path escapes output", async () => {
    const config = makeConfig();
    const outsideDir = join(directory, "outside-canonical-output");
    await mkdir(config.paths.reportsDir, { recursive: true });
    await mkdir(outsideDir, { recursive: true });

    const result = await inspectWorkflowManagedPaths(config, {
      realpath: async (path) => (String(path) === config.paths.reportsDir ? outsideDir : realpath(path))
    });

    expect(result).toEqual({
      status: "unsafe",
      issues: [
        {
          id: "reports-escape",
          message: "Managed reports directory escapes output directory",
          path: config.paths.reportsDir
        }
      ]
    });
  });
});
