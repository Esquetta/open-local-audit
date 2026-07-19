import { constants } from "node:fs";
import { access, lstat } from "node:fs/promises";
import { dirname } from "node:path";
import type { Stats } from "node:fs";
import { ZodError } from "zod";
import { readWorkflowConfig } from "./workflow-config.js";
import type { ResolvedWorkflowConfig, WorkflowManagedPaths } from "./workflow-config.js";
import { inspectWorkflowManagedPaths } from "./workflow-paths.js";
import type { WorkflowPathInspection } from "./workflow-paths.js";
import { resolveGoogleMapsApiKey } from "./secrets.js";

export type WorkflowPreflightStatus = "ready" | "blocked";
export type WorkflowPreflightCheckStatus = "pass" | "warn" | "fail";
export type WorkflowPreflightStage = "discovery" | "shortlist" | "review" | "packaging";
export type WorkflowPreflightCheckId =
  | "configuration"
  | "discovery-input"
  | "google-api-key"
  | "review-csv"
  | "output-access"
  | "managed-paths";

export interface WorkflowPreflightCheck {
  id: WorkflowPreflightCheckId;
  status: WorkflowPreflightCheckStatus;
  message: string;
  path?: string;
}

export interface WorkflowPreflightReport {
  version: 1;
  status: WorkflowPreflightStatus;
  checks: WorkflowPreflightCheck[];
  provider?: "manual-csv" | "google-places";
  stages?: WorkflowPreflightStage[];
  outputs?: { outDir: string } & WorkflowManagedPaths;
  limits?: { maxCandidates: number | null; maxAudits: number | null };
}

export interface WorkflowPreflightDependencies {
  readWorkflowConfig(configPath: string): Promise<ResolvedWorkflowConfig>;
  resolveGoogleMapsApiKey(): string | undefined;
  lstat(path: string): Promise<Stats>;
  access(path: string, mode?: number): Promise<void>;
  inspectWorkflowManagedPaths(config: ResolvedWorkflowConfig): Promise<WorkflowPathInspection>;
}

const defaultDependencies: WorkflowPreflightDependencies = {
  readWorkflowConfig,
  resolveGoogleMapsApiKey,
  lstat,
  access,
  inspectWorkflowManagedPaths
};

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

function isFilesystemReadinessError(error: unknown): boolean {
  return ["ENOENT", "EACCES", "EPERM", "EISDIR", "ENOTDIR", "ELOOP", "ENAMETOOLONG"].some((code) =>
    hasErrorCode(error, code)
  );
}

function isInvalidWorkflowConfigJsonError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "cause" in error &&
      error.cause instanceof SyntaxError &&
      error instanceof Error &&
      error.message.startsWith("Workflow config ") &&
      error.message.endsWith(" contains invalid JSON")
  );
}

function isExpectedWorkflowConfigError(error: unknown): boolean {
  return isFilesystemReadinessError(error) || error instanceof ZodError || isInvalidWorkflowConfigJsonError(error);
}

async function isReadableRegularFile(
  path: string,
  dependencies: WorkflowPreflightDependencies
): Promise<"readable" | "missing" | "invalid"> {
  try {
    const info = await dependencies.lstat(path);
    if (!info.isFile()) {
      return "invalid";
    }
    await dependencies.access(path, constants.R_OK);
    return "readable";
  } catch (error) {
    if (!isFilesystemReadinessError(error)) {
      throw error;
    }
    return hasErrorCode(error, "ENOENT") ? "missing" : "invalid";
  }
}

async function findWritableOutputAncestor(
  outDir: string,
  dependencies: WorkflowPreflightDependencies
): Promise<boolean> {
  let ancestor = outDir;

  while (true) {
    let info: Stats;
    try {
      info = await dependencies.lstat(ancestor);
    } catch (error) {
      if (!hasErrorCode(error, "ENOENT")) {
        if (isFilesystemReadinessError(error)) {
          return false;
        }
        throw error;
      }

      const parent = dirname(ancestor);
      if (parent === ancestor) {
        return false;
      }
      ancestor = parent;
      continue;
    }

    if (!info.isDirectory()) {
      return false;
    }

    try {
      await dependencies.access(ancestor, constants.W_OK);
      return true;
    } catch (error) {
      if (isFilesystemReadinessError(error)) {
        return false;
      }
      throw error;
    }
  }
}

function reportStatus(checks: WorkflowPreflightCheck[]): WorkflowPreflightStatus {
  return checks.some((check) => check.status === "fail") ? "blocked" : "ready";
}

export function renderWorkflowPreflightTerminal(report: WorkflowPreflightReport, configPath: string): string {
  const details = [
    ...(report.stages ? [`Stages: ${report.stages.join(" -> ")}`] : []),
    ...(report.outputs ? [`Managed output: ${report.outputs.outDir}`] : [])
  ];
  const lines = [
    `Workflow preflight: ${report.status.toUpperCase()}`,
    `Config: ${configPath}`,
    ...(report.provider ? [`Provider: ${report.provider}`] : []),
    "",
    ...report.checks.map((check) => `${check.status.toUpperCase().padEnd(5)} ${check.message}`),
    ...(details.length > 0 ? ["", ...details] : [])
  ];

  return `${lines.join("\n")}\n`;
}

export function renderWorkflowPreflightJson(report: WorkflowPreflightReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export async function runWorkflowPreflight(configPath: string): Promise<WorkflowPreflightReport> {
  return runWorkflowPreflightWithDependencies(configPath);
}

export async function runWorkflowPreflightWithDependencies(
  configPath: string,
  overrides: Partial<WorkflowPreflightDependencies> = {}
): Promise<WorkflowPreflightReport> {
  const dependencies: WorkflowPreflightDependencies = { ...defaultDependencies, ...overrides };
  let config: ResolvedWorkflowConfig;

  try {
    config = await dependencies.readWorkflowConfig(configPath);
  } catch (error) {
    if (!isExpectedWorkflowConfigError(error)) {
      throw error;
    }
    return {
      version: 1,
      status: "blocked",
      checks: [
        {
          id: "configuration",
          status: "fail",
          message: "Workflow configuration could not be read or validated"
        }
      ]
    };
  }

  const checks: WorkflowPreflightCheck[] = [
    { id: "configuration", status: "pass", message: "Workflow configuration is valid" }
  ];

  if (config.discovery.provider === "manual-csv") {
    const inputStatus = await isReadableRegularFile(config.discovery.input, dependencies);
    checks.push({
      id: "discovery-input",
      status: inputStatus === "readable" ? "pass" : "fail",
      message: inputStatus === "readable" ? "Discovery input is readable" : "Discovery input must be a readable regular file",
      path: config.discovery.input
    });
  } else {
    const hasApiKey = Boolean(dependencies.resolveGoogleMapsApiKey()?.trim());
    checks.push({
      id: "google-api-key",
      status: hasApiKey ? "pass" : "fail",
      message: hasApiKey ? "Google Maps API key is available" : "Google Maps API key is required"
    });
  }

  if (config.review) {
    const reviewStatus = await isReadableRegularFile(config.review.csv, dependencies);
    checks.push({
      id: "review-csv",
      status: reviewStatus === "readable" ? "pass" : reviewStatus === "missing" ? "warn" : "fail",
      message:
        reviewStatus === "readable"
          ? "Review CSV is readable"
          : reviewStatus === "missing"
            ? "Review CSV does not exist and will be created"
            : "Review CSV must be a readable regular file",
      path: config.review.csv
    });
  }

  const outputWritable = await findWritableOutputAncestor(config.outDir, dependencies);
  checks.push({
    id: "output-access",
    status: outputWritable ? "pass" : "fail",
    message: outputWritable ? "Output location is writable" : "Output location is not writable",
    path: config.outDir
  });

  try {
    const inspection = await dependencies.inspectWorkflowManagedPaths(config);
    for (const issue of inspection.issues) {
      checks.push({ id: "managed-paths", status: "fail", message: issue.message, path: issue.path });
    }
  } catch (error) {
    if (!isFilesystemReadinessError(error)) {
      throw error;
    }
    checks.push({
      id: "managed-paths",
      status: "fail",
      message: "Managed output paths could not be inspected safely"
    });
  }

  const stages: WorkflowPreflightStage[] = [
    "discovery",
    "shortlist",
    ...(config.review ? ["review" as const] : []),
    ...(config.packageReports ? ["packaging" as const] : [])
  ];

  return {
    version: 1,
    status: reportStatus(checks),
    checks,
    provider: config.discovery.provider,
    stages,
    outputs: { outDir: config.outDir, ...config.paths },
    limits: {
      maxCandidates: config.discovery.provider === "google-places" ? config.discovery.limit : null,
      maxAudits: config.discovery.maxAudits ?? null
    }
  };
}
