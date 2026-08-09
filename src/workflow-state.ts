import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ResolvedWorkflowConfig, WorkflowManagedPaths } from "./workflow-config.js";
import { writeWorkflowOutputFile } from "./workflow-output.js";
import { workflowConfigFingerprint, type WorkflowPackageEntry, type WorkflowStageName, type WorkflowSummary } from "./workflow.js";

export type WorkflowLifecyclePhase = "running" | "failed" | "completed";

export interface WorkflowState {
  version: 1;
  configFingerprint: string;
  phase: WorkflowLifecyclePhase;
  currentStage: WorkflowStageName | null;
  checkpointHash: string | null;
  startedAt: string;
  updatedAt: string;
  summary: WorkflowSummary;
}

export type WorkflowStateReadResult =
  | { kind: "missing" }
  | { kind: "invalid"; message: string }
  | { kind: "valid"; state: WorkflowState };

export interface WorkflowStateTransition {
  phase: WorkflowLifecyclePhase;
  currentStage: WorkflowStageName | null;
  checkpointHash: string | null;
  summary: WorkflowSummary;
}

const stateKeys = [
  "version",
  "configFingerprint",
  "phase",
  "currentStage",
  "checkpointHash",
  "startedAt",
  "updatedAt",
  "summary"
] as const;

const workflowStageNames = ["discovery", "shortlist", "review", "packaging"] as const satisfies readonly WorkflowStageName[];
const workflowStageStatuses = ["success", "failed", "skipped", "not-run"] as const;
const workflowPackageStatuses = ["packaged", "skipped", "failed"] as const;
const workflowManagedPathKeys = [
  "leadsCsv",
  "discoverySummaryJson",
  "shortlistCsv",
  "shortlistSummaryJson",
  "reviewSummaryJson",
  "workflowSummaryJson",
  "reportsDir",
  "packagesDir"
] as const satisfies readonly (keyof WorkflowManagedPaths)[];

export function workflowStatePath(config: ResolvedWorkflowConfig): string {
  return join(config.outDir, "workflow-state.json");
}

export function createWorkflowState(config: ResolvedWorkflowConfig, summary: WorkflowSummary, timestamp = new Date().toISOString()): WorkflowState {
  return {
    version: 1,
    configFingerprint: workflowConfigFingerprint(config),
    phase: "running",
    currentStage: null,
    checkpointHash: null,
    startedAt: timestamp,
    updatedAt: timestamp,
    summary
  };
}

export function transitionWorkflowState(
  state: WorkflowState,
  transition: WorkflowStateTransition,
  timestamp = new Date().toISOString()
): WorkflowState {
  return {
    ...state,
    ...transition,
    updatedAt: timestamp
  };
}

export function parseWorkflowState(value: unknown): WorkflowStateReadResult {
  if (!isWorkflowState(value)) {
    return { kind: "invalid", message: "Workflow state is invalid" };
  }
  return { kind: "valid", state: value };
}

export async function readWorkflowState(config: ResolvedWorkflowConfig): Promise<WorkflowStateReadResult> {
  const path = workflowStatePath(config);
  let content: string;
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) {
      return { kind: "invalid", message: "Workflow state is invalid" };
    }
    content = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingPath(error)) {
      return { kind: "missing" };
    }
    return { kind: "invalid", message: "Workflow state is invalid" };
  }

  try {
    return parseWorkflowState(JSON.parse(content));
  } catch {
    return { kind: "invalid", message: "Workflow state is invalid" };
  }
}

export async function writeWorkflowState(config: ResolvedWorkflowConfig, state: WorkflowState): Promise<void> {
  const parsed = parseWorkflowState(state);
  if (parsed.kind !== "valid") {
    throw new Error(parsed.kind === "invalid" ? parsed.message : "Workflow state is missing");
  }
  const path = workflowStatePath(config);
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error("Workflow state must be a regular file");
    }
  } catch (error) {
    if (!isMissingPath(error)) {
      throw error;
    }
  }
  await writeWorkflowOutputFile(path, `${JSON.stringify(parsed.state, null, 2)}\n`, {
    managedOutputRoot: config.outDir
  });
}

export async function hashWorkflowCheckpoint(config: ResolvedWorkflowConfig): Promise<string | null> {
  const checkpointPath = join(config.outDir, "workflow-checkpoint.json");
  try {
    const info = await lstat(checkpointPath);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error("Workflow checkpoint must be a regular file");
    }
    return createHash("sha256").update(await readFile(checkpointPath)).digest("hex");
  } catch (error) {
    if (isMissingPath(error)) {
      return null;
    }
    throw error;
  }
}

function isMissingPath(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isStageName(value: unknown): value is WorkflowStageName {
  return typeof value === "string" && workflowStageNames.includes(value as WorkflowStageName);
}

function isStageSummary(value: unknown, countKeys: readonly string[]): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["status", ...countKeys]) &&
    typeof value.status === "string" &&
    workflowStageStatuses.includes(value.status as (typeof workflowStageStatuses)[number]) &&
    countKeys.every((key) => value[key] === undefined || isCount(value[key]))
  );
}

function isPackageEntry(value: unknown): value is WorkflowPackageEntry {
  if (!isRecord(value) || typeof value.leadKey !== "string" || typeof value.companyName !== "string") {
    return false;
  }
  if (value.status === "packaged") {
    return hasExactKeys(value, ["leadKey", "companyName", "status", "outDir"]) && typeof value.outDir === "string";
  }
  if (value.status === "skipped") {
    return hasExactKeys(value, ["leadKey", "companyName", "status"]);
  }
  return (
    value.status === "failed" &&
    hasExactKeys(value, ["leadKey", "companyName", "status", "error"]) &&
    typeof value.error === "string"
  );
}

function isWorkflowSummary(value: unknown): value is WorkflowSummary {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["version", "status", "stages", "outputs", "discoveredLeads", "selectedLeads", "packages", "error"]) ||
    value.version !== 1 ||
    (value.status !== "success" && value.status !== "failed") ||
    !isRecord(value.stages) ||
    !hasExactKeys(value.stages, workflowStageNames) ||
    !isRecord(value.outputs) ||
    !hasExactKeys(value.outputs, workflowManagedPathKeys) ||
    !isCount(value.discoveredLeads) ||
    !isCount(value.selectedLeads) ||
    !isRecord(value.packages) ||
    !hasExactKeys(value.packages, ["packaged", "skipped", "failed", "entries"])
  ) {
    return false;
  }

  const stages = value.stages;
  const outputs = value.outputs;
  const packages = value.packages;
  const error = value.error;
  return (
    isStageSummary(stages.discovery, ["totalCandidates", "suppressedCandidates", "audited"]) &&
    isStageSummary(stages.shortlist, ["totalRows", "suppressedRows", "filteredRows", "selected"]) &&
    isStageSummary(stages.review, ["totalRows", "reviewedRows", "actionableLeads", "staleRows", "invalidReviewedAtRows", "unreviewedRows"]) &&
    isStageSummary(stages.packaging, ["packaged", "skipped", "failed"]) &&
    workflowManagedPathKeys.every((key) => typeof outputs[key] === "string") &&
    isCount(packages.packaged) &&
    isCount(packages.skipped) &&
    isCount(packages.failed) &&
    Array.isArray(packages.entries) &&
    packages.entries.every(isPackageEntry) &&
    (error === undefined || (isRecord(error) && hasExactKeys(error, ["stage", "message"]) && isStageName(error.stage) && typeof error.message === "string"))
  );
}

function isWorkflowState(value: unknown): value is WorkflowState {
  if (!isRecord(value) || !hasExactKeys(value, stateKeys)) {
    return false;
  }
  return (
    value.version === 1 &&
    isHash(value.configFingerprint) &&
    (value.phase === "running" || value.phase === "failed" || value.phase === "completed") &&
    (value.currentStage === null || isStageName(value.currentStage)) &&
    (value.checkpointHash === null || isHash(value.checkpointHash)) &&
    isTimestamp(value.startedAt) &&
    isTimestamp(value.updatedAt) &&
    isWorkflowSummary(value.summary)
  );
}
