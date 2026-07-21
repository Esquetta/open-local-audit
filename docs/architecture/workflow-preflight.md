# Workflow Preflight

## Purpose

Workflow preflight validates whether a version `1` workflow configuration is operationally ready without running discovery, calling external APIs, or creating or modifying workflow outputs.

```bash
open-local-audit workflow --config workflow.json --check
open-local-audit workflow --config workflow.json --check --format json
```

The existing `workflow --config <path>` execution behavior remains unchanged. `--format` is accepted with `--check` or `--plan` and remains invalid for normal workflow execution.

## Goals

- Validate the strict workflow configuration before execution.
- Check local inputs, optional review state, API key availability, output writability, and managed-path safety.
- Show the stages and managed outputs that a real workflow would use.
- Produce stable terminal and JSON results for operators and CI jobs.
- Keep preflight read-only and prevent secrets from appearing in output.

## Non-Goals

Preflight does not:

- call Google Places or any audited website;
- create output directories or probe writability by creating temporary files;
- run discovery, shortlist, review, or packaging stages;
- estimate currency costs or promise external API availability;
- send outreach, upload reports, or synchronize CRM records.

## Checks

The preflight service performs these checks in order:

1. Read and validate the strict version `1` JSON configuration.
2. For `manual-csv`, require the discovery input to exist as a readable regular file.
3. For `google-places`, require the existing Google Maps API key resolver to return a nonblank value without exposing it or making a network request.
4. When a review CSV is configured, verify it is a readable regular file when present. A missing review CSV is a warning because the workflow may create it.
5. Find the nearest existing ancestor for `outDir` and verify that it is a directory with write access.
6. Inspect existing `outDir`, `reports/`, enabled `packages/`, and config-managed output files. Reject linked managed paths and canonical directories that escape `outDir`.
7. Report the enabled workflow stages, configured limits, and resolved managed output paths.

Filesystem access checks are advisory and can become stale before execution. The workflow retains its existing write-time containment checks as the authoritative enforcement boundary.

## Result Contract

`workflow --plan` includes a preflight result alongside an execution plan; its additive contract is defined in the [workflow plan contract](./workflow-plan.md). The version `1` preflight report remains unchanged.

The preflight report is versioned independently from the workflow configuration:

```json
{
  "version": 1,
  "status": "ready",
  "checks": [
    {
      "id": "configuration",
      "status": "pass",
      "message": "Workflow configuration is valid"
    }
  ],
  "stages": ["discovery", "shortlist"],
  "outputs": {
    "outDir": "C:/work/workflow-output",
    "workflowSummaryJson": "C:/work/workflow-output/workflow-summary.json"
  },
  "limits": {
    "maxCandidates": null,
    "maxAudits": 10
  }
}
```

The report uses:

- `ready` when no check failed; warnings are allowed and the command exits `0`;
- `blocked` when one or more checks failed; the command exits `1`;
- `pass`, `warn`, or `fail` for individual checks.

Check identifiers are stable machine-readable strings. Messages are human-readable and must not contain API keys, environment values, or raw configuration contents.

`maxCandidates` is the configured Google Places candidate limit and is `null` for manual CSV. `maxAudits` is the configured audit cap and is `null` when no cap is configured. These values describe limits, not predicted usage or cost.

## Terminal Output

Terminal output is the default and is written to standard output:

```text
Workflow preflight: READY
Config: workflow.json
Provider: manual-csv

PASS  Workflow configuration is valid
PASS  Discovery input is readable
PASS  Output location is writable
WARN  Review CSV does not exist and will be created

Stages: discovery -> shortlist -> review
Managed output: ./workflow-output
```

For a blocked terminal preflight, the full report remains on standard output and the CLI writes its existing concise `open-local-audit:` error summary to standard error.

With `--format json`, standard output contains exactly one JSON document for both ready and blocked results. The exit code remains authoritative; no additional human-readable text is written to standard output.

## Components

- `workflow-preflight.ts` owns check orchestration and the versioned result type.
- Small shared workflow path and output modules own no-write inspection, write-time managed-directory preparation, and same-directory temporary-file replacement for managed outputs.
- Terminal and JSON renderers convert a preflight result without performing checks.
- `cli.ts` selects normal execution or preflight while preserving the existing error prefix and exit behavior.

## Failure Handling

Configuration read and validation errors are converted into a blocked preflight report. Independent checks continue where their prerequisites are available so one invocation can report all actionable local problems. Checks that depend on an invalid configuration are omitted rather than reported as additional failures.

Expected operational filesystem errors are sanitized and represented as failed checks; unexpected programming errors still propagate. The command must never include a resolved API key in thrown errors, terminal output, or JSON output.

## Acceptance Tests

- A valid manual CSV configuration is ready, exits `0`, and creates no files or directories.
- Missing, unreadable, or non-file manual input blocks execution.
- Google API key presence passes without a network request; a missing key blocks execution.
- A missing review CSV produces a warning, while an unreadable or non-file review path fails.
- A missing output tree passes when its nearest existing ancestor is writable.
- An unwritable output ancestor blocks execution without creating a probe file.
- Linked or canonically escaping managed directories, and linked managed output files, block execution.
- Terminal and JSON outputs contain no API key or raw environment value.
- JSON output is one parseable document for ready and blocked results.
- `--format` without `--check` is rejected.
- Existing workflow execution and failure behavior remains covered by regression tests.
- The release passes the full release check, package audit, and fresh consumer installation check.
