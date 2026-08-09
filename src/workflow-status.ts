import { readWorkflowConfig, type ResolvedWorkflowConfig } from "./workflow-config.js";
import { readWorkflowState } from "./workflow-state.js";
import { inspectWorkflowCheckpoint, type WorkflowCheckpointInspection, type WorkflowStageName, type WorkflowSummary } from "./workflow.js";

export type WorkflowStatusReportStatus = "not-started" | "running-or-interrupted" | "failed" | "completed" | "invalid";
export type WorkflowArtifactValidation = "valid" | "invalid" | "not-applicable";
export type WorkflowStatusNextActionKind = "run" | "resume" | "confirm-active-process" | "none" | "inspect";

export interface WorkflowStatusNextAction {
  kind: WorkflowStatusNextActionKind;
  argv: string[] | null;
  message: string;
}

export interface WorkflowStatusReport {
  version: 1;
  status: WorkflowStatusReportStatus;
  currentStage: WorkflowStageName | null;
  lastSuccessfulStage: WorkflowStageName | null;
  resumeAvailable: boolean;
  updatedAt: string | null;
  stages: WorkflowSummary["stages"];
  artifactValidation: WorkflowArtifactValidation;
  nextAction: WorkflowStatusNextAction;
  error: { message: string } | null;
}

const stageNames = ["discovery", "shortlist", "review", "packaging"] as const satisfies readonly WorkflowStageName[];

function initialStages(config: ResolvedWorkflowConfig): WorkflowSummary["stages"] {
  return {
    discovery: { status: "not-run" },
    shortlist: { status: "not-run" },
    review: { status: config.review ? "not-run" : "skipped" },
    packaging: { status: config.packageReports ? "not-run" : "skipped" }
  };
}

function unknownStages(): WorkflowSummary["stages"] {
  return {
    discovery: { status: "not-run" },
    shortlist: { status: "not-run" },
    review: { status: "not-run" },
    packaging: { status: "not-run" }
  };
}

function lastSuccessfulStage(stages: WorkflowSummary["stages"]): WorkflowStageName | null {
  let last: WorkflowStageName | null = null;
  for (const stage of stageNames) {
    if (stages[stage].status === "success") {
      last = stage;
    }
  }
  return last;
}

function nextIncompleteStage(stages: WorkflowSummary["stages"]): WorkflowStageName | null {
  return stageNames.find((stage) => stages[stage].status !== "success" && stages[stage].status !== "skipped") ?? null;
}

function runAction(configPath: string): WorkflowStatusNextAction {
  return {
    kind: "run",
    argv: ["workflow", "--config", configPath],
    message: "Run the workflow from the beginning."
  };
}

function resumeAction(configPath: string): WorkflowStatusNextAction {
  return {
    kind: "resume",
    argv: ["workflow", "--config", configPath, "--resume"],
    message: "Resume from the latest validated checkpoint."
  };
}

function runningAction(configPath: string, resumeAvailable: boolean): WorkflowStatusNextAction {
  return {
    kind: "confirm-active-process",
    argv: resumeAvailable ? ["workflow", "--config", configPath, "--resume"] : ["workflow", "--config", configPath],
    message: "Confirm that no workflow process is active before running this command."
  };
}

function invalidReport(
  stages: WorkflowSummary["stages"],
  artifactValidation: WorkflowArtifactValidation,
  message: string
): WorkflowStatusReport {
  return {
    version: 1,
    status: "invalid",
    currentStage: null,
    lastSuccessfulStage: lastSuccessfulStage(stages),
    resumeAvailable: false,
    updatedAt: null,
    stages,
    artifactValidation,
    nextAction: { kind: "inspect", argv: null, message: "Inspect workflow state and checkpoint files before running." },
    error: { message }
  };
}

function hasCompletedStages(stages: WorkflowSummary["stages"]): boolean {
  return stageNames.every((stage) => stages[stage].status === "success" || stages[stage].status === "skipped");
}

function checkpointIsUsable(inspection: WorkflowCheckpointInspection, hash: string | null): boolean {
  return inspection.kind === "valid" && hash !== null && inspection.checkpointHash === hash;
}

export async function runWorkflowStatus(configPath: string): Promise<WorkflowStatusReport> {
  let config: ResolvedWorkflowConfig;
  try {
    config = await readWorkflowConfig(configPath);
  } catch {
    return invalidReport(unknownStages(), "not-applicable", "Workflow configuration is invalid.");
  }

  const [stateResult, checkpoint] = await Promise.all([readWorkflowState(config), inspectWorkflowCheckpoint(config)]);
  if (stateResult.kind === "invalid") {
    return invalidReport(initialStages(config), "invalid", "Workflow state is invalid.");
  }

  if (stateResult.kind === "missing") {
    if (checkpoint.kind === "missing") {
      const stages = initialStages(config);
      return {
        version: 1,
        status: "not-started",
        currentStage: null,
        lastSuccessfulStage: null,
        resumeAvailable: false,
        updatedAt: null,
        stages,
        artifactValidation: "not-applicable",
        nextAction: runAction(configPath),
        error: null
      };
    }
    if (checkpoint.kind === "invalid") {
      return invalidReport(initialStages(config), "invalid", "Workflow checkpoint is invalid.");
    }

    const completed = hasCompletedStages(checkpoint.summary.stages);
    return {
      version: 1,
      status: completed ? "completed" : "running-or-interrupted",
      currentStage: completed ? null : nextIncompleteStage(checkpoint.summary.stages),
      lastSuccessfulStage: lastSuccessfulStage(checkpoint.summary.stages),
      resumeAvailable: !completed,
      updatedAt: null,
      stages: checkpoint.summary.stages,
      artifactValidation: "valid",
      nextAction: completed
        ? { kind: "none", argv: null, message: "Workflow completion is recorded." }
        : runningAction(configPath, true),
      error: null
    };
  }

  const state = stateResult.state;
  const stages = state.summary.stages;
  if (state.checkpointHash !== null && !checkpointIsUsable(checkpoint, state.checkpointHash)) {
    return invalidReport(stages, "invalid", "Workflow checkpoint is missing, invalid, or does not match the state.");
  }
  if (state.phase === "completed" && !checkpointIsUsable(checkpoint, state.checkpointHash)) {
    return invalidReport(stages, "invalid", "Completed workflow state requires a matching checkpoint.");
  }

  const resumeAvailable = checkpointIsUsable(checkpoint, state.checkpointHash);
  const status: WorkflowStatusReportStatus =
    state.phase === "running" ? "running-or-interrupted" : state.phase === "failed" ? "failed" : "completed";
  const nextAction =
    state.phase === "running"
      ? runningAction(configPath, resumeAvailable)
      : state.phase === "failed"
        ? resumeAvailable
          ? resumeAction(configPath)
          : runAction(configPath)
        : { kind: "none" as const, argv: null, message: "Workflow completion is recorded." };

  return {
    version: 1,
    status,
    currentStage: state.currentStage,
    lastSuccessfulStage: lastSuccessfulStage(stages),
    resumeAvailable,
    updatedAt: state.updatedAt,
    stages,
    artifactValidation: resumeAvailable ? "valid" : "not-applicable",
    nextAction,
    error: state.phase === "failed" && state.currentStage ? { message: `Workflow failed during ${state.currentStage}` } : null
  };
}

export function renderWorkflowStatusTerminal(report: WorkflowStatusReport, configPath: string): string {
  const command = report.nextAction.argv === null ? [] : [`Command: ${report.nextAction.argv.join(" ")}`];
  return `${[
    `Workflow status: ${report.status.toUpperCase().replaceAll("-", " ")}`,
    `Config: ${configPath}`,
    `Current stage: ${report.currentStage ?? "none"}`,
    `Last successful stage: ${report.lastSuccessfulStage ?? "none"}`,
    `Artifact validation: ${report.artifactValidation.toUpperCase().replaceAll("-", " ")}`,
    `Next action: ${report.nextAction.kind.toUpperCase().replaceAll("-", " ")}`,
    ...command
  ].join("\n")}\n`;
}

export function renderWorkflowStatusJson(report: WorkflowStatusReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
