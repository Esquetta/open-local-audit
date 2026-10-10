#!/usr/bin/env node
import { Command } from "commander";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readBrandConfig } from "./brand.js";
import {
  compareReports,
  loadComparisonScreenshots,
  readComparisonReport,
  renderComparisonHtml,
  renderComparisonJson,
  renderComparisonMarkdown,
  renderComparisonPdf
} from "./compare.js";
import { type DiscoverySummary } from "./discovery.js";
import type { DiscoveryRunResult } from "./discovery-runner.js";
import { defaultDiscoveryCacheDirectory } from "./discovery-cache.js";
import { shouldFailOnThreshold } from "./exit-policy.js";
import {
  renderExportValidationJson,
  renderExportValidationMarkdown,
  validateCrmExportCsv,
  type ExportValidationFormat,
  type ExportValidationPreset
} from "./export-validation.js";
import { packageReport } from "./report-pack.js";
import {
  readLeadKeysFromReviewInput,
  summarizeReviewCsvFile,
  upsertReviewCsvFile,
  upsertReviewCsvFileMany,
  type ReviewSummary
} from "./review.js";
import { cliOptionsSchema, inputUrlSchema } from "./schema.js";
import { resolveGoogleMapsApiKey } from "./secrets.js";
import { runShortlistReport } from "./shortlist-runner.js";
import { type ShortlistFormat, type ShortlistSort } from "./shortlist.js";
import { renderTerminalSummary } from "./summary.js";
import { readWorkflowConfig } from "./workflow-config.js";
import {
  renderWorkflowPreflightJson,
  renderWorkflowPreflightTerminal,
  runWorkflowPreflight
} from "./workflow-preflight.js";
import { renderWorkflowPlanJson, renderWorkflowPlanTerminal, runWorkflowPlan } from "./workflow-plan.js";

// Modules that load cheerio, libphonenumber-js metadata, or pdfkit are imported inside the
// command actions that need them, so help output and early validation errors start quickly.

const program = new Command().enablePositionalOptions();

// Workflow runs keep reports in a "reports" folder next to the lead CSV; "start" writes them beside it.
function defaultReportsDir(input: string): string {
  const reports = join(dirname(input), "reports");
  return existsSync(reports) ? reports : dirname(input);
}

function optsWithLocalCliPrecedence(command: Command): Record<string, unknown> {
  const options = command.optsWithGlobals();
  const localOptions = command.opts();

  for (const option of command.options) {
    const name = option.attributeName();
    if (command.getOptionValueSource(name) === "cli") {
      options[name] = localOptions[name];
    }
  }

  return options;
}

const discoveryProgram = program
  .command("discover")
  .description("Discover local lead candidates from an operator-provided source and prepare prospect triage output.")
  .argument("[query]", "provider-specific discovery query")
  .option("--input <path>", "read candidate businesses from a manual CSV file")
  .option("--provider <provider>", "discovery provider: overture (default), manual-csv (with --input), or google-places")
  .option("--city <name>", "city name for keyless Overture discovery")
  .option("--country <code>", "two-letter country code, for example TR, US, DE, GB")
  .option("--bbox <bounds>", "search bounds west,south,east,north instead of a city")
  .option("--radius-km <km>", "city search bounding-box half-width in km (maximum 50)", "10")
  .option("--release <release>", "pin an Overture release for repeatable searches")
  .option("--cache-dir <path>", "store reusable Overture search results in this local directory")
  .option("--no-cache", "do not read or write the Overture result cache")
  .option("--refresh-cache", "fetch fresh Overture results and replace this search's cache entry", false)
  .option("--profile <profile>", "default industry profile for candidates", "generic")
  .option("--out-dir <path>", "write generated audit reports to a directory")
  .option("--brand-config <path>", "read report branding from a JSON file")
  .option("--export-csv <path>", "write lead discovery CSV output")
  .option("--export-preset <preset>", "CSV export preset: standard or crm", "standard")
  .option("--summary-json <path>", "write discovery summary JSON output")
  .option("--suppression-list <path>", "read reviewed or suppressed lead identities from a CSV file")
  .option("--review-csv <path>", "write or merge a local discovery review queue CSV")
  .option("--duplicates-json <path>", "write duplicate lead groups as JSON")
  .option("--dry-run", "resolve candidates and write leads without auditing websites", false)
  .option("--limit <count>", "maximum discovered candidates to return", "10")
  .option("--max-audits <count>", "maximum website-present candidates to audit")
  .option("--audit-priority <mode>", "Overture audit selection: source-order or missing-contact", "source-order")
  .option("--min-opportunity-score <score>", "export only leads at or above an opportunity score")
  .option("--concurrency <count>", "maximum concurrent audits when dry-run is not used", "1")
  .addHelpText(
    "after",
    `
Discovery boundaries:
  Overture discovery needs no API key. Use: discover dental --city Istanbul --country TR
  City lookup uses GeoNames cities15000 (CC BY 4.0); smaller places can use --bbox.
  Public source data can be incomplete. Missing website data means unknown, not no website.
  --provider google-places requires GOOGLE_MAPS_API_KEY and uses the official Places Text Search API.
  Google Maps scraping, reviews/photos collection, and outreach sending are not supported.
`
  );

function renderDiscoverySummary(summary: DiscoverySummary): string {
  return [
    `With website: ${summary.withWebsite}`,
    `Without website: ${summary.withoutWebsite}`,
    `Unknown website: ${summary.unknownWebsite}`,
    `Audited: ${summary.audited}`,
    `Audit failed: ${summary.auditFailed}`,
    `Not audited: ${summary.notAudited}`,
    `Suppressed: ${summary.suppressedCandidates}`,
    `Average score: ${summary.averageScore ?? "N/A"}`
  ].join("\n");
}

function discoveryCacheOptions(options: { cache: boolean; cacheDir?: string; refreshCache: boolean }, provider = "overture"): { cacheDir?: string; refreshCache?: boolean } {
  if (!options.cache && options.refreshCache) throw new Error("--refresh-cache cannot be combined with --no-cache");
  if (!options.cache && options.cacheDir) throw new Error("--cache-dir cannot be combined with --no-cache");
  if (provider !== "overture") {
    if (options.cacheDir || options.refreshCache) throw new Error("Discovery caching is only supported with --provider overture");
    return {};
  }
  return options.cache ? { cacheDir: options.cacheDir ?? defaultDiscoveryCacheDirectory(), refreshCache: options.refreshCache } : {};
}

function printDiscoveryResult(result: DiscoveryRunResult): void {
  process.stdout.write(`Discovered ${result.rows.length} lead${result.rows.length === 1 ? "" : "s"}\n`);
  process.stdout.write(`${renderDiscoverySummary(result.summary)}\n`);
  if (result.metrics?.selection) {
    const selection = result.metrics.selection;
    process.stdout.write(`Audit selection: ${selection.priority}; ${selection.selected} selected of ${selection.eligible} eligible\n`);
  }
  if (result.metrics?.identity) {
    const identity = result.metrics.identity;
    process.stdout.write(`Website identity: ${identity.matched} matched; ${identity.uncertain} uncertain; ${identity.conflict} conflict; ${identity.notChecked} not checked\n`);
  }
  const cache = result.metrics?.cache;
  if (cache) {
    process.stdout.write(`Discovery cache: ${cache.status}; source ${cache.release}${cache.fetchedAt ? `; fetched ${cache.fetchedAt}` : ""}\n`);
    if (cache.message) process.stderr.write(`open-local-audit: ${cache.message}\n`);
  }
}

discoveryProgram.action(async (query?: string) => {
  try {
    const rawDiscoveryOptions = optsWithLocalCliPrecedence(discoveryProgram);
    rawDiscoveryOptions.provider ??= rawDiscoveryOptions.input ? "manual-csv" : "overture";
    const options = cliOptionsSchema
      .pick({
        input: true,
        profile: true,
        outDir: true,
        brandConfig: true,
        exportCsv: true,
        exportPreset: true,
        dryRun: true,
        concurrency: true,
        provider: true,
        city: true,
        country: true,
        bbox: true,
        radiusKm: true,
        release: true,
        cache: true,
        cacheDir: true,
        refreshCache: true,
        limit: true,
        maxAudits: true,
        auditPriority: true,
        summaryJson: true,
        suppressionList: true,
        reviewCsv: true,
        duplicatesJson: true,
        minOpportunityScore: true
      })
      .parse(rawDiscoveryOptions);
    const cacheOptions = discoveryCacheOptions(options, options.provider);
    const brand = options.brandConfig ? await readBrandConfig(options.brandConfig) : undefined;

    if (options.provider === "google-places") {
      process.stderr.write("open-local-audit: Google Maps Platform billing may apply for --provider google-places\n");
    }

    const { runDiscovery } = await import("./discovery-runner.js");
    const result = await runDiscovery({
      ...cacheOptions,
      provider: options.provider,
      city: options.city,
      country: options.country,
      bbox: options.bbox,
      radiusKm: options.radiusKm,
      release: options.release,
      query,
      input: options.input,
      profile: options.profile,
      outDir: options.outDir,
      exportCsv: options.exportCsv ?? "",
      summaryJson: options.summaryJson,
      reviewCsv: options.reviewCsv,
      suppressionList: options.suppressionList,
      duplicatesJson: options.duplicatesJson,
      exportPreset: options.exportPreset,
      dryRun: options.dryRun,
      limit: options.limit,
      maxAudits: options.maxAudits,
      auditPriority: options.auditPriority,
      minOpportunityScore: options.minOpportunityScore,
      concurrency: options.concurrency,
      apiKey: options.provider === "google-places" ? resolveGoogleMapsApiKey() : undefined,
      brand
    });
    printDiscoveryResult(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    process.stderr.write(`open-local-audit: ${message}\n`);
    process.exitCode = 1;
  }
});

const startProgram = program
  .command("start")
  .description("Start a guided, keyless business search.")
  .option("--cache-dir <path>", "store reusable Overture search results in this local directory")
  .option("--no-cache", "do not read or write the Overture result cache")
  .option("--refresh-cache", "fetch fresh Overture results for this search", false);

startProgram.action(async () => {
  try {
    const cacheOptions = discoveryCacheOptions(cliOptionsSchema.pick({ cache: true, cacheDir: true, refreshCache: true }).parse(startProgram.opts()));
    const { collectStartOptions } = await import("./start.js");
    const options = await collectStartOptions();
    if (!options) return;
    await mkdir(dirname(options.outDir!), { recursive: true });
    try {
      await mkdir(options.outDir!);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") throw new Error("Output directory already exists. Run start again and choose a new directory.");
      throw error;
    }
    process.stdout.write("Searching businesses...\n");
    const { runDiscovery } = await import("./discovery-runner.js");
    const result = await runDiscovery({ ...options, ...cacheOptions });
    printDiscoveryResult(result);
    process.stdout.write(`Prospects: ${options.exportCsv}\nSummary: ${options.summaryJson}\n`);
  } catch (error) {
    process.stderr.write(`open-local-audit: ${error instanceof Error ? error.message : "Unknown error"}\n`);
    process.exitCode = 1;
  }
});

const workflowProgram = program
  .command("workflow")
  .description("Run a versioned local discovery, shortlist, review, and report packaging workflow.")
  .option("--config <path>", "read workflow configuration from a JSON file")
  .option("--check", "validate workflow readiness without running it", false)
  .option("--plan", "show readiness and resolved execution plan without running it", false)
  .option("--resume", "resume from the latest valid workflow checkpoint", false)
  .option("--status", "show latest persisted workflow state without running it", false)
  .option("--format <format>", "workflow check, plan, or status output format: terminal or json");

workflowProgram.action(async () => {
  try {
    const options = workflowProgram.opts<{
      config?: string;
      check: boolean;
      plan: boolean;
      resume: boolean;
      status: boolean;
      format?: string;
    }>();
    const format = workflowProgram.getOptionValueSource("format") === "cli" ? options.format : undefined;
    const config = options.config;
    if (!config) {
      throw new Error("--config is required for workflow");
    }

    if (options.status && (options.check || options.plan || options.resume)) {
      throw new Error("workflow modes cannot be used together: --status, --check, --plan, and --resume are mutually exclusive");
    }

    if (options.resume && (options.check || options.plan || format !== undefined)) {
      throw new Error("workflow --resume cannot be used with --check, --plan, or --format");
    }

    if (options.check && options.plan) {
      throw new Error("workflow --check and --plan cannot be used together");
    }

    if (!options.check && !options.plan && !options.status && format !== undefined) {
      throw new Error("--format is only supported with workflow --check, --plan, or --status");
    }

    if (options.check || options.plan || options.status) {
      const outputFormat = format ?? "terminal";
      if (outputFormat !== "terminal" && outputFormat !== "json") {
        throw new Error("workflow --format must be terminal or json");
      }

      if (options.status) {
        const { renderWorkflowStatusJson, renderWorkflowStatusTerminal, runWorkflowStatus } = await import("./workflow-status.js");
        const report = await runWorkflowStatus(config);
        process.stdout.write(
          outputFormat === "json"
            ? renderWorkflowStatusJson(report)
            : renderWorkflowStatusTerminal(report, config)
        );
        if (report.status === "failed" || report.status === "invalid") {
          if (outputFormat === "terminal") {
            process.stderr.write(`open-local-audit: workflow status ${report.status}\n`);
          }
          process.exitCode = 1;
        }
        return;
      }

      if (options.check) {
        const report = await runWorkflowPreflight(config);
        process.stdout.write(
          outputFormat === "json"
            ? renderWorkflowPreflightJson(report)
            : renderWorkflowPreflightTerminal(report, config)
        );
        if (report.status === "blocked") {
          if (outputFormat === "terminal") {
            process.stderr.write("open-local-audit: workflow preflight blocked\n");
          }
          process.exitCode = 1;
        }
        return;
      }

      const report = await runWorkflowPlan(config);
      process.stdout.write(
        outputFormat === "json"
          ? renderWorkflowPlanJson(report)
          : renderWorkflowPlanTerminal(report, config)
      );
      if (report.status === "blocked") {
        if (outputFormat === "terminal") {
          process.stderr.write("open-local-audit: workflow plan blocked\n");
        }
        process.exitCode = 1;
      }
      return;
    }

    const resolvedConfig = await readWorkflowConfig(config);
    if (resolvedConfig.discovery.provider === "google-places") {
      process.stderr.write("open-local-audit: Google Maps Platform billing may apply for --provider google-places\n");
    }

    const { runResolvedWorkflow } = await import("./workflow.js");
    const summary = await runResolvedWorkflow(resolvedConfig, {}, { resume: options.resume });
    process.stdout.write("Workflow completed\n");
    process.stdout.write(`Discovered: ${summary.discoveredLeads}\n`);
    process.stdout.write(`Selected: ${summary.selectedLeads}\n`);
    process.stdout.write(`Summary: ${summary.outputs.workflowSummaryJson}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    process.stderr.write(`open-local-audit: ${message}\n`);
    process.exitCode = 1;
  }
});

const validateExportProgram = program
  .command("validate-export")
  .description("Validate a local CRM export CSV before importing it into external tools.")
  .option("--input <path>", "read the CSV export to validate")
  .option("--preset <preset>", "export preset to validate: crm", "crm")
  .option("--format <format>", "validation report format: markdown or json", "markdown")
  .action(async () => {
    try {
      const rawOptions = optsWithLocalCliPrecedence(validateExportProgram) as {
        input?: string;
        preset: string;
        format: string;
      };
      const preset = rawOptions.preset as ExportValidationPreset;
      const format = rawOptions.format as ExportValidationFormat;
      if (!rawOptions.input) {
        throw new Error("--input is required for validate-export");
      }

      if (preset !== "crm") {
        throw new Error("validate-export currently supports --preset crm only");
      }

      if (format !== "markdown" && format !== "json") {
        throw new Error("validate-export --format must be markdown or json");
      }

      const result = validateCrmExportCsv(await readFile(rawOptions.input, "utf8"));
      process.stdout.write(
        format === "json" ? renderExportValidationJson(result) : renderExportValidationMarkdown(result)
      );
      if (!result.summary.valid) {
        process.exitCode = 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      process.stderr.write(`open-local-audit: ${message}\n`);
      process.exitCode = 1;
    }
  });

const packageReportProgram = program
  .command("package-report")
  .description("Package an existing single-site report directory for local customer sharing.")
  .option("--input <path>", "read an existing report directory")
  .option("--out <path>", "write the report pack to a directory")
  .action(async () => {
    try {
      const options = packageReportProgram.optsWithGlobals() as { input?: string; out?: string };
      if (!options.input) {
        throw new Error("--input is required for package-report");
      }

      if (!options.out) {
        throw new Error("--out is required for package-report");
      }

      const result = await packageReport({
        inputDir: options.input,
        outDir: options.out
      });
      process.stdout.write(`Packaged report for ${result.manifest.finalUrl}\n`);
      process.stdout.write(`Files: ${result.manifest.files.length}\n`);
      process.stdout.write(`Output: ${result.outDir}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      process.stderr.write(`open-local-audit: ${message}\n`);
      process.exitCode = 1;
    }
  });

const compareProgram = program
  .command("compare")
  .description("Compare two JSON reports for the same site to show fixed, remaining, and new findings.")
  .argument("<before>", "earlier JSON report file or report directory")
  .argument("<after>", "later JSON report file or report directory")
  .option("-f, --format <format>", "comparison format: markdown, json, html, or pdf", "markdown")
  .option("-o, --out <path>", "write the comparison to a file instead of stdout")
  .option("--brand-config <path>", "read report branding from a JSON file")
  .action(async (beforePath: string, afterPath: string) => {
    try {
      const options = compareProgram.opts() as { format: string; out?: string; brandConfig?: string };
      if (!["markdown", "json", "html", "pdf"].includes(options.format)) {
        throw new Error("compare --format must be markdown, json, html, or pdf");
      }

      if (options.format === "pdf" && !options.out) {
        throw new Error("--out is required when compare --format pdf is used");
      }

      const brand = options.brandConfig ? await readBrandConfig(options.brandConfig) : undefined;
      const comparison = compareReports(await readComparisonReport(beforePath), await readComparisonReport(afterPath));
      const screenshots = ["html", "pdf"].includes(options.format) ? await loadComparisonScreenshots(comparison) : undefined;
      const content =
        options.format === "json"
          ? renderComparisonJson(comparison)
          : options.format === "html"
            ? renderComparisonHtml(comparison, { brand, screenshots })
            : options.format === "pdf"
              ? await renderComparisonPdf(comparison, { brand, screenshots })
              : renderComparisonMarkdown(comparison, { brand });

      if (!options.out) {
        process.stdout.write(content);
        return;
      }

      await mkdir(dirname(options.out), { recursive: true });
      await writeFile(options.out, content);
      process.stdout.write(
        `Compared ${comparison.url}: ${comparison.fixed.length} fixed, ${comparison.remaining.length} still open, ${comparison.introduced.length} new\n`
      );
      process.stdout.write(`Output: ${options.out}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      process.stderr.write(`open-local-audit: ${message}\n`);
      process.exitCode = 1;
    }
  });

const shortlistProgram = program
  .command("shortlist")
  .description("Rank a local discovery or CRM CSV export into a lead shortlist report.")
  .option("--input <path>", "read a discovery or CRM CSV export")
  .option("--out <path>", "write the shortlist report")
  .option("--review-csv <path>", "read local review state and suppress completed leads")
  .option("--top <count>", "number of leads to include", "20")
  .option("--min-opportunity-score <score>", "include only leads at or above an opportunity score")
  .option("--min-score <score>", "include only leads at or above an audit score")
  .option("--segment <segment>", "include only leads matching a segment")
  .option("--profile <profile>", "include only leads matching a profile")
  .option("--priority <priority>", "include only leads matching a priority")
  .option("--contact-confidence <level>", "include only leads matching a contact confidence level")
  .option("--min-contact-confidence <level>", "include only leads at or above a contact confidence level")
  .option("--preferred-contact-channel <channel>", "include only leads matching a preferred contact channel")
  .option("--source <source>", "include only leads matching a discovery source")
  .option("--audit-status <status>", "include only leads matching an audit status")
  .option("--has-website <status>", "include only leads matching a website presence status")
  .option("--top-finding <finding>", "include only leads matching a top finding")
  .option("--review-status <status>", "include only leads matching an active review status")
  .option("--exclude-review-status <status>", "exclude leads matching an active review status")
  .option("--unreviewed", "include only leads without a review date")
  .option("--reviewed-before <date>", "include only leads reviewed before a YYYY-MM-DD date")
  .option("--require-website", "include only leads with a website")
  .option("--missing-website", "include only leads without a website")
  .option("--require-contact", "include only leads with contact confidence")
  .option("--missing-contact", "include only leads without contact confidence")
  .option("--require-report", "include only leads with a report path")
  .option("--missing-report", "include only leads without a report path")
  .option("--sort <sort>", "shortlist sort: opportunity-desc, score-desc, company-asc, last-reviewed-asc, contact-confidence-desc, priority-desc, or source-asc", "opportunity-desc")
  .option("--summary-json <path>", "write shortlist automation summary JSON output")
  .option("--format <format>", "shortlist report format: markdown, json, or csv", "markdown")
  .option("--pitch-brief <path>", "write Markdown pitch notes for each shortlisted lead from its audit report")
  .option("--reports-dir <path>", "resolve lead report paths for --pitch-brief from this directory (default: reports next to --input)")
  .action(async () => {
    const options = optsWithLocalCliPrecedence(shortlistProgram) as {
      input?: string;
      out?: string;
      reviewCsv?: string;
      pitchBrief?: string;
      reportsDir?: string;
      top: string;
      minOpportunityScore?: string;
      minScore?: string;
      segment?: string;
      profile?: string;
      priority?: string;
      contactConfidence?: string;
      minContactConfidence?: string;
      preferredContactChannel?: string;
      source?: string;
      auditStatus?: string;
      hasWebsite?: string;
      topFinding?: string;
      reviewStatus?: string;
      excludeReviewStatus?: string;
      unreviewed?: boolean;
      reviewedBefore?: string;
      requireWebsite?: boolean;
      missingWebsite?: boolean;
      requireContact?: boolean;
      missingContact?: boolean;
      requireReport?: boolean;
      missingReport?: boolean;
      sort: string;
      summaryJson?: string;
      format: string;
    };
    try {
      if (!options.input) {
        throw new Error("--input is required for shortlist");
      }

      if (!options.out) {
        throw new Error("--out is required for shortlist");
      }

      const format = options.format as ShortlistFormat;
      if (format !== "markdown" && format !== "json" && format !== "csv") {
        throw new Error("shortlist --format must be markdown, json, or csv");
      }

      if (options.reportsDir && !options.pitchBrief) {
        throw new Error("--reports-dir is only used with --pitch-brief");
      }

      const top = Number(options.top);
      const minOpportunityScore =
        options.minOpportunityScore === undefined ? undefined : Number(options.minOpportunityScore);
      const minScore =
        options.minScore === undefined ? undefined : Number(options.minScore);
      const result = await runShortlistReport({
        input: options.input,
        out: options.out,
        summaryJson: options.summaryJson,
        reviewCsv: options.reviewCsv,
        pitchBrief: options.pitchBrief
          ? { out: options.pitchBrief, reportsDir: options.reportsDir ?? defaultReportsDir(options.input) }
          : undefined,
        format,
        shortlist: {
          top,
          minOpportunityScore,
          minScore,
          segment: options.segment,
          profile: options.profile,
          priority: options.priority,
          contactConfidence: options.contactConfidence,
          minContactConfidence: options.minContactConfidence,
          preferredContactChannel: options.preferredContactChannel,
          source: options.source,
          auditStatus: options.auditStatus,
          hasWebsite: options.hasWebsite,
          topFinding: options.topFinding,
          reviewStatus: options.reviewStatus,
          excludeReviewStatus: options.excludeReviewStatus,
          unreviewed: options.unreviewed,
          reviewedBefore: options.reviewedBefore,
          requireWebsite: options.requireWebsite,
          missingWebsite: options.missingWebsite,
          requireContact: options.requireContact,
          missingContact: options.missingContact,
          requireReport: options.requireReport,
          missingReport: options.missingReport,
          sort: options.sort as ShortlistSort
        }
      });
      process.stdout.write(`Shortlisted ${result.selected} of ${result.totalRows} lead${result.totalRows === 1 ? "" : "s"}\n`);
      process.stdout.write(`Suppressed: ${result.suppressedRows}\n`);
      process.stdout.write(`Filtered: ${result.filteredRows}\n`);
      process.stdout.write(`Output: ${options.out}\n`);
      if (options.summaryJson) {
        process.stdout.write(`Summary: ${options.summaryJson}\n`);
      }
      if (options.pitchBrief) {
        process.stdout.write(`Pitch brief: ${options.pitchBrief}\n`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      process.stderr.write(`open-local-audit: ${message}\n`);
      process.exitCode = 1;
    }
  });

function renderReviewSummary(summary: ReviewSummary): string {
  const nonZeroStatuses = Object.entries(summary.statusCounts).filter(([, count]) => count > 0);
  return [
    `Rows: ${summary.totalRows}`,
    `Reviewed: ${summary.reviewedRows}`,
    `Unreviewed: ${summary.unreviewedRows}`,
    `Invalid review dates: ${summary.invalidReviewedAtRows}`,
    ...(summary.staleBefore ? [`Stale before ${summary.staleBefore}: ${summary.staleRows}`] : []),
    `Oldest reviewed: ${summary.oldestReviewedAt ?? "N/A"}`,
    `Newest reviewed: ${summary.newestReviewedAt ?? "N/A"}`,
    "Status counts:",
    ...(nonZeroStatuses.length > 0 ? nonZeroStatuses.map(([status, count]) => `- ${status}: ${count}`) : ["- none: 0"]),
    ""
  ].join("\n");
}

const reviewProgram = program
  .command("review")
  .description("Update local lead review state in a review CSV.")
  .option("--review-csv <path>", "read and update the local review CSV")
  .option("--input <path>", "read lead keys from a shortlist CSV or JSON file")
  .option("--lead-key <key>", "lead key to update")
  .option("--status <status>", "review status to write")
  .option("--reason <text>", "operator review reason")
  .option("--reviewed-at <timestamp>", "review timestamp; defaults to the current time")
  .option("--summary", "print review CSV queue summary without updating rows", false)
  .option("--summary-json <path>", "write review CSV queue summary JSON")
  .option("--stale-before <date>", "count review rows older than a YYYY-MM-DD date in summary output")
  .option("--dry-run", "show the bulk review update without writing the review CSV", false)
  .action(async () => {
    try {
      const options = reviewProgram.optsWithGlobals() as {
        reviewCsv?: string;
        input?: string;
        leadKey?: string;
        status?: string;
        reason?: string;
        reviewedAt?: string;
        summary?: boolean;
        summaryJson?: string;
        staleBefore?: string;
        dryRun?: boolean;
      };

      if (!options.reviewCsv) {
        throw new Error("--review-csv is required for review");
      }

      if (options.staleBefore && !options.summary && !options.summaryJson) {
        throw new Error("review --stale-before is only supported with --summary or --summary-json");
      }

      if (options.summary || options.summaryJson) {
        const summary = await summarizeReviewCsvFile(options.reviewCsv, { staleBefore: options.staleBefore });
        process.stdout.write(renderReviewSummary(summary));
        if (options.summaryJson) {
          await mkdir(dirname(options.summaryJson), { recursive: true });
          await writeFile(options.summaryJson, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
          process.stdout.write(`Summary JSON: ${options.summaryJson}\n`);
        }
        return;
      }

      if (!options.status) {
        throw new Error("review --status is required");
      }

      if (options.input && options.leadKey) {
        throw new Error("Use either review --input or --lead-key, not both");
      }

      if (options.input) {
        const result = await upsertReviewCsvFileMany(
          options.reviewCsv,
          {
            leadKeys: readLeadKeysFromReviewInput(await readFile(options.input, "utf8")),
            status: options.status,
            reason: options.reason,
            reviewedAt: options.reviewedAt
          },
          options.dryRun
        );
        process.stdout.write(
          `${options.dryRun ? "Would update" : "Updated"} ${result.total} review row${result.total === 1 ? "" : "s"}\n`
        );
        process.stdout.write(`Added: ${result.added}\n`);
        process.stdout.write(`Updated: ${result.updated}\n`);
        process.stdout.write(`Skipped: ${result.skipped}\n`);
        process.stdout.write(`Status: ${result.reviewStatus}\n`);
        process.stdout.write(`Last reviewed: ${result.lastReviewedAt}\n`);
        process.stdout.write(`Review CSV: ${options.reviewCsv}\n`);
        return;
      }

      if (options.dryRun) {
        throw new Error("review --dry-run is only supported with --input");
      }

      if (!options.leadKey) {
        throw new Error("review --lead-key is required unless --input is used");
      }

      const result = await upsertReviewCsvFile(options.reviewCsv, {
        leadKey: options.leadKey,
        status: options.status,
        reason: options.reason,
        reviewedAt: options.reviewedAt
      });
      process.stdout.write(`Review ${result.action} for ${result.leadKey}\n`);
      process.stdout.write(`Status: ${result.reviewStatus}\n`);
      process.stdout.write(`Last reviewed: ${result.lastReviewedAt}\n`);
      process.stdout.write(`Review CSV: ${options.reviewCsv}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      process.stderr.write(`open-local-audit: ${message}\n`);
      process.exitCode = 1;
    }
  });

program
  .name("open-local-audit")
  .description("Audit a public local-business website and generate an evidence-backed report.")
  .argument("[url]", "HTTP or HTTPS URL to audit")
  .option("--input <path>", "read URLs from a text file for batch audits")
  .option("-f, --format <format>", "output format: json, markdown, html, pdf, or all", "markdown")
  .option("-o, --out <path>", "write report to a file instead of stdout")
  .option("--out-dir <path>", "write generated report files to a directory")
  .option("--brand-config <path>", "read report branding from a JSON file")
  .option("--segment <segment>", "include only batch index entries matching a segment")
  .option("--min-score <score>", "include only successful batch index entries at or above a score")
  .option("--top <count>", "limit the batch index to the top N entries after filtering and sorting")
  .option("--sort <sort>", "batch index sort: score-asc or severity-desc")
  .option("--source <source>", "include only batch index entries matching a source")
  .option("--audit-status <status>", "include only batch index entries matching an audit status")
  .option("--has-website <status>", "include only batch index entries matching a website presence status")
  .option("--concurrency <count>", "maximum concurrent batch audits", "1")
  .option("--profile <profile>", "industry profile: generic, dental, beauty, restaurant, contractor, lawyer, clinic, gym, hotel, or auto-service")
  .option("--export-csv <path>", "write a batch prospect CSV export")
  .option("--export-preset <preset>", "CSV export preset for --export-csv: standard or crm", "standard")
  .option("--summary-json <path>", "write batch index JSON output to an explicit path")
  .option("--timeout <ms>", "request timeout in milliseconds", "10000")
  .option("--max-redirects <count>", "maximum redirects to follow", "5")
  .option("--check-links", "check same-origin links found on the audited page", false)
  .option("--max-pages <count>", "maximum same-origin links to check", "10")
  .option("--render", "use Playwright-rendered HTML instead of the static response", false)
  .option("--screenshot", "capture a rendered homepage screenshot into the report output directory", false)
  .option("--lighthouse", "run Lighthouse performance, accessibility, best-practices, and SEO checks", false)
  .option("--fail-on <severity>", "exit with code 1 when findings meet severity: none, high, medium, or low", "none")
  .option("--pretty", "pretty-print JSON output", false)
  .action(async (rawUrl: string | undefined, rawOptions: unknown) => {
    try {
      const options = cliOptionsSchema.parse(rawOptions);
      const brand = options.brandConfig ? await readBrandConfig(options.brandConfig) : undefined;
      const auditOptions = {
        timeoutMs: options.timeout,
        maxRedirects: options.maxRedirects,
        checkLinks: options.checkLinks,
        maxPages: options.maxPages,
        profile: options.profile,
        render: options.render || options.screenshot,
        screenshot: options.screenshot,
        lighthouse: options.lighthouse
      };

      if (options.input) {
        if (rawUrl) {
          throw new Error("Use either a URL or --input, not both");
        }

        if (!options.outDir) {
          throw new Error("--out-dir is required when --input is used");
        }

        if (options.format === "pdf") {
          throw new Error("--format pdf is only supported for single URL audits");
        }

        const [{ auditUrl }, { readBatchInput, runBatchReports }] = await Promise.all([import("./audit.js"), import("./batch.js")]);
        const urls = await readBatchInput(options.input);
        const results = await runBatchReports(urls, {
          format: options.format,
          outDir: options.outDir,
          pretty: options.pretty,
          summaryJson: options.summaryJson,
          exportCsv: options.exportCsv,
          exportPreset: options.exportPreset,
          concurrency: options.concurrency,
          profile: options.profile,
          brand,
          index: {
            segment: options.segment,
            minScore: options.minScore,
            top: options.top,
            sort: options.sort,
            source: options.source,
            auditStatus: options.auditStatus,
            hasWebsite: options.hasWebsite
          },
          audit: (url, context) =>
            auditUrl(url, {
              ...auditOptions,
              profile: context.profile,
              screenshotPath: options.screenshot ? join(context.outDir, "artifacts", "homepage.png") : undefined,
              screenshotReportPath: options.screenshot ? "artifacts/homepage.png" : undefined
            })
        });

        process.stdout.write(`Audited ${results.length} URL${results.length === 1 ? "" : "s"}\n`);
        const failed = results.some(
          (result) => result.status === "success" && shouldFailOnThreshold(result.report, options.failOn)
        );
        if (failed) {
          process.stderr.write(`open-local-audit: findings met --fail-on ${options.failOn}\n`);
          process.exitCode = 1;
        }
        return;
      }

      if (options.summaryJson) {
        throw new Error("--summary-json is only supported when --input is used");
      }

      if (!rawUrl) {
        throw new Error("URL is required unless --input is used");
      }

      if (options.exportCsv) {
        throw new Error("--export-csv is only supported when --input is used");
      }

      if (options.screenshot && !options.outDir) {
        throw new Error("--out-dir is required when --screenshot is used");
      }

      if (options.format === "pdf" && !options.out && !options.outDir) {
        throw new Error("--out or --out-dir is required when --format pdf is used");
      }

      const screenshotOutDir = options.screenshot ? options.outDir : undefined;
      const url = inputUrlSchema.parse(rawUrl);
      const [{ auditUrl }, { writeReportOutputs }] = await Promise.all([import("./audit.js"), import("./output.js")]);
      const report = await auditUrl(url, {
        ...auditOptions,
        screenshotPath: screenshotOutDir ? join(screenshotOutDir, "artifacts", "homepage.png") : undefined,
        screenshotReportPath: screenshotOutDir ? "artifacts/homepage.png" : undefined
      });

      const outputs = await writeReportOutputs(report, {
        format: options.format,
        out: options.out,
        outDir: options.outDir,
        pretty: options.pretty,
        brand
      });

      for (const output of outputs) {
        if (!output.path) {
          process.stdout.write(output.content);
        }
      }

      if (outputs.some((output) => output.path)) {
        process.stdout.write(`${renderTerminalSummary(report)}\n`);
      }

      if (shouldFailOnThreshold(report, options.failOn)) {
        process.stderr.write(`open-local-audit: findings met --fail-on ${options.failOn}\n`);
        process.exitCode = 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      process.stderr.write(`open-local-audit: ${message}\n`);
      process.exitCode = 1;
    }
  });

program.parseAsync();
