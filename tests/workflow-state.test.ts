import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readWorkflowConfig, type ResolvedWorkflowConfig } from "../src/workflow-config.js";
import {
  createWorkflowState,
  hashWorkflowCheckpoint,
  parseWorkflowState,
  readWorkflowState,
  transitionWorkflowState,
  workflowStatePath,
  writeWorkflowState
} from "../src/workflow-state.js";
import { type WorkflowSummary } from "../src/workflow.js";

const fsValidationMock = vi.hoisted(() => ({ linkedPath: "" }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    lstat: vi.fn(async (path: Parameters<typeof actual.lstat>[0]) => {
      const stats = await actual.lstat(path);
      if (String(path) === fsValidationMock.linkedPath) {
        return new Proxy(stats, {
          get(target, property, receiver) {
            return property === "isSymbolicLink" ? () => true : Reflect.get(target, property, receiver);
          }
        });
      }
      return stats;
    })
  };
});

describe("workflow state manifest", () => {
  let directory: string;
  let config: ResolvedWorkflowConfig;

  beforeEach(async () => {
    fsValidationMock.linkedPath = "";
    directory = await mkdtemp(join(tmpdir(), "open-local-audit-workflow-state-"));
    const configPath = join(directory, "workflow.json");
    await writeFile(
      configPath,
      JSON.stringify({
        version: 1,
        outDir: "./output",
        discovery: { provider: "manual-csv", input: "./places.csv" },
        shortlist: {}
      }),
      "utf8"
    );
    config = await readWorkflowConfig(configPath);
    expect(config.paths).not.toHaveProperty("workflowStateJson");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  function summary(): WorkflowSummary {
    return {
      version: 1,
      status: "success",
      stages: {
        discovery: { status: "not-run" },
        shortlist: { status: "not-run" },
        review: { status: "skipped" },
        packaging: { status: "skipped" }
      },
      outputs: config.paths,
      discoveredLeads: 0,
      selectedLeads: 0,
      packages: { packaged: 0, skipped: 0, failed: 0, entries: [] }
    };
  }

  it("creates and persists the explicit initial running manifest atomically", async () => {
    await mkdir(config.outDir, { recursive: true });
    const state = createWorkflowState(config, summary(), "2026-08-09T10:00:00.000Z");

    expect(state).toMatchObject({
      version: 1,
      phase: "running",
      currentStage: null,
      checkpointHash: null,
      startedAt: "2026-08-09T10:00:00.000Z",
      updatedAt: "2026-08-09T10:00:00.000Z"
    });

    await writeWorkflowState(config, state);
    const replacement = transitionWorkflowState(
      state,
      { phase: "running", currentStage: "discovery", checkpointHash: null, summary: state.summary },
      "2026-08-09T10:01:00.000Z"
    );
    await writeWorkflowState(config, replacement);

    expect(await readWorkflowState(config)).toEqual({ kind: "valid", state: replacement });
    expect(await lstat(workflowStatePath(config))).toMatchObject({ isFile: expect.any(Function) });
    expect((await readFile(workflowStatePath(config), "utf8")).endsWith("\n")).toBe(true);
    expect((await lstat(config.outDir)).isDirectory()).toBe(true);
    expect((await rmTempStateFiles(config.outDir)).length).toBe(0);
  });

  it("transitions without changing the config identity or start timestamp", () => {
    const initial = createWorkflowState(config, summary(), "2026-08-09T10:00:00.000Z");
    const next = transitionWorkflowState(
      initial,
      { phase: "running", currentStage: "discovery", checkpointHash: null, summary: initial.summary },
      "2026-08-09T10:01:00.000Z"
    );

    expect(next).toMatchObject({
      configFingerprint: initial.configFingerprint,
      startedAt: initial.startedAt,
      updatedAt: "2026-08-09T10:01:00.000Z",
      phase: "running",
      currentStage: "discovery",
      checkpointHash: null
    });
  });

  it("rejects malformed or expanded manifest data", async () => {
    const state = createWorkflowState(config, summary(), "2026-08-09T10:00:00.000Z");
    const withUnexpectedKey = { ...state, unexpected: true };

    expect(parseWorkflowState(withUnexpectedKey)).toEqual({ kind: "invalid", message: "Workflow state is invalid" });
    await mkdir(config.outDir, { recursive: true });
    await writeFile(workflowStatePath(config), JSON.stringify(withUnexpectedKey), "utf8");
    await expect(readWorkflowState(config)).resolves.toEqual({ kind: "invalid", message: "Workflow state is invalid" });
  });

  it("rejects invalid scalar values and malformed nested summaries", () => {
    const state = createWorkflowState(config, summary(), "2026-08-09T10:00:00.000Z");
    const invalidStates = [
      { ...state, startedAt: "not-a-timestamp" },
      { ...state, updatedAt: "2026-08-09T10:00:00Z" },
      { ...state, checkpointHash: "not-a-hash" },
      { ...state, currentStage: "export" },
      { ...state, summary: { ...state.summary, stages: { ...state.summary.stages, discovery: { status: "running" } } } }
    ];

    for (const invalidState of invalidStates) {
      expect(parseWorkflowState(invalidState)).toEqual({ kind: "invalid", message: "Workflow state is invalid" });
    }
  });

  it("rejects lifecycle phases that contradict the persisted summary", () => {
    const state = createWorkflowState(config, summary(), "2026-08-09T10:00:00.000Z");
    const failedSummary: WorkflowSummary = {
      ...state.summary,
      status: "failed",
      error: { stage: "shortlist", message: "shortlist failed" }
    };
    const invalidStates = [
      { ...state, phase: "completed", currentStage: "discovery" },
      { ...state, phase: "completed", summary: { ...state.summary, error: { stage: "discovery", message: "unexpected" } } },
      { ...state, phase: "failed", currentStage: "discovery", summary: failedSummary },
      { ...state, phase: "failed", currentStage: "shortlist" },
      { ...state, phase: "running", summary: failedSummary }
    ];

    for (const invalidState of invalidStates) {
      expect(parseWorkflowState(invalidState)).toEqual({ kind: "invalid", message: "Workflow state is invalid" });
    }
  });

  it("rejects fingerprint and managed output paths that do not match the current configuration", async () => {
    await mkdir(config.outDir, { recursive: true });
    const state = createWorkflowState(config, summary(), "2026-08-09T10:00:00.000Z");
    const fingerprintMismatch = { ...state, configFingerprint: `${state.configFingerprint.slice(0, -1)}${state.configFingerprint.endsWith("0") ? "1" : "0"}` };
    const outputMismatch = {
      ...state,
      summary: { ...state.summary, outputs: { ...state.summary.outputs, leadsCsv: join(config.outDir, "forged.csv") } }
    };
    const outputWithExtraPath = {
      ...state,
      summary: { ...state.summary, outputs: { ...state.summary.outputs, unexpected: "forged" } }
    };

    expect(fingerprintMismatch.configFingerprint).not.toBe(state.configFingerprint);
    expect(parseWorkflowState(fingerprintMismatch)).toMatchObject({ kind: "valid" });
    expect(parseWorkflowState(outputMismatch)).toMatchObject({ kind: "valid" });
    expect(parseWorkflowState(outputWithExtraPath)).toEqual({ kind: "invalid", message: "Workflow state is invalid" });
    await writeFile(workflowStatePath(config), JSON.stringify(fingerprintMismatch), "utf8");
    await expect(readWorkflowState(config)).resolves.toEqual({ kind: "invalid", message: "Workflow state is invalid" });
    await expect(writeWorkflowState(config, outputMismatch)).rejects.toThrow("Workflow state is invalid");
    await expect(readFile(workflowStatePath(config), "utf8")).resolves.toBe(JSON.stringify(fingerprintMismatch));
  });

  it("rejects completed and running states with impossible progress", () => {
    const state = createWorkflowState(config, summary(), "2026-08-09T10:00:00.000Z");
    const invalidStates = [
      {
        ...state,
        phase: "completed",
        summary: { ...state.summary, stages: { ...state.summary.stages, discovery: { status: "success" } } }
      },
      {
        ...state,
        currentStage: "shortlist",
        summary: {
          ...state.summary,
          stages: { ...state.summary.stages, shortlist: { status: "success", selected: 0 } }
        }
      }
    ];

    for (const invalidState of invalidStates) {
      expect(parseWorkflowState(invalidState)).toEqual({ kind: "invalid", message: "Workflow state is invalid" });
    }
  });

  it("rejects linked and non-regular state paths", async () => {
    await mkdir(config.outDir, { recursive: true });
    const state = createWorkflowState(config, summary(), "2026-08-09T10:00:00.000Z");
    await writeWorkflowState(config, state);
    fsValidationMock.linkedPath = workflowStatePath(config);

    await expect(readWorkflowState(config)).resolves.toEqual({ kind: "invalid", message: "Workflow state is invalid" });
    await expect(writeWorkflowState(config, state)).rejects.toThrow("Workflow state must be a regular file");

    fsValidationMock.linkedPath = "";
    await rm(workflowStatePath(config));
    await mkdir(workflowStatePath(config));
    await expect(readWorkflowState(config)).resolves.toEqual({ kind: "invalid", message: "Workflow state is invalid" });
  });

  it("reports a missing state file and hashes only regular checkpoints", async () => {
    await expect(readWorkflowState(config)).resolves.toEqual({ kind: "missing" });
    await mkdir(config.outDir, { recursive: true });
    const checkpointPath = join(config.outDir, "workflow-checkpoint.json");
    await writeFile(checkpointPath, "checkpoint\n", "utf8");

    expect(await hashWorkflowCheckpoint(config)).toMatch(/^[a-f0-9]{64}$/);
    await rm(checkpointPath);
    await mkdir(checkpointPath);
    await expect(hashWorkflowCheckpoint(config)).rejects.toThrow("Workflow checkpoint must be a regular file");
  });
});

async function rmTempStateFiles(outDir: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  return (await readdir(outDir)).filter((name) => name.startsWith(".workflow-state.json-") && name.endsWith(".tmp"));
}
