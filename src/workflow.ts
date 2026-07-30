import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { runDiscovery, type DiscoveryRunResult } from "./discovery-runner.js";
import { packageReport, type ReportPackResult } from "./report-pack.js";
import { summarizeReviewCsvFile, type ReviewSummary } from "./review.js";
import { runShortlistReport, type ShortlistRunOptions } from "./shortlist-runner.js";
import type { ShortlistLead, ShortlistResult } from "./shortlist.js";
import { resolveGoogleMapsApiKey } from "./secrets.js";
import { readWorkflowConfig, type ResolvedWorkflowConfig, type WorkflowManagedPaths } from "./workflow-config.js";
import { prepareWorkflowManagedDirectories } from "./workflow-paths.js";
import { writeWorkflowOutputFile } from "./workflow-output.js";

export type WorkflowStatus = "success" | "failed";
export type WorkflowStageStatus = "success" | "failed" | "skipped" | "not-run";
export type WorkflowStageName = "discovery" | "shortlist" | "review" | "packaging";
export type WorkflowPackageStatus = "packaged" | "skipped" | "failed";

export interface WorkflowDiscoveryStageSummary {
  status: WorkflowStageStatus;
  totalCandidates?: number;
  suppressedCandidates?: number;
  audited?: number;
}

export interface WorkflowShortlistStageSummary {
  status: WorkflowStageStatus;
  totalRows?: number;
  suppressedRows?: number;
  filteredRows?: number;
  selected?: number;
}

export interface WorkflowReviewStageSummary {
  status: WorkflowStageStatus;
  totalRows?: number;
  reviewedRows?: number;
  actionableLeads?: number;
  staleRows?: number;
  invalidReviewedAtRows?: number;
  unreviewedRows?: number;
}

export interface WorkflowPackagingStageSummary {
  status: WorkflowStageStatus;
  packaged?: number;
  skipped?: number;
  failed?: number;
}

export interface WorkflowPackageEntry {
  leadKey: string;
  companyName: string;
  status: WorkflowPackageStatus;
  outDir?: string;
  error?: string;
}

export interface WorkflowPackageSummary {
  packaged: number;
  skipped: number;
  failed: number;
  entries: WorkflowPackageEntry[];
}

export interface WorkflowSummary {
  version: 1;
  status: WorkflowStatus;
  stages: {
    discovery: WorkflowDiscoveryStageSummary;
    shortlist: WorkflowShortlistStageSummary;
    review: WorkflowReviewStageSummary;
    packaging: WorkflowPackagingStageSummary;
  };
  outputs: WorkflowManagedPaths;
  discoveredLeads: number;
  selectedLeads: number;
  packages: WorkflowPackageSummary;
  error?: {
    stage: WorkflowStageName;
    message: string;
  };
}

export interface WorkflowDependencies {
  readWorkflowConfig: typeof readWorkflowConfig;
  runDiscovery: (options: Parameters<typeof runDiscovery>[0]) => Promise<DiscoveryRunResult>;
  runShortlistReport: (options: ShortlistRunOptions) => Promise<ShortlistResult>;
  summarizeReviewCsvFile: typeof summarizeReviewCsvFile;
  packageReport: (options: Parameters<typeof packageReport>[0]) => Promise<ReportPackResult>;
  resolveGoogleMapsApiKey: typeof resolveGoogleMapsApiKey;
}

export interface WorkflowRunOptions {
  resume?: boolean;
}

interface WorkflowCheckpoint {
  version: 1;
  configFingerprint: string;
  summary: WorkflowSummary;
  integrity: Record<string, string>;
  shortlistLeads: ShortlistLead[];
}

export class WorkflowRunError extends Error {
  readonly summary: WorkflowSummary;

  constructor(summary: WorkflowSummary) {
    super(summary.error ? `Workflow failed during ${summary.error.stage}: ${summary.error.message}` : "Workflow failed");
    this.name = "WorkflowRunError";
    this.summary = summary;
  }
}

const defaultDependencies: WorkflowDependencies = {
  readWorkflowConfig,
  runDiscovery,
  runShortlistReport,
  summarizeReviewCsvFile,
  packageReport,
  resolveGoogleMapsApiKey
};

const packageReportFileNames = [
  "open-local-audit-report.json",
  "open-local-audit-report.md",
  "open-local-audit-report.html",
  "open-local-audit-report.pdf"
];

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function slugSourceFromLeadKey(leadKey: string): string {
  const trimmed = leadKey.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith("url:")) {
    const rawUrl = trimmed.slice(4);
    try {
      const parsed = new URL(rawUrl);
      return `${parsed.hostname}${parsed.pathname}`.replace(/^www\./i, "");
    } catch {
      return rawUrl;
    }
  }

  return trimmed.replace(/^[a-z]+:/i, "");
}

export function safeLeadSlug(leadKey: string, companyName: string): string {
  const companySlug = slugify(companyName.trim());
  if (companySlug) {
    return companySlug;
  }

  const leadSlug = slugify(slugSourceFromLeadKey(leadKey));
  return leadSlug || "lead";
}

function sanitizeErrorMessage(error: unknown, knownSecrets: readonly string[] = []): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    return knownSecrets
      .filter((secret) => secret.length > 0)
      .reduce((sanitized, secret) => sanitized.split(secret).join("[REDACTED]"), message || "Unknown error");
  }

  return "Unknown error";
}

function createInitialSummary(config: ResolvedWorkflowConfig): WorkflowSummary {
  return {
    version: 1,
    status: "success",
    stages: {
      discovery: { status: "not-run" },
      shortlist: { status: "not-run" },
      review: { status: config.review ? "not-run" : "skipped" },
      packaging: { status: config.packageReports ? "not-run" : "skipped" }
    },
    outputs: config.paths,
    discoveredLeads: 0,
    selectedLeads: 0,
    packages: {
      packaged: 0,
      skipped: 0,
      failed: 0,
      entries: []
    }
  };
}

async function writePrettyJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeWorkflowOutputFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeWorkflowSummary(summary: WorkflowSummary): Promise<void> {
  await writePrettyJson(summary.outputs.workflowSummaryJson, summary);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function workflowConfigFingerprint(config: ResolvedWorkflowConfig): string {
  const { paths: _paths, ...effectiveConfig } = config;
  return createHash("sha256").update(stableJson(effectiveConfig)).digest("hex");
}

function workflowCheckpointPath(config: ResolvedWorkflowConfig): string {
  return join(config.outDir, "workflow-checkpoint.json");
}

function isRegularFile(info: Awaited<ReturnType<typeof lstat>>): boolean {
  return info.isFile() && !info.isSymbolicLink();
}

async function hashManagedFile(path: string): Promise<string | undefined> {
  try {
    const info = await lstat(path);
    if (!isRegularFile(info)) {
      throw new Error("Workflow checkpoint managed artifact must be a regular file");
    }
    return createHash("sha256").update(await readFile(path)).digest("hex");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function isMissingPath(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function packageSourceIntegrityId(index: number, fileName: string): string {
  return `package-source-${index}-${fileName}`;
}

function isPackageSourceIntegrityId(id: string, shortlistLeads: readonly ShortlistLead[]): boolean {
  const match = /^package-source-(\d+)-(.+)$/.exec(id);
  if (!match) {
    return false;
  }
  const index = Number(match[1]);
  return (
    Number.isSafeInteger(index) &&
    index >= 0 &&
    index < shortlistLeads.length &&
    shortlistLeads[index].reportPath.trim().length > 0 &&
    packageReportFileNames.includes(match[2] as (typeof packageReportFileNames)[number])
  );
}

async function validateCheckpointPackageSources(
  config: ResolvedWorkflowConfig,
  checkpoint: WorkflowCheckpoint
): Promise<void> {
  if (!config.packageReports || checkpoint.summary.stages.packaging.status === "success") {
    return;
  }

  for (const [index, lead] of checkpoint.shortlistLeads.entries()) {
    if (!lead.reportPath.trim()) {
      continue;
    }
    const source = await resolvePackageInputDir(config.paths.reportsDir, lead.reportPath);
    await validatePackageSourceFiles(source.inputDir, source.realInputDir);
    for (const fileName of packageReportFileNames) {
      const id = packageSourceIntegrityId(index, fileName);
      const expectedHash = checkpoint.integrity[id];
      const actualHash = await hashManagedFile(join(source.inputDir, fileName));
      if ((actualHash && !expectedHash) || (expectedHash && actualHash !== expectedHash)) {
        throw new Error("Workflow checkpoint managed artifacts do not match");
      }
    }
  }
}

async function addPackageSourceIntegrity(
  config: ResolvedWorkflowConfig,
  summary: WorkflowSummary,
  shortlistLeads: ShortlistLead[],
  integrity: Record<string, string>
): Promise<void> {
  if (!config.packageReports || summary.stages.shortlist.status !== "success") {
    return;
  }

  for (const [index, lead] of shortlistLeads.entries()) {
    if (!lead.reportPath.trim()) {
      continue;
    }
    let source;
    try {
      source = await resolvePackageInputDir(config.paths.reportsDir, lead.reportPath);
    } catch (error) {
      if (isMissingPath(error)) {
        throw new Error("Checkpoint package source report is missing");
      }
      throw error;
    }
    await validatePackageSourceFiles(source.inputDir, source.realInputDir);
    for (const fileName of packageReportFileNames) {
      const hash = await hashManagedFile(join(source.inputDir, fileName));
      if (!hash && fileName === "open-local-audit-report.json") {
        throw new Error("Checkpoint package source report is missing");
      }
      if (hash) {
        integrity[packageSourceIntegrityId(index, fileName)] = hash;
      }
    }
  }
}

function checkpointArtifactPaths(config: ResolvedWorkflowConfig, summary: WorkflowSummary): Record<string, string> {
  const paths: Record<string, string> = {};
  if (summary.stages.discovery.status === "success") {
    paths.leadsCsv = config.paths.leadsCsv;
    paths.discoverySummaryJson = config.paths.discoverySummaryJson;
  }
  if (summary.stages.shortlist.status === "success") {
    paths.shortlistCsv = config.paths.shortlistCsv;
    paths.shortlistSummaryJson = config.paths.shortlistSummaryJson;
  }
  if (summary.stages.review.status === "success") {
    paths.reviewSummaryJson = config.paths.reviewSummaryJson;
  }
  return paths;
}

async function createCheckpoint(
  config: ResolvedWorkflowConfig,
  summary: WorkflowSummary,
  shortlistLeads: ShortlistLead[]
): Promise<WorkflowCheckpoint> {
  const integrity: Record<string, string> = {};
  for (const [id, path] of Object.entries(checkpointArtifactPaths(config, summary))) {
    const hash = await hashManagedFile(path);
    if (hash) {
      integrity[id] = hash;
    }
  }
  await addPackageSourceIntegrity(config, summary, shortlistLeads, integrity);
  return {
    version: 1,
    configFingerprint: workflowConfigFingerprint(config),
    summary,
    integrity,
    shortlistLeads
  };
}

async function writeWorkflowCheckpoint(
  config: ResolvedWorkflowConfig,
  summary: WorkflowSummary,
  shortlistLeads: ShortlistLead[]
): Promise<void> {
  await writePrettyJson(workflowCheckpointPath(config), await createCheckpoint(config, summary, shortlistLeads));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isCount(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isStageSummary(value: unknown, keys: readonly string[]): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["status", ...keys]) &&
    typeof value.status === "string" &&
    keys.every((key) => value[key] === undefined || isCount(value[key]))
  );
}

function isShortlistLeadSnapshot(value: unknown): value is ShortlistLead {
  if (!isRecord(value)) {
    return false;
  }
  const stringKeys = [
    "companyName",
    "website",
    "segment",
    "profile",
    "priority",
    "auditStatus",
    "hasWebsite",
    "source",
    "topFinding",
    "contactConfidence",
    "preferredContactChannel",
    "contactabilityReason",
    "reason",
    "reportPath",
    "leadKey",
    "reviewStatus",
    "reviewReason",
    "lastReviewedAt"
  ];
  return (
    hasOnlyKeys(value, ["rank", ...stringKeys, "score", "opportunityScore"]) &&
    typeof value.rank === "number" &&
    Number.isSafeInteger(value.rank) &&
    value.rank > 0 &&
    stringKeys.every((key) => typeof value[key] === "string") &&
    (value.score === undefined || typeof value.score === "number") &&
    (value.opportunityScore === undefined || typeof value.opportunityScore === "number")
  );
}

function isCompletedPackageEntries(
  entries: unknown[],
  shortlistLeads: readonly ShortlistLead[],
  packagesDir: string
): boolean {
  if (entries.length !== shortlistLeads.length) {
    return false;
  }
  const slugCounts = new Map<string, number>();
  return entries.every((entry, index) => {
    if (!isRecord(entry)) {
      return false;
    }
    const lead = shortlistLeads[index];
    if (entry.leadKey !== lead.leadKey || entry.companyName !== lead.companyName) {
      return false;
    }
    if (!lead.reportPath.trim()) {
      return hasOnlyKeys(entry, ["leadKey", "companyName", "status"]) && entry.status === "skipped";
    }
    const slug = nextUniqueSlug(safeLeadSlug(lead.leadKey, lead.companyName), slugCounts);
    return (
      hasOnlyKeys(entry, ["leadKey", "companyName", "status", "outDir"]) &&
      entry.status === "packaged" &&
      entry.outDir === join(packagesDir, slug)
    );
  });
}

function isWorkflowCheckpoint(value: unknown, config: ResolvedWorkflowConfig): value is WorkflowCheckpoint {
  if (!isRecord(value) || !hasOnlyKeys(value, ["version", "configFingerprint", "summary", "integrity", "shortlistLeads"])) {
    return false;
  }
  const checkpoint = value as Partial<WorkflowCheckpoint>;
  const summary = checkpoint.summary;
  if (!isRecord(summary) || !hasOnlyKeys(summary, ["version", "status", "stages", "outputs", "discoveredLeads", "selectedLeads", "packages"])) {
    return false;
  }
  const stages = summary.stages;
  const packages = summary.packages;
  const integrity = checkpoint.integrity;
  if (
    !isRecord(stages) ||
    !hasOnlyKeys(stages, ["discovery", "shortlist", "review", "packaging"]) ||
    !isRecord(packages) ||
    !hasOnlyKeys(packages, ["packaged", "skipped", "failed", "entries"]) ||
    !isRecord(integrity) ||
    !isRecord(summary.outputs)
  ) {
    return false;
  }

  const stageSummaries = {
    discovery: isStageSummary(stages.discovery, ["totalCandidates", "suppressedCandidates", "audited"]),
    shortlist: isStageSummary(stages.shortlist, ["totalRows", "suppressedRows", "filteredRows", "selected"]),
    review: isStageSummary(stages.review, ["totalRows", "reviewedRows", "actionableLeads", "staleRows", "invalidReviewedAtRows", "unreviewedRows"]),
    packaging: isStageSummary(stages.packaging, ["packaged", "skipped", "failed"])
  };
  const expectedIntegrity = checkpointArtifactPaths(config, summary as WorkflowSummary);
  const expectedOutputEntries = Object.entries(config.paths);
  const checkpointOutputs = summary.outputs as unknown as Record<string, unknown>;
  const outputsMatch =
    hasOnlyKeys(
      checkpointOutputs,
      expectedOutputEntries.map(([key]) => key)
    ) && expectedOutputEntries.every(([key, path]) => checkpointOutputs[key] === path);
  const stageStatus = (name: WorkflowStageName): WorkflowStageStatus | undefined =>
    (stages[name] as { status?: WorkflowStageStatus }).status;
  if (!Array.isArray(checkpoint.shortlistLeads)) {
    return false;
  }
  const shortlistLeads = checkpoint.shortlistLeads;
  const packagesValid =
    isCount(packages.packaged) &&
    isCount(packages.skipped) &&
    packages.failed === 0 &&
    Array.isArray(packages.entries) &&
    packages.entries.length === packages.packaged + packages.skipped;
  const completedPackagesValid =
    stageStatus("packaging") !== "success" ||
    (packages.entries as unknown[]).filter((entry) => isRecord(entry) && entry.status === "packaged").length === packages.packaged &&
      (packages.entries as unknown[]).filter((entry) => isRecord(entry) && entry.status === "skipped").length === packages.skipped &&
      isCompletedPackageEntries(packages.entries as unknown[], shortlistLeads, config.paths.packagesDir);
  const packagingCountersMatch =
    stageStatus("packaging") !== "success" ||
    (stages.packaging.packaged === packages.packaged &&
      stages.packaging.skipped === packages.skipped &&
      stages.packaging.failed === packages.failed);

  return (
    checkpoint.version === 1 &&
    typeof checkpoint.configFingerprint === "string" &&
    /^[a-f0-9]{64}$/.test(checkpoint.configFingerprint) &&
    summary.version === 1 &&
    summary.status === "success" &&
    stageSummaries.discovery &&
    stageSummaries.shortlist &&
    stageSummaries.review &&
    stageSummaries.packaging &&
    outputsMatch &&
    isCount(summary.discoveredLeads) &&
    isCount(summary.selectedLeads) &&
    packagesValid &&
    completedPackagesValid &&
    packagingCountersMatch &&
    stageStatus("discovery") === "success" &&
    (stageStatus("shortlist") === "success" || stageStatus("shortlist") === "not-run") &&
    (config.review ? stageStatus("review") === "success" || stageStatus("review") === "not-run" : stageStatus("review") === "skipped") &&
    (config.packageReports
      ? stageStatus("packaging") === "success" || stageStatus("packaging") === "not-run"
      : stageStatus("packaging") === "skipped") &&
    (stageStatus("shortlist") === "success" ||
      (stageStatus("review") !== "success" && stageStatus("packaging") !== "success" && summary.selectedLeads === 0 && shortlistLeads.length === 0)) &&
    (stageStatus("review") !== "success" || stageStatus("shortlist") === "success") &&
    (stageStatus("packaging") !== "success" ||
      (stageStatus("shortlist") === "success" && (!config.review || stageStatus("review") === "success"))) &&
    shortlistLeads.every(isShortlistLeadSnapshot) &&
    (stageStatus("shortlist") !== "success" ||
      (summary.selectedLeads === shortlistLeads.length && stages.shortlist.selected === shortlistLeads.length)) &&
    Object.keys(integrity).every(
      (id) => Object.hasOwn(expectedIntegrity, id) || isPackageSourceIntegrityId(id, shortlistLeads)
    ) &&
    Object.entries(expectedIntegrity).every(
      ([id]) => typeof integrity[id] === "string" && /^[a-f0-9]{64}$/.test(integrity[id])
    ) &&
    Object.entries(integrity).every(([, hash]) => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash)) &&
    (!config.packageReports ||
      stageStatus("packaging") === "success" ||
      shortlistLeads.every(
        (lead, index) =>
          !lead.reportPath.trim() ||
          typeof integrity[packageSourceIntegrityId(index, "open-local-audit-report.json")] === "string"
      ))
  );
}

async function readWorkflowCheckpoint(config: ResolvedWorkflowConfig): Promise<WorkflowCheckpoint> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(workflowCheckpointPath(config), "utf8"));
  } catch {
    throw new Error("Workflow checkpoint is missing or invalid");
  }
  if (!isWorkflowCheckpoint(value, config)) {
    throw new Error("Workflow checkpoint is missing or invalid");
  }
  if (value.configFingerprint !== workflowConfigFingerprint(config)) {
    throw new Error("Workflow checkpoint does not match the current configuration");
  }

  for (const [id, path] of Object.entries(checkpointArtifactPaths(config, value.summary))) {
    const expectedHash = value.integrity[id];
    if (!expectedHash || (await hashManagedFile(path)) !== expectedHash) {
      throw new Error("Workflow checkpoint managed artifacts do not match");
    }
  }
  await validateCheckpointPackageSources(config, value);
  return value;
}

async function throwPersistedWorkflowFailure(summary: WorkflowSummary): Promise<never> {
  try {
    await writeWorkflowSummary(summary);
  } catch {
    // The workflow failure remains authoritative if its summary cannot be persisted.
  }

  throw new WorkflowRunError(summary);
}

async function throwStageFailure(
  summary: WorkflowSummary,
  stage: WorkflowStageName,
  error: unknown,
  knownSecrets: readonly string[]
): Promise<never> {
  markStageFailure(summary, stage, sanitizeErrorMessage(error, knownSecrets));
  return throwPersistedWorkflowFailure(summary);
}

function markStageFailure(summary: WorkflowSummary, stage: WorkflowStageName, message: string): void {
  summary.status = "failed";
  summary.stages[stage].status = "failed";
  summary.error = {
    stage,
    message
  };
}

async function resolvePackageInputDir(
  reportsDir: string,
  reportPath: string
): Promise<{ inputDir: string; realInputDir: string }> {
  const resolvedReportPath = resolve(reportsDir, reportPath);
  const relativePath = relative(reportsDir, resolvedReportPath);

  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("Report path escapes reports directory");
  }

  const inputDir = dirname(resolvedReportPath);
  const [realReportsDir, realInputDir] = await Promise.all([realpath(reportsDir), realpath(inputDir)]);
  const realRelativePath = relative(realReportsDir, realInputDir);
  if (realRelativePath.startsWith("..") || isAbsolute(realRelativePath)) {
    throw new Error("Report path escapes reports directory");
  }

  return { inputDir, realInputDir };
}

async function validatePackageSourceFiles(inputDir: string, realInputDir: string): Promise<void> {
  for (const fileName of packageReportFileNames) {
    const sourcePath = join(inputDir, fileName);
    try {
      const sourceInfo = await lstat(sourcePath);
      if (sourceInfo.isSymbolicLink()) {
        throw new Error("Linked report files are not allowed");
      }

      const realSourcePath = await realpath(sourcePath);
      const relativeSourcePath = relative(realInputDir, realSourcePath);
      if (relativeSourcePath.startsWith("..") || isAbsolute(relativeSourcePath)) {
        throw new Error("Report file escapes input directory");
      }
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }
}

async function promotePackage(tempDir: string, finalDir: string): Promise<void> {
  const backupDir = `${finalDir}.backup-${randomUUID()}`;
  let hasBackup = false;
  let promoted = false;

  try {
    await rename(finalDir, backupDir);
    hasBackup = true;
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }

  try {
    await rename(tempDir, finalDir);
    promoted = true;
    if (hasBackup) {
      await rm(backupDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  } catch (error) {
    if (hasBackup) {
      try {
        if (promoted) {
          await rename(finalDir, tempDir);
        }
        await rename(backupDir, finalDir);
      } catch {
        // Best-effort rollback; the original promotion error remains authoritative.
      }
    }
    throw error;
  }
}

function updateDiscoveryStage(summary: WorkflowSummary, result: DiscoveryRunResult): void {
  summary.stages.discovery = {
    status: "success",
    totalCandidates: result.summary.totalCandidates,
    suppressedCandidates: result.summary.suppressedCandidates,
    audited: result.summary.audited
  };
  summary.discoveredLeads = result.rows.length;
}

function updateShortlistStage(summary: WorkflowSummary, result: ShortlistResult): void {
  summary.stages.shortlist = {
    status: "success",
    totalRows: result.totalRows,
    suppressedRows: result.suppressedRows,
    filteredRows: result.filteredRows,
    selected: result.selected
  };
  summary.selectedLeads = result.selected;
}

function updateReviewStage(summary: WorkflowSummary, result: ReviewSummary): void {
  summary.stages.review = {
    status: "success",
    totalRows: result.totalRows,
    reviewedRows: result.reviewedRows,
    actionableLeads: result.actionableLeadKeys.length,
    staleRows: result.staleRows,
    invalidReviewedAtRows: result.invalidReviewedAtRows,
    unreviewedRows: result.unreviewedRows
  };
}

function updatePackagingStage(summary: WorkflowSummary): void {
  summary.stages.packaging = {
    status: summary.packages.failed > 0 ? "failed" : "success",
    packaged: summary.packages.packaged,
    skipped: summary.packages.skipped,
    failed: summary.packages.failed
  };
}

function nextUniqueSlug(baseSlug: string, counts: Map<string, number>): string {
  const nextCount = (counts.get(baseSlug) ?? 0) + 1;
  counts.set(baseSlug, nextCount);
  return nextCount === 1 ? baseSlug : `${baseSlug}-${nextCount}`;
}

export async function runWorkflow(
  configPath: string,
  dependencies: Partial<WorkflowDependencies> = {},
  options: WorkflowRunOptions = {}
): Promise<WorkflowSummary> {
  const resolvedDependencies: WorkflowDependencies = {
    ...defaultDependencies,
    ...dependencies
  };
  const config = await resolvedDependencies.readWorkflowConfig(configPath);

  return await runResolvedWorkflow(config, resolvedDependencies, options);
}

export async function runResolvedWorkflow(
  config: ResolvedWorkflowConfig,
  dependencies: Partial<WorkflowDependencies> = {},
  options: WorkflowRunOptions = {}
): Promise<WorkflowSummary> {
  const resolvedDependencies: WorkflowDependencies = {
    ...defaultDependencies,
    ...dependencies
  };

  const checkpoint = options.resume ? await readWorkflowCheckpoint(config) : undefined;
  await prepareWorkflowManagedDirectories(config);
  const summary = checkpoint
    ? { ...checkpoint.summary, outputs: config.paths, error: undefined, status: "success" as const }
    : createInitialSummary(config);
  let shortlistLeads = checkpoint?.shortlistLeads ?? [];
  const knownSecrets: string[] = [];

  try {
    if (summary.stages.discovery.status !== "success") {
      const googleApiKey =
        config.discovery.provider === "google-places" ? resolvedDependencies.resolveGoogleMapsApiKey() : undefined;
      if (googleApiKey) {
        knownSecrets.push(googleApiKey);
      }
      const discoveryResult = await resolvedDependencies.runDiscovery({
        provider: config.discovery.provider,
        ...(config.discovery.provider === "manual-csv" ? { input: config.discovery.input } : {}),
        ...(config.discovery.provider === "google-places" ? { query: config.discovery.query } : {}),
        profile: config.discovery.profile,
        outDir: config.paths.reportsDir,
        managedOutputRoot: config.paths.reportsDir,
        exportCsv: config.paths.leadsCsv,
        summaryJson: config.paths.discoverySummaryJson,
        reviewCsv: config.review?.csv,
        dryRun: false,
        concurrency: config.discovery.concurrency,
        ...(config.discovery.maxAudits !== undefined ? { maxAudits: config.discovery.maxAudits } : {}),
        ...(config.discovery.provider === "google-places" ? { limit: config.discovery.limit } : {}),
        ...(googleApiKey !== undefined ? { apiKey: googleApiKey } : {})
      });
      updateDiscoveryStage(summary, discoveryResult);
      await writeWorkflowCheckpoint(config, summary, shortlistLeads);
    }

    if (summary.stages.shortlist.status !== "success") {
      const shortlistResult = await resolvedDependencies.runShortlistReport({
        input: config.paths.leadsCsv,
        out: config.paths.shortlistCsv,
        summaryJson: config.paths.shortlistSummaryJson,
        reviewCsv: config.review?.csv,
        format: "csv",
        shortlist: config.shortlist
      });
      updateShortlistStage(summary, shortlistResult);
      shortlistLeads = shortlistResult.leads;
      await writeWorkflowCheckpoint(config, summary, shortlistLeads);
    }

    if (config.review && summary.stages.review.status !== "success") {
      const reviewSummary = await resolvedDependencies.summarizeReviewCsvFile(config.review.csv, {
        staleBefore: config.review.staleBefore
      });
      await writePrettyJson(config.paths.reviewSummaryJson, reviewSummary);
      updateReviewStage(summary, reviewSummary);
      await writeWorkflowCheckpoint(config, summary, shortlistLeads);
    }

    if (config.packageReports && summary.stages.packaging.status !== "success") {
      summary.packages = { packaged: 0, skipped: 0, failed: 0, entries: [] };
      const slugCounts = new Map<string, number>();
      for (const lead of shortlistLeads) {
        const packageEntry = await packageLead(
          config.paths,
          lead,
          slugCounts,
          resolvedDependencies.packageReport,
          knownSecrets
        );
        summary.packages.entries.push(packageEntry);
        if (packageEntry.status === "packaged") {
          summary.packages.packaged += 1;
        } else if (packageEntry.status === "skipped") {
          summary.packages.skipped += 1;
        } else {
          summary.packages.failed += 1;
        }
      }

      updatePackagingStage(summary);
      if (summary.packages.failed > 0) {
        summary.status = "failed";
        summary.error = {
          stage: "packaging",
          message: `${summary.packages.failed} package ${summary.packages.failed === 1 ? "entry" : "entries"} failed`
        };
        await throwPersistedWorkflowFailure(summary);
      }
      await writeWorkflowCheckpoint(config, summary, shortlistLeads);
    }
  } catch (error) {
    if (error instanceof WorkflowRunError) {
      throw error;
    }

    const failedStage =
      summary.stages.discovery.status !== "success"
        ? "discovery"
        : summary.stages.shortlist.status !== "success"
          ? "shortlist"
          : summary.stages.review.status === "not-run"
            ? "review"
            : "packaging";
    await throwStageFailure(summary, failedStage, error, knownSecrets);
  }

  await writeWorkflowSummary(summary);
  return summary;
}

async function packageLead(
  paths: WorkflowManagedPaths,
  lead: ShortlistLead,
  slugCounts: Map<string, number>,
  packageReportDependency: WorkflowDependencies["packageReport"],
  knownSecrets: readonly string[]
): Promise<WorkflowPackageEntry> {
  const reportPath = lead.reportPath.trim();
  if (!reportPath) {
    return {
      leadKey: lead.leadKey,
      companyName: lead.companyName,
      status: "skipped"
    };
  }

  const slug = nextUniqueSlug(safeLeadSlug(lead.leadKey, lead.companyName), slugCounts);
  const outDir = join(paths.packagesDir, slug);
  let tempDir: string | undefined;

  try {
    const { inputDir, realInputDir } = await resolvePackageInputDir(paths.reportsDir, reportPath);
    await validatePackageSourceFiles(inputDir, realInputDir);
    await mkdir(paths.packagesDir, { recursive: true });
    tempDir = await mkdtemp(join(paths.packagesDir, `.${slug}-tmp-`));
    await packageReportDependency({
      inputDir,
      outDir: tempDir
    });
    await promotePackage(tempDir, outDir);
    tempDir = undefined;

    return {
      leadKey: lead.leadKey,
      companyName: lead.companyName,
      status: "packaged",
      outDir
    };
  } catch (error) {
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      } catch {
        // Keep the package failure useful even if temporary output cannot be removed.
      }
    }
    return {
      leadKey: lead.leadKey,
      companyName: lead.companyName,
      status: "failed",
      error: sanitizeErrorMessage(error, knownSecrets)
    };
  }
}
