import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { renderHtmlReport, renderJsonReport, renderMarkdownReport } from "./reporters.js";
import type { AuditReport } from "./types.js";

export type OutputFormat = "json" | "markdown" | "html" | "all";

export interface ReportOutputOptions {
  format: OutputFormat;
  out?: string;
  outDir?: string;
  pretty?: boolean;
}

export interface ReportOutput {
  format: Exclude<OutputFormat, "all">;
  content: string;
  path?: string;
}

function outputFor(report: AuditReport, format: Exclude<OutputFormat, "all">, pretty: boolean): ReportOutput {
  const contentByFormat = {
    json: renderJsonReport(report, pretty),
    markdown: renderMarkdownReport(report),
    html: renderHtmlReport(report)
  };

  return {
    format,
    content: contentByFormat[format]
  };
}

function defaultReportName(format: Exclude<OutputFormat, "all">): string {
  const extension = {
    json: "json",
    markdown: "md",
    html: "html"
  }[format];

  return `open-local-audit-report.${extension}`;
}

export async function writeReportOutputs(report: AuditReport, options: ReportOutputOptions): Promise<ReportOutput[]> {
  const pretty = options.pretty ?? false;
  const formats: Array<Exclude<OutputFormat, "all">> =
    options.format === "all" ? ["json", "markdown", "html"] : [options.format];
  const outputs = formats.map((format) => outputFor(report, format, pretty));

  if (options.outDir) {
    await mkdir(options.outDir, { recursive: true });
    for (const output of outputs) {
      output.path = join(options.outDir, defaultReportName(output.format));
      await writeFile(output.path, output.content, "utf8");
    }
    return outputs;
  }

  if (options.format === "all") {
    throw new Error("--out-dir is required when --format all is used");
  }

  if (options.out) {
    outputs[0].path = options.out;
    await writeFile(options.out, outputs[0].content, "utf8");
  }

  return outputs;
}
