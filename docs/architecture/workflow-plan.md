# Workflow Plan

## Purpose

Workflow plan explains what a version `1` workflow would run, in which order, with which effective settings, and which local artifacts it would read or write. It includes the existing readiness checks without running discovery or changing workflow outputs.

```bash
open-local-audit workflow --config workflow.json --plan
open-local-audit workflow --config workflow.json --plan --format json
```

`--check` answers whether a workflow is ready to run. `--plan` includes that readiness result and adds an explainable execution plan. The two options are mutually exclusive. `--format terminal|json` is accepted with either option and remains invalid for normal workflow execution.

## Goals

- Show the successful-path workflow steps and their dependencies.
- Explain configured, conditional, and disabled steps.
- Show sanitized effective settings and deterministic local artifact paths.
- Identify steps that can call Google Places or audited websites.
- Report configuration-derived work limits without presenting them as predicted usage or currency cost.
- Preserve the existing preflight and workflow execution contracts.

## Non-Goals

Workflow plan does not:

- call Google Places, audited websites, or any other network service;
- create, replace, or delete files or directories;
- parse lead rows to predict actual candidate, shortlist, or package counts;
- estimate Google billing, elapsed time, or report success;
- expose a Google query, API key, environment value, CSV contents, or raw configuration;
- reserve output paths or remove the need for write-time containment checks;
- resume, retry, or execute any workflow step.

## Plan Model

The plan lists these stable step identifiers:

1. `discovery`
2. `shortlist`
3. `review`
4. `packaging`
5. `summary`

Each step has one of these states:

- `will-run`: the step is configured on the normal successful execution path;
- `conditional`: the step is configured but also depends on runtime results;
- `disabled`: the step is not enabled by the configuration.

`will-run` does not guarantee execution after an earlier step fails. Normal workflow fail-fast behavior remains authoritative. Packaging is `conditional` when enabled because only selected leads with successful report artifacts can be packaged. Summary is `will-run` for a valid configuration and represents the managed workflow summary lifecycle.

Dependencies describe ordering, not concurrency:

- discovery has no dependency;
- shortlist depends on discovery;
- enabled review depends on shortlist;
- enabled packaging depends on review when review is enabled, otherwise on shortlist;
- summary depends on the last enabled step.

Disabled steps have no dependencies. Conditional and disabled steps include a human-readable `reason`; consumers use `state`, not `reason`, for automation. Disabled steps remain in the plan so operators can see why they are absent from execution.

## Effective Settings

The plan reports only settings needed to explain execution:

- discovery provider, audit profile, concurrency, candidate limit, and website audit cap;
- shortlist top count, minimum opportunity score, and sort mode;
- review stale-before date when review is configured;
- whether report packaging is enabled.

The Google Places query is intentionally omitted. A missing numeric cap is represented as `null`, meaning the configuration does not set that cap; it does not predict unlimited successful work.

Network access is declared per step with stable values:

- `google-places` for Google Places provider calls;
- `website-audits` for website audit calls;
- an empty list for local-only steps.

Manual CSV discovery does not call a discovery provider, but its discovery step can still perform website audits. A zero website audit cap removes `website-audits` from that step. Plan generation itself never performs either kind of network access.

## Artifact Paths

The plan uses stable artifact identifiers and absolute normalized paths. It can include:

- `manual-input-csv` for the manual discovery input;
- `review-csv` for optional review state;
- `leads-csv` and `discovery-summary-json`;
- `reports-dir` for managed audit reports;
- `shortlist-csv` and `shortlist-summary-json`;
- `review-summary-json` when review is configured;
- `packages-dir` when packaging is enabled;
- `workflow-summary-json`.

Step inputs and outputs refer to artifact identifiers instead of repeating paths. The plan does not inspect or include artifact contents.

Artifact inputs and outputs follow the runtime data flow:

- Discovery reads `manual-input-csv` for manual discovery and reads `review-csv` whenever review is configured. When review is configured, discovery also rewrites `review-csv`; discovery always writes `leads-csv`, `discovery-summary-json`, and `reports-dir`.
- Shortlist always reads `leads-csv` and also reads `review-csv` when configured; it writes `shortlist-csv` and `shortlist-summary-json`.
- Review reads only `review-csv` and writes `review-summary-json`.
- Packaging reads report files through `reports-dir`; it uses the in-memory shortlist result and does not read `shortlist-csv`.

## Result Contract

The plan report is versioned independently from the workflow configuration and preflight report:

```json
{
  "version": 1,
  "status": "ready",
  "preflight": {
    "version": 1,
    "status": "ready",
    "checks": []
  },
  "artifacts": {
    "leads-csv": "C:/work/workflow-output/leads.csv",
    "workflow-summary-json": "C:/work/workflow-output/workflow-summary.json"
  },
  "steps": [
    {
      "id": "discovery",
      "state": "will-run",
      "dependsOn": [],
      "inputs": ["manual-input-csv"],
      "outputs": ["leads-csv", "discovery-summary-json", "reports-dir"],
      "networkAccess": ["website-audits"],
      "settings": {
        "provider": "manual-csv",
        "profile": "dental",
        "concurrency": 2,
        "maxCandidates": null,
        "maxAudits": 10
      }
    }
  ]
}
```

The top-level status matches the included preflight status:

- `ready` exits `0`, including when preflight contains warnings;
- `blocked` exits `1`.

For a readable and valid configuration, the plan is produced even when an operational preflight check is blocked, such as a missing API key or input file. If the configuration cannot be read or validated, `artifacts` is empty and `steps` is empty because no trustworthy execution plan can be derived.

Step identifiers, states, artifact identifiers, network-access values, and JSON property meanings are stable within plan report version `1`. Human-readable readiness messages are not a machine-readable policy interface.

Step settings use an object specific to the step identifier. Discovery has `provider`, `profile`, `concurrency`, `maxCandidates`, and `maxAudits`; shortlist has `top`, `minOpportunityScore`, and `sort`; review has `staleBefore`; packaging has `enabled`; summary has an empty settings object. Optional numeric and date settings use `null` rather than being omitted.

## Terminal Output

Terminal output is the default and presents readiness before execution details:

```text
Workflow plan: READY
Config: workflow.json
Provider: manual-csv

Readiness:
PASS  Workflow configuration is valid
PASS  Discovery input is readable
PASS  Output location is writable

Execution plan:
1. discovery [WILL RUN]
   Network: website audits (up to 10)
   Outputs: leads-csv, discovery-summary-json, reports-dir

2. shortlist [WILL RUN]

3. review [DISABLED]

4. packaging [DISABLED]

5. summary [WILL RUN]
```

A blocked terminal plan writes the complete report to standard output and the concise `open-local-audit: workflow plan blocked` summary to standard error. JSON mode writes exactly one JSON document to standard output for ready and blocked reports and writes no expected readiness text to standard error.

## Components

- A workflow planner builds the versioned plan from one resolved configuration snapshot.
- Existing preflight check orchestration is reused against that same snapshot so plan and readiness data cannot disagree because the configuration changed between reads.
- Terminal and JSON renderers format an existing plan without reading configuration or performing checks.
- The CLI selects execution, preflight, or plan mode and enforces option compatibility.

The package root exports:

- `runWorkflowPlan(configPath)`;
- `renderWorkflowPlanTerminal(report, configPath)`;
- `renderWorkflowPlanJson(report)`;
- only the public types required to consume the version `1` plan report.

Dependency injection helpers, resolved configuration types, and workflow path internals remain outside the package root API.

## Failure Handling

Expected configuration and filesystem readiness failures use the existing sanitized preflight checks. Operationally blocked plans still include execution details when the configuration is valid. Unexpected programming errors continue to propagate through the existing CLI error policy.

No terminal output, JSON output, or thrown expected-readiness error may include API keys, environment values, Google queries, CSV contents, raw configuration, or filesystem error stacks.

Filesystem readiness is advisory. Normal workflow execution continues to validate and safely replace managed outputs at write time.

## Compatibility

Normal `workflow --config <path>` execution is unchanged. The existing `--check` terminal output, JSON report version `1`, public API, and exit behavior remain unchanged. `--plan` is additive and composes preflight rather than expanding the preflight result contract.

Future additive plan fields may be introduced without changing report version `1`. Removing or changing the meaning of a stable identifier, state, or field requires a new plan report version.

## Acceptance Tests

- Manual CSV and Google Places configurations produce deterministic successful-path plans.
- Review and packaging appear as `disabled`, `conditional`, or `will-run` steps as defined above.
- Step dependencies and conditional or disabled reasons follow the plan model.
- Step dependencies, inputs, outputs, settings, and network declarations match the resolved configuration.
- Relative artifact paths resolve from the configuration directory.
- Missing input, API key, or output access blocks readiness while retaining a valid execution plan.
- Invalid or unreadable configuration produces a blocked report with empty artifacts and steps.
- Plan generation makes no network calls and creates or modifies no files or directories.
- Terminal and JSON outputs exclude API keys, Google queries, environment values, and raw config contents.
- JSON output is exactly one parseable document for ready and blocked plans.
- `--check` and `--plan` together are rejected; `--format` without either option remains rejected.
- Existing workflow execution and preflight behavior remain covered by regression tests.
- The packed npm consumer can import the public plan API and includes this architecture document.
- The release passes lint, build, tests, dependency audit, package dry run, and fresh consumer installation.
