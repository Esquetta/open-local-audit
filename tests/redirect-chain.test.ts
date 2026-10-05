import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { auditSnapshot, auditUrl } from "../src/audit.js";
import { enrichWebsite } from "../src/website-enrichment.js";
import type { PageSnapshot, RedirectHop } from "../src/types.js";

let server: Server | undefined;

async function startServer(): Promise<string> {
  server = createServer((request, response) => {
    if (request.url === "/old") {
      response.writeHead(301, { location: "/moved" });
      response.end();
      return;
    }

    if (request.url === "/moved") {
      response.writeHead(302, { location: "/" });
      response.end();
      return;
    }

    response.writeHead(200, { "content-type": "text/html" });
    response.end("<html><title>Example</title></html>");
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

function snapshot(redirects?: RedirectHop[]): PageSnapshot {
  return {
    url: "http://example.test/",
    finalUrl: "https://www.example.test/",
    statusCode: 200,
    headers: {},
    html: "<html><title>Example</title></html>",
    redirects
  };
}

function chainFinding(redirects?: RedirectHop[]) {
  return auditSnapshot(snapshot(redirects)).findings.find((finding) => finding.id === "redirect-chain-short");
}

describe("redirect chain checks", () => {
  it("allows no redirect, a single redirect, or an unknown chain", () => {
    expect(chainFinding([])).toBeUndefined();
    expect(chainFinding([{ url: "http://example.test/", statusCode: 301 }])).toBeUndefined();
    expect(chainFinding(undefined)).toBeUndefined();
  });

  it("flags more than one redirect and shows every hop", () => {
    const finding = chainFinding([
      { url: "http://example.test/", statusCode: 301 },
      { url: "https://example.test/", statusCode: 302 }
    ]);

    expect(finding?.severity).toBe("low");
    expect(finding?.evidence[0]?.value).toBe(
      "http://example.test/ (301) -> https://example.test/ (302) -> https://www.example.test/"
    );
  });

  it("records each redirect hop when auditing a URL", async () => {
    const origin = await startServer();
    const report = await auditUrl(`${origin}/old`, { timeoutMs: 5000 });

    expect(report.findings.find((finding) => finding.id === "redirect-chain-short")?.evidence[0]?.value).toBe(
      `${origin}/old (301) -> ${origin}/moved (302) -> ${origin}/`
    );
  });

  it("records redirect hops during website enrichment", async () => {
    const result = await enrichWebsite("https://shop.example/", {
      resolve: async () => ["93.184.216.34"],
      fetch: async (input) => {
        const url = input.toString();
        if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
        if (url === "https://shop.example/") return new Response(null, { status: 301, headers: { location: "/home" } });
        return new Response("<title>Shop</title>", { headers: { "content-type": "text/html" } });
      }
    });

    expect(result.snapshot?.redirects).toEqual([{ url: "https://shop.example/", statusCode: 301 }]);
    expect(result.snapshot?.finalUrl).toBe("https://shop.example/home");
  });
});
