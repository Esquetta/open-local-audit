import { constants } from "node:fs";
import { access, lstat } from "node:fs/promises";
import { dirname } from "node:path";
import type { Stats } from "node:fs";
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
    return hasErrorCode(error, "ENOENT") ? "missing" : "invalid";
  }
}

async function findWritableOutputAncestor(
  outDir: string,
  dependencies: WorkflowPreflightDependencies
): Promise<boolean> {
  let ancestor = outDir;

  while (true) {
    try {
      const info = await dependencies.lstat(ancestor);
      if (!info.isDirectory()) {
        return false;
      }
      await dependencies.access(ancestor, constants.W_OK);
      return true;
    } catch (error) {
      if (!hasErrorCode(error, "ENOENT")) {
        return false;
      }

      const parent = dirname(ancestor);
      if (parent === ancestor) {
        return false;
      }
      ancestor = parent;
    }
  }
}

function reportStatus(checks: WorkflowPreflightCheck[]): WorkflowPreflightStatus {
  return checks.some((check) => check.status === "fail") ? "blocked" : "ready";
}

export async function runWorkflowPreflight(
  configPath: string,
  overrides: Partial<WorkflowPreflightDependencies> = {}
): Promise<WorkflowPreflightReport> {
  const dependencies: WorkflowPreflightDependencies = { ...defaultDependencies, ...overrides };
  let config: ResolvedWorkflowConfig;

  try {
    config = await dependencies.readWorkflowConfig(configPath);
  } catch {
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
    let hasApiKey = false;
    try {
      hasApiKey = Boolean(dependencies.resolveGoogleMapsApiKey()?.trim());
    } catch {
      hasApiKey = false;
    }
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
  } catch {
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
