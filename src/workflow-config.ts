import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { auditProfileSchema } from "./schema.js";
import { shortlistSortValues } from "./shortlist.js";

const nonblankStringSchema = z.string().trim().min(1);

const discoveryDefaults = {
  profile: auditProfileSchema.default("generic"),
  concurrency: z.number().int().positive().default(1),
  maxAudits: z.number().int().min(0).optional()
};

const manualDiscoverySchema = z
  .object({
    provider: z.literal("manual-csv"),
    input: nonblankStringSchema,
    ...discoveryDefaults
  })
  .strict();

const googleDiscoverySchema = z
  .object({
    provider: z.literal("google-places"),
    query: nonblankStringSchema,
    ...discoveryDefaults,
    limit: z.number().int().positive().max(50).default(10)
  })
  .strict();

const shortlistSchema = z
  .object({
    top: z.number().int().positive().default(20),
    minOpportunityScore: z.number().int().min(0).max(100).optional(),
    sort: z.enum(shortlistSortValues).default("opportunity-desc")
  })
  .strict();

const calendarDateSchema = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}, "Expected a real calendar date in YYYY-MM-DD format");

const reviewSchema = z
  .object({
    csv: nonblankStringSchema,
    staleBefore: calendarDateSchema.optional()
  })
  .strict();

const workflowConfigSchema = z
  .object({
    version: z.literal(1),
    outDir: nonblankStringSchema,
    discovery: z.discriminatedUnion("provider", [manualDiscoverySchema, googleDiscoverySchema]),
    shortlist: shortlistSchema,
    review: reviewSchema.optional(),
    packageReports: z.boolean().default(false)
  })
  .strict();

export type RawWorkflowConfig = z.input<typeof workflowConfigSchema>;

type ParsedWorkflowConfig = z.output<typeof workflowConfigSchema>;

export interface WorkflowManagedPaths {
  leadsCsv: string;
  discoverySummaryJson: string;
  shortlistCsv: string;
  shortlistSummaryJson: string;
  reviewSummaryJson: string;
  workflowSummaryJson: string;
  reportsDir: string;
  packagesDir: string;
}

export type ResolvedWorkflowConfig = Omit<ParsedWorkflowConfig, "outDir" | "discovery" | "review"> & {
  outDir: string;
  discovery:
    | (Extract<ParsedWorkflowConfig["discovery"], { provider: "manual-csv" }> & { input: string })
    | Extract<ParsedWorkflowConfig["discovery"], { provider: "google-places" }>;
  review?: ParsedWorkflowConfig["review"] & { csv: string };
  paths: WorkflowManagedPaths;
};

export async function readWorkflowConfig(configPath: string): Promise<ResolvedWorkflowConfig> {
  const absoluteConfigPath = resolve(configPath);
  const configDirectory = dirname(absoluteConfigPath);
  const content = await readFile(absoluteConfigPath, "utf8");
  let rawConfig: unknown;
  try {
    rawConfig = JSON.parse(content);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Workflow config ${absoluteConfigPath} contains invalid JSON`, { cause: error });
    }
    throw error;
  }
  const config = workflowConfigSchema.parse(rawConfig);
  const outDir = resolve(configDirectory, config.outDir);

  return {
    ...config,
    outDir,
    discovery:
      config.discovery.provider === "manual-csv"
        ? { ...config.discovery, input: resolve(configDirectory, config.discovery.input) }
        : config.discovery,
    ...(config.review
      ? { review: { ...config.review, csv: resolve(configDirectory, config.review.csv) } }
      : {}),
    paths: {
      leadsCsv: join(outDir, "leads.csv"),
      discoverySummaryJson: join(outDir, "discovery-summary.json"),
      shortlistCsv: join(outDir, "shortlist.csv"),
      shortlistSummaryJson: join(outDir, "shortlist-summary.json"),
      reviewSummaryJson: join(outDir, "review-summary.json"),
      workflowSummaryJson: join(outDir, "workflow-summary.json"),
      reportsDir: join(outDir, "reports"),
      packagesDir: join(outDir, "packages")
    }
  };
}
