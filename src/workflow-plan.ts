import { runWorkflowPreflightEvaluationWithDependencies } from "./workflow-preflight.js";
import type {
  WorkflowPreflightEvaluation,
  WorkflowPreflightReport,
  WorkflowPreflightStatus
} from "./workflow-preflight.js";
import type { ResolvedWorkflowConfig } from "./workflow-config.js";

export type WorkflowPlanStatus = WorkflowPreflightStatus;
export type WorkflowPlanStepId = "discovery" | "shortlist" | "review" | "packaging" | "summary";
export type WorkflowPlanStepState = "will-run" | "conditional" | "disabled";
export type WorkflowPlanNetworkAccess = "google-places" | "website-audits";
export type WorkflowPlanArtifactId =
  | "manual-input-csv"
  | "review-csv"
  | "leads-csv"
  | "discovery-summary-json"
  | "reports-dir"
  | "shortlist-csv"
  | "shortlist-summary-json"
  | "review-summary-json"
  | "packages-dir"
  | "workflow-summary-json";

interface WorkflowPlanStepBase<
  Id extends WorkflowPlanStepId,
  State extends WorkflowPlanStepState,
  Settings
> {
  id: Id;
  state: State;
  dependsOn: WorkflowPlanStepId[];
  inputs: WorkflowPlanArtifactId[];
  outputs: WorkflowPlanArtifactId[];
  networkAccess: WorkflowPlanNetworkAccess[];
  reason?: string;
  settings: Settings;
}

export type WorkflowPlanStep =
  | WorkflowPlanStepBase<
      "discovery",
      "will-run",
      {
        provider: ResolvedWorkflowConfig["discovery"]["provider"];
        profile: ResolvedWorkflowConfig["discovery"]["profile"];
        concurrency: number;
        maxCandidates: number | null;
        maxAudits: number | null;
      }
    >
  | WorkflowPlanStepBase<
      "shortlist",
      "will-run",
      {
        top: number;
        minOpportunityScore: number | null;
        sort: ResolvedWorkflowConfig["shortlist"]["sort"];
      }
    >
  | WorkflowPlanStepBase<"review", "will-run" | "disabled", { staleBefore: string | null }>
  | WorkflowPlanStepBase<"packaging", "conditional" | "disabled", { enabled: boolean }>
  | WorkflowPlanStepBase<"summary", "will-run", Record<string, never>>;

export interface WorkflowPlanReport {
  version: 1;
  status: WorkflowPlanStatus;
  preflight: WorkflowPreflightReport;
  artifacts: Partial<Record<WorkflowPlanArtifactId, string>>;
  steps: WorkflowPlanStep[];
}

interface WorkflowPlanDependencies {
  evaluatePreflight(configPath: string): Promise<WorkflowPreflightEvaluation>;
}

const defaultDependencies: WorkflowPlanDependencies = {
  evaluatePreflight: runWorkflowPreflightEvaluationWithDependencies
};

function buildPlan(evaluation: WorkflowPreflightEvaluation): WorkflowPlanReport {
  const { config, report: preflight } = evaluation;
  if (!config) {
    return { version: 1, status: preflight.status, preflight, artifacts: {}, steps: [] };
  }

  const artifacts: Partial<Record<WorkflowPlanArtifactId, string>> = {
    ...(config.discovery.provider === "manual-csv" ? { "manual-input-csv": config.discovery.input } : {}),
    ...(config.review ? { "review-csv": config.review.csv } : {}),
    "leads-csv": config.paths.leadsCsv,
    "discovery-summary-json": config.paths.discoverySummaryJson,
    "reports-dir": config.paths.reportsDir,
    "shortlist-csv": config.paths.shortlistCsv,
    "shortlist-summary-json": config.paths.shortlistSummaryJson,
    ...(config.review ? { "review-summary-json": config.paths.reviewSummaryJson } : {}),
    ...(config.packageReports ? { "packages-dir": config.paths.packagesDir } : {}),
    "workflow-summary-json": config.paths.workflowSummaryJson
  };
  const reviewEnabled = Boolean(config.review);
  const packagingEnabled = config.packageReports;
  const discoveryNetworkAccess: WorkflowPlanNetworkAccess[] = [
    ...(config.discovery.provider === "google-places" ? ["google-places" as const] : []),
    ...(config.discovery.maxAudits === 0 ? [] : ["website-audits" as const])
  ];
  const summaryDependency: WorkflowPlanStepId = packagingEnabled ? "packaging" : reviewEnabled ? "review" : "shortlist";

  const steps: WorkflowPlanStep[] = [
    {
      id: "discovery",
      state: "will-run",
      dependsOn: [],
      inputs: config.discovery.provider === "manual-csv" ? ["manual-input-csv"] : [],
      outputs: ["leads-csv", "discovery-summary-json", "reports-dir"],
      networkAccess: discoveryNetworkAccess,
      settings: {
        provider: config.discovery.provider,
        profile: config.discovery.profile,
        concurrency: config.discovery.concurrency,
        maxCandidates: config.discovery.provider === "google-places" ? config.discovery.limit : null,
        maxAudits: config.discovery.maxAudits ?? null
      }
    },
    {
      id: "shortlist",
      state: "will-run",
      dependsOn: ["discovery"],
      inputs: ["leads-csv"],
      outputs: ["shortlist-csv", "shortlist-summary-json"],
      networkAccess: [],
      settings: {
        top: config.shortlist.top,
        minOpportunityScore: config.shortlist.minOpportunityScore ?? null,
        sort: config.shortlist.sort
      }
    },
    config.review
      ? {
          id: "review",
          state: "will-run",
          dependsOn: ["shortlist"],
          inputs: ["review-csv", "shortlist-csv"],
          outputs: ["review-summary-json"],
          networkAccess: [],
          settings: { staleBefore: config.review.staleBefore ?? null }
        }
      : {
          id: "review",
          state: "disabled",
          dependsOn: [],
          inputs: [],
          outputs: [],
          networkAccess: [],
          reason: "Review is not configured",
          settings: { staleBefore: null }
        },
    packagingEnabled
      ? {
          id: "packaging",
          state: "conditional",
          dependsOn: [reviewEnabled ? "review" : "shortlist"],
          inputs: ["shortlist-csv", "reports-dir"],
          outputs: ["packages-dir"],
          networkAccess: [],
          reason: "Runs for selected leads with successful report artifacts",
          settings: { enabled: true }
        }
      : {
          id: "packaging",
          state: "disabled",
          dependsOn: [],
          inputs: [],
          outputs: [],
          networkAccess: [],
          reason: "Report packaging is not enabled",
          settings: { enabled: false }
        },
    {
      id: "summary",
      state: "will-run",
      dependsOn: [summaryDependency],
      inputs: [],
      outputs: ["workflow-summary-json"],
      networkAccess: [],
      settings: {}
    }
  ];

  return { version: 1, status: preflight.status, preflight, artifacts, steps };
}

export async function runWorkflowPlan(configPath: string): Promise<WorkflowPlanReport> {
  return runWorkflowPlanWithDependencies(configPath);
}

export async function runWorkflowPlanWithDependencies(
  configPath: string,
  overrides: Partial<WorkflowPlanDependencies> = {}
): Promise<WorkflowPlanReport> {
  const dependencies: WorkflowPlanDependencies = { ...defaultDependencies, ...overrides };
  return buildPlan(await dependencies.evaluatePreflight(configPath));
}
