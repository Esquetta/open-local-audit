import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { auditSnapshot, auditUrl } from "../src/audit.js";
import { runBatchReports } from "../src/batch.js";
import { parseCsvLine } from "../src/csv.js";
import { buildProspectRows, renderProspectRowsCsv } from "../src/discovery.js";
import { detectDotnetStack } from "../src/dotnet-stack.js";
import { renderMarkdownReport } from "../src/reporters.js";

const pageUrl = "https://example.test/";

function detect(headers: Record<string, string>, html = "<html><title>Example</title></html>") {
  return detectDotnetStack({ finalUrl: pageUrl, headers, html });
}

const webFormsHtml = `<html><head><title>Clinic</title></head><body>
<form method="post" action="./Default.aspx" id="form1">
<input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="/wEPDwUKLTY1MzQ5" />
<input type="hidden" name="__VIEWSTATEGENERATOR" id="__VIEWSTATEGENERATOR" value="CA0B0334" />
<input type="hidden" name="__EVENTVALIDATION" id="__EVENTVALIDATION" value="/wEdAAKx" />
<script src="/WebResource.axd?d=abc&amp;t=123"></script>
</form></body></html>`;

describe("detectDotnetStack", () => {
  it("classifies Web Forms markup as legacy with high confidence", () => {
    const result = detect({}, webFormsHtml);

    expect(result).toMatchObject({ detected: true, stack: "aspnet-webforms", legacyFramework: true, confidence: "high" });
    expect(result.evidence.map((item) => item.signal)).toEqual([
      "__VIEWSTATE",
      "__EVENTVALIDATION",
      "__VIEWSTATEGENERATOR",
      ".aspx path",
      "WebResource.axd"
    ]);
    expect(result.evidence.every((item) => item.source === "html")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("/wEPDwUKLTY1MzQ5");
  });

  it("reads the framework version from X-AspNet-Version and keeps only cookie names", () => {
    const result = detect({
      "X-AspNet-Version": "4.0.30319",
      "set-cookie": "ASP.NET_SessionId=secretvalue; path=/; HttpOnly\nother=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT"
    });

    expect(result).toMatchObject({
      detected: true,
      stack: "aspnet-framework",
      legacyFramework: true,
      confidence: "high",
      frameworkVersion: "4.0.30319"
    });
    expect(result.evidence).toEqual([
      { source: "header", signal: "X-AspNet-Version", value: "4.0.30319" },
      { source: "cookie", signal: "ASP.NET_SessionId", value: "ASP.NET_SessionId" }
    ]);
    expect(JSON.stringify(result)).not.toContain("secretvalue");
  });

  it("classifies X-AspNetMvc-Version as legacy ASP.NET MVC without reporting it as the framework version", () => {
    const result = detect({ "x-aspnetmvc-version": "5.2" });
    expect(result).toMatchObject({
      stack: "aspnet-mvc",
      legacyFramework: true,
      confidence: "high",
      evidence: [{ source: "header", signal: "X-AspNetMvc-Version", value: "5.2" }]
    });
    expect(result.frameworkVersion).toBeUndefined();
  });

  it("classifies an .AspNetCore cookie as ASP.NET Core", () => {
    const result = detect({ "set-cookie": ".AspNetCore.Antiforgery.xyz=CfDJ8abc; path=/; samesite=strict; httponly" });

    expect(result).toMatchObject({ detected: true, stack: "aspnet-core", legacyFramework: false, confidence: "high" });
    expect(result.evidence).toEqual([{ source: "cookie", signal: ".AspNetCore.*", value: ".AspNetCore.Antiforgery.xyz" }]);
  });

  it("classifies a Blazor script as Blazor", () => {
    const result = detect({}, '<html><body><script src="_framework/blazor.web.js"></script></body></html>');

    expect(result).toMatchObject({ detected: true, stack: "blazor", legacyFramework: false, confidence: "high" });
    expect(result.evidence).toEqual([{ source: "html", signal: "Blazor script", value: "_framework/blazor.web.js" }]);
  });

  it("does not overclaim from IIS or X-Powered-By alone", () => {
    expect(detect({ Server: "Microsoft-IIS/10.0" })).toMatchObject({
      detected: true,
      stack: "aspnet-unknown",
      legacyFramework: false,
      confidence: "low",
      evidence: [{ source: "header", signal: "Server", value: "Microsoft-IIS/10.0" }]
    });
    expect(detect({ "x-powered-by": "ASP.NET" })).toMatchObject({
      stack: "aspnet-unknown",
      legacyFramework: false,
      confidence: "low"
    });
    expect(
      detect({}, '<form><input name="__RequestVerificationToken" type="hidden" value="token" /></form>')
    ).toMatchObject({ stack: "aspnet-unknown", legacyFramework: false, confidence: "low" });
  });

  it("returns none for a plain non-.NET page", () => {
    expect(
      detect(
        { server: "nginx", "x-powered-by": "PHP/8.3", "set-cookie": "PHPSESSID=abc; path=/" },
        '<html><body><a href="https://other.test/legacy/page.aspx">Partner</a></body></html>'
      )
    ).toEqual({ detected: false, stack: "none", legacyFramework: false, confidence: "none", evidence: [] });
  });

  it("lets ASP.NET Core signals win over IIS headers", () => {
    expect(
      detect({
        server: "Microsoft-IIS/10.0",
        "x-powered-by": "ASP.NET",
        "set-cookie": ".AspNetCore.Session=abc; path=/"
      })
    ).toMatchObject({ stack: "aspnet-core", legacyFramework: false, confidence: "high" });
  });
});

let server: Server | undefined;

async function startServer(): Promise<string> {
  server = createServer((request, response) => {
    if (request.url === "/legacy/") {
      response.setHeader("content-type", "text/html");
      response.setHeader("server", "Microsoft-IIS/8.5");
      response.setHeader("x-aspnet-version", "4.0.30319");
      response.setHeader("set-cookie", ["ASP.NET_SessionId=abc; path=/; HttpOnly", "theme=light; path=/"]);
      response.end(webFormsHtml);
      return;
    }

    response.writeHead(request.url === "/plain/" ? 200 : 404, { "content-type": "text/html" });
    response.end("<html><head><title>Plain</title></head><body><h1>Plain</h1></body></html>");
  });

  await new Promise<void>((resolve) => {
    server?.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    if (!server) {
      resolve();
      return;
    }

    server.close((error) => (error ? reject(error) : resolve()));
    server = undefined;
  });
});

describe("dotnet stack in audit results and exports", () => {
  it("adds dotnetStack to fetched audit results without changing findings or reports", async () => {
    const origin = await startServer();
    const report = await auditUrl(`${origin}/legacy/`, { timeoutMs: 5000 });

    expect(report.dotnetStack).toMatchObject({
      detected: true,
      stack: "aspnet-webforms",
      legacyFramework: true,
      confidence: "high",
      frameworkVersion: "4.0.30319"
    });
    expect(report.dotnetStack?.evidence).toContainEqual({ source: "cookie", signal: "ASP.NET_SessionId", value: "ASP.NET_SessionId" });

    const withoutDotnetSignals = auditSnapshot({ url: report.url, finalUrl: report.finalUrl, statusCode: 200, headers: {}, html: webFormsHtml });
    expect(report.findings.map((finding) => finding.id)).toEqual(withoutDotnetSignals.findings.map((finding) => finding.id));
    expect(report.scores).toEqual(withoutDotnetSignals.scores);
    expect(renderMarkdownReport(report)).not.toMatch(/dotnet|aspnet/i);
  });

  it("exports dotnetStack and dotnetLegacyFramework columns in batch and discovery CSVs", async () => {
    const origin = await startServer();
    const dir = await mkdtemp(join(tmpdir(), "open-local-audit-dotnet-"));
    const csvPath = join(dir, "prospects.csv");

    try {
      const results = await runBatchReports([`${origin}/legacy/`, `${origin}/plain/`], {
        format: "json",
        outDir: dir,
        exportCsv: csvPath
      });
      const rows = (await readFile(csvPath, "utf8")).trim().split(/\r?\n/).map(parseCsvLine);
      const stackColumn = rows[0].indexOf("dotnetStack");
      const legacyColumn = rows[0].indexOf("dotnetLegacyFramework");

      expect(rows[0].slice(-2)).toEqual(["dotnetStack", "dotnetLegacyFramework"]);
      expect([rows[1][stackColumn], rows[1][legacyColumn]]).toEqual(["aspnet-webforms", "yes"]);
      expect([rows[2][stackColumn], rows[2][legacyColumn]]).toEqual(["none", "no"]);

      const legacy = results[0];
      expect(legacy.status).toBe("success");
      const json = JSON.parse(await readFile(join(dir, legacy.slug, "open-local-audit-report.json"), "utf8"));
      expect(json.dotnetStack.stack).toBe("aspnet-webforms");

      const discoveryCsv = renderProspectRowsCsv(
        buildProspectRows([
          {
            candidate: { source: "manual-csv", label: "Legacy Clinic", websiteUri: `${origin}/legacy/` },
            resolution: { hasWebsite: true, websiteUrl: `${origin}/legacy/`, status: "resolved" },
            audit: { status: "success", score: 80, dotnetStack: legacy.status === "success" ? legacy.report.dotnetStack : undefined }
          },
          {
            candidate: { source: "manual-csv", label: "No Site" },
            resolution: { hasWebsite: false, status: "missing" }
          }
        ])
      );
      const discoveryRows = discoveryCsv.trim().split(/\r?\n/).map(parseCsvLine);
      const discoveryStack = discoveryRows[0].indexOf("dotnetStack");

      expect(discoveryRows[0].slice(discoveryStack, discoveryStack + 2)).toEqual(["dotnetStack", "dotnetLegacyFramework"]);
      expect(discoveryRows[1].slice(discoveryStack, discoveryStack + 2)).toEqual(["aspnet-webforms", "yes"]);
      expect(discoveryRows[2].slice(discoveryStack, discoveryStack + 2)).toEqual(["", ""]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
