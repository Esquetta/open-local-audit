#!/usr/bin/env node
import { Command } from "commander";
import { auditUrl } from "./audit.js";
import { shouldFailOnThreshold } from "./exit-policy.js";
import { writeReportOutputs } from "./output.js";
import { cliOptionsSchema, inputUrlSchema } from "./schema.js";
import { renderTerminalSummary } from "./summary.js";

const program = new Command();

program
  .name("open-local-audit")
  .description("Audit a public local-business website and generate an evidence-backed report.")
  .argument("<url>", "HTTP or HTTPS URL to audit")
  .option("-f, --format <format>", "output format: json, markdown, or all", "markdown")
  .option("-o, --out <path>", "write report to a file instead of stdout")
  .option("--out-dir <path>", "write generated report files to a directory")
  .option("--timeout <ms>", "request timeout in milliseconds", "10000")
  .option("--max-redirects <count>", "maximum redirects to follow", "5")
  .option("--check-links", "check same-origin links found on the audited page", false)
  .option("--max-pages <count>", "maximum same-origin links to check", "10")
  .option("--fail-on <severity>", "exit with code 1 when findings meet severity: none, high, medium, or low", "none")
  .option("--pretty", "pretty-print JSON output", false)
  .action(async (rawUrl: string, rawOptions: unknown) => {
    try {
      const url = inputUrlSchema.parse(rawUrl);
      const options = cliOptionsSchema.parse(rawOptions);
      const report = await auditUrl(url, {
        timeoutMs: options.timeout,
        maxRedirects: options.maxRedirects,
        checkLinks: options.checkLinks,
        maxPages: options.maxPages
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
