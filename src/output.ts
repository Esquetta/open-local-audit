import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { renderPdfReport } from "./pdf.js";
import { renderHtmlReport, renderJsonReport, renderMarkdownReport } from "./reporters.js";
import type { AuditReport, ReportBrandConfig } from "./types.js";
import { writeWorkflowOutputFile } from "./workflow-output.js";

export type OutputFormat = "json" | "markdown" | "html" | "pdf" | "all";

export interface ReportOutputOptions {
  format: OutputFormat;
  out?: string;
  outDir?: string;
  pretty?: boolean;
  brand?: ReportBrandConfig;
  managedOutputRoot?: string;
}

export interface ReportOutput {
  format: Exclude<OutputFormat, "all">;
  content: string | Buffer;
  path?: string;
}

async function outputFor(
  report: AuditReport,
  format: Exclude<OutputFormat, "all">,
  options: Pick<ReportOutputOptions, "pretty" | "brand">
): Promise<ReportOutput> {
  const pretty = options.pretty ?? false;
  return {
    format,
    content:
      format === "json"
        ? renderJsonReport(report, pretty)
        : format === "markdown"
          ? renderMarkdownReport(report, { brand: options.brand })
          : format === "html"
            ? renderHtmlReport(report, { brand: options.brand })
            : await renderPdfReport(report, { brand: options.brand })
  };
}

function defaultReportName(format: Exclude<OutputFormat, "all">): string {
  const extension = {
    json: "json",
    markdown: "md",
    html: "html",
    pdf: "pdf"
  }[format];

  return `open-local-audit-report.${extension}`;
}

export async function writeReportOutputs(report: AuditReport, options: ReportOutputOptions): Promise<ReportOutput[]> {
  const pretty = options.pretty ?? false;
  const formats: Array<Exclude<OutputFormat, "all">> =
    options.format === "all" ? ["json", "markdown", "html"] : [options.format];
  const outputs = await Promise.all(formats.map((format) => outputFor(report, format, { pretty, brand: options.brand })));

  if (options.format === "pdf" && !options.outDir && !options.out) {
    throw new Error("--out or --out-dir is required when --format pdf is used");
  }

  if (options.outDir) {
    if (!options.managedOutputRoot) {
      await mkdir(options.outDir, { recursive: true });
    }
    for (const output of outputs) {
      output.path = join(options.outDir, defaultReportName(output.format));
      await writeWorkflowOutputFile(output.path, output.content, {
        managedOutputRoot: options.managedOutputRoot
      });
    }
    return outputs;
  }

  if (options.format === "all") {
    throw new Error("--out-dir is required when --format all is used");
  }

  if (options.out) {
    outputs[0].path = options.out;
    await writeWorkflowOutputFile(options.out, outputs[0].content, {
      managedOutputRoot: options.managedOutputRoot
    });
  }

  return outputs;
}
