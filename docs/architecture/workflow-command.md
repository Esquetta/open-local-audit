# Workflow Command

## Purpose

The `workflow` command runs the existing local lead discovery, shortlist, review summary, and report packaging capabilities from one versioned JSON configuration file. It writes local artifacts; it does not send outreach, synchronize CRM records, or upload reports. A Google Places discovery run is the exception to local processing: it calls the configured Google service through the existing provider.

```bash
open-local-audit workflow --config workflow.json
```

The command does not store Google Places API keys. The Google provider resolves its key through the existing key resolver at runtime.

## Configuration

The configuration uses a strict JSON contract. Only version `1` is accepted. Relative `outDir`, manual CSV `input`, and optional review `csv` paths are resolved from the configuration file directory.

```json
{
  "version": 1,
  "outDir": "./workflow-output",
  "discovery": {
    "provider": "manual-csv",
    "input": "./places.csv",
    "profile": "dental",
    "concurrency": 2,
    "maxAudits": 10
  },
  "shortlist": {
    "top": 10,
    "minOpportunityScore": 70,
    "sort": "opportunity-desc"
  },
  "review": {
    "csv": "./review.csv",
    "staleBefore": "2026-07-01"
  },
  "packageReports": true
}
```

`version`, `outDir`, `discovery`, and `shortlist` are required. `review` and `packageReports` are optional. Unknown fields and invalid values are rejected before output files are created. `manual-csv` discovery requires `input`; `google-places` discovery requires `query` and resolves `GOOGLE_MAPS_API_KEY` only for that provider.

The discovery object accepts either the existing `manual-csv` input or the existing `google-places` provider and its query. Google Places workflows continue to require `GOOGLE_MAPS_API_KEY`, display the billing warning, and use the existing candidate and audit limits.

## Managed Outputs

The command writes predictable paths below `outDir`:

- `leads.csv`
- `discovery-summary.json`
- `shortlist.csv`
- `shortlist-summary.json`
- `review-summary.json` when review configuration is present
- `packages/<safe-lead-slug>/` for selected leads with successful report artifacts when packaging is enabled
- `workflow-summary.json`

The same configuration resolves to the same managed output paths, so rerun destinations are deterministic. Reruns replace only those managed outputs and do not delete unrelated files. Existing operator decisions in the configured review CSV remain authoritative and are preserved by the discovery merge behavior.

## Execution Model

The workflow runs these dependent stages in order:

```text
discovery
  -> shortlist
  -> review summary (optional)
  -> selected report packages (optional)
  -> workflow summary
```

The implementation reuses the same application services as the individual CLI commands. It does not duplicate discovery, ranking, review, or packaging rules.

Configuration validation completes before any output is written and returns exit code `1` when invalid. A discovery, shortlist, or review summary failure stops dependent stages and returns exit code `1`. Report packages are independent: one package failure does not prevent other selected reports from being packaged, but the final workflow status is `failed` and the command returns exit code `1`.

A selected lead without a successful report path is recorded as `skipped`, not failed.
Package directory names use a deterministic, file-system-safe slug derived from the selected lead identity; raw lead keys are not used as paths.

## Workflow Summary

`workflow-summary.json` is written after configuration has been validated, the output directory has been prepared, and execution reaches a managed workflow stage. It contains:

- overall `status`;
- per-stage status and counts;
- generated output paths;
- discovered and selected lead counts;
- package success, skipped, and failure counts;
- sanitized failure messages.

The summary does not include the full configuration, environment variables, API keys, raw Google Places responses, or website response bodies.

## Compatibility

The existing `discover`, `shortlist`, `review`, and `package-report` commands keep their current flags, outputs, and exit behavior. The workflow command is additive and uses configuration contract version `1` so future incompatible configuration changes can be rejected explicitly. `workflow --check` is also additive: it preflights the same configuration without changing normal workflow execution. Its read-only behavior, exit semantics, and versioned report contract are defined in the [workflow preflight contract](./workflow-preflight.md). `workflow --plan` is likewise additive and does not change normal workflow execution; its execution-plan contract is defined in the [workflow plan contract](./workflow-plan.md).

## Verification

Coverage for this command includes:

- strict configuration validation and unknown-field rejection;
- configuration-relative path resolution;
- a successful manual CSV workflow using local fixtures;
- fail-fast behavior for discovery, shortlist, and review summary failures;
- partial package failure reporting and exit behavior;
- review decision preservation across repeated runs;
- CLI help and invalid-configuration errors;
- the full release gate, including build, dependency audit, package dry run, and clean consumer installation.
