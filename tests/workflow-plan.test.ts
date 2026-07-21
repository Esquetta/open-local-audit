import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runWorkflowPreflightEvaluationWithDependencies } from "../src/workflow-preflight.js";
import {
  renderWorkflowPlanJson,
  renderWorkflowPlanTerminal,
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

  it("orders Google Places and website audit network access when audits are enabled", async () => {
    await writeConfig(
      manualConfig({
        discovery: { provider: "google-places", query: "dentist Kadikoy", maxAudits: 2 }
      })
    );

    const report = await runWorkflowPlan(configPath);

    expect(findStep(report, "discovery").networkAccess).toEqual(["google-places", "website-audits"]);
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
      inputs: ["reports-dir"],
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
    expect(findStep(report, "discovery")).toMatchObject({
      inputs: ["manual-input-csv", "review-csv"],
      outputs: ["leads-csv", "discovery-summary-json", "reports-dir", "review-csv"]
    });
    expect(findStep(report, "shortlist")).toMatchObject({
      inputs: ["leads-csv", "review-csv"]
    });
    expect(findStep(report, "review")).toEqual({
      id: "review",
      state: "will-run",
      dependsOn: ["shortlist"],
      inputs: ["review-csv"],
      outputs: ["review-summary-json"],
      networkAccess: [],
      settings: { staleBefore: "2026-01-31" }
    });
    expect(findStep(report, "packaging")).toEqual({
      id: "packaging",
      state: "conditional",
      dependsOn: ["review"],
      inputs: ["reports-dir"],
      outputs: ["packages-dir"],
      networkAccess: [],
      reason: "Runs for selected leads with successful report artifacts",
      settings: { enabled: true }
    });
    expect(findStep(report, "summary").dependsOn).toEqual(["packaging"]);
  });

  it("does not create configured output artifacts while planning", async () => {
    await writeConfig(manualConfig());
    await writeManualInput();
    const outputPath = join(directory, "config", "output");

    await runWorkflowPlan(configPath);

    expect(existsSync(outputPath)).toBe(false);
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

  it("renders a ready manual plan with readiness, execution, and artifacts", async () => {
    const secret = "workflow-plan-renderer-api-key-sentinel";
    const rawConfig = "workflow-plan-renderer-raw-config-sentinel";
    await writeConfig(manualConfig());
    await writeManualInput();
    const report = await runWorkflowPlan(configPath);
    const before = structuredClone(report);

    const rendered = renderWorkflowPlanTerminal(report, "display/workflow.json");
    const json = renderWorkflowPlanJson(report);
    const reorderedReport = {
      ...report,
      artifacts: Object.fromEntries(Object.entries(report.artifacts).reverse()) as WorkflowPlanReport["artifacts"]
    };
    const reorderedRendered = renderWorkflowPlanTerminal(reorderedReport, "display/workflow.json");

    expect(rendered).toContain("Workflow plan: READY");
    expect(rendered).toContain("Config: display/workflow.json");
    expect(rendered).toContain("Provider: manual-csv");
    expect(rendered).toContain("Readiness:");
    expect(rendered).toContain("PASS  Workflow configuration is valid");
    expect(rendered).toContain("Execution plan:");
    expect(rendered).toContain("1. discovery [WILL RUN]");
    expect(rendered).toContain("Network: website audits (no configured cap)");
    expect(rendered).toContain("Outputs: leads-csv, discovery-summary-json, reports-dir");
    expect(rendered).toContain("Artifacts:");
    expect(rendered).toContain(`manual-input-csv: ${join(directory, "config", "input", "places.csv")}`);
    expect(reorderedRendered.indexOf("- manual-input-csv:")).toBeLessThan(reorderedRendered.indexOf("- leads-csv:"));
    expect(rendered).not.toContain(secret);
    expect(rendered).not.toContain(rawConfig);
    expect(json).not.toContain(secret);
    expect(json).not.toContain(rawConfig);
    expect(rendered.endsWith("\n")).toBe(true);
    expect(rendered.endsWith("\n\n")).toBe(false);
    expect(report).toEqual(before);
  });

  it("renders Google Places and website audit capabilities in model order", async () => {
    const apiKey = "workflow-plan-google-renderer-api-key-sentinel";
    const query = "workflow-plan-google-renderer-query-sentinel";
    const rawConfig = "workflow-plan-google-renderer-raw-config-sentinel";
    const stackDetails = "workflow-plan-google-renderer-stack-sentinel";
    await writeConfig(manualConfig({ discovery: { provider: "google-places", query, maxAudits: 10 } }));
    const evaluation = await runWorkflowPreflightEvaluationWithDependencies(configPath, {
      resolveGoogleMapsApiKey: () => apiKey
    });
    if (!evaluation.config) {
      throw new Error("Expected a resolved workflow configuration");
    }
    const resolvedConfig = evaluation.config;
    const evaluationWithRawConfig = { ...evaluation, config: { ...resolvedConfig, rawConfig } };
    const report = await runWorkflowPlanWithDependencies(configPath, {
      evaluatePreflight: async () => evaluationWithRawConfig
    });

    const rendered = renderWorkflowPlanTerminal(report, configPath);
    const json = renderWorkflowPlanJson(report);

    expect(rendered).toContain("Network: Google Places, website audits (up to 10)");
    expect(rendered.indexOf("Google Places")).toBeLessThan(rendered.indexOf("website audits (up to 10)"));
    expect(`${rendered}${json}`).not.toContain(apiKey);
    expect(`${rendered}${json}`).not.toContain(query);
    expect(`${rendered}${json}`).not.toContain(rawConfig);
    expect(`${rendered}${json}`).not.toContain(stackDetails);
  });

  it("renders no configured audit cap for website audit access", async () => {
    await writeConfig(manualConfig());
    await writeManualInput();

    const rendered = renderWorkflowPlanTerminal(await runWorkflowPlan(configPath), configPath);

    expect(rendered).toContain("website audits (no configured cap)");
  });

  it("does not render website audits for a generated zero-cap plan", async () => {
    await writeConfig(
      manualConfig({ discovery: { provider: "manual-csv", input: "./input/places.csv", maxAudits: 0 } })
    );
    await writeManualInput();

    const rendered = renderWorkflowPlanTerminal(await runWorkflowPlan(configPath), configPath);

    expect(rendered).not.toContain("website audits");
  });

  it("renders explicitly declared zero-cap website audit access", async () => {
    await writeConfig(
      manualConfig({ discovery: { provider: "manual-csv", input: "./input/places.csv", maxAudits: 0 } })
    );
    await writeManualInput();
    const report = await runWorkflowPlan(configPath);
    const declaredReport = structuredClone(report);
    findStep(declaredReport, "discovery").networkAccess = ["website-audits"];

    const rendered = renderWorkflowPlanTerminal(declaredReport, configPath);

    expect(rendered).toContain("Network: website audits (up to 0)");
  });

  it("renders reasons for conditional and disabled steps", async () => {
    await writeConfig(manualConfig({ packageReports: true }));
    await writeManualInput();

    const rendered = renderWorkflowPlanTerminal(await runWorkflowPlan(configPath), configPath);

    expect(rendered).toContain("3. review [DISABLED]");
    expect(rendered).toContain("Reason: Review is not configured");
    expect(rendered).toContain("4. packaging [CONDITIONAL]");
    expect(rendered).toContain("Reason: Runs for selected leads with successful report artifacts");
  });

  it("retains execution details in a blocked plan with valid configuration", async () => {
    await writeConfig(manualConfig());

    const rendered = renderWorkflowPlanTerminal(await runWorkflowPlan(configPath), configPath);

    expect(rendered).toContain("Workflow plan: BLOCKED");
    expect(rendered).toContain("Execution plan:");
    expect(rendered).toContain("1. discovery [WILL RUN]");
    expect(rendered).toContain("Artifacts:");
  });

  it("renders an invalid blocked configuration without an execution plan", async () => {
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, '{ "version": 1,', "utf8");

    const rendered = renderWorkflowPlanTerminal(await runWorkflowPlan(configPath), configPath);

    expect(rendered).toContain("Workflow plan: BLOCKED");
    expect(rendered).toContain("No execution plan is available");
    expect(rendered).not.toContain("Artifacts:");
  });

  it("renders ready and blocked plans as pretty JSON without mutation", async () => {
    await writeConfig(manualConfig());
    await writeManualInput();
    const ready = await runWorkflowPlan(configPath);
    const blocked: WorkflowPlanReport = {
      version: 1,
      status: "blocked",
      preflight: {
        version: 1,
        status: "blocked",
        checks: [{ id: "configuration", status: "fail", message: "Workflow configuration could not be read or validated" }]
      },
      artifacts: {},
      steps: []
    };
    const readyBefore = structuredClone(ready);
    const blockedBefore = structuredClone(blocked);

    const readyJson = renderWorkflowPlanJson(ready);
    const blockedJson = renderWorkflowPlanJson(blocked);

    expect(JSON.parse(readyJson)).toEqual(ready);
    expect(JSON.parse(blockedJson)).toEqual(blocked);
    expect(readyJson).toBe(`${JSON.stringify(ready, null, 2)}\n`);
    expect(blockedJson).toBe(`${JSON.stringify(blocked, null, 2)}\n`);
    expect(ready).toEqual(readyBefore);
    expect(blocked).toEqual(blockedBefore);
  });
});
