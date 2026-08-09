import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readWorkflowConfig, workflowConfigFingerprint, type ResolvedWorkflowConfig } from "../src/workflow-config.js";
import { createWorkflowState, workflowStatePath } from "../src/workflow-state.js";
import {
  renderWorkflowStatusJson,
  renderWorkflowStatusTerminal,
  runWorkflowStatus,
  type WorkflowStatusReport
} from "../src/workflow-status.js";
import type { WorkflowSummary } from "../src/workflow.js";

const googleApiKeyResolver = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("Google API key resolution must not run during status checks");
  })
);

vi.mock("../src/secrets.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/secrets.js")>();
  return { ...actual, resolveGoogleMapsApiKey: googleApiKeyResolver };
});

describe("workflow status", () => {
  let directory: string;
  let configPath: string;
  let config: ResolvedWorkflowConfig;
  let originalGoogleMapsApiKey: string | undefined;

  beforeEach(async () => {
    originalGoogleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;
    directory = await mkdtemp(join(tmpdir(), "open-local-audit-workflow-status-"));
    configPath = join(directory, "config", "workflow.json");
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      `${JSON.stringify({
        version: 1,
        outDir: "./output",
        discovery: { provider: "manual-csv", input: "./places.csv" },
        shortlist: {}
      })}\n`,
      "utf8"
    );
    config = await readWorkflowConfig(configPath);
  });

  afterEach(async () => {
    if (originalGoogleMapsApiKey === undefined) {
      delete process.env.GOOGLE_MAPS_API_KEY;
    } else {
      process.env.GOOGLE_MAPS_API_KEY = originalGoogleMapsApiKey;
    }
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  it("reports a missing state and checkpoint as not-started without creating the output directory", async () => {
    const report = await runWorkflowStatus(configPath);

    expect(report).toMatchObject({
      version: 1,
      status: "not-started",
      currentStage: null,
      lastSuccessfulStage: null,
      resumeAvailable: false,
      updatedAt: null,
      artifactValidation: "not-applicable",
      nextAction: { kind: "run", argv: ["workflow", "--config", configPath], message: expect.any(String) },
      error: null
    });
    await expect(lstat(config.outDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    ["missing configuration", async () => await rm(configPath)],
    ["malformed configuration", async () => await writeFile(configPath, "{ malformed", "utf8")]
  ])("propagates %s errors instead of reporting an invalid workflow", async (_label, arrange) => {
    await arrange();
    await expect(runWorkflowStatus(configPath)).rejects.toThrow();
  });

  it("does not resolve Google credentials or use fetch while reporting Google Places status", async () => {
    const querySentinel = "GOOGLE_QUERY_SENTINEL__ISTANBUL_DENTISTS";
    const secretSentinel = "GOOGLE_API_KEY_SENTINEL__DO_NOT_LEAK";
    process.env.GOOGLE_MAPS_API_KEY = secretSentinel;
    await writeFile(
      configPath,
      `${JSON.stringify({
        version: 1,
        outDir: "./google-output",
        discovery: { provider: "google-places", query: querySentinel },
        shortlist: {}
      })}\n`,
      "utf8"
    );
    const fetchSentinel = vi.fn(() => {
      throw new Error("Network access must not run during status checks");
    });
    vi.stubGlobal("fetch", fetchSentinel);

    const report = await runWorkflowStatus(configPath);
    const json = renderWorkflowStatusJson(report);
    const terminal = renderWorkflowStatusTerminal(report, configPath);

    expect(report.status).toBe("not-started");
    expect(googleApiKeyResolver).not.toHaveBeenCalled();
    expect(fetchSentinel).not.toHaveBeenCalled();
    expect(json).not.toContain(querySentinel);
    expect(json).not.toContain(secretSentinel);
    expect(terminal).not.toContain(querySentinel);
    expect(terminal).not.toContain(secretSentinel);
    await expect(lstat(join(directory, "config", "google-output"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    ["running", "running-or-interrupted", "confirm-active-process"],
    ["failed", "failed", "resume"],
    ["completed", "completed", "none"]
  ] as const)("maps persisted %s state to %s", async (phase, status, action) => {
    const checkpoint = await writeValidCheckpoint();
    const summary = checkpoint.value.summary;
    if (phase === "running") {
      summary.stages.shortlist = { status: "not-run" };
    }
    if (phase === "failed") {
      summary.status = "failed";
      summary.stages.shortlist = { status: "failed" };
      summary.error = { stage: "shortlist", message: "private failure detail" };
    }
    const state = createWorkflowState(config, summary, "2026-08-09T10:00:00.000Z");
    state.phase = phase;
    state.currentStage = phase === "failed" ? "shortlist" : null;
    state.checkpointHash = checkpoint.hash;
    state.updatedAt = "2026-08-09T10:01:00.000Z";
    await writeFile(workflowStatePath(config), `${JSON.stringify(state)}\n`, "utf8");

    const report = await runWorkflowStatus(configPath);
    expect(report.status).toBe(status);
    expect(report.nextAction.kind).toBe(action);
    expect(report.artifactValidation).toBe("valid");
    expect(report.updatedAt).toBe("2026-08-09T10:01:00.000Z");
  });

  it("uses a correlated checkpoint for failed resume and ignores a stale checkpoint when state has no hash", async () => {
    const checkpoint = await writeValidCheckpoint();
    const state = createWorkflowState(config, checkpoint.value.summary, "2026-08-09T10:00:00.000Z");
    state.phase = "failed";
    state.currentStage = "shortlist";
    state.checkpointHash = null;
    state.summary.status = "failed";
    state.summary.stages.shortlist = { status: "failed" };
    state.summary.error = { stage: "shortlist", message: "do not disclose this" };
    await writeFile(workflowStatePath(config), JSON.stringify(state), "utf8");

    const report = await runWorkflowStatus(configPath);
    expect(report).toMatchObject({
      status: "failed",
      artifactValidation: "not-applicable",
      resumeAvailable: false,
      nextAction: { kind: "run", argv: ["workflow", "--config", configPath] },
      error: { message: "Workflow failed during shortlist" }
    });
  });

  it("rejects state/checkpoint mismatches, malformed data, and tampered artifacts", async () => {
    const checkpoint = await writeValidCheckpoint();
    const state = createWorkflowState(config, checkpoint.value.summary, "2026-08-09T10:00:00.000Z");
    state.phase = "completed";
    state.checkpointHash = `${checkpoint.hash.startsWith("0") ? "1" : "0"}${checkpoint.hash.slice(1)}`;
    await writeFile(workflowStatePath(config), JSON.stringify(state), "utf8");
    expect((await runWorkflowStatus(configPath)).status).toBe("invalid");

    await writeFile(workflowStatePath(config), "{ malformed", "utf8");
    expect((await runWorkflowStatus(configPath)).status).toBe("invalid");

    await writeFile(config.paths.leadsCsv, "tampered\n", "utf8");
    expect((await runWorkflowStatus(configPath)).status).toBe("invalid");
  });

  it("allows an uncheckpointed running state but rejects completed states without their checkpoint", async () => {
    const state = createWorkflowState(config, initialSummary(), "2026-08-09T10:00:00.000Z");
    state.currentStage = "discovery";
    await mkdir(config.outDir, { recursive: true });
    await writeFile(workflowStatePath(config), JSON.stringify(state), "utf8");
    expect(await runWorkflowStatus(configPath)).toMatchObject({
      status: "running-or-interrupted",
      resumeAvailable: false,
      artifactValidation: "not-applicable",
      nextAction: { kind: "confirm-active-process", argv: ["workflow", "--config", configPath] }
    });

    const checkpoint = await writeValidCheckpoint();
    state.phase = "completed";
    state.currentStage = null;
    state.summary = checkpoint.value.summary;
    state.checkpointHash = checkpoint.hash;
    await writeFile(workflowStatePath(config), JSON.stringify(state), "utf8");
    await rm(checkpoint.path);
    expect(await runWorkflowStatus(configPath)).toMatchObject({ status: "invalid", resumeAvailable: false });
  });

  it("rejects configuration-bound state mismatches and non-regular checkpoint artifacts", async () => {
    const checkpoint = await writeValidCheckpoint();
    const state = createWorkflowState(config, checkpoint.value.summary, "2026-08-09T10:00:00.000Z");
    state.phase = "completed";
    state.checkpointHash = checkpoint.hash;
    state.configFingerprint = `${state.configFingerprint[0] === "0" ? "1" : "0"}${state.configFingerprint.slice(1)}`;
    await writeFile(workflowStatePath(config), JSON.stringify(state), "utf8");
    expect((await runWorkflowStatus(configPath)).status).toBe("invalid");

    state.configFingerprint = workflowConfigFingerprint(config);
    state.summary.outputs = { ...state.summary.outputs, leadsCsv: join(config.outDir, "forged.csv") };
    await writeFile(workflowStatePath(config), JSON.stringify(state), "utf8");
    expect((await runWorkflowStatus(configPath)).status).toBe("invalid");

    await rm(workflowStatePath(config));
    await rm(config.paths.leadsCsv);
    await mkdir(config.paths.leadsCsv);
    expect(await runWorkflowStatus(configPath)).toMatchObject({ status: "invalid", artifactValidation: "invalid" });
  });

  it("uses a valid legacy checkpoint read-only and treats incomplete progress as resumable", async () => {
    const checkpoint = await writeValidCheckpoint();
    expect(Object.keys(checkpoint.value)).toEqual(["version", "configFingerprint", "summary", "integrity", "shortlistLeads"]);

    let report = await runWorkflowStatus(configPath);
    expect(report).toMatchObject({ status: "completed", resumeAvailable: false, nextAction: { kind: "none", argv: null } });

    checkpoint.value.summary.stages.shortlist = { status: "not-run" };
    delete checkpoint.value.integrity.shortlistCsv;
    delete checkpoint.value.integrity.shortlistSummaryJson;
    await writeFile(checkpoint.path, `${JSON.stringify(checkpoint.value, null, 2)}\n`, "utf8");
    report = await runWorkflowStatus(configPath);
    expect(report).toMatchObject({
      status: "running-or-interrupted",
      resumeAvailable: true,
      nextAction: { kind: "confirm-active-process", argv: ["workflow", "--config", configPath, "--resume"] }
    });
  });

  it("leaves the directory tree byte-for-byte and metadata unchanged", async () => {
    await writeValidCheckpoint();
    const before = await snapshot(directory);
    await runWorkflowStatus(configPath);
    const after = await snapshot(directory);
    expect(after).toEqual(before);
  });

  it("renders exact JSON and stable terminal output without exposing config secrets", async () => {
    const report: WorkflowStatusReport = await runWorkflowStatus(configPath);
    expect(renderWorkflowStatusJson(report)).toBe(`${JSON.stringify(report, null, 2)}\n`);
    expect(renderWorkflowStatusTerminal(report, configPath)).toBe(
      `Workflow status: NOT STARTED\nConfig: ${configPath}\nCurrent stage: none\nLast successful stage: none\nArtifact validation: NOT APPLICABLE\nNext action: RUN\nCommand: workflow --config ${configPath}\n`
    );
    const source = await readFile(join(process.cwd(), "src", "workflow-status.ts"), "utf8");
    expect(source).not.toContain("secrets.js");
    expect(source).not.toContain("resolveGoogleMapsApiKey");
    expect(source).not.toContain("fetch(");
  });

  it("renders the sanitized failed-status error in terminal output", () => {
    const terminal = renderWorkflowStatusTerminal(
      {
        version: 1,
        status: "failed",
        currentStage: "discovery",
        lastSuccessfulStage: null,
        resumeAvailable: false,
        updatedAt: "2026-08-09T10:00:00.000Z",
        stages: initialSummary().stages,
        artifactValidation: "not-applicable",
        nextAction: runActionForTest(),
        error: { message: "provider rejected [REDACTED]" }
      },
      configPath
    );

    expect(terminal).toContain("Error: provider rejected [REDACTED]");
  });

  async function writeValidCheckpoint(): Promise<{ path: string; hash: string; value: Checkpoint }> {
    await mkdir(config.outDir, { recursive: true });
    const summary = completedSummary();
    await writeFile(config.paths.leadsCsv, "lead\n", "utf8");
    await writeFile(config.paths.discoverySummaryJson, "{}\n", "utf8");
    await writeFile(config.paths.shortlistCsv, "lead\n", "utf8");
    await writeFile(config.paths.shortlistSummaryJson, "{}\n", "utf8");
    const value: Checkpoint = {
      version: 1,
      configFingerprint: workflowConfigFingerprint(config),
      summary,
      integrity: {
        leadsCsv: await sha256(config.paths.leadsCsv),
        discoverySummaryJson: await sha256(config.paths.discoverySummaryJson),
        shortlistCsv: await sha256(config.paths.shortlistCsv),
        shortlistSummaryJson: await sha256(config.paths.shortlistSummaryJson)
      },
      shortlistLeads: []
    };
    const path = join(config.outDir, "workflow-checkpoint.json");
    const content = `${JSON.stringify(value, null, 2)}\n`;
    await writeFile(path, content, "utf8");
    return { path, hash: createHash("sha256").update(content).digest("hex"), value };
  }

  function completedSummary(): WorkflowSummary {
    return {
      version: 1,
      status: "success",
      stages: {
        discovery: { status: "success" },
        shortlist: { status: "success", selected: 0 },
        review: { status: "skipped" },
        packaging: { status: "skipped" }
      },
      outputs: config.paths,
      discoveredLeads: 0,
      selectedLeads: 0,
      packages: { packaged: 0, skipped: 0, failed: 0, entries: [] }
    };
  }

  function initialSummary(): WorkflowSummary {
    return {
      ...completedSummary(),
      stages: {
        discovery: { status: "not-run" },
        shortlist: { status: "not-run" },
        review: { status: "skipped" },
        packaging: { status: "skipped" }
      }
    };
  }

  function runActionForTest(): WorkflowStatusReport["nextAction"] {
    return { kind: "run", argv: ["workflow", "--config", configPath], message: "Run the workflow from the beginning." };
  }
});

interface Checkpoint {
  version: 1;
  configFingerprint: string;
  summary: WorkflowSummary;
  integrity: Record<string, string>;
  shortlistLeads: [];
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function snapshot(root: string): Promise<Array<{ path: string; size: number; mtimeMs: number; bytes: string }>> {
  const paths: string[] = [];
  async function visit(path: string): Promise<void> {
    const info = await stat(path);
    if (info.isDirectory()) {
      for (const child of await readdir(path)) await visit(join(path, child));
    } else {
      paths.push(path);
    }
  }
  await visit(root);
  return await Promise.all(
    paths.sort().map(async (path) => {
      const info = await stat(path);
      return { path, size: info.size, mtimeMs: info.mtimeMs, bytes: (await readFile(path)).toString("base64") };
    })
  );
}
