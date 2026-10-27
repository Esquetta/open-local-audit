import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { requestWithPinnedLookup } from "../src/website-enrichment.js";

describe("responses discovery cannot represent", () => {
  it("rejects a status outside 200-599 instead of crashing the process", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(999, { "content-type": "text/html" });
      response.end("<p>Request denied</p>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as AddressInfo;
      await expect(requestWithPinnedLookup(new URL(`http://site.example:${port}/`), ["127.0.0.1"], new AbortController().signal)).rejects.toThrow(
        "website returned an invalid HTTP status 999"
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
