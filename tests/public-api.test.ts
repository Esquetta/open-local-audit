import { describe, expect, it } from "vitest";
import {
  renderWorkflowPlanJson,
  renderWorkflowPlanTerminal,
  renderWorkflowPreflightJson,
  renderWorkflowPreflightTerminal,
  runWorkflowPlan,
  runWorkflowPreflight
} from "../src/index.js";
import * as publicApi from "../src/index.js";
import type {
  WorkflowPlanArtifactId,
  WorkflowPlanNetworkAccess,
  WorkflowPlanReport,
  WorkflowPlanStatus,
  WorkflowPlanStep,
  WorkflowPlanStepId,
  WorkflowPlanStepState,
  WorkflowPreflightCheck,
  WorkflowPreflightCheckId,
  WorkflowPreflightCheckStatus,
  WorkflowPreflightReport,
  WorkflowPreflightStage,
  WorkflowPreflightStatus
} from "../src/index.js";

describe("public API", () => {
  it("exports workflow plan values and report contract types without internal seams", () => {
    const artifactId: WorkflowPlanArtifactId = "leads-csv";
    const networkAccess: WorkflowPlanNetworkAccess = "website-audits";
    const status: WorkflowPlanStatus = "ready";
    const stepId: WorkflowPlanStepId = "discovery";
    const stepState: WorkflowPlanStepState = "will-run";
    const step: WorkflowPlanStep = {
      id: stepId,
      state: stepState,
      dependsOn: [],
      inputs: [],
      outputs: [artifactId],
      networkAccess: [networkAccess],
      settings: {
        provider: "manual-csv",
        profile: "dental",
        concurrency: 1,
        maxCandidates: null,
        maxAudits: null
      }
    };
    const report: WorkflowPlanReport = {
      version: 1,
      status,
      preflight: { version: 1, status, checks: [], stages: [] },
      artifacts: { [artifactId]: "C:/work/leads.csv" },
      steps: [step]
    };

    expect(runWorkflowPlan).toBeTypeOf("function");
    expect(renderWorkflowPlanTerminal).toBeTypeOf("function");
    expect(renderWorkflowPlanJson).toBeTypeOf("function");
    expect(renderWorkflowPlanTerminal(report, "workflow.json")).toContain("READY");
    expect(JSON.parse(renderWorkflowPlanJson(report))).toEqual(report);
    expect(publicApi).not.toHaveProperty("runWorkflowPlanWithDependencies");
  });

  it("accepts only a configuration path for workflow planning", () => {
    if (false) {
      // @ts-expect-error The package-root plan API does not accept dependency overrides.
      void runWorkflowPlan("workflow.json", {});
    }
  });

  it("exports workflow preflight values and report contract types", () => {
    const status: WorkflowPreflightStatus = "ready";
    const checkStatus: WorkflowPreflightCheckStatus = "pass";
    const checkId: WorkflowPreflightCheckId = "configuration";
    const stage: WorkflowPreflightStage = "discovery";
    const check: WorkflowPreflightCheck = {
      id: checkId,
      status: checkStatus,
      message: "Workflow configuration is valid"
    };
    const report: WorkflowPreflightReport = {
      version: 1,
      status,
      checks: [check],
      stages: [stage]
    };

    expect(runWorkflowPreflight).toBeTypeOf("function");
    expect(renderWorkflowPreflightTerminal(report, "workflow.json")).toContain("READY");
    expect(JSON.parse(renderWorkflowPreflightJson(report))).toEqual(report);
  });

  it("accepts only a configuration path for workflow preflight", () => {
    if (false) {
      // @ts-expect-error The package-root preflight API does not accept dependency overrides.
      void runWorkflowPreflight("workflow.json", {});
    }
  });
});
