import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { auditUrl } from "../src/audit.js";

let server: Server | undefined;

async function startServer(): Promise<string> {
  server = createServer((request, response) => {
    if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`
        <html>
          <head>
            <title>Example</title>
            <meta name="description" content="Example">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <meta property="og:title" content="Example">
            <meta property="og:description" content="Example">
            <meta property="og:url" content="/">
            <link rel="canonical" href="/">
            <script type="application/ld+json">{"@type":"LocalBusiness"}</script>
          </head>
          <body>
            <h1>Example</h1>
            <a href="/ok">Working internal link</a>
            <a href="/missing">Broken internal link</a>
            <a href="https://outside.example/missing">External link</a>
            <a href="tel:+902120000000">Call</a>
            <a href="mailto:hello@example.test">Email</a>
            <a href="https://wa.me/902120000000">WhatsApp</a>
            <a href="/maps">Directions</a>
          </body>
        </html>
      `);
      return;
    }

    if (request.url === "/ok" || request.url === "/robots.txt" || request.url === "/sitemap.xml" || request.url === "/maps") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
      return;
    }

    response.writeHead(404, { "content-type": "text/plain" });
    response.end("missing");
  });

  await new Promise<void>((resolve) => {
    server?.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}/`;
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

describe("internal link checks", () => {
  it("reports broken same-origin links when link checking is enabled", async () => {
    const url = await startServer();
    const report = await auditUrl(url, {
      checkLinks: true,
      maxPages: 5,
      timeoutMs: 5000
    });

    const finding = report.findings.find((item) => item.id === "broken-internal-links");

    expect(finding?.evidence.map((item) => item.value).join(" ")).toContain("/missing");
    expect(finding?.evidence.map((item) => item.value).join(" ")).not.toContain("outside.example");
  });
});
