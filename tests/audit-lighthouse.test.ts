import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { auditUrl } from "../src/audit.js";

let server: Server | undefined;

async function startServer(): Promise<string> {
  server = createServer((request, response) => {
    if (request.url === "/robots.txt" || request.url === "/sitemap.xml") {
      response.writeHead(404);
      response.end("");
      return;
    }

    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<html><head><title>Example</title></head><body><h1>Example</h1></body></html>");
  });

  await new Promise<void>((resolve) => {
    server?.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}/`;
}

afterEach(async () => {
  if (!server) {
    return;
  }

  await new Promise<void>((resolve) => {
    server?.close(() => resolve());
  });
  server = undefined;
});

describe("Lighthouse audits", () => {
  it("attaches Lighthouse category scores when requested", async () => {
    const url = await startServer();
    const calls: string[] = [];

    const report = await auditUrl(url, {
      lighthouse: true,
      runLighthouse: async (targetUrl) => {
        calls.push(targetUrl);
        return {
          requestedUrl: targetUrl,
          finalUrl: targetUrl,
          fetchTime: "2026-05-15T00:00:00.000Z",
          categories: {
            performance: 74,
            accessibility: 88,
            bestPractices: 92,
            seo: 96
          },
          warnings: ["Synthetic Lighthouse warning"]
        };
      }
    });

    expect(calls).toEqual([url]);
    expect(report.lighthouse).toMatchObject({
      requestedUrl: url,
      categories: {
        performance: 74,
        accessibility: 88,
        bestPractices: 92,
        seo: 96
      },
      warnings: ["Synthetic Lighthouse warning"]
    });
    expect(report.evidence).toContainEqual({
      label: "Lighthouse performance",
      value: "74"
    });
  });
});
