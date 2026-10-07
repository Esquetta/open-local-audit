import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { auditSnapshot, auditUrl } from "../src/audit.js";
import type { PageSnapshot } from "../src/types.js";

let server: Server | undefined;

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

function snapshot(head: string, headers: Record<string, string> = {}): PageSnapshot {
  return {
    url: "https://example.test/",
    finalUrl: "https://example.test/",
    statusCode: 200,
    headers,
    html: `<html><head><title>Example</title>${head}</head><body></body></html>`
  };
}

function indexFinding(head: string, headers?: Record<string, string>) {
  return auditSnapshot(snapshot(head, headers)).findings.find((finding) => finding.id === "page-indexable");
}

describe("page indexability checks", () => {
  it("allows indexable pages", () => {
    expect(indexFinding("")).toBeUndefined();
    expect(indexFinding('<meta name="robots" content="index, follow">')).toBeUndefined();
    expect(indexFinding('<meta name="robots" content="nofollow">', { "x-robots-tag": "noarchive" })).toBeUndefined();
  });

  it("flags noindex and none in robots and googlebot meta tags", () => {
    const finding = indexFinding('<meta name="Robots" content="NOINDEX, follow">');

    expect(finding?.severity).toBe("high");
    expect(finding?.evidence[0]?.value).toBe("meta robots: NOINDEX, follow");
    expect(indexFinding('<meta name="googlebot" content="none">')?.evidence[0]?.value).toBe("meta googlebot: none");
  });

  it("ignores directives aimed at other crawlers", () => {
    expect(indexFinding('<meta name="bingbot" content="noindex">')).toBeUndefined();
    expect(indexFinding("", { "x-robots-tag": "otherbot: noindex, nofollow" })).toBeUndefined();
  });

  it("reads X-Robots-Tag directives and crawler prefixes", () => {
    expect(indexFinding("", { "x-robots-tag": "noindex" })?.evidence[0]?.value).toBe("X-Robots-Tag: noindex");
    expect(indexFinding("", { "x-robots-tag": "otherbot: nofollow, googlebot: noindex" })).toBeDefined();
    expect(indexFinding("", { "x-robots-tag": "unavailable_after: 25 Jun 2010 15:00:00 PST" })).toBeUndefined();
  });

  it("lists every noindex signal as evidence", () => {
    expect(indexFinding('<meta name="robots" content="noindex">', { "x-robots-tag": "none" })?.evidence[0]?.value).toBe(
      "meta robots: noindex; X-Robots-Tag: none"
    );
  });

  it("reads the X-Robots-Tag header when auditing a URL", async () => {
    server = createServer((request, response) => {
      response.writeHead(request.url === "/" ? 200 : 404, {
        "content-type": "text/html",
        "x-robots-tag": "noindex"
      });
      response.end("<html><title>Example</title></html>");
    });
    await new Promise<void>((resolve) => {
      server?.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address() as AddressInfo;

    const report = await auditUrl(`http://127.0.0.1:${address.port}/`, { timeoutMs: 5000 });

    expect(report.findings.find((finding) => finding.id === "page-indexable")?.evidence[0]?.value).toBe(
      "X-Robots-Tag: noindex"
    );
  });
});
