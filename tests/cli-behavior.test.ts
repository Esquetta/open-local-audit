import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    <a href="tel:+902120000000">Call now</a>
    <a href="https://wa.me/902120000000">WhatsApp</a>
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
          exportCsv
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
      expect(csv).toContain("Example Dental");
      expect(csv).toContain("No Site Clinic");
      expect(csv).toContain("not-audited");
      expect(csv).toContain("opportunityScore");
      expect(csv).toContain("Build a basic website");
      expect(result.stdout).toContain("With website: 1");
      expect(result.stdout).toContain("Without website: 1");
      expect(JSON.parse(readFileSync(summaryJson, "utf8"))).toMatchObject({
        totalCandidates: 2,
        withWebsite: 1,
        withoutWebsite: 1,
        notAudited: 2
      });
      expect(existsSync(join(outDir, "open-local-audit-batch-index.json"))).toBe(false);
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
