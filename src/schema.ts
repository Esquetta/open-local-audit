import { z } from "zod";

export const inputUrlSchema = z
  .string()
  .trim()
  .min(1, "URL is required")
  .transform((value) => {
    if (/^https?:\/\//i.test(value)) {
      return value;
    }

    return `https://${value}`;
  })
  .pipe(z.string().url("URL must be a valid HTTP or HTTPS URL"))
  .refine((value) => /^https?:\/\//i.test(value), {
    message: "Only HTTP and HTTPS URLs are supported"
  });

export const outputFormatSchema = z.enum(["json", "markdown", "html", "all"]);
export const failOnSchema = z.enum(["none", "high", "medium", "low"]);
export const batchIndexSortSchema = z.enum(["score-asc", "severity-desc"]);
export const auditProfileSchema = z.enum(["generic", "dental", "beauty", "restaurant", "contractor"]);
export const discoveryProviderSchema = z.enum(["manual-csv", "google-places"]);

export const cliOptionsSchema = z.object({
  format: outputFormatSchema.default("markdown"),
  out: z.string().optional(),
  outDir: z.string().optional(),
  input: z.string().optional(),
  segment: z.string().trim().min(1).optional(),
  minScore: z.coerce.number().min(0).max(100).optional(),
  top: z.coerce.number().int().positive().optional(),
  sort: batchIndexSortSchema.optional(),
  concurrency: z.coerce.number().int().positive().default(1),
  profile: auditProfileSchema.default("generic"),
  exportCsv: z.string().optional(),
  provider: discoveryProviderSchema.default("manual-csv"),
  dryRun: z.boolean().default(false),
  limit: z.coerce.number().int().positive().default(10),
  maxAudits: z.coerce.number().int().min(0).optional(),
  summaryJson: z.string().optional(),
  suppressionList: z.string().optional(),
  minOpportunityScore: z.coerce.number().int().min(0).max(100).optional(),
  timeout: z.coerce.number().int().positive().max(60000).default(10000),
  maxRedirects: z.coerce.number().int().min(0).max(10).default(5),
  checkLinks: z.boolean().default(false),
  maxPages: z.coerce.number().int().positive().max(100).default(10),
  render: z.boolean().default(false),
  screenshot: z.boolean().default(false),
  failOn: failOnSchema.default("none"),
  pretty: z.boolean().default(false)
});
