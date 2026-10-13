import { describe, expect, it } from "vitest";
import { auditSnapshot, auditUrl } from "../src/audit.js";
import { probeDomainExpiry } from "../src/domain-probe.js";
import type { PageSnapshot } from "../src/types.js";

const dayMs = 24 * 60 * 60 * 1000;

const bootstrap = {
  services: [
    [["com", "net"], ["http://rdap.example/insecure/", "https://rdap.verisign.test/com/v1/"]],
    [["uk"], ["https://rdap.nominet.test/uk"]]
  ]
};

function rdapDomain(name: string, expiresInDays: number, status = ["active"]) {
  return {
    ldhName: name.toUpperCase(),
    status,
    events: [
      { eventAction: "registration", eventDate: "2009-12-22T18:13:48Z" },
      { eventAction: "expiration", eventDate: new Date(Date.now() + expiresInDays * dayMs + 60_000).toISOString() }
    ],
    entities: [
      { roles: ["registrant"], vcardArray: ["vcard", [["fn", {}, "text", "Owner"]]] },
      { roles: ["registrar"], vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "Krystal Hosting Ltd"]]] }
    ]
  };
}

function fakeFetch(routes: Record<string, { status: number; body?: unknown }>) {
  const calls: string[] = [];
  const inits: RequestInit[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    inits.push(init ?? {});
    const route = url === "https://data.iana.org/rdap/dns.json" ? { status: 200, body: bootstrap } : (routes[url] ?? { status: 404 });
    return new Response(route.body === undefined ? null : JSON.stringify(route.body), { status: route.status });
  }) as typeof fetch;
  return { fetcher, calls, inits };
}

function snapshot(domain?: PageSnapshot["domain"]): PageSnapshot {
  return { url: "https://clinic.test/", finalUrl: "https://clinic.test/", statusCode: 200, headers: {}, html: "<html></html>", domain };
}

function domainFinding(domain?: PageSnapshot["domain"]) {
  return auditSnapshot(snapshot(domain)).findings.find((finding) => finding.id === "domain-expiry");
}

describe("domain expiry lookups", () => {
  it("reads the expiry date, status, and registrar from the registry's HTTPS RDAP server", async () => {
    const { fetcher, calls, inits } = fakeFetch({
      "https://rdap.nominet.test/uk/domain/clinic.co.uk": { status: 200, body: rdapDomain("clinic.co.uk", 20) }
    });

    const domain = await probeDomainExpiry("https://www.clinic.co.uk/contact", 1000, fetcher);

    expect(domain).toMatchObject({ name: "clinic.co.uk", daysRemaining: 20, status: ["active"], registrar: "Krystal Hosting Ltd" });
    expect(calls).toEqual(["https://data.iana.org/rdap/dns.json", "https://rdap.nominet.test/uk/domain/clinic.co.uk"]);
    for (const init of inits) {
      expect(init.redirect).toBe("error");
      expect((init.headers as Record<string, string>)["user-agent"]).toMatch(/^open-local-audit\//);
    }
  });

  it("walks up from a subdomain only while the registry says not found", async () => {
    const { fetcher, calls } = fakeFetch({
      "https://rdap.verisign.test/com/v1/domain/clinic.com": { status: 200, body: rdapDomain("clinic.com", 300) }
    });

    expect((await probeDomainExpiry("https://book.clinic.com/", 1000, fetcher))?.name).toBe("clinic.com");
    expect(calls.slice(1)).toEqual([
      "https://rdap.verisign.test/com/v1/domain/book.clinic.com",
      "https://rdap.verisign.test/com/v1/domain/clinic.com"
    ]);

    const limited = fakeFetch({ "https://rdap.verisign.test/com/v1/domain/book.clinic.com": { status: 429 } });
    expect(await probeDomainExpiry("https://book.clinic.com/", 1000, limited.fetcher)).toBeUndefined();
    expect(limited.calls).toHaveLength(2);
  });

  it("returns nothing for registries without RDAP, IP addresses, missing expiry dates, and failures", async () => {
    const { fetcher } = fakeFetch({
      "https://rdap.verisign.test/com/v1/domain/noexpiry.com": { status: 200, body: { ldhName: "noexpiry.com", events: [] } }
    });

    expect(await probeDomainExpiry("https://klinik.com.tr/", 1000, fetcher)).toBeUndefined();
    expect(await probeDomainExpiry("https://192.0.2.10/", 1000, fetcher)).toBeUndefined();
    expect(await probeDomainExpiry("https://noexpiry.com/", 1000, fetcher)).toBeUndefined();
    expect(await probeDomainExpiry("https://clinic.com/", 1000, (async () => Promise.reject(new Error("offline"))) as typeof fetch)).toBeUndefined();
  });

  it("only looks up the domain when checkDomain is set", async () => {
    const lookups: string[] = [];
    const audit = (checkDomain: boolean) =>
      auditUrl("https://clinic.test/", {
        checkDomain,
        probeDomain: async (url) => {
          lookups.push(url);
          return { name: "clinic.test", expiresAt: "2026-10-20T00:00:00.000Z", daysRemaining: 7, status: ["active"] };
        },
        renderPage: async () => snapshot(),
        render: true
      });

    expect((await audit(false)).findings.some((finding) => finding.id === "domain-expiry")).toBe(false);
    expect((await audit(true)).findings.find((finding) => finding.id === "domain-expiry")?.evidence[0]?.value).toBe(
      "clinic.test expires 2026-10-20 (7 days)"
    );
    expect(lookups).toEqual(["https://clinic.test/"]);
  });
});

describe("domain expiry rule", () => {
  it("is skipped without lookup data and passes domains with a month or more left", () => {
    expect(domainFinding()).toBeUndefined();
    expect(domainFinding({ name: "clinic.test", expiresAt: "2026-11-12T00:00:00.000Z", daysRemaining: 30, status: ["active"] })).toBeUndefined();
  });

  it("flags domains that expire within 30 days, have expired, or are being deleted", () => {
    const soon = domainFinding({
      name: "clinic.co.uk",
      expiresAt: "2026-11-02T18:13:48.000Z",
      daysRemaining: 20,
      status: ["active"],
      registrar: "Krystal Hosting Ltd"
    });
    expect(soon?.severity).toBe("medium");
    expect(soon?.category).toBe("technical-health");
    expect(soon?.evidence[0]?.value).toBe("clinic.co.uk expires 2026-11-02 (20 days); registrar Krystal Hosting Ltd");

    expect(domainFinding({ name: "clinic.com", expiresAt: "2026-10-01T00:00:00.000Z", daysRemaining: -12, status: ["redemption period"] })?.evidence[0]?.value).toBe(
      "clinic.com expired 2026-10-01; status: redemption period"
    );
    expect(domainFinding({ name: "clinic.com", expiresAt: "2027-06-01T00:00:00.000Z", daysRemaining: 230, status: ["pending delete"] })?.evidence[0]?.value).toBe(
      "clinic.com expires 2027-06-01 (230 days); status: pending delete"
    );
  });
});
