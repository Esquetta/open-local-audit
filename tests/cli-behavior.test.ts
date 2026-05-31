import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { auditSnapshot } from "../src/audit.js";
import { shouldFailOnThreshold } from "../src/exit-policy.js";
import { renderTerminalSummary } from "../src/summary.js";

const report = auditSnapshot(
  {
    url: "https://example.test",
    finalUrl: "https://example.test",
    statusCode: 200,
    headers: {
      "content-type": "text/html"
    },
    html: "<html><head><title></title></head><body><h1></h1></body></html>",
    resources: {
      robotsTxt: {
        url: "https://example.test/robots.txt",
        finalUrl: "https://example.test/robots.txt",
        statusCode: 404
      },
      sitemapXml: {
        url: "https://example.test/sitemap.xml",
        finalUrl: "https://example.test/sitemap.xml",
        statusCode: 404
      }
    }
  },
  "2026-05-08T00:00:00.000Z"
);

function removeTempDir(path: string): void {
  rmSync(path, {
    force: true,
    recursive: true,
    maxRetries: 5,
    retryDelay: 100
  });
}

async function spawnCli(args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

async function startLocalBusinessServer(): Promise<{ server: Server; url: string }> {
  const server = createServer((request, response) => {
    if (request.url === "/robots.txt" || request.url === "/sitemap.xml") {
      response.writeHead(404);
      response.end("");
      return;
    }

    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
<html>
  <head>
    <title>Example Dental Clinic</title>
    <meta name="description" content="Dental care in Istanbul with appointments and emergency support.">
  </head>
  <body>
    <h1>Example Dental Clinic</h1>
    <p>Call us for dental implants, orthodontics, and emergency dental appointments.</p>
    <a href="mailto:hello@localclinic.com">Email</a>
    <a href="tel:+902120000000">Call now</a>
    <a href="https://wa.me/902120000000">WhatsApp</a>
    <a href="/contact">Contact</a>
    <a href="https://www.instagram.com/localclinic">Instagram</a>
    <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Dentist","name":"Example Dental Clinic","telephone":"+902120000000"}
    </script>
  </body>
</html>`);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address() as AddressInfo;
  return {
    server,
    url: `http://127.0.0.1:${address.port}/`
  };
}

describe("CLI behavior helpers", () => {
  it("fails when findings meet the configured severity threshold", () => {
    expect(shouldFailOnThreshold(report, "high")).toBe(true);
    expect(shouldFailOnThreshold(report, "medium")).toBe(true);
    expect(shouldFailOnThreshold(report, "none")).toBe(false);
  });

  it("renders a compact terminal summary", () => {
    const summary = renderTerminalSummary(report);

    expect(summary).toContain("Overall score:");
    expect(summary).toContain("High:");
    expect(summary).toContain("Medium:");
    expect(summary).toContain("Top issue:");
  });

  it("rejects a positional URL when batch input is used", () => {
    const tmp = mkdtempSync(join(tmpdir(), "open-local-audit-cli-"));
    try {
      const inputPath = join(tmp, "sites.txt");
      const outDir = join(tmp, "reports");
      writeFileSync(inputPath, "https://example.test\n", "utf8");

      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/cli.ts",
          "https://ignored.test",
          "--input",
          inputPath,
          "--out-dir",
          outDir,
          "--timeout",
          "1"
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8"
        }
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Use either a URL or --input, not both");
      expect(result.stdout).not.toContain("Audited");
    } finally {
      removeTempDir(tmp);
    }
  });

  it("accepts batch triage options before validating mutually exclusive input", () => {
    const tmp = mkdtempSync(join(tmpdir(), "open-local-audit-cli-"));
    try {
      const inputPath = join(tmp, "sites.txt");
      const outDir = join(tmp, "reports");
      writeFileSync(inputPath, "https://example.test\n", "utf8");

      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/cli.ts",
          "https://ignored.test",
          "--input",
          inputPath,
          "--out-dir",
          outDir,
          "--segment",
          "dental",
          "--min-score",
          "70",
          "--top",
          "5",
          "--sort",
          "severity-desc",
          "--concurrency",
          "3"
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8"
        }
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Use either a URL or --input, not both");
      expect(result.stderr).not.toContain("unknown option");
      expect(result.stdout).not.toContain("Audited");
    } finally {
      removeTempDir(tmp);
    }
  });

  it("requires an output directory when screenshot capture is requested", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "https://example.test", "--screenshot"], {
      cwd: process.cwd(),
      encoding: "utf8"
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--out-dir is required when --screenshot is used");
    expect(result.stderr).not.toContain("Playwright is required");
  });

  it("accepts brand config before validating mutually exclusive input", () => {
    const tmp = mkdtempSync(join(tmpdir(), "open-local-audit-cli-brand-"));
    try {
      const inputPath = join(tmp, "sites.txt");
      const outDir = join(tmp, "reports");
      const brandPath = join(tmp, "brand.json");
      writeFileSync(inputPath, "https://example.test\n", "utf8");
      writeFileSync(brandPath, JSON.stringify({ name: "TORUT Audit Studio" }), "utf8");

      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/cli.ts",
          "https://ignored.test",
          "--input",
          inputPath,
          "--out-dir",
          outDir,
          "--brand-config",
          brandPath
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8"
        }
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Use either a URL or --input, not both");
      expect(result.stderr).not.toContain("unknown option");
    } finally {
      removeTempDir(tmp);
    }
  });

  it("accepts profile and export CSV options before validating mutually exclusive input", () => {
    const tmp = mkdtempSync(join(tmpdir(), "open-local-audit-cli-"));
    try {
      const inputPath = join(tmp, "sites.txt");
      const outDir = join(tmp, "reports");
      const exportCsv = join(tmp, "prospects.csv");
      writeFileSync(inputPath, "https://example.test\n", "utf8");

      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/cli.ts",
          "https://ignored.test",
          "--input",
          inputPath,
          "--out-dir",
          outDir,
          "--profile",
          "dental",
          "--export-csv",
          exportCsv,
          "--export-preset",
          "crm"
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8"
        }
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Use either a URL or --input, not both");
      expect(result.stderr).not.toContain("unknown option");
    } finally {
      removeTempDir(tmp);
    }
  });

  it("writes CRM-ready batch CSV output", () => {
    const tmp = mkdtempSync(join(tmpdir(), "open-local-audit-cli-batch-crm-"));
    try {
      const inputPath = join(tmp, "sites.txt");
      const outDir = join(tmp, "reports");
      const exportCsv = join(tmp, "crm-prospects.csv");
      writeFileSync(inputPath, "https://example.test\n", "utf8");

      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/cli.ts",
          "--input",
          inputPath,
          "--out-dir",
          outDir,
          "--format",
          "json",
          "--timeout",
          "1",
          "--export-csv",
          exportCsv,
          "--export-preset",
          "crm"
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8"
        }
      );

      expect(result.status).toBe(0);
      expect(readFileSync(exportCsv, "utf8").split(/\r?\n/)[0]).toBe(
        "companyName,website,segment,profile,priority,score,opportunityScore,topFinding,contactConfidence,preferredContactChannel,contactabilityReason,publicEmail,publicPhone,contactPageUrl,source,leadKey,reportPath"
      );
    } finally {
      removeTempDir(tmp);
    }
  });

  it("rejects unknown CSV export presets", () => {
    const tmp = mkdtempSync(join(tmpdir(), "open-local-audit-cli-export-preset-"));
    try {
      const inputPath = join(tmp, "sites.txt");
      writeFileSync(inputPath, "https://example.test\n", "utf8");

      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/cli.ts",
          "--input",
          inputPath,
          "--out-dir",
          join(tmp, "reports"),
          "--export-csv",
          join(tmp, "out.csv"),
          "--export-preset",
          "remote-crm"
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8"
        }
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Invalid enum value");
    } finally {
      removeTempDir(tmp);
    }
  });

  it("validates a clean CRM export CSV", () => {
    const tmp = mkdtempSync(join(tmpdir(), "open-local-audit-cli-validate-clean-"));
    try {
      const inputPath = join(tmp, "crm.csv");
      writeFileSync(
        inputPath,
        [
          "companyName,website,segment,profile,priority,score,opportunityScore,topFinding,contactConfidence,preferredContactChannel,contactabilityReason,publicEmail,publicPhone,contactPageUrl,source,leadKey,reportPath",
          "Clinic A,https://clinic-a.test,dental,dental,high,82,74,Low contrast,High,email,Public email found,hello@clinic-a.test,'+902120000000,https://clinic-a.test/contact,manual-csv,url:https://clinic-a.test,clinic-a/open-local-audit-report.html"
        ].join("\n"),
        "utf8"
      );

      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", "src/cli.ts", "validate-export", "--input", inputPath, "--preset", "crm"],
        {
          cwd: process.cwd(),
          encoding: "utf8"
        }
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("# CRM Export Validation");
      expect(result.stdout).toContain("No import issues found.");
    } finally {
      removeTempDir(tmp);
    }
  });

  it("returns JSON and a failing status for CRM export issues", () => {
    const tmp = mkdtempSync(join(tmpdir(), "open-local-audit-cli-validate-issues-"));
    try {
      const inputPath = join(tmp, "crm.csv");
      writeFileSync(
        inputPath,
        [
          "companyName,website,segment,profile,priority,score,opportunityScore,topFinding,contactConfidence,preferredContactChannel,contactabilityReason,publicEmail,publicPhone,contactPageUrl,source,leadKey,reportPath",
          ",,dental,dental,medium,70,60,Missing title,None,manual-review,No public contact,,,,manual-csv,url:https://clinic-a.test,"
        ].join("\n"),
        "utf8"
      );

      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/cli.ts",
          "validate-export",
          "--input",
          inputPath,
          "--preset",
          "crm",
          "--format",
          "json"
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8"
        }
      );

      expect(result.status).toBe(1);
      const output = JSON.parse(result.stdout);
      expect(output.summary).toMatchObject({
        rows: 1,
        errors: 2,
        warnings: 2,
        valid: false
      });
      expect(output.issues.map((issue: { code: string }) => issue.code)).toEqual([
        "missing-company-name",
        "missing-website",
        "low-contact-confidence",
        "manual-contact-review"
      ]);
    } finally {
      removeTempDir(tmp);
    }
  });

  it("rejects unsupported export validation presets", () => {
    const tmp = mkdtempSync(join(tmpdir(), "open-local-audit-cli-validate-preset-"));
    try {
      const inputPath = join(tmp, "crm.csv");
      writeFileSync(inputPath, "companyName\nClinic A\n", "utf8");

      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", "src/cli.ts", "validate-export", "--input", inputPath, "--preset", "standard"],
        {
          cwd: process.cwd(),
          encoding: "utf8"
        }
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("validate-export currently supports --preset crm only");
    } finally {
      removeTempDir(tmp);
    }
  });

  it("packages an existing single-site report directory", () => {
    const tmp = mkdtempSync(join(tmpdir(), "open-local-audit-cli-package-report-"));
    try {
      const inputDir = join(tmp, "site");
      const outDir = join(tmp, "pack");
      mkdirSync(inputDir, { recursive: true });
      const sourceReport = auditSnapshot(
        {
          url: "https://package.test",
          finalUrl: "https://package.test",
          statusCode: 200,
          headers: {
            "content-type": "text/html"
          },
          html: "<html><head><title></title></head><body><h1></h1></body></html>"
        },
        "2026-05-28T00:00:00.000Z"
      );
      writeFileSync(join(inputDir, "open-local-audit-report.json"), `${JSON.stringify(sourceReport, null, 2)}\n`, "utf8");
      writeFileSync(join(inputDir, "open-local-audit-report.md"), "# Open Local Audit Report\n", "utf8");

      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", "src/cli.ts", "package-report", "--input", inputDir, "--out", outDir],
        {
          cwd: process.cwd(),
          encoding: "utf8"
        }
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Packaged report for https://package.test");
      expect(readFileSync(join(outDir, "README.md"), "utf8")).toContain("# Open Local Audit Report Pack");
      expect(readFileSync(join(outDir, "next-actions.md"), "utf8")).toContain("# Next Actions");
      expect(JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8"))).toMatchObject({
        url: "https://package.test",
        finalUrl: "https://package.test"
      });
      expect(existsSync(join(outDir, "reports", "open-local-audit-report.md"))).toBe(true);
    } finally {
      removeTempDir(tmp);
    }
  });

  it("reports a clear package-report error for missing JSON reports", () => {
    const tmp = mkdtempSync(join(tmpdir(), "open-local-audit-cli-package-report-missing-"));
    try {
      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", "src/cli.ts", "package-report", "--input", tmp, "--out", join(tmp, "pack")],
        {
          cwd: process.cwd(),
          encoding: "utf8"
        }
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("package-report requires open-local-audit-report.json in the input directory");
    } finally {
      removeTempDir(tmp);
    }
  });

  it("writes a markdown lead shortlist from a CSV export", () => {
    const tmp = mkdtempSync(join(tmpdir(), "open-local-audit-cli-shortlist-"));
    try {
      const inputPath = join(tmp, "leads.csv");
      const outPath = join(tmp, "shortlist.md");
      writeFileSync(
        inputPath,
        [
          "companyName,website,segment,profile,priority,score,opportunityScore,topFinding,contactConfidence,preferredContactChannel,contactabilityReason,source,leadKey,reportPath",
          "Lower Lead,https://lower.test,dental,dental,medium,80,60,Missing title,High,email,Public email found,manual-csv,url:https://lower.test,lower/open-local-audit-report.html",
          "Best Lead,https://best.test,dental,dental,high,70,95,Missing CTA,Medium,phone,Phone found,manual-csv,url:https://best.test,best/open-local-audit-report.html"
        ].join("\n"),
        "utf8"
      );

      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", "src/cli.ts", "shortlist", "--input", inputPath, "--out", outPath, "--top", "1"],
        {
          cwd: process.cwd(),
          encoding: "utf8"
        }
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Shortlisted 1 of 2 leads");
      const markdown = readFileSync(outPath, "utf8");
      expect(markdown).toContain("# Lead Shortlist");
      expect(markdown).toContain("| 1 | Best Lead | https://best.test | high | 95 | 70 | Medium | phone | Missing CTA | best/open-local-audit-report.html |");
      expect(markdown).not.toContain("Lower Lead");
    } finally {
      removeTempDir(tmp);
    }
  });

  it("writes a JSON lead shortlist from a CSV export", () => {
    const tmp = mkdtempSync(join(tmpdir(), "open-local-audit-cli-shortlist-json-"));
    try {
      const inputPath = join(tmp, "leads.csv");
      const outPath = join(tmp, "shortlist.json");
      writeFileSync(
        inputPath,
        [
          "label,websiteUrl,priority,score,opportunityScore,contactConfidence,preferredContactChannel,topFinding,reportPath",
          "JSON Lead,https://json.test,high,88,92,High,email,Missing CTA,json/open-local-audit-report.html"
        ].join("\n"),
        "utf8"
      );

      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/cli.ts",
          "shortlist",
          "--input",
          inputPath,
          "--out",
          outPath,
          "--format",
          "json"
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8"
        }
      );

      expect(result.status).toBe(0);
      expect(JSON.parse(readFileSync(outPath, "utf8"))).toMatchObject({
        totalRows: 1,
        selected: 1,
        leads: [{ companyName: "JSON Lead" }]
      });
    } finally {
      removeTempDir(tmp);
    }
  });

  it("runs manual CSV lead discovery in dry-run mode", () => {
    const tmp = mkdtempSync(join(tmpdir(), "open-local-audit-discover-"));
    try {
      const inputPath = join(tmp, "places.csv");
      const outDir = join(tmp, "reports");
      const exportCsv = join(tmp, "leads.csv");
      const summaryJson = join(tmp, "discovery-summary.json");
      writeFileSync(
        inputPath,
        "label,website,segment,profile\nExample Dental,https://example.test,dental,dental\nNo Site Clinic,,dental,dental\n",
        "utf8"
      );

      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/cli.ts",
          "discover",
          "--input",
          inputPath,
          "--provider",
          "manual-csv",
          "--profile",
          "dental",
          "--out-dir",
          outDir,
          "--export-csv",
          exportCsv,
          "--summary-json",
          summaryJson,
          "--dry-run"
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8"
        }
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Discovered 2 lead");
      expect(existsSync(exportCsv)).toBe(true);
      const csv = readFileSync(exportCsv, "utf8");
      expect(csv).toContain("leadKey");
      expect(csv).toContain("reviewStatus");
      expect(csv).toContain("Example Dental");
      expect(csv).toContain("No Site Clinic");
      expect(csv).toContain("not-audited");
      expect(csv).toContain("opportunityScore");
      expect(csv).toContain("Build a basic website");
      expect(csv).toContain("preferredContactChannel");
      expect(csv).toContain("manual-review");
      expect(csv).toContain("No website URL found.");
      expect(result.stdout).toContain("With website: 1");
      expect(result.stdout).toContain("Without website: 1");
      expect(result.stdout).toContain("Suppressed: 0");
      expect(JSON.parse(readFileSync(summaryJson, "utf8"))).toMatchObject({
        totalCandidates: 2,
        suppressedCandidates: 0,
        withWebsite: 1,
        withoutWebsite: 1,
        notAudited: 2
      });
      expect(existsSync(join(outDir, "open-local-audit-batch-index.json"))).toBe(false);
    } finally {
      removeTempDir(tmp);
    }
  });

  it("writes CRM-ready discovery CSV output in dry-run mode", () => {
    const tmp = mkdtempSync(join(tmpdir(), "open-local-audit-discover-crm-"));
    try {
      const inputPath = join(tmp, "places.csv");
      const exportCsv = join(tmp, "crm-leads.csv");
      writeFileSync(
        inputPath,
        "label,website,segment,profile\nCRM Dental,https://crm-dental.test,dental,dental\n",
        "utf8"
      );

      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/cli.ts",
          "discover",
          "--input",
          inputPath,
          "--provider",
          "manual-csv",
          "--export-csv",
          exportCsv,
          "--export-preset",
          "crm",
          "--dry-run"
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8"
        }
      );

      expect(result.status).toBe(0);
      const csv = readFileSync(exportCsv, "utf8");
      expect(csv.split(/\r?\n/)[0]).toBe(
        "companyName,website,segment,profile,priority,score,opportunityScore,topFinding,contactConfidence,preferredContactChannel,contactabilityReason,publicEmail,publicPhone,contactPageUrl,source,leadKey,reportPath"
      );
      expect(csv).toContain("CRM Dental,https://crm-dental.test,dental,dental,medium,,55");
      expect(csv).toContain('manual-review,"Website was not audited, so public contactability is unknown."');
    } finally {
      removeTempDir(tmp);
    }
  });

  it("suppresses previously reviewed discovery leads before audit and export", () => {
    const tmp = mkdtempSync(join(tmpdir(), "open-local-audit-discover-suppression-"));
    try {
      const inputPath = join(tmp, "places.csv");
      const suppressionPath = join(tmp, "suppression.csv");
      const exportCsv = join(tmp, "leads.csv");
      const summaryJson = join(tmp, "summary.json");
      writeFileSync(
        inputPath,
        "label,website,segment,profile\nOld Dental,https://old.example,dental,dental\nFresh Dental,,dental,dental\n",
        "utf8"
      );
      writeFileSync(
        suppressionPath,
        "websiteUrl,reviewStatus,reviewReason,lastReviewedAt\nhttps://old.example/,rejected,Not a fit,2026-05-13\n",
        "utf8"
      );

      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/cli.ts",
          "discover",
          "--input",
          inputPath,
          "--provider",
          "manual-csv",
          "--export-csv",
          exportCsv,
          "--summary-json",
          summaryJson,
          "--suppression-list",
          suppressionPath,
          "--dry-run"
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8"
        }
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Discovered 1 lead");
      expect(result.stdout).toContain("Suppressed: 1");
      const csv = readFileSync(exportCsv, "utf8");
      expect(csv).not.toContain("Old Dental");
      expect(csv).toContain("Fresh Dental");
      expect(JSON.parse(readFileSync(summaryJson, "utf8"))).toMatchObject({
        totalCandidates: 1,
        suppressedCandidates: 1
      });
    } finally {
      removeTempDir(tmp);
    }
  });

  it("writes a review CSV and duplicate JSON for discovery reruns", () => {
    const tmp = mkdtempSync(join(tmpdir(), "open-local-audit-discover-review-"));
    try {
      const inputPath = join(tmp, "places.csv");
      const exportCsv = join(tmp, "leads.csv");
      const reviewCsv = join(tmp, "review.csv");
      const duplicatesJson = join(tmp, "duplicates.json");
      writeFileSync(
        inputPath,
        "label,website,segment,profile\nFirst Dental,https://dup.example,dental,dental\nSecond Dental,https://dup.example/,dental,dental\nKadikoy Smile Dental,https://smile.example/location-a,dental,dental\nKadikoy Smile Clinic,https://smile.example/location-b,dental,dental\nFresh Dental,,dental,dental\n",
        "utf8"
      );
      writeFileSync(
        reviewCsv,
        "leadKey,source,sourceId,label,websiteUrl,reviewStatus,reviewReason,lastReviewedAt\nurl:https://old.example,manual-csv,,Old Dental,https://old.example,rejected,Not a fit,2026-05-13\n",
        "utf8"
      );

      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/cli.ts",
          "discover",
          "--input",
          inputPath,
          "--provider",
          "manual-csv",
          "--export-csv",
          exportCsv,
          "--review-csv",
          reviewCsv,
          "--duplicates-json",
          duplicatesJson,
          "--dry-run"
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8"
        }
      );

      expect(result.status).toBe(0);
      const review = readFileSync(reviewCsv, "utf8");
      expect(review).toContain("Old Dental");
      expect(review).toContain("Fresh Dental");
      expect(review).toContain("pending");
      const duplicates = JSON.parse(readFileSync(duplicatesJson, "utf8"));
      expect(duplicates).toEqual({
        duplicateGroups: [
          {
            leadKey: "url:https://dup.example",
            count: 2,
            labels: ["First Dental", "Second Dental"],
            sources: ["manual-csv"]
          }
        ],
        fuzzyDuplicateGroups: [
          {
            matchKey: "domain:smile.example",
            confidence: "high",
            matchReasons: ["Shared website domain: smile.example", "Similar business labels"],
            count: 2,
            labels: ["Kadikoy Smile Clinic", "Kadikoy Smile Dental"],
            leadKeys: ["url:https://smile.example/location-a", "url:https://smile.example/location-b"],
            sources: ["manual-csv"]
          }
        ]
      });
    } finally {
      removeTempDir(tmp);
    }
  });

  it("filters exported discovery leads by minimum opportunity score", () => {
    const tmp = mkdtempSync(join(tmpdir(), "open-local-audit-discover-min-opportunity-"));
    try {
      const inputPath = join(tmp, "places.csv");
      const exportCsv = join(tmp, "leads.csv");
      writeFileSync(
        inputPath,
        "label,website,segment,profile\nWebsite Dental,https://website.example,dental,dental\nNo Site Dental,,dental,dental\n",
        "utf8"
      );

      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/cli.ts",
          "discover",
          "--input",
          inputPath,
          "--provider",
          "manual-csv",
          "--export-csv",
          exportCsv,
          "--min-opportunity-score",
          "90",
          "--dry-run"
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8"
        }
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Discovered 1 lead");
      const csv = readFileSync(exportCsv, "utf8");
      expect(csv).toContain("No Site Dental");
      expect(csv).not.toContain("Website Dental");
    } finally {
      removeTempDir(tmp);
    }
  });

  it("audits website-present manual CSV discovery rows", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "open-local-audit-discover-audit-"));
    const { server, url } = await startLocalBusinessServer();
    try {
      const inputPath = join(tmp, "places.csv");
      const outDir = join(tmp, "reports");
      const exportCsv = join(tmp, "leads.csv");
      writeFileSync(inputPath, `label,website,segment,profile\nExample Dental,${url},dental,dental\n`, "utf8");

      const result = await spawnCli(
        [
          "--import",
          "tsx",
          "src/cli.ts",
          "discover",
          "--input",
          inputPath,
          "--provider",
          "manual-csv",
          "--profile",
          "dental",
          "--out-dir",
          outDir,
          "--export-csv",
          exportCsv,
          "--concurrency",
          "1"
        ]
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Discovered 1 lead");
      const csv = readFileSync(exportCsv, "utf8");
      expect(csv).toContain("Example Dental");
      expect(csv).toContain("success");
      expect(csv).toContain("hello@localclinic.com");
      expect(csv).toContain("+902120000000");
      expect(csv).toContain(`http://127.0.0.1:${new URL(url).port}/contact`);
      expect(csv).toContain("https://www.instagram.com/localclinic");
      expect(csv).toContain("email");
      expect(csv).toContain("Send a personalized audit summary by email.");
      expect(csv).toContain("Public email found on the audited website.");
      expect(csv).toContain("127-0-0-1/open-local-audit-report.html");
      expect(existsSync(join(outDir, "open-local-audit-batch-index.json"))).toBe(true);
      expect(existsSync(join(outDir, "127-0-0-1"))).toBe(true);
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      removeTempDir(tmp);
    }
  });

  it("limits discovery audits while preserving unaudited website-present leads", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "open-local-audit-discover-max-audits-"));
    const { server, url } = await startLocalBusinessServer();
    try {
      const inputPath = join(tmp, "places.csv");
      const outDir = join(tmp, "reports");
      const exportCsv = join(tmp, "leads.csv");
      writeFileSync(
        inputPath,
        `label,website,segment,profile\nFirst Dental,${url},dental,dental\nSecond Dental,${url},dental,dental\n`,
        "utf8"
      );

      const result = await spawnCli([
        "--import",
        "tsx",
        "src/cli.ts",
        "discover",
        "--input",
        inputPath,
        "--provider",
        "manual-csv",
        "--profile",
        "dental",
        "--out-dir",
        outDir,
        "--export-csv",
        exportCsv,
        "--max-audits",
        "1"
      ]);

      expect(result.status).toBe(0);
      const csv = readFileSync(exportCsv, "utf8");
      expect(csv.match(/,success,/g)).toHaveLength(1);
      expect(csv.match(/,not-audited,/g)).toHaveLength(1);
      expect(result.stdout).toContain("Audited: 1");
      expect(result.stdout).toContain("Not audited: 1");
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      removeTempDir(tmp);
    }
  });

  it("requires an API key for Google Places discovery", () => {
    const tmp = mkdtempSync(join(tmpdir(), "open-local-audit-discover-provider-"));
    try {
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/cli.ts",
          "discover",
          "dental clinic",
          "--provider",
          "google-places",
          "--export-csv",
          join(tmp, "leads.csv"),
          "--dry-run"
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            GOOGLE_MAPS_API_KEY: "",
            OPEN_LOCAL_AUDIT_DISABLE_WINDOWS_ENV_FALLBACK: "1"
          },
          encoding: "utf8"
        }
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Google Maps Platform billing may apply");
      expect(result.stderr).toContain("GOOGLE_MAPS_API_KEY is required when --provider google-places is used");
    } finally {
      removeTempDir(tmp);
    }
  });

  it("rejects positional queries for manual CSV discovery", () => {
    const tmp = mkdtempSync(join(tmpdir(), "open-local-audit-discover-query-"));
    try {
      const inputPath = join(tmp, "places.csv");
      writeFileSync(inputPath, "label,website\nExample Dental,https://example.test\n", "utf8");

      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/cli.ts",
          "discover",
          "dental clinic",
          "--input",
          inputPath,
          "--provider",
          "manual-csv",
          "--export-csv",
          join(tmp, "leads.csv"),
          "--dry-run"
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8"
        }
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Manual CSV discovery does not accept a positional query");
    } finally {
      removeTempDir(tmp);
    }
  });
});
