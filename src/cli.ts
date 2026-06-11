#!/usr/bin/env node
import { Command } from "commander";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { auditUrl } from "./audit.js";
import { readBrandConfig } from "./brand.js";
import { readBatchInput, runBatchReports } from "./batch.js";
import {
  buildDiscoverySummary,
  buildProspectRows,
  findDuplicateProspectGroups,
  findFuzzyDuplicateProspectGroups,
  fetchGooglePlacesCandidates,
  filterSuppressedProspects,
  mergeDiscoveryReviewRows,
  readLeadSuppressionCsv,
  readLeadReviewCsv,
  readManualDiscoveryCsv,
  renderDiscoveryReviewCsv,
  renderProspectRowsCsv,
  resolveCandidateWebsite,
  type LeadReviewRow,
  type ProspectRowInput
} from "./discovery.js";
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

function preferredReportPath(slug: string, outputs: Array<{ format: string; path?: string }>): string | undefined {
  const preferred =
    outputs.find((output) => output.format === "html") ??
    outputs.find((output) => output.format === "markdown") ??
    outputs[0];
  return preferred?.path ? `${slug}/${preferred.path.split(/[\\/]/).pop()}` : undefined;
}

function renderDiscoverySummary(summary: ReturnType<typeof buildDiscoverySummary>): string {
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

    if (!options.exportCsv) {
      throw new Error("--export-csv is required for discover output");
    }

    if (!options.dryRun && !options.outDir) {
      throw new Error("--out-dir is required unless --dry-run is used");
    }

    if (options.provider === "manual-csv") {
      if (query?.trim()) {
        throw new Error("Manual CSV discovery does not accept a positional query; use --input instead");
      }

      if (!options.input) {
        throw new Error("--input is required when --provider manual-csv is used");
      }
    }

    if (options.provider === "google-places" && options.input) {
      throw new Error("--input is only supported when --provider manual-csv is used");
    }

    if (options.provider === "google-places") {
      process.stderr.write("open-local-audit: Google Maps Platform billing may apply for --provider google-places\n");
    }

    const candidates =
      options.provider === "manual-csv"
        ? await readManualDiscoveryCsv(options.input ?? "", {
            defaultProfile: options.profile
          })
        : await fetchGooglePlacesCandidates(query ?? "", {
            apiKey: resolveGoogleMapsApiKey(),
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
          brand
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
    await writeFile(options.exportCsv, renderProspectRowsCsv(rows, options.exportPreset), "utf8");
    if (options.reviewCsv) {
      await mkdir(dirname(options.reviewCsv), { recursive: true });
      await writeFile(options.reviewCsv, renderDiscoveryReviewCsv(mergeDiscoveryReviewRows(rows, existingReviewRows)), "utf8");
    }
    if (options.duplicatesJson) {
      await mkdir(dirname(options.duplicatesJson), { recursive: true });
      await writeFile(
        options.duplicatesJson,
        `${JSON.stringify(
          {
            duplicateGroups: findDuplicateProspectGroups(rows),
            fuzzyDuplicateGroups: findFuzzyDuplicateProspectGroups(rows)
          },
          null,
          2
        )}\n`,
        "utf8"
      );
    }
    const summary = buildDiscoverySummary(rows, suppressionResult.suppressedCount);
    if (options.summaryJson) {
      await mkdir(dirname(options.summaryJson), { recursive: true });
      await writeFile(options.summaryJson, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    }
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
  .option("--segment <segment>", "include only leads matching a segment")
  .option("--profile <profile>", "include only leads matching a profile")
  .option("--priority <priority>", "include only leads matching a priority")
  .option("--contact-confidence <level>", "include only leads matching a contact confidence level")
  .option("--review-status <status>", "include only leads matching an active review status")
  .option("--exclude-review-status <status>", "exclude leads matching an active review status")
  .option("--require-website", "include only leads with a website")
  .option("--sort <sort>", "shortlist sort: opportunity-desc, score-desc, company-asc, or last-reviewed-asc", "opportunity-desc")
  .option("--summary-json <path>", "write shortlist automation summary JSON output")
  .option("--format <format>", "shortlist report format: markdown, json, or csv", "markdown")
  .action(async () => {
    const options = shortlistProgram.optsWithGlobals() as {
      input?: string;
      out?: string;
      reviewCsv?: string;
      top: string;
      minOpportunityScore?: string;
      segment?: string;
      profile?: string;
      priority?: string;
      contactConfidence?: string;
      reviewStatus?: string;
      excludeReviewStatus?: string;
      requireWebsite?: boolean;
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
      const reviewRows = options.reviewCsv ? readShortlistReviewCsv(await readFile(options.reviewCsv, "utf8")) : [];
      const result = buildLeadShortlist(await readFile(options.input, "utf8"), {
        top,
        minOpportunityScore,
        segment: options.segment,
        profile: options.profile,
        priority: options.priority,
        contactConfidence: options.contactConfidence,
        reviewStatus: options.reviewStatus,
        excludeReviewStatus: options.excludeReviewStatus,
        requireWebsite: options.requireWebsite,
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
  .option("--concurrency <count>", "maximum concurrent batch audits", "1")
  .option("--profile <profile>", "industry profile: generic, dental, beauty, restaurant, contractor, lawyer, clinic, gym, hotel, or auto-service")
  .option("--export-csv <path>", "write a batch prospect CSV export")
  .option("--export-preset <preset>", "CSV export preset for --export-csv: standard or crm", "standard")
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
          exportCsv: options.exportCsv,
          exportPreset: options.exportPreset,
          concurrency: options.concurrency,
          profile: options.profile,
          brand,
          index: {
            segment: options.segment,
            minScore: options.minScore,
            top: options.top,
            sort: options.sort
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
