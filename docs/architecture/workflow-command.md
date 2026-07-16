# Workflow Command

## Purpose

The `workflow` command runs the existing local lead discovery, shortlist, review summary, and report packaging capabilities from one versioned JSON configuration file.

```bash
open-local-audit workflow --config workflow.json
```

The command is a local orchestrator. It does not send outreach, synchronize CRM records, upload reports, or store Google Places API keys.

## Configuration

The configuration uses a strict, versioned JSON contract. Relative paths are resolved from the configuration file directory.

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

`version`, `outDir`, `discovery`, and `shortlist` are required. `review` and `packageReports` are optional. Unknown fields and invalid values are rejected before output files are created.

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

Running the same configuration again replaces only these managed outputs. It does not delete unrelated files. Existing operator decisions in the configured review CSV remain authoritative and are preserved by the discovery merge behavior.

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

Configuration validation completes before any output is written. A discovery, shortlist, or review summary failure stops dependent stages and returns exit code `1`. Report packages are independent: one package failure does not prevent other selected reports from being packaged, but the final workflow status is `failed` and the command returns exit code `1`.

A selected lead without a successful report path is recorded as `skipped`, not failed.
Package directory names use a deterministic, file-system-safe slug derived from the selected lead identity; raw lead keys are not used as paths.

## Workflow Summary

`workflow-summary.json` is written whenever execution reaches the workflow runner. It contains:

- overall `status`;
- per-stage status and counts;
- generated output paths;
- discovered and selected lead counts;
- package success, skipped, and failure counts;
- sanitized failure messages.

The summary does not include the full configuration, environment variables, API keys, raw Google Places responses, or website response bodies.

## Compatibility

The existing `discover`, `shortlist`, `review`, and `package-report` commands keep their current flags, outputs, and exit behavior. The workflow command is additive and uses configuration contract version `1` so future incompatible configuration changes can be rejected explicitly.

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
