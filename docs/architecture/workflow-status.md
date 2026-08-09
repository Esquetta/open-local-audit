# Workflow Status

## Purpose

`workflow --status` reports the latest persisted state of one configured
workflow without running a stage or changing local state.

```bash
open-local-audit workflow --config workflow.json --status
open-local-audit workflow --config workflow.json --status --format json
```

Status is read-only. It makes no network calls, resolves no API keys, creates
no directories, and writes no files. It reports persisted state; it does not
claim that a process recorded as running is still alive.

## Current-state manifest

A normal workflow run writes `workflow-state.json` below the configured
`outDir`. The versioned manifest contains:

- a fingerprint of the validated effective workflow configuration;
- the persisted lifecycle phase and current stage;
- the existing workflow stage summary;
- start and last-update timestamps;
- a sanitized failure description when execution fails.

The manifest does not contain environment variables, API keys, Google Places
queries, raw provider responses, or website response bodies. It is replaced
atomically through the existing guarded workflow output writer.

The initial manifest is persisted before the first workflow stage or network
call. Each stage start updates the current stage. After a stage succeeds, its
checkpoint is persisted before the manifest records the successful transition.
A controlled failure records `failed`; successful completion records
`completed`. An abrupt process exit leaves the last persisted running state.

Failure to persist the initial manifest prevents stage execution. Failure to
persist a later transition stops the workflow before another stage begins and
does not discard the last verified checkpoint. The workflow must never report
completion when the completed state could not be persisted.

## Status report

Terminal and JSON output are rendered from the same versioned
`WorkflowStatusReport`. The report status is one of:

- `not-started`: no state or checkpoint exists for the configuration;
- `running-or-interrupted`: execution last persisted a running state, but
  process liveness is unknown;
- `failed`: execution persisted a controlled failure;
- `completed`: every enabled stage completed successfully;
- `invalid`: state, configuration identity, checkpoint, or required managed
  artifacts cannot be trusted.

The report includes the current stage, last successful stage, stage summaries,
last update time, artifact validation result, resume availability, and a
structured next action. JSON commands use an argument array instead of a shell
string so callers do not need to parse quoting.

`resumeAvailable` is true only when the report is not completed and the current
configuration has a valid checkpoint with the managed artifacts required by
resume. A `running-or-interrupted` report warns the operator to confirm that no
workflow process is still active before using `--resume`. An `invalid` report
never recommends automatic resume.

## Validation and compatibility

Status validates:

- the state structure and version;
- the effective configuration fingerprint;
- the existing checkpoint structure and version when resume state is present;
- the expected managed paths and required artifact integrity.

`workflow-state.json` is not added to `WorkflowManagedPaths` or the existing
checkpoint output map. The v1 checkpoint and `workflow-summary.json` contracts
remain unchanged, so checkpoints written by v0.65 and v0.66 remain valid for
`--resume`.

When no state manifest exists but a valid legacy checkpoint does, status derives
a conservative report from the checkpoint. A fully completed checkpoint reports
`completed`; any incomplete checkpoint reports `running-or-interrupted` and may
offer resume after normal checkpoint validation. A malformed or mismatched
legacy checkpoint reports `invalid`. This fallback does not rewrite or migrate
the old files.

## CLI and exit behavior

`--status`, `--check`, `--plan`, and `--resume` are mutually exclusive.
`--format terminal|json` is accepted with `--status`, `--check`, or `--plan`.
Supplying `--format` for normal execution or resume remains invalid.

`completed`, `not-started`, and `running-or-interrupted` return exit code `0`.
`failed`, `invalid`, invalid configuration, and invalid CLI usage return exit
code `1`. JSON mode writes exactly one report object to standard output; usage
and configuration errors retain the existing standard-error behavior.

Recommended next actions are:

1. `not-started`: run the workflow normally.
2. `failed` with a valid checkpoint: run with `--resume`.
3. `failed` without a checkpoint: run the workflow normally.
4. `running-or-interrupted`: first confirm that no workflow process is active,
   then use `--resume` only when the report marks it available.
5. `completed`: no action.
6. `invalid`: inspect or replace the untrusted local state; do not resume it.

## Verification contract

Automated coverage must prove:

- every manifest lifecycle transition and atomic replacement behavior;
- not-started, completed, controlled-failure, and interrupted status reports;
- configuration fingerprint mismatch and managed-artifact modification;
- resume availability with valid, missing, and invalid checkpoints;
- v0.65 and v0.66 checkpoint compatibility;
- CLI option conflicts, terminal and JSON rendering, and exit codes;
- no writes, directory creation, network calls, or secret resolution during
  status inspection.
