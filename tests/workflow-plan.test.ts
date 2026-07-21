import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runWorkflowPreflightEvaluationWithDependencies } from "../src/workflow-preflight.js";
import {
  runWorkflowPlan,
  runWorkflowPlanWithDependencies,
  type WorkflowPlanReport,
  type WorkflowPlanStep,
  type WorkflowPlanStepId
} from "../src/workflow-plan.js";

function findStep<Id extends WorkflowPlanStepId>(
  report: WorkflowPlanReport,
  id: Id
): Extract<WorkflowPlanStep, { id: Id }> {
  const step = report.steps.find((candidate) => candidate.id === id);
  if (!step) {
    throw new Error(`Workflow plan step ${id} was not found`);
  }
  return step as Extract<WorkflowPlanStep, { id: Id }>;
}

describe("workflow plan", () => {
  let directory: string;
  let configPath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "open-local-audit-workflow-plan-"));
    configPath = join(directory, "config", "workflow.json");
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function writeConfig(config: unknown): Promise<void> {
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify(config), "utf8");
  }

  function manualConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      version: 1,
      outDir: "./output",
      discovery: { provider: "manual-csv", input: "./input/places.csv" },
      shortlist: {},
      ...overrides
    };
  }

  async function writeManualInput(): Promise<void> {
    const inputPath = join(directory, "config", "input", "places.csv");
    await mkdir(dirname(inputPath), { recursive: true });
    await writeFile(inputPath, "name\nExample\n", "utf8");
  }

  it("builds a deterministic manual workflow plan with only enabled artifacts", async () => {
    await writeConfig(manualConfig());
    await writeManualInput();

    const report = await runWorkflowPlan(configPath);
    const output = join(directory, "config", "output");

    expect(report).toEqual({
      version: 1,
      status: "ready",
      preflight: expect.objectContaining({ version: 1, status: "ready" }),
      artifacts: {
        "manual-input-csv": join(directory, "config", "input", "places.csv"),
        "leads-csv": join(output, "leads.csv"),
        "discovery-summary-json": join(output, "discovery-summary.json"),
        "reports-dir": join(output, "reports"),
        "shortlist-csv": join(output, "shortlist.csv"),
        "shortlist-summary-json": join(output, "shortlist-summary.json"),
        "workflow-summary-json": join(output, "workflow-summary.json")
      },
      steps: [
        {
          id: "discovery",
          state: "will-run",
          dependsOn: [],
          inputs: ["manual-input-csv"],
          outputs: ["leads-csv", "discovery-summary-json", "reports-dir"],
          networkAccess: ["website-audits"],
          settings: {
            provider: "manual-csv",
            profile: "generic",
            concurrency: 1,
            maxCandidates: null,
            maxAudits: null
          }
        },
        {
          id: "shortlist",
          state: "will-run",
          dependsOn: ["discovery"],
          inputs: ["leads-csv"],
          outputs: ["shortlist-csv", "shortlist-summary-json"],
          networkAccess: [],
          settings: { top: 20, minOpportunityScore: null, sort: "opportunity-desc" }
        },
        {
          id: "review",
          state: "disabled",
          dependsOn: [],
          inputs: [],
          outputs: [],
          networkAccess: [],
          reason: "Review is not configured",
          settings: { staleBefore: null }
        },
        {
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
          dependsOn: ["shortlist"],
          inputs: [],
          outputs: ["workflow-summary-json"],
          networkAccess: [],
          settings: {}
        }
      ]
    });
  });

  it("builds a sanitized Google plan and omits website audits at a zero audit cap", async () => {
    const apiKey = "workflow-plan-api-key-sentinel";
    const query = "workflow-plan-google-query-sentinel";
    const rawOnly = "workflow-plan-raw-config-sentinel";
    await writeConfig(
      manualConfig({
        discovery: {
          provider: "google-places",
          query,
          profile: "dental",
          concurrency: 3,
          limit: 7,
          maxAudits: 0
        },
        shortlist: { top: 4, minOpportunityScore: 60, sort: "priority-desc" }
      })
    );

    const evaluation = await runWorkflowPreflightEvaluationWithDependencies(configPath, {
      resolveGoogleMapsApiKey: () => apiKey
    });
    if (!evaluation.config) {
      throw new Error("Expected a resolved workflow configuration");
    }
    const resolvedConfig = evaluation.config;
    const evaluationWithRawConfig = { ...evaluation, config: { ...resolvedConfig, rawOnly } };

    const report = await runWorkflowPlanWithDependencies(configPath, {
      evaluatePreflight: async () => evaluationWithRawConfig
    });

    expect(report.artifacts).toEqual({
      "leads-csv": join(directory, "config", "output", "leads.csv"),
      "discovery-summary-json": join(directory, "config", "output", "discovery-summary.json"),
      "reports-dir": join(directory, "config", "output", "reports"),
      "shortlist-csv": join(directory, "config", "output", "shortlist.csv"),
      "shortlist-summary-json": join(directory, "config", "output", "shortlist-summary.json"),
      "workflow-summary-json": join(directory, "config", "output", "workflow-summary.json")
    });
    expect(findStep(report, "discovery")).toEqual({
      id: "discovery",
      state: "will-run",
      dependsOn: [],
      inputs: [],
      outputs: ["leads-csv", "discovery-summary-json", "reports-dir"],
      networkAccess: ["google-places"],
      settings: {
        provider: "google-places",
        profile: "dental",
        concurrency: 3,
        maxCandidates: 7,
        maxAudits: 0
      }
    });
    expect(findStep(report, "shortlist").settings).toEqual({ top: 4, minOpportunityScore: 60, sort: "priority-desc" });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(apiKey);
    expect(serialized).not.toContain(query);
    expect(serialized).not.toContain(rawOnly);
  });

  it("uses the preceding enabled step when review or packaging is disabled", async () => {
    await writeConfig(manualConfig({ review: { csv: "./review.csv" } }));
    await writeManualInput();

    const reviewOnly = await runWorkflowPlan(configPath);

    expect(findStep(reviewOnly, "review").state).toBe("will-run");
    expect(findStep(reviewOnly, "packaging")).toMatchObject({
      state: "disabled",
      dependsOn: [],
      inputs: [],
      outputs: []
    });
    expect(findStep(reviewOnly, "summary").dependsOn).toEqual(["review"]);

    await writeConfig(manualConfig({ packageReports: true }));

    const packagingOnly = await runWorkflowPlan(configPath);

    expect(findStep(packagingOnly, "review")).toMatchObject({
      state: "disabled",
      dependsOn: [],
      inputs: [],
      outputs: []
    });
    expect(findStep(packagingOnly, "packaging")).toMatchObject({
      state: "conditional",
      dependsOn: ["shortlist"],
      inputs: ["shortlist-csv", "reports-dir"],
      outputs: ["packages-dir"]
    });
    expect(findStep(packagingOnly, "summary").dependsOn).toEqual(["packaging"]);
  });

  it("models configured review and report packaging dependencies", async () => {
    await writeConfig(
      manualConfig({ review: { csv: "./review.csv", staleBefore: "2026-01-31" }, packageReports: true })
    );
    await writeManualInput();

    const report = await runWorkflowPlan(configPath);

    expect(report.artifacts).toHaveProperty("review-csv", join(directory, "config", "review.csv"));
    expect(report.artifacts).toHaveProperty("review-summary-json", join(directory, "config", "output", "review-summary.json"));
    expect(report.artifacts).toHaveProperty("packages-dir", join(directory, "config", "output", "packages"));
    expect(findStep(report, "review")).toEqual({
      id: "review",
      state: "will-run",
      dependsOn: ["shortlist"],
      inputs: ["review-csv", "shortlist-csv"],
      outputs: ["review-summary-json"],
      networkAccess: [],
      settings: { staleBefore: "2026-01-31" }
    });
    expect(findStep(report, "packaging")).toEqual({
      id: "packaging",
      state: "conditional",
      dependsOn: ["review"],
      inputs: ["shortlist-csv", "reports-dir"],
      outputs: ["packages-dir"],
      networkAccess: [],
      reason: "Runs for selected leads with successful report artifacts",
      settings: { enabled: true }
    });
    expect(findStep(report, "summary").dependsOn).toEqual(["packaging"]);
  });

  it("retains a derived plan when valid configuration preflight is blocked", async () => {
    await writeConfig(manualConfig());

    const report = await runWorkflowPlan(configPath);

    expect(report.status).toBe("blocked");
    expect(report.preflight.status).toBe("blocked");
    expect(report.steps).toHaveLength(5);
    expect(report.artifacts).toHaveProperty("manual-input-csv", join(directory, "config", "input", "places.csv"));
  });

  it("returns an empty blocked plan when configuration evaluation has no resolved config", async () => {
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, '{ "version": 1,', "utf8");

    await expect(runWorkflowPlan(configPath)).resolves.toEqual({
      version: 1,
      status: "blocked",
      preflight: {
        version: 1,
        status: "blocked",
        checks: [{ id: "configuration", status: "fail", message: "Workflow configuration could not be read or validated" }]
      },
      artifacts: {},
      steps: []
    });
  });

  it("evaluates preflight once and derives the plan from its configuration snapshot", async () => {
    await writeConfig(manualConfig());
    await writeManualInput();
    const evaluation = await runWorkflowPreflightEvaluationWithDependencies(configPath);
    let evaluations = 0;

    const report = await runWorkflowPlanWithDependencies(configPath, {
      evaluatePreflight: async () => {
        evaluations += 1;
        return evaluation;
      }
    });

    expect(evaluations).toBe(1);
    expect(report.status).toBe(evaluation.report.status);
    expect(report.artifacts).toHaveProperty("leads-csv", evaluation.config?.paths.leadsCsv);
  });
});
