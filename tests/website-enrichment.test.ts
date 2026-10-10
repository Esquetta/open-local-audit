import { describe, expect, it, vi } from "vitest";
import { enrichWebsite } from "../src/website-enrichment.js";

const publicResolver = async () => ["93.184.216.34"];

function response(body: string, status = 200, headers: Record<string, string> = { "content-type": "text/html" }): Response {
  return new Response(body, { status, headers });
}

describe("website enrichment", () => {
  it("checks robots rules per path and keeps useful homepage contacts", async () => {
    const requests: string[] = [];
    const result = await enrichWebsite("https://shop.example/", {
      resolve: publicResolver,
      fetch: async (input) => {
        const url = input.toString(); requests.push(url);
        if (url.endsWith("/robots.txt")) return response("User-agent: *\nDisallow: /contact");
        return response('<a href="mailto:home@shop.example">Email</a><a href="/contact">Contact</a>');
      }
    });
    expect(requests).not.toContain("https://shop.example/contact");
    expect(result.status).toBe("success");
    expect(result.contact?.publicEmail).toBe("home@shop.example");
  });
  it("reads the homepage certificate from a checked public address", async () => {
    const tls = { validFrom: "2026-07-01T00:00:00.000Z", validTo: "2026-10-15T00:00:00.000Z", daysRemaining: 5, issuer: "R11", authorized: true };
    const probeTls = vi.fn(async () => tls);
    const fetchPage = async (input: string | URL | Request) =>
      input.toString().endsWith("/robots.txt") ? response("", 404) : response("<title>Shop</title>");

    const probed = await enrichWebsite("https://shop.example/", { resolve: publicResolver, fetch: fetchPage, probeTls });
    expect(probeTls).toHaveBeenCalledWith("https://shop.example/", expect.any(Number), "93.184.216.34");
    expect(probed.snapshot?.tls).toEqual(tls);

    let lookups = 0;
    const rebinding = vi.fn(async () => tls);
    const rebound = await enrichWebsite("https://shop.example/", {
      // The page requests see a public address; the lookup before the probe answers with loopback.
      resolve: async () => (++lookups > 2 ? ["127.0.0.1"] : ["93.184.216.34"]),
      fetch: fetchPage,
      probeTls: rebinding
    });
    expect(rebound.status).toBe("success");
    expect(rebinding).not.toHaveBeenCalled();
    expect(rebound.snapshot?.tls).toBeUndefined();

    expect((await enrichWebsite("http://shop.example/", { resolve: publicResolver, fetch: fetchPage, probeTls })).snapshot?.tls).toBeUndefined();
    expect((await enrichWebsite("https://shop.example/", { resolve: publicResolver, fetch: fetchPage })).snapshot?.tls).toBeUndefined();
  });
  it("bounds stalled DNS and rejects mapped loopback addresses", async () => {
    const result = await enrichWebsite("https://shop.example/", { timeoutMs: 10, resolve: () => new Promise(() => undefined) });
    expect(result.status).toBe("failed");
    const mapped = await enrichWebsite("https://shop.example/", { resolve: async () => ["::ffff:7f00:1"], fetch: async () => response("", 404) });
    expect(mapped.status).toBe("blocked");
  }, 1000);
  it("does not treat error-page contacts as a successful business audit", async () => {
    const result = await enrichWebsite("https://shop.example/", { resolve: publicResolver, fetch: async (input) => input.toString().endsWith("robots.txt") ? response("", 404) : response("provider@error.example", 500) });
    expect(result.status).toBe("failed");
    expect(result.contact).toBeUndefined();
  });
  it("does not request HTML when robots disallows the homepage", async () => {
    const requests: string[] = [];
    const result = await enrichWebsite("https://shop.example/", {
      resolve: publicResolver,
      fetch: async (input) => {
        const url = input.toString();
        requests.push(url);
        return response("User-agent: *\nDisallow: /", 200, { "content-type": "text/plain" });
      }
    });

    expect(result.status).toBe("blocked");
    expect(result.pagesFetched).toBe(0);
    expect(requests).toEqual(["https://shop.example/robots.txt"]);
  });

  it("bounds a slow or oversized response", async () => {
    const timedOut = await enrichWebsite("https://shop.example/", {
      timeoutMs: 10,
      resolve: publicResolver,
      fetch: async (input) =>
        input.toString().endsWith("/robots.txt")
          ? response("", 404, { "content-type": "text/plain" })
          : new Promise<Response>(() => undefined)
    });
    const oversized = await enrichWebsite("https://shop.example/", {
      resolve: publicResolver,
      fetch: async (input) =>
        input.toString().endsWith("/robots.txt")
          ? response("", 404, { "content-type": "text/plain" })
          : response("x".repeat(1_048_577))
    });

    expect(timedOut).toMatchObject({ status: "failed", pagesFetched: 0 });
    expect(oversized).toMatchObject({ status: "failed", pagesFetched: 0 });
  });

  it("blocks unsafe entry points and redirects before requesting their destination", async () => {
    const unsafeEntry = await enrichWebsite("http://127.0.0.1/", {
      resolve: publicResolver,
      fetch: async () => response("<html></html>")
    });
    const requests: string[] = [];
    const unsafeRedirect = await enrichWebsite("https://shop.example/", {
      resolve: publicResolver,
      fetch: async (input) => {
        const url = input.toString();
        requests.push(url);
        return url.endsWith("/robots.txt")
          ? response("", 404, { "content-type": "text/plain" })
          : response("", 302, { location: "http://127.0.0.1/private" });
      }
    });

    expect(unsafeEntry.status).toBe("blocked");
    expect(unsafeRedirect.status).toBe("blocked");
    expect(requests).not.toContain("http://127.0.0.1/private");
  });

  it("collects publicly published contact data from same-origin contact pages and schema", async () => {
    const result = await enrichWebsite("https://shop.example/", {
      resolve: publicResolver,
      fetch: async (input) => {
        const url = input.toString();
        if (url.endsWith("/robots.txt")) {
          return response("", 404, { "content-type": "text/plain" });
        }
        if (url.endsWith("/contact")) {
          return response(`
            <a href="mailto:hello@shop.example">Email</a>
            <script type="application/ld+json">{"@type":"LocalBusiness","telephone":"+90 212 555 0000","sameAs":["https://www.instagram.com/shop"]}</script>
            <script type="application/ld+json">{not valid json}</script>
          `);
        }
        return response(`
          <html><body>
            <a href="/contact" rel="contact">Iletisim</a>
            <a href="https://other.example/contact">Contact</a>
          </body></html>
        `);
      }
    });

    expect(result.status).toBe("success");
    expect(result.snapshot?.finalUrl).toBe("https://shop.example/");
    expect(result.sourceUrls).toEqual(["https://shop.example/", "https://shop.example/contact"]);
    expect(result.contact).toMatchObject({
      publicEmail: "hello@shop.example",
      publicPhone: "+902125550000",
      socialProfiles: ["https://www.instagram.com/shop"]
    });
    expect(result.contact?.contactSource).toContain("https://shop.example/contact");
  });

  it("keeps the first page with an enquiry form as the contact form", async () => {
    const form = '<form><input name="name"><textarea name="message"></textarea></form>';
    const enrich = (homepage: string) =>
      enrichWebsite("https://shop.example/", {
        resolve: publicResolver,
        fetch: async (input) => {
          const url = input.toString();
          if (url.endsWith("/robots.txt")) return response("", 404, { "content-type": "text/plain" });
          if (url.endsWith("/contact")) return response(`<a href="tel:+902125550000">Call</a>${form}`);
          return response(homepage);
        }
      });

    const viaContactPage = await enrich('<a href="/contact">Contact</a>');
    expect(viaContactPage.contact?.contactFormUrl).toBe("https://shop.example/contact");

    const formOnly = await enrich(form);
    expect(formOnly.contact).toEqual({
      contactFormUrl: "https://shop.example/",
      socialProfiles: [],
      contactConfidence: "None",
      contactSource: ""
    });
  });

  it("retains business identities from the homepage and contact page it actually fetched", async () => {
    const result = await enrichWebsite("https://shop.example/", {
      resolve: publicResolver,
      fetch: async (input) => {
        const url = input.toString();
        if (url.endsWith("/robots.txt")) return response("", 404, { "content-type": "text/plain" });
        if (url.endsWith("/contact")) return response('<script type="application/ld+json">{"@type":"LocalBusiness","name":"Shop Contact","telephone":"+1 212 555 0100"}</script>');
        return response('<a href="/contact">Contact</a><script type="application/ld+json">{"@type":"LocalBusiness","name":"Shop Home","telephone":"+1 212 555 0100"}</script>');
      }
    });

    expect(result.status).toBe("success");
    expect(result.businessIdentities?.map((identity) => [identity.name, identity.pageUrl])).toEqual([
      ["Shop Home", "https://shop.example/"],
      ["Shop Contact", "https://shop.example/contact"]
    ]);
  });
});
