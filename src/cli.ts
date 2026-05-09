#!/usr/bin/env node
import { Command } from "commander";
import { auditUrl } from "./audit.js";
import { readBatchInput, runBatchReports } from "./batch.js";
import { shouldFailOnThreshold } from "./exit-policy.js";
import { writeReportOutputs } from "./output.js";
import { cliOptionsSchema, inputUrlSchema } from "./schema.js";
import { renderTerminalSummary } from "./summary.js";

const program = new Command();

program
  .name("open-local-audit")
  .description("Audit a public local-business website and generate an evidence-backed report.")
  .argument("[url]", "HTTP or HTTPS URL to audit")
  .option("--input <path>", "read URLs from a text file for batch audits")
  .option("-f, --format <format>", "output format: json, markdown, html, or all", "markdown")
  .option("-o, --out <path>", "write report to a file instead of stdout")
  .option("--out-dir <path>", "write generated report files to a directory")
  .option("--timeout <ms>", "request timeout in milliseconds", "10000")
  .option("--max-redirects <count>", "maximum redirects to follow", "5")
  .option("--check-links", "check same-origin links found on the audited page", false)
  .option("--max-pages <count>", "maximum same-origin links to check", "10")
  .option("--fail-on <severity>", "exit with code 1 when findings meet severity: none, high, medium, or low", "none")
  .option("--pretty", "pretty-print JSON output", false)
  .action(async (rawUrl: string | undefined, rawOptions: unknown) => {
    try {
      const options = cliOptionsSchema.parse(rawOptions);
      const auditOptions = {
        timeoutMs: options.timeout,
        maxRedirects: options.maxRedirects,
        checkLinks: options.checkLinks,
        maxPages: options.maxPages
      };

      if (options.input) {
        if (rawUrl) {
          throw new Error("Use either a URL or --input, not both");
        }

        if (!options.outDir) {
          throw new Error("--out-dir is required when --input is used");
        }

        const urls = await readBatchInput(options.input);
        const results = await runBatchReports(urls, {
          format: options.format,
          outDir: options.outDir,
          pretty: options.pretty,
          audit: (url) => auditUrl(url, auditOptions)
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

      const url = inputUrlSchema.parse(rawUrl);
      const report = await auditUrl(url, {
        ...auditOptions
      });

      const outputs = await writeReportOutputs(report, {
        format: options.format,
        out: options.out,
        outDir: options.outDir,
        pretty: options.pretty
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
