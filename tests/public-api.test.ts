import { describe, expect, it } from "vitest";
import {
  renderWorkflowPreflightJson,
  renderWorkflowPreflightTerminal,
  runWorkflowPreflight
} from "../src/index.js";
import type {
  WorkflowPreflightCheck,
  WorkflowPreflightCheckId,
  WorkflowPreflightCheckStatus,
  WorkflowPreflightReport,
  WorkflowPreflightStage,
  WorkflowPreflightStatus
} from "../src/index.js";

describe("public API", () => {
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
