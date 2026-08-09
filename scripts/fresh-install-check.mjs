import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const npm = process.env.npm_execpath ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
const npmArgsPrefix = process.env.npm_execpath ? [process.env.npm_execpath] : [];
const shell = !process.env.npm_execpath && process.platform === "win32";
const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const tempRoot = mkdtempSync(join(tmpdir(), "open-local-audit-release-"));
const cacheDir = join(tempRoot, "npm-cache");
const consumerDir = join(tempRoot, "consumer");

function run(args, options = {}) {
  return execFileSync(npm, [...npmArgsPrefix, ...args], {
    cwd: options.cwd ?? root,
    encoding: options.encoding ?? "utf8",
    shell,
    stdio: options.stdio ?? "pipe"
  });
}

try {
  const packOutput = JSON.parse(run(["pack", "--json", "--pack-destination", tempRoot]));
  const packResult = Array.isArray(packOutput) ? packOutput[0] : packOutput[pkg.name];
  const tarball = join(tempRoot, packResult.filename);

  mkdirSync(consumerDir);
  writeFileSync(join(consumerDir, "package.json"), JSON.stringify({ private: true }, null, 2));
  run(["install", tarball, "--cache", cacheDir, "--prefer-online"], { cwd: consumerDir, stdio: "inherit" });
  run(["ls", `${pkg.name}@${pkg.version}`, "--depth=0"], { cwd: consumerDir, stdio: "inherit" });
  run(["audit", "--omit=dev", "--cache", cacheDir], { cwd: consumerDir, stdio: "inherit" });
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `const { existsSync, writeFileSync } = await import("node:fs");\nconst { join } = await import("node:path");\nconst api = await import(${JSON.stringify(pkg.name)});\nfor (const name of ["runWorkflowPreflight", "renderWorkflowPreflightTerminal", "renderWorkflowPreflightJson", "runWorkflowPlan", "renderWorkflowPlanTerminal", "renderWorkflowPlanJson", "runWorkflowStatus", "renderWorkflowStatusTerminal", "renderWorkflowStatusJson"]) {\n  if (typeof api[name] !== "function") throw new Error(\`Expected package export \${name} to be a function\`);\n}\nconst configPath = join(process.cwd(), "workflow-status.json");\nconst outDir = join(process.cwd(), "workflow-status-output");\nwriteFileSync(configPath, JSON.stringify({ version: 1, outDir: "./workflow-status-output", discovery: { provider: "manual-csv", input: "./places.csv" }, shortlist: {} }));\nconst report = await api.runWorkflowStatus(configPath);\nif (report.status !== "not-started") throw new Error(\`Expected not-started workflow status, received \${report.status}\`);\nif (existsSync(outDir)) throw new Error("Workflow status created the output directory");`
    ],
    { cwd: consumerDir, encoding: "utf8" }
  );
  writeFileSync(
    join(consumerDir, "consumer-check.ts"),
    `import {\n  renderWorkflowPlanJson,\n  renderWorkflowPlanTerminal,\n  renderWorkflowStatusJson,\n  renderWorkflowStatusTerminal,\n  runWorkflowPlan,\n  runWorkflowStatus\n} from ${JSON.stringify(pkg.name)};\nimport type {\n  WorkflowArtifactValidation,\n  WorkflowPlanArtifactId,\n  WorkflowPlanNetworkAccess,\n  WorkflowPlanReport,\n  WorkflowPlanStatus,\n  WorkflowPlanStep,\n  WorkflowPlanStepId,\n  WorkflowPlanStepState,\n  WorkflowStatusNextAction,\n  WorkflowStatusNextActionKind,\n  WorkflowStatusReport,\n  WorkflowStatusReportStatus\n} from ${JSON.stringify(pkg.name)};\n\nconst artifactId: WorkflowPlanArtifactId = "leads-csv";\nconst networkAccess: WorkflowPlanNetworkAccess = "website-audits";\nconst status: WorkflowPlanStatus = "ready";\nconst stepId: WorkflowPlanStepId = "discovery";\nconst stepState: WorkflowPlanStepState = "will-run";\nconst step: WorkflowPlanStep = {\n  id: stepId,\n  state: stepState,\n  dependsOn: [],\n  inputs: [],\n  outputs: [artifactId],\n  networkAccess: [networkAccess],\n  settings: {\n    provider: "manual-csv",\n    profile: "dental",\n    concurrency: 1,\n    maxCandidates: null,\n    maxAudits: null\n  }\n};\nconst report: WorkflowPlanReport = {\n  version: 1,\n  status,\n  preflight: { version: 1, status, checks: [], stages: [] },\n  artifacts: { [artifactId]: "C:/work/leads.csv" },\n  steps: [step]\n};\nconst statusValue: WorkflowStatusReportStatus = "not-started";\nconst artifactValidation: WorkflowArtifactValidation = "not-applicable";\nconst nextActionKind: WorkflowStatusNextActionKind = "run";\nconst nextAction: WorkflowStatusNextAction = { kind: nextActionKind, argv: ["workflow", "--config", "workflow.json"], message: "Run the workflow from the beginning." };\nconst statusReport: WorkflowStatusReport = {\n  version: 1,\n  status: statusValue,\n  currentStage: null,\n  lastSuccessfulStage: null,\n  resumeAvailable: false,\n  updatedAt: null,\n  stages: { discovery: { status: "not-run" }, shortlist: { status: "not-run" }, review: { status: "skipped" }, packaging: { status: "skipped" } },\n  artifactValidation,\n  nextAction,\n  error: null\n};\n\nvoid renderWorkflowPlanTerminal(report, "workflow.json");\nvoid renderWorkflowPlanJson(report);\nvoid runWorkflowPlan("workflow.json");\nvoid renderWorkflowStatusTerminal(statusReport, "workflow.json");\nvoid renderWorkflowStatusJson(statusReport);\nvoid runWorkflowStatus("workflow.json");\n`
  );
  execFileSync(
    process.execPath,
    [
      join(root, "node_modules", "typescript", "bin", "tsc"),
      "--noEmit",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ES2022",
      "--strict",
      "consumer-check.ts"
    ],
    { cwd: consumerDir, encoding: "utf8" }
  );
  for (const documentationPath of [
    "docs/architecture/workflow-command.md",
    "docs/architecture/workflow-preflight.md",
    "docs/architecture/workflow-plan.md",
    "docs/architecture/workflow-status.md"
  ]) {
    readFileSync(join(consumerDir, "node_modules", pkg.name, documentationPath), "utf8");
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
