import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { runBatchReports } from "./batch.js";
import {
  buildDiscoverySummary,
  buildProspectRows,
  fetchGooglePlacesCandidates,
  filterSuppressedProspects,
  findDuplicateProspectGroups,
  findFuzzyDuplicateProspectGroups,
  mergeDiscoveryReviewRows,
  readLeadSuppressionCsv,
  readLeadReviewCsv,
  readManualDiscoveryCsv,
  renderDiscoveryReviewCsv,
  renderProspectRowsCsv,
  resolveCandidateWebsite,
  type DiscoveryProviderName,
  type DiscoverySummary,
  type LeadReviewRow,
  type ProspectCsvExportPreset,
  type ProspectExportRow,
  type ProspectRowInput
} from "./discovery.js";
import type { AuditProfile, ReportBrandConfig } from "./types.js";
import { writeWorkflowOutputFile } from "./workflow-output.js";

export interface DiscoveryRunOptions {
  provider: DiscoveryProviderName;
  query?: string;
  input?: string;
  profile: AuditProfile;
  outDir?: string;
  exportCsv: string;
  summaryJson?: string;
  reviewCsv?: string;
  suppressionList?: string;
  duplicatesJson?: string;
  exportPreset?: ProspectCsvExportPreset;
  dryRun: boolean;
  limit?: number;
  maxAudits?: number;
  minOpportunityScore?: number;
  concurrency: number;
  apiKey?: string;
  managedOutputRoot?: string;
  brand?: ReportBrandConfig;
}

export interface DiscoveryRunResult {
  rows: ProspectExportRow[];
  summary: DiscoverySummary;
}

function preferredReportPath(slug: string, outputs: Array<{ format: string; path?: string }>): string | undefined {
  const preferred =
    outputs.find((output) => output.format === "html") ??
    outputs.find((output) => output.format === "markdown") ??
    outputs[0];
  return preferred?.path ? `${slug}/${preferred.path.split(/[\\/]/).pop()}` : undefined;
}

async function readOptionalReviewCsv(path: string | undefined): Promise<LeadReviewRow[]> {
  if (!path) {
    return [];
  }

  try {
    return await readLeadReviewCsv(path);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

export async function runDiscovery(options: DiscoveryRunOptions): Promise<DiscoveryRunResult> {
  if (!options.exportCsv) {
    throw new Error("--export-csv is required for discover output");
  }

  if (!options.dryRun && !options.outDir) {
    throw new Error("--out-dir is required unless --dry-run is used");
  }

  if (options.provider === "manual-csv") {
    if (options.query?.trim()) {
      throw new Error("Manual CSV discovery does not accept a positional query; use --input instead");
    }

    if (!options.input) {
      throw new Error("--input is required when --provider manual-csv is used");
    }
  }

  if (options.provider === "google-places" && options.input) {
    throw new Error("--input is only supported when --provider manual-csv is used");
  }

  const candidates =
    options.provider === "manual-csv"
      ? await readManualDiscoveryCsv(options.input ?? "", {
          defaultProfile: options.profile
        })
      : await fetchGooglePlacesCandidates(options.query ?? "", {
          apiKey: options.apiKey,
          defaultProfile: options.profile,
          limit: options.limit
        });

  const resolutions = candidates.map(resolveCandidateWebsite);
  let prospectInputs: ProspectRowInput[] = candidates.map((candidate, index) => ({
    candidate,
    resolution: resolutions[index]
  }));
  const existingReviewRows = await readOptionalReviewCsv(options.reviewCsv);
  const suppressionEntries = [
    ...(options.suppressionList ? await readLeadSuppressionCsv(options.suppressionList) : []),
    ...existingReviewRows
  ];
  const suppressionResult = filterSuppressedProspects(prospectInputs, suppressionEntries);
  prospectInputs = suppressionResult.included;

  if (!options.dryRun) {
    const auditable = prospectInputs
      .map((input, index) => ({ ...input, index }))
      .filter((input) => input.resolution.status === "resolved" && input.resolution.websiteUrl)
      .slice(0, options.maxAudits);

    const auditResults = await runBatchReports(
      auditable.map((input) => ({
        url: input.resolution.websiteUrl ?? "",
        label: input.candidate.label,
        segment: input.candidate.segment,
        profile: input.candidate.profile
      })),
      {
        format: "all",
        outDir: options.outDir ?? "reports",
        concurrency: options.concurrency,
        profile: options.profile,
        brand: options.brand,
        managedOutputRoot: options.managedOutputRoot
      }
    );

    prospectInputs = prospectInputs.map((input, index) => {
      const auditableIndex = auditable.findIndex((candidate) => candidate.index === index);
      if (auditableIndex < 0) {
        return input;
      }

      const result = auditResults[auditableIndex];
      if (result.status === "failed") {
        return {
          ...input,
          audit: {
            status: "failed",
            error: result.error
          }
        };
      }

      const scores = Object.values(result.report.scores);
      const score =
        scores.length > 0 ? Math.round(scores.reduce((total, item) => total + item.score, 0) / scores.length) : undefined;
      return {
        ...input,
        audit: {
          status: "success",
          score,
          topFinding: result.report.findings[0]?.title,
          reportPath: preferredReportPath(result.slug, result.outputs),
          contact: result.report.contact
        }
      };
    });
  }

  const rows = buildProspectRows(prospectInputs).filter((row) =>
    options.minOpportunityScore === undefined ? true : row.opportunityScore >= options.minOpportunityScore
  );
  await mkdir(dirname(options.exportCsv), { recursive: true });
  await writeWorkflowOutputFile(options.exportCsv, renderProspectRowsCsv(rows, options.exportPreset ?? "standard"));
  if (options.reviewCsv) {
    await mkdir(dirname(options.reviewCsv), { recursive: true });
    await writeWorkflowOutputFile(options.reviewCsv, renderDiscoveryReviewCsv(mergeDiscoveryReviewRows(rows, existingReviewRows)));
  }
  if (options.duplicatesJson) {
    await mkdir(dirname(options.duplicatesJson), { recursive: true });
    await writeWorkflowOutputFile(
      options.duplicatesJson,
      `${JSON.stringify(
        {
          duplicateGroups: findDuplicateProspectGroups(rows),
          fuzzyDuplicateGroups: findFuzzyDuplicateProspectGroups(rows)
        },
        null,
        2
      )}\n`,
    );
  }
  const summary = buildDiscoverySummary(rows, suppressionResult.suppressedCount);
  if (options.summaryJson) {
    await mkdir(dirname(options.summaryJson), { recursive: true });
    await writeWorkflowOutputFile(options.summaryJson, `${JSON.stringify(summary, null, 2)}\n`);
  }

  return {
    rows,
    summary
  };
}
