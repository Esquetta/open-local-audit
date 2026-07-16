#!/usr/bin/env node
import { Command } from "commander";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { auditUrl } from "./audit.js";
import { readBrandConfig } from "./brand.js";
import { readBatchInput, runBatchReports } from "./batch.js";
import { type DiscoverySummary } from "./discovery.js";
import { runDiscovery } from "./discovery-runner.js";
import { shouldFailOnThreshold } from "./exit-policy.js";
import {
  renderExportValidationJson,
  renderExportValidationMarkdown,
  validateCrmExportCsv,
  type ExportValidationFormat,
  type ExportValidationPreset
} from "./export-validation.js";
import { writeReportOutputs } from "./output.js";
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
import {
  buildLeadShortlist,
  readShortlistReviewCsv,
  renderShortlistCsv,
  renderShortlistJson,
  renderShortlistMarkdown,
  renderShortlistSummaryJson,
  type ShortlistFormat,
  type ShortlistSort
} from "./shortlist.js";
import { renderTerminalSummary } from "./summary.js";

const program = new Command();

const discoveryProgram = program
  .command("discover")
  .description("Discover local lead candidates from an operator-provided source and prepare prospect triage output.")
  .argument("[query]", "provider-specific discovery query")
  .option("--input <path>", "read candidate businesses from a manual CSV file")
  .option("--provider <provider>", "discovery provider: manual-csv or google-places", "manual-csv")
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
  .option("--limit <count>", "maximum Google Places candidates to request", "10")
  .option("--max-audits <count>", "maximum website-present candidates to audit")
  .option("--min-opportunity-score <score>", "export only leads at or above an opportunity score")
  .option("--concurrency <count>", "maximum concurrent audits when dry-run is not used", "1")
  .addHelpText(
    "after",
    `
Discovery boundaries:
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

discoveryProgram.action(async (query?: string) => {
  try {
    const rawDiscoveryOptions = discoveryProgram.optsWithGlobals();
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
        limit: true,
        maxAudits: true,
        summaryJson: true,
        suppressionList: true,
        reviewCsv: true,
        duplicatesJson: true,
        minOpportunityScore: true
      })
      .parse(rawDiscoveryOptions);
    const brand = options.brandConfig ? await readBrandConfig(options.brandConfig) : undefined;

    if (options.provider === "google-places") {
      process.stderr.write("open-local-audit: Google Maps Platform billing may apply for --provider google-places\n");
    }

    const { rows, summary } = await runDiscovery({
      provider: options.provider,
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
      minOpportunityScore: options.minOpportunityScore,
      concurrency: options.concurrency,
      apiKey: options.provider === "google-places" ? resolveGoogleMapsApiKey() : undefined,
      brand
    });
    process.stdout.write(`Discovered ${rows.length} lead${rows.length === 1 ? "" : "s"}\n`);
    process.stdout.write(`${renderDiscoverySummary(summary)}\n`);
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
      const rawOptions = validateExportProgram.optsWithGlobals() as { input?: string; preset: string; format: string };
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
  .action(async () => {
    const options = shortlistProgram.optsWithGlobals() as {
      input?: string;
      out?: string;
      reviewCsv?: string;
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

      const sort = options.sort as ShortlistSort;
      const top = Number(options.top);
      const minOpportunityScore =
        options.minOpportunityScore === undefined ? undefined : Number(options.minOpportunityScore);
      const minScore =
        options.minScore === undefined ? undefined : Number(options.minScore);
      const reviewRows = options.reviewCsv ? readShortlistReviewCsv(await readFile(options.reviewCsv, "utf8")) : [];
      const result = buildLeadShortlist(await readFile(options.input, "utf8"), {
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
        sort,
        reviewRows
      });
      await mkdir(dirname(options.out), { recursive: true });
      const output =
        format === "json"
          ? renderShortlistJson(result)
          : format === "csv"
            ? renderShortlistCsv(result)
            : renderShortlistMarkdown(result);
      await writeFile(options.out, output, "utf8");
      if (options.summaryJson) {
        await mkdir(dirname(options.summaryJson), { recursive: true });
        await writeFile(options.summaryJson, renderShortlistSummaryJson(result), "utf8");
      }
      process.stdout.write(`Shortlisted ${result.selected} of ${result.totalRows} lead${result.totalRows === 1 ? "" : "s"}\n`);
      process.stdout.write(`Suppressed: ${result.suppressedRows}\n`);
      process.stdout.write(`Filtered: ${result.filteredRows}\n`);
      process.stdout.write(`Output: ${options.out}\n`);
      if (options.summaryJson) {
        process.stdout.write(`Summary: ${options.summaryJson}\n`);
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
