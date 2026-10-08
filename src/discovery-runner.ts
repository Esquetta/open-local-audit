import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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
  stableLeadKey,
  type DiscoveryProviderName,
  type DiscoverySummary,
  type LeadReviewRow,
  type ProspectCsvExportPreset,
  type ProspectExportRow,
  type ProspectRowInput
} from "./discovery.js";
import type { AuditProfile, ReportBrandConfig } from "./types.js";
import { writeWorkflowOutputFile } from "./workflow-output.js";
import type { DiscoveryCacheInfo } from "./discovery-cache.js";
import { compareBusinessIdentity, type BusinessIdentityResult } from "./business-identity.js";
import { selectAuditCandidates, type AuditPriority } from "./audit-selection.js";

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
  city?: string;
  country?: string;
  bbox?: string;
  radiusKm?: number;
  release?: string;
  cacheDir?: string;
  refreshCache?: boolean;
  auditPriority?: AuditPriority;
  managedOutputRoot?: string;
  brand?: ReportBrandConfig;
}

export interface DiscoveryRunResult {
  rows: ProspectExportRow[];
  summary: DiscoverySummary;
  metrics?: {
    discoveryMs: number;
    auditMs: number;
    totalMs: number;
    cache?: DiscoveryCacheInfo;
    selection?: { priority: AuditPriority; eligible: number; selected: number };
    identity?: { matched: number; uncertain: number; conflict: number; notChecked: number };
    sourceCoverage?: { denominator: number; website: number; phone: number; email: number; address: number };
    websites: Array<{ url: string; status: string; durationMs: number; pagesFetched: number; sourceUrls: string[]; error?: string; warnings?: string[]; sourceId?: string; identity?: BusinessIdentityResult }>;
  };
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
  const started = performance.now();
  let cache: DiscoveryCacheInfo | undefined;
  const websiteMetrics: NonNullable<DiscoveryRunResult["metrics"]>["websites"] = [];
  const hostQueues = new Map<string, Promise<void>>();
  const identities = new Map<string, BusinessIdentityResult>();
  const auditPriority = options.auditPriority ?? "source-order";
  if (auditPriority !== "source-order" && auditPriority !== "missing-contact") throw new Error("Unsupported audit priority");
  if (auditPriority !== "source-order" && options.provider !== "overture") throw new Error("Audit prioritization is only supported with --provider overture");
  if ((options.cacheDir || options.refreshCache) && options.provider !== "overture") {
    throw new Error("Discovery caching is only supported with --provider overture");
  }
  if (options.refreshCache && !options.cacheDir) {
    throw new Error("Refreshing discovery cache requires a cache directory");
  }
  if (options.provider === "overture" && (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 8)) {
    throw new Error("Overture website concurrency must be between 1 and 8");
  }
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

  if (options.provider !== "manual-csv" && options.input) {
    throw new Error("--input is only supported when --provider manual-csv is used");
  }

  let candidates;
  if (options.provider === "overture") {
    const { fetchOvertureCandidates } = await import("./overture.js");
    const { cityBoundingBox, parseDiscoveryBbox, resolveDiscoveryCity } = await import("./discovery-location.js");
    if (!options.query?.trim()) throw new Error("An industry category is required for Overture discovery");
    if (options.bbox && (options.city || options.country)) throw new Error("Use either --bbox or --city with --country, not both");
    if (!options.bbox && (!options.city || !options.country)) throw new Error("Overture discovery requires --city and --country, or --bbox");
    const { join } = await import("node:path");
    const bbox = options.bbox ? parseDiscoveryBbox(options.bbox) : cityBoundingBox(
      await resolveDiscoveryCity(options.city!, options.country!, join(options.outDir ?? "reports", ".cache")), options.radiusKm
    );
    candidates = await fetchOvertureCandidates({
      bbox, category: options.query, limit: options.limit, defaultProfile: options.profile, release: options.release,
      cacheDir: options.cacheDir ? resolve(options.cacheDir) : undefined, refreshCache: options.refreshCache,
      onCacheStatus: (info) => { cache = info; }
    });
  } else if (options.provider === "manual-csv") {
    candidates = await readManualDiscoveryCsv(options.input ?? "", {
          defaultProfile: options.profile
        });
  } else if (options.provider === "google-places") {
    candidates = await fetchGooglePlacesCandidates(options.query ?? "", {
          apiKey: options.apiKey,
          defaultProfile: options.profile,
          limit: options.limit
        });
  } else {
    throw new Error("Unsupported discovery provider");
  }
  const discoveryMs = performance.now() - started;

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
  const selection = selectAuditCandidates(prospectInputs, { priority: auditPriority, maxAudits: options.maxAudits, dryRun: options.dryRun });
  prospectInputs = prospectInputs.map((input, index) => ({ ...input, auditSelection: selection.decisions[index] }));
  const sourceRows = options.provider === "overture" ? buildProspectRows(prospectInputs) : [];
  const sourceCoverage = {
    denominator: sourceRows.length,
    website: sourceRows.filter((row) => row.hasWebsite === "yes").length,
    phone: sourceRows.filter((row) => row.publicPhone).length,
    email: sourceRows.filter((row) => row.publicEmail).length,
    address: sourceRows.filter((row) => row.address).length
  };

  const auditStarted = performance.now();
  if (!options.dryRun) {
    const auditable = selection.selectedIndices.map((index) => ({ ...prospectInputs[index], index }));
    const candidatesById = new Map(auditable.map((input) => [stableLeadKey(input), input.candidate]));

    const auditResults = await runBatchReports(
      auditable.map((input) => ({
        url: input.resolution.websiteUrl ?? "",
        label: input.candidate.label,
        segment: input.candidate.segment,
        profile: input.candidate.profile,
        ...(options.provider === "overture" ? { sourceId: stableLeadKey(input) } : {})
      })),
      {
        format: "all",
        outDir: options.outDir ?? "reports",
        concurrency: options.concurrency,
        profile: options.profile,
        brand: options.brand,
        ...(options.provider === "overture" ? {
          audit: async (url: string, context: { profile: AuditProfile; sourceId?: string }) => {
            const sourceId = context.sourceId ?? "";
            const candidate = candidatesById.get(sourceId);
            if (!candidate) throw new Error("Missing discovery candidate identity");
            const host = new URL(url).hostname.replace(/^www\./, "");
            const previous = hostQueues.get(host) ?? Promise.resolve();
            let unlock!: () => void;
            const lock = new Promise<void>((resolve) => { unlock = resolve; });
            hostQueues.set(host, lock);
            await previous;
            try {
            const { enrichWebsite } = await import("./website-enrichment.js");
            const { auditSnapshot } = await import("./audit.js");
            const enriched = await enrichWebsite(url);
            const identity = compareBusinessIdentity(candidate, enriched.businessIdentities ?? []);
            identities.set(sourceId, identity);
            websiteMetrics.push({ url, status: enriched.status, durationMs: enriched.durationMs, pagesFetched: enriched.pagesFetched, sourceUrls: enriched.sourceUrls, error: enriched.error, warnings: enriched.warnings, sourceId, identity });
            if (enriched.status !== "success" || !enriched.snapshot) throw new Error(enriched.error ?? "Website enrichment did not return an auditable page");
            if (identity.status === "conflict") throw new Error(`Website identity conflicts with the source: ${identity.reasons.join("; ")}`);
            const report = auditSnapshot(enriched.snapshot, undefined, { profile: context.profile });
            report.evidence.push(...(enriched.warnings ?? []).map((value) => ({ label: "Website enrichment warning", value })));
            report.businessIdentity = identity;
            return { ...report, contact: enriched.contact ? { ...enriched.contact, ...(identity.status === "uncertain" && enriched.contact.contactConfidence !== "None" ? { contactConfidence: "Low" as const } : {}) } : undefined };
            } finally {
              unlock();
              if (hostQueues.get(host) === lock) hostQueues.delete(host);
            }
          }
        } : {}),
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
            error: result.error,
            ...(options.provider === "overture" ? { identity: identities.get(stableLeadKey(input)) ?? compareBusinessIdentity(input.candidate, []) } : {})
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
          contact: result.report.contact,
          dotnetStack: result.report.dotnetStack,
          ...(options.provider === "overture" ? { identity: identities.get(stableLeadKey(input)) ?? compareBusinessIdentity(input.candidate, []) } : {})
        }
      };
    });
  }

  const auditMs = performance.now() - auditStarted;
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
    summary,
    ...(options.provider === "overture" ? { metrics: {
      discoveryMs, auditMs, totalMs: performance.now() - started, cache, sourceCoverage, websites: websiteMetrics,
      selection: { priority: auditPriority, eligible: selection.decisions.filter((item) => item.rank !== undefined).length, selected: selection.selectedIndices.length },
      identity: {
        matched: rows.filter((row) => row.identityStatus === "matched").length,
        uncertain: rows.filter((row) => row.identityStatus === "uncertain").length,
        conflict: rows.filter((row) => row.identityStatus === "conflict").length,
        notChecked: rows.filter((row) => row.identityStatus === "not-checked").length
      }
    } } : {})
  };
}
