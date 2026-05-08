#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { Command } from "commander";
import { auditUrl } from "./audit.js";
import { renderJsonReport, renderMarkdownReport } from "./reporters.js";
import { cliOptionsSchema, inputUrlSchema } from "./schema.js";

const program = new Command();

program
  .name("open-local-audit")
  .description("Audit a public local-business website and generate an evidence-backed report.")
  .argument("<url>", "HTTP or HTTPS URL to audit")
  .option("-f, --format <format>", "output format: json or markdown", "markdown")
  .option("-o, --out <path>", "write report to a file instead of stdout")
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

      const output =
        options.format === "json" ? renderJsonReport(report, options.pretty) : renderMarkdownReport(report);

      if (options.out) {
        await writeFile(options.out, output, "utf8");
      } else {
        process.stdout.write(output);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      process.stderr.write(`open-local-audit: ${message}\n`);
      process.exitCode = 1;
    }
  });

program.parseAsync();
