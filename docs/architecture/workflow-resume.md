# Workflow Resume

## Purpose

`workflow --resume` continues an interrupted workflow from its last verified
stage boundary. It avoids repeating completed discovery and audit work while
refusing to reuse stale or modified managed outputs.

```bash
open-local-audit workflow --config workflow.json --resume
```

Resume is explicit. A normal workflow run keeps the existing full-run behavior.

## Checkpoint

The workflow writes `workflow-checkpoint.json` after each successful stage. The
versioned checkpoint contains:

- a fingerprint of the validated effective workflow configuration;
- the last completed stage and its summary state;
- integrity records for managed files required by later stages;
- the selected lead snapshot required to resume report packaging.

The checkpoint does not contain environment variables, API keys, raw Google
Places responses, or website response bodies. It is replaced atomically.

## Validation

Before a resumed workflow invokes any stage, it validates:

- the checkpoint structure and version;
- the effective configuration fingerprint;
- the expected managed paths derived from the current configuration;
- the presence, containment, file type, and integrity of required artifacts.

Checkpoint paths are never trusted as authority. Missing, changed, symlinked,
or escaping artifacts block resume with exit code `1` before network calls or
stage execution.

Configuration formatting and JSON key order do not affect the fingerprint.
Semantic configuration changes do. Changes to source files after their
dependent stage completed do not invalidate that completed stage; resume uses
the verified managed outputs captured at the stage boundary.

## Recovery

Resume starts with the first incomplete stage:

1. A completed discovery stage reuses its verified leads and reports.
2. A completed shortlist stage reuses its verified selected lead snapshot.
3. A completed review stage reuses its verified summary.
4. An incomplete or failed packaging stage reruns packaging for every selected
   lead and resets package counters.
5. A fully completed workflow returns success without invoking a stage.

Google API key resolution is deferred until discovery actually runs. Existing
failure summaries remain operator-facing; the checkpoint remains the source of
resume state.

## Compatibility

`--resume` cannot be combined with `--check`, `--plan`, or `--format`. Existing
workflow configuration, summary, preflight, plan, and execution contracts keep
their current behavior. Concurrent workflows sharing one `outDir` remain
unsupported.
