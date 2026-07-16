import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoveryRunResult } from "../src/discovery-runner.js";
import type { ReportPackResult } from "../src/report-pack.js";
import type { ReviewSummary } from "../src/review.js";
import type { ShortlistLead, ShortlistResult } from "../src/shortlist.js";
import { WorkflowRunError, runWorkflow, safeLeadSlug, type WorkflowSummary } from "../src/workflow.js";

describe("workflow orchestrator", () => {
  let directory: string;
  let configPath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "open-local-audit-workflow-"));
    configPath = join(directory, "config", "workflow.json");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  async function writeWorkflowConfig(config: unknown): Promise<void> {
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  }

  function manualWorkflowConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      version: 1,
      outDir: "./artifacts/run-output",
      discovery: {
        provider: "manual-csv",
        input: "./input/manual.csv",
        profile: "generic",
        concurrency: 2,
        maxAudits: 4
      },
      shortlist: {
        top: 3,
        sort: "opportunity-desc"
      },
      ...overrides
    };
  }

  function googleWorkflowConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      version: 1,
      outDir: "./artifacts/run-output",
      discovery: {
        provider: "google-places",
        query: "dentist Istanbul",
        profile: "generic",
        concurrency: 3,
        limit: 7
      },
      shortlist: {
        top: 2,
        sort: "score-desc"
      },
      ...overrides
    };
  }

  function resolvedWorkflowPaths() {
    const outDir = join(dirname(resolve(configPath)), "artifacts", "run-output");
    return {
      outDir,
      leadsCsv: join(outDir, "leads.csv"),
      discoverySummaryJson: join(outDir, "discovery-summary.json"),
      shortlistCsv: join(outDir, "shortlist.csv"),
      shortlistSummaryJson: join(outDir, "shortlist-summary.json"),
      reviewSummaryJson: join(outDir, "review-summary.json"),
      workflowSummaryJson: join(outDir, "workflow-summary.json"),
      reportsDir: join(outDir, "reports"),
      packagesDir: join(outDir, "packages")
    };
  }

  function makeLead(overrides: Partial<ShortlistLead> = {}): ShortlistLead {
    return {
      rank: 1,
      companyName: "Acme Dental",
      website: "https://acme.test",
      segment: "dental",
      profile: "generic",
      priority: "high",
      auditStatus: "success",
      hasWebsite: "yes",
      source: "manual-csv",
      score: 72,
      opportunityScore: 91,
      topFinding: "Missing title",
      contactConfidence: "High",
      preferredContactChannel: "email",
      contactabilityReason: "Public email found.",
      reason: "Audit score is below 80",
      reportPath: "acme/open-local-audit-report.html",
      leadKey: "url:https://acme.test",
      reviewStatus: "pending",
      reviewReason: "",
      lastReviewedAt: "",
      ...overrides
    };
  }

  function makeDiscoveryResult(totalCandidates: number): DiscoveryRunResult {
    return {
      rows: Array.from({ length: totalCandidates }, (_, index) => ({
        leadKey: `url:https://lead-${index + 1}.test`,
        source: "manual-csv",
        label: `Lead ${index + 1}`,
        profile: "generic",
        hasWebsite: "yes",
        websiteUrl: `https://lead-${index + 1}.test`,
        auditStatus: "success",
        score: 70 + index,
        opportunityScore: 90 - index,
        opportunityReasons: ["Audit score is below 80"],
        pitchAngle: "Fix visible conversion blockers",
        recommendedOffer: "Conversion-focused website tune-up",
        estimatedNeed: "High",
        outreachPriorityReason: "Audit score is below 80",
        contactConfidence: "High",
        preferredContactChannel: "email",
        outreachAction: "Send a personalized audit summary by email.",
        contactabilityReason: "Public email found.",
        priority: index === 0 ? "high" : "medium",
        nextAction: "Prioritize outreach with the top audit issue.",
        reviewStatus: "new"
      })),
      summary: {
        totalCandidates,
        suppressedCandidates: 1,
        withWebsite: totalCandidates,
        withoutWebsite: 0,
        unknownWebsite: 0,
        audited: totalCandidates,
        auditFailed: 0,
        notAudited: 0,
        averageScore: 75,
        priority: {
          high: 1,
          medium: Math.max(0, totalCandidates - 1),
          low: 0
        }
      }
    };
  }

  function makeShortlistResult(leads: ShortlistLead[]): ShortlistResult {
    return {
      totalRows: 5,
      suppressedRows: 1,
      filteredRows: 2,
      selected: leads.length,
      leads: leads.map((lead, index) => ({
        ...lead,
        rank: index + 1
      }))
    };
  }

  function makeReviewSummary(overrides: Partial<ReviewSummary> = {}): ReviewSummary {
    return {
      totalRows: 3,
      reviewedRows: 2,
      unreviewedRows: 1,
      unreviewedLeadKeys: ["url:https://missing-review.test"],
      actionableLeadKeys: ["url:https://missing-review.test"],
      actionableLeads: [{ leadKey: "url:https://missing-review.test", reasons: ["unreviewed"] }],
      invalidReviewedAtRows: 0,
      invalidReviewedAtLeadKeys: [],
      staleRows: 0,
      staleLeadKeys: [],
      staleBefore: "2026-06-01",
      oldestReviewedAt: "2026-05-01T00:00:00.000Z",
      newestReviewedAt: "2026-06-10T00:00:00.000Z",
      statusCounts: {
        new: 0,
        pending: 1,
        "in-review": 0,
        qualified: 1,
        contacted: 0,
        rejected: 0,
        "not-fit": 0,
        "do-not-contact": 0,
        suppressed: 0,
        unknown: 1
      },
      ...overrides
    };
  }

  function makePackResult(outDir: string): ReportPackResult {
    return {
      outDir,
      manifest: {
        generatedAt: "2026-07-16T00:00:00.000Z",
        sourceReport: "open-local-audit-report.json",
        url: "https://clinic.test",
        finalUrl: "https://clinic.test",
        score: 82,
        files: ["README.md", "manifest.json"]
      }
    };
  }

  function readSummaryFile(): { content: string; summary: WorkflowSummary } {
    const workflowSummaryJson = resolvedWorkflowPaths().workflowSummaryJson;
    const content = readFileSync(workflowSummaryJson, "utf8");
    return {
      content,
      summary: JSON.parse(content) as WorkflowSummary
    };
  }

  it("sanitizes lead slugs, falls back safely, and appends duplicate suffixes during packaging", async () => {
    await writeWorkflowConfig(manualWorkflowConfig({ packageReports: true }));

    const discovery = vi.fn(async () => makeDiscoveryResult(3));
    const shortlist = vi.fn(async () =>
      makeShortlistResult([
        makeLead({ companyName: "Acme / Dental", leadKey: "url:https://acme-a.test", reportPath: "acme-a/open-local-audit-report.html" }),
        makeLead({ companyName: "Acme / Dental", leadKey: "url:https://acme-b.test", reportPath: "acme-b/open-local-audit-report.html" }),
        makeLead({ companyName: "!!!", leadKey: "url:https://www.example.com/path", reportPath: "example/open-local-audit-report.html" })
      ])
    );
    const packageReport = vi.fn(async ({ outDir }: { inputDir: string; outDir: string }) => makePackResult(outDir));

    expect(safeLeadSlug("url:https://www.example.com/path", "Acme / Dental")).toBe("acme-dental");
    expect(safeLeadSlug("url:https://www.example.com/path", "   ")).toBe("example-com-path");
    expect(safeLeadSlug("   ", "!!!")).toBe("lead");

    await runWorkflow(configPath, {
      runDiscovery: discovery,
      runShortlistReport: shortlist,
      packageReport
    });

    const { packagesDir } = resolvedWorkflowPaths();

    expect(packageReport.mock.calls.map(([options]) => options.outDir)).toEqual([
      join(packagesDir, "acme-dental"),
      join(packagesDir, "acme-dental-2"),
      join(packagesDir, "example-com-path")
    ]);
  });

  it("runs a successful manual workflow with exact stage options, shared review path, summary counts, and summary files", async () => {
    await writeWorkflowConfig(
      manualWorkflowConfig({
        review: {
          csv: "./operator/review.csv",
          staleBefore: "2026-06-01"
        },
        packageReports: true
      })
    );

    const paths = resolvedWorkflowPaths();
    const discoveryResult = makeDiscoveryResult(3);
    const shortlistResult = makeShortlistResult([
      makeLead({
        companyName: "Acme Health",
        leadKey: "url:https://acme-health.test",
        reportPath: "acme-health/open-local-audit-report.html"
      }),
      makeLead({
        companyName: "Skipped Report",
        leadKey: "url:https://skip.test",
        reportPath: ""
      })
    ]);
    const reviewSummary = makeReviewSummary();
    const reviewCsvPath = join(dirname(resolve(configPath)), "operator", "review.csv");

    const discovery = vi.fn(async () => discoveryResult);
    const shortlist = vi.fn(async () => shortlistResult);
    const summarizeReviewCsvFile = vi.fn(async () => reviewSummary);
    const packageReport = vi.fn(async ({ outDir }: { inputDir: string; outDir: string }) => makePackResult(outDir));
    const resolveGoogleMapsApiKey = vi.fn(() => "unused-secret");

    const summary = await runWorkflow(configPath, {
      runDiscovery: discovery,
      runShortlistReport: shortlist,
      summarizeReviewCsvFile,
      packageReport,
      resolveGoogleMapsApiKey
    });

    expect(resolveGoogleMapsApiKey).not.toHaveBeenCalled();
    expect(discovery).toHaveBeenCalledWith({
      provider: "manual-csv",
      input: join(dirname(resolve(configPath)), "input", "manual.csv"),
      profile: "generic",
      outDir: paths.reportsDir,
      exportCsv: paths.leadsCsv,
      summaryJson: paths.discoverySummaryJson,
      reviewCsv: reviewCsvPath,
      dryRun: false,
      concurrency: 2,
      maxAudits: 4
    });
    expect(shortlist).toHaveBeenCalledWith({
      input: paths.leadsCsv,
      out: paths.shortlistCsv,
      summaryJson: paths.shortlistSummaryJson,
      reviewCsv: reviewCsvPath,
      format: "csv",
      shortlist: {
        top: 3,
        sort: "opportunity-desc"
      }
    });
    expect(summarizeReviewCsvFile).toHaveBeenCalledWith(reviewCsvPath, {
      staleBefore: "2026-06-01"
    });
    expect(packageReport).toHaveBeenCalledWith({
      inputDir: join(paths.reportsDir, "acme-health"),
      outDir: join(paths.packagesDir, "acme-health")
    });

    expect(summary).toMatchObject({
      version: 1,
      status: "success",
      outputs: {
        leadsCsv: paths.leadsCsv,
        discoverySummaryJson: paths.discoverySummaryJson,
        shortlistCsv: paths.shortlistCsv,
        shortlistSummaryJson: paths.shortlistSummaryJson,
        reviewSummaryJson: paths.reviewSummaryJson,
        workflowSummaryJson: paths.workflowSummaryJson,
        reportsDir: paths.reportsDir,
        packagesDir: paths.packagesDir
      },
      discoveredLeads: 3,
      selectedLeads: 2,
      stages: {
        discovery: {
          status: "success",
          totalCandidates: 3,
          suppressedCandidates: 1,
          audited: 3
        },
        shortlist: {
          status: "success",
          totalRows: 5,
          suppressedRows: 1,
          filteredRows: 2,
          selected: 2
        },
        review: {
          status: "success",
          totalRows: 3,
          reviewedRows: 2,
          actionableLeads: 1,
          staleRows: 0,
          invalidReviewedAtRows: 0,
          unreviewedRows: 1
        },
        packaging: {
          status: "success",
          packaged: 1,
          skipped: 1,
          failed: 0
        }
      },
      packages: {
        packaged: 1,
        skipped: 1,
        failed: 0,
        entries: [
          {
            leadKey: "url:https://acme-health.test",
            companyName: "Acme Health",
            status: "packaged",
            outDir: join(paths.packagesDir, "acme-health")
          },
          {
            leadKey: "url:https://skip.test",
            companyName: "Skipped Report",
            status: "skipped"
          }
        ]
      }
    });

    expect(JSON.parse(readFileSync(paths.reviewSummaryJson, "utf8"))).toEqual(reviewSummary);
    expect(readSummaryFile().summary).toEqual(summary);
    expect(readSummaryFile().content.endsWith("\n")).toBe(true);
  });

  it("calls the Google API key resolver only for Google discovery and passes the key to discovery", async () => {
    await writeWorkflowConfig(googleWorkflowConfig());

    const discovery = vi.fn(async () => makeDiscoveryResult(0));
    const shortlist = vi.fn(async () => makeShortlistResult([]));
    const resolveGoogleMapsApiKey = vi.fn(() => "super-secret-key");

    await runWorkflow(configPath, {
      runDiscovery: discovery,
      runShortlistReport: shortlist,
      resolveGoogleMapsApiKey
    });

    expect(resolveGoogleMapsApiKey).toHaveBeenCalledTimes(1);
    expect(discovery).toHaveBeenCalledWith({
      provider: "google-places",
      query: "dentist Istanbul",
      profile: "generic",
      outDir: resolvedWorkflowPaths().reportsDir,
      exportCsv: resolvedWorkflowPaths().leadsCsv,
      summaryJson: resolvedWorkflowPaths().discoverySummaryJson,
      dryRun: false,
      concurrency: 3,
      limit: 7,
      apiKey: "super-secret-key"
    });
  });

  it("does not create output or call downstream dependencies when config validation fails", async () => {
    await writeWorkflowConfig({
      version: 1,
      outDir: "./artifacts/run-output",
      discovery: {
        provider: "manual-csv",
        input: "./input/manual.csv"
      }
    });

    const paths = resolvedWorkflowPaths();
    const discovery = vi.fn();
    const shortlist = vi.fn();
    const summarizeReviewCsvFile = vi.fn();
    const packageReport = vi.fn();

    await expect(
      runWorkflow(configPath, {
        runDiscovery: discovery,
        runShortlistReport: shortlist,
        summarizeReviewCsvFile,
        packageReport
      })
    ).rejects.toThrow();

    expect(existsSync(paths.outDir)).toBe(false);
    expect(existsSync(paths.workflowSummaryJson)).toBe(false);
    expect(discovery).not.toHaveBeenCalled();
    expect(shortlist).not.toHaveBeenCalled();
    expect(summarizeReviewCsvFile).not.toHaveBeenCalled();
    expect(packageReport).not.toHaveBeenCalled();
  });

  it("fails fast on discovery errors, writes a failed summary, and leaves dependent stages not-run", async () => {
    await writeWorkflowConfig(
      manualWorkflowConfig({
        review: { csv: "./operator/review.csv" },
        packageReports: true
      })
    );

    const discovery = vi.fn(async () => {
      throw new Error("Discovery exploded");
    });
    const shortlist = vi.fn();
    const summarizeReviewCsvFile = vi.fn();
    const packageReport = vi.fn();

    await expect(
      runWorkflow(configPath, {
        runDiscovery: discovery,
        runShortlistReport: shortlist,
        summarizeReviewCsvFile,
        packageReport
      })
    ).rejects.toMatchObject({
      name: "WorkflowRunError",
      summary: {
        status: "failed",
        error: {
          stage: "discovery",
          message: "Discovery exploded"
        }
      }
    });

    const { summary } = readSummaryFile();
    expect(summary.stages.discovery.status).toBe("failed");
    expect(summary.stages.shortlist.status).toBe("not-run");
    expect(summary.stages.review.status).toBe("not-run");
    expect(summary.stages.packaging.status).toBe("not-run");
    expect(shortlist).not.toHaveBeenCalled();
    expect(summarizeReviewCsvFile).not.toHaveBeenCalled();
    expect(packageReport).not.toHaveBeenCalled();
  });

  it("fails fast on shortlist errors after a successful discovery stage", async () => {
    await writeWorkflowConfig(
      manualWorkflowConfig({
        review: { csv: "./operator/review.csv" },
        packageReports: true
      })
    );

    const discovery = vi.fn(async () => makeDiscoveryResult(2));
    const shortlist = vi.fn(async () => {
      throw new Error("Shortlist failed");
    });
    const summarizeReviewCsvFile = vi.fn();
    const packageReport = vi.fn();

    await expect(
      runWorkflow(configPath, {
        runDiscovery: discovery,
        runShortlistReport: shortlist,
        summarizeReviewCsvFile,
        packageReport
      })
    ).rejects.toBeInstanceOf(WorkflowRunError);

    const { summary } = readSummaryFile();
    expect(summary.error).toEqual({
      stage: "shortlist",
      message: "Shortlist failed"
    });
    expect(summary.stages.discovery.status).toBe("success");
    expect(summary.stages.shortlist.status).toBe("failed");
    expect(summary.stages.review.status).toBe("not-run");
    expect(summary.stages.packaging.status).toBe("not-run");
    expect(summarizeReviewCsvFile).not.toHaveBeenCalled();
    expect(packageReport).not.toHaveBeenCalled();
  });

  it("fails fast on review errors after successful discovery and shortlist stages", async () => {
    await writeWorkflowConfig(
      manualWorkflowConfig({
        review: { csv: "./operator/review.csv", staleBefore: "2026-06-01" },
        packageReports: true
      })
    );

    const discovery = vi.fn(async () => makeDiscoveryResult(2));
    const shortlist = vi.fn(async () => makeShortlistResult([makeLead()]));
    const summarizeReviewCsvFile = vi.fn(async () => {
      throw new Error("Review summary failed");
    });
    const packageReport = vi.fn();

    await expect(
      runWorkflow(configPath, {
        runDiscovery: discovery,
        runShortlistReport: shortlist,
        summarizeReviewCsvFile,
        packageReport
      })
    ).rejects.toBeInstanceOf(WorkflowRunError);

    const { summary } = readSummaryFile();
    expect(summary.error).toEqual({
      stage: "review",
      message: "Review summary failed"
    });
    expect(summary.stages.discovery.status).toBe("success");
    expect(summary.stages.shortlist.status).toBe("success");
    expect(summary.stages.review.status).toBe("failed");
    expect(summary.stages.packaging.status).toBe("not-run");
    expect(packageReport).not.toHaveBeenCalled();
  });

  it("skips optional review and packaging stages when they are not enabled", async () => {
    await writeWorkflowConfig(manualWorkflowConfig());

    const discovery = vi.fn(async () => makeDiscoveryResult(1));
    const shortlist = vi.fn(async () => makeShortlistResult([makeLead()]));
    const summarizeReviewCsvFile = vi.fn();
    const packageReport = vi.fn();

    const summary = await runWorkflow(configPath, {
      runDiscovery: discovery,
      runShortlistReport: shortlist,
      summarizeReviewCsvFile,
      packageReport
    });

    expect(summary.stages.review.status).toBe("skipped");
    expect(summary.stages.packaging.status).toBe("skipped");
    expect(summary.packages).toEqual({
      packaged: 0,
      skipped: 0,
      failed: 0,
      entries: []
    });
    expect(summarizeReviewCsvFile).not.toHaveBeenCalled();
    expect(packageReport).not.toHaveBeenCalled();
  });

  it("skips packaging per lead when reportPath is blank", async () => {
    await writeWorkflowConfig(manualWorkflowConfig({ packageReports: true }));

    const discovery = vi.fn(async () => makeDiscoveryResult(1));
    const shortlist = vi.fn(async () =>
      makeShortlistResult([
        makeLead({
          companyName: "Needs Manual Packaging",
          leadKey: "url:https://blank.test",
          reportPath: ""
        })
      ])
    );
    const packageReport = vi.fn();

    const summary = await runWorkflow(configPath, {
      runDiscovery: discovery,
      runShortlistReport: shortlist,
      packageReport
    });

    expect(summary.status).toBe("success");
    expect(summary.stages.packaging).toEqual({
      status: "success",
      packaged: 0,
      skipped: 1,
      failed: 0
    });
    expect(summary.packages.entries).toEqual([
      {
        leadKey: "url:https://blank.test",
        companyName: "Needs Manual Packaging",
        status: "skipped"
      }
    ]);
    expect(packageReport).not.toHaveBeenCalled();
  });

  it("continues packaging after per-lead failures, writes the failed summary, and throws the same summary", async () => {
    await writeWorkflowConfig(manualWorkflowConfig({ packageReports: true }));

    const discovery = vi.fn(async () => makeDiscoveryResult(3));
    const shortlist = vi.fn(async () =>
      makeShortlistResult([
        makeLead({
          companyName: "Pack Success",
          leadKey: "url:https://success.test",
          reportPath: "success/open-local-audit-report.html"
        }),
        makeLead({
          companyName: "Pack Failure",
          leadKey: "url:https://failure.test",
          reportPath: "failure/open-local-audit-report.html"
        }),
        makeLead({
          companyName: "Pack Skipped",
          leadKey: "url:https://skipped.test",
          reportPath: ""
        })
      ])
    );
    const packageReport = vi
      .fn()
      .mockImplementationOnce(async ({ outDir }: { inputDir: string; outDir: string }) => makePackResult(outDir))
      .mockImplementationOnce(async () => {
        throw new Error("Missing packaged report");
      });

    let capturedError: WorkflowRunError | undefined;
    try {
      await runWorkflow(configPath, {
        runDiscovery: discovery,
        runShortlistReport: shortlist,
        packageReport
      });
    } catch (error) {
      capturedError = error as WorkflowRunError;
    }

    expect(capturedError).toBeInstanceOf(WorkflowRunError);
    expect(packageReport).toHaveBeenCalledTimes(2);
    expect(capturedError?.summary.status).toBe("failed");
    expect(capturedError?.summary.stages.packaging).toEqual({
      status: "failed",
      packaged: 1,
      skipped: 1,
      failed: 1
    });
    expect(capturedError?.summary.packages.entries).toEqual([
      {
        leadKey: "url:https://success.test",
        companyName: "Pack Success",
        status: "packaged",
        outDir: join(resolvedWorkflowPaths().packagesDir, "pack-success")
      },
      {
        leadKey: "url:https://failure.test",
        companyName: "Pack Failure",
        status: "failed",
        error: "Missing packaged report"
      },
      {
        leadKey: "url:https://skipped.test",
        companyName: "Pack Skipped",
        status: "skipped"
      }
    ]);
    expect(capturedError?.summary).toEqual(readSummaryFile().summary);
  });

  it("rejects traversal outside the reports directory per lead without calling packageReport", async () => {
    await writeWorkflowConfig(manualWorkflowConfig({ packageReports: true }));

    const discovery = vi.fn(async () => makeDiscoveryResult(2));
    const shortlist = vi.fn(async () =>
      makeShortlistResult([
        makeLead({
          companyName: "Good Lead",
          leadKey: "url:https://good.test",
          reportPath: "good/open-local-audit-report.html"
        }),
        makeLead({
          companyName: "Escaping Lead",
          leadKey: "url:https://escape.test",
          reportPath: "../outside/open-local-audit-report.html"
        })
      ])
    );
    const packageReport = vi.fn(async ({ outDir }: { inputDir: string; outDir: string }) => makePackResult(outDir));

    await expect(
      runWorkflow(configPath, {
        runDiscovery: discovery,
        runShortlistReport: shortlist,
        packageReport
      })
    ).rejects.toBeInstanceOf(WorkflowRunError);

    expect(packageReport).toHaveBeenCalledTimes(1);
    expect(readSummaryFile().summary.packages.entries).toEqual([
      {
        leadKey: "url:https://good.test",
        companyName: "Good Lead",
        status: "packaged",
        outDir: join(resolvedWorkflowPaths().packagesDir, "good-lead")
      },
      {
        leadKey: "url:https://escape.test",
        companyName: "Escaping Lead",
        status: "failed",
        error: "Report path escapes reports directory"
      }
    ]);
  });

  it("writes summaries without leaking the API key, config object, stack, or cause", async () => {
    await writeWorkflowConfig(googleWorkflowConfig());

    const discovery = vi.fn(async () => {
      throw new Error("Network denied");
    });
    const shortlist = vi.fn();
    const resolveGoogleMapsApiKey = vi.fn(() => "super-secret-key");

    await expect(
      runWorkflow(configPath, {
        runDiscovery: discovery,
        runShortlistReport: shortlist,
        resolveGoogleMapsApiKey
      })
    ).rejects.toBeInstanceOf(WorkflowRunError);

    const { content } = readSummaryFile();
    expect(content).not.toContain("super-secret-key");
    expect(content).not.toContain("\"config\"");
    expect(content).not.toContain("\"stack\"");
    expect(content).not.toContain("\"cause\"");
  });
});
