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

const workflowPlanArtifactIds = [
  "manual-input-csv",
  "review-csv",
  "leads-csv",
  "discovery-summary-json",
  "reports-dir",
  "shortlist-csv",
  "shortlist-summary-json",
  "review-summary-json",
  "packages-dir",
  "workflow-summary-json"
] as const satisfies readonly WorkflowPlanArtifactId[];

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
      inputs: [
        ...(config.discovery.provider === "manual-csv" ? ["manual-input-csv" as const] : []),
        ...(config.review ? ["review-csv" as const] : [])
      ],
      outputs: [
        "leads-csv",
        "discovery-summary-json",
        "reports-dir",
        ...(config.review ? ["review-csv" as const] : [])
      ],
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
      inputs: ["leads-csv", ...(config.review ? ["review-csv" as const] : [])],
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
          inputs: ["review-csv"],
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
          inputs: ["reports-dir"],
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

function renderNetworkCapabilities(step: WorkflowPlanStep): string[] {
  return step.networkAccess.flatMap((access) => {
    if (access === "google-places") {
      return "Google Places";
    }
    if (step.id !== "discovery" || step.settings.maxAudits === 0) {
      return [];
    }
    return step.settings.maxAudits === null
      ? "website audits (no configured cap)"
      : `website audits (up to ${step.settings.maxAudits})`;
  });
}

function renderWorkflowPlanStep(step: WorkflowPlanStep, index: number): string[] {
  const networkCapabilities = renderNetworkCapabilities(step);
  return [
    `${index + 1}. ${step.id} [${step.state.toUpperCase().replace("-", " ")}]`,
    ...(step.reason !== undefined ? [`   Reason: ${step.reason}`] : []),
    ...(networkCapabilities.length > 0 ? [`   Network: ${networkCapabilities.join(", ")}`] : []),
    ...(step.inputs.length > 0 ? [`   Inputs: ${step.inputs.join(", ")}`] : []),
    ...(step.outputs.length > 0 ? [`   Outputs: ${step.outputs.join(", ")}`] : [])
  ];
}

export function renderWorkflowPlanTerminal(report: WorkflowPlanReport, configPath: string): string {
  const discovery = report.steps.find((step) => step.id === "discovery");
  const artifactLines = workflowPlanArtifactIds.flatMap((id) => {
    const path = report.artifacts[id];
    return path !== undefined ? [`- ${id}: ${path}`] : [];
  });
  const lines = [
    `Workflow plan: ${report.status.toUpperCase()}`,
    `Config: ${configPath}`,
    ...(discovery ? [`Provider: ${discovery.settings.provider}`] : []),
    "",
    "Readiness:",
    ...report.preflight.checks.map((check) => `${check.status.toUpperCase().padEnd(5)} ${check.message}`),
    "",
    "Execution plan:",
    ...(report.steps.length > 0
      ? report.steps.flatMap((step, index) => [
          ...renderWorkflowPlanStep(step, index),
          ...(index < report.steps.length - 1 ? [""] : [])
        ])
      : ["No execution plan is available"]),
    ...(artifactLines.length > 0 ? ["", "Artifacts:", ...artifactLines] : [])
  ];

  return `${lines.join("\n")}\n`;
}

export function renderWorkflowPlanJson(report: WorkflowPlanReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
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
