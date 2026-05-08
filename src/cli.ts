#!/usr/bin/env node
import { Command } from "commander";
import { auditUrl } from "./audit.js";
import { writeReportOutputs } from "./output.js";
import { cliOptionsSchema, inputUrlSchema } from "./schema.js";

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
  .option("--pretty", "pretty-print JSON output", false)
  .action(async (rawUrl: string, rawOptions: unknown) => {
    try {
      const url = inputUrlSchema.parse(rawUrl);
      const options = cliOptionsSchema.parse(rawOptions);
      const report = await auditUrl(url, {
        timeoutMs: options.timeout,
        maxRedirects: options.maxRedirects
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
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      process.stderr.write(`open-local-audit: ${message}\n`);
      process.exitCode = 1;
    }
  });

program.parseAsync();
