import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { runDiscovery, type DiscoveryRunResult } from "./discovery-runner.js";
import { packageReport, type ReportPackResult } from "./report-pack.js";
import { summarizeReviewCsvFile, type ReviewSummary } from "./review.js";
import { runShortlistReport, type ShortlistRunOptions } from "./shortlist-runner.js";
import type { ShortlistLead, ShortlistResult } from "./shortlist.js";
import { resolveGoogleMapsApiKey } from "./secrets.js";
import { readWorkflowConfig, type ResolvedWorkflowConfig, type WorkflowManagedPaths } from "./workflow-config.js";

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
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeWorkflowSummary(summary: WorkflowSummary): Promise<void> {
  await writePrettyJson(summary.outputs.workflowSummaryJson, summary);
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

async function resolvePackageInputDir(reportsDir: string, reportPath: string): Promise<string> {
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

  return inputDir;
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
  dependencies: Partial<WorkflowDependencies> = {}
): Promise<WorkflowSummary> {
  const resolvedDependencies: WorkflowDependencies = {
    ...defaultDependencies,
    ...dependencies
  };
  const config = await resolvedDependencies.readWorkflowConfig(configPath);

  await mkdir(config.outDir, { recursive: true });
  const summary = createInitialSummary(config);
  const knownSecrets: string[] = [];

  try {
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

    const shortlistResult = await resolvedDependencies.runShortlistReport({
      input: config.paths.leadsCsv,
      out: config.paths.shortlistCsv,
      summaryJson: config.paths.shortlistSummaryJson,
      reviewCsv: config.review?.csv,
      format: "csv",
      shortlist: config.shortlist
    });
    updateShortlistStage(summary, shortlistResult);

    if (config.review) {
      const reviewSummary = await resolvedDependencies.summarizeReviewCsvFile(config.review.csv, {
        staleBefore: config.review.staleBefore
      });
      await writePrettyJson(config.paths.reviewSummaryJson, reviewSummary);
      updateReviewStage(summary, reviewSummary);
    }

    if (config.packageReports) {
      const slugCounts = new Map<string, number>();
      for (const lead of shortlistResult.leads) {
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
    const inputDir = await resolvePackageInputDir(paths.reportsDir, reportPath);
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
