import { EventEmitter } from "node:events";
import { connect, type TLSSocket } from "node:tls";
import { afterEach, describe, expect, it, vi } from "vitest";
import { auditSnapshot, auditUrl, probeTlsCertificate } from "../src/audit.js";
import type { PageSnapshot } from "../src/types.js";

vi.mock("node:tls", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:tls")>()),
  connect: vi.fn()
}));

class FakeSocket extends EventEmitter {
  authorized = true;
  authorizationError: string | null = null;
  destroy = vi.fn();

  constructor(private readonly certificate: Record<string, unknown>) {
    super();
  }

  getPeerCertificate() {
    return this.certificate;
  }
}

const certificate = {
  valid_from: "Aug  1 00:00:00 2026 GMT",
  valid_to: "Oct 19 12:00:00 2026 GMT",
  issuer: { C: "US", O: "Let's Encrypt", CN: "R11" }
};

function fakeConnect(
  emit: "secureConnect" | "error" | "none",
  peerCertificate: Record<string, unknown> = certificate,
  trust: { authorized: boolean; authorizationError: string | null } = { authorized: true, authorizationError: null }
): FakeSocket {
  const socket = Object.assign(new FakeSocket(peerCertificate), trust);
  vi.mocked(connect).mockImplementation(() => {
    if (emit !== "none") {
      setImmediate(() => socket.emit(emit, emit === "error" ? new Error("connect ECONNREFUSED") : undefined));
    }
    return socket as unknown as TLSSocket;
  });
  return socket;
}

afterEach(() => {
  vi.mocked(connect).mockReset();
  vi.unstubAllGlobals();
});

function snapshot(tls?: PageSnapshot["tls"], finalUrl = "https://example.test/"): PageSnapshot {
  return {
    url: finalUrl,
    finalUrl,
    statusCode: 200,
    headers: {},
    html: "<html><title>Example</title></html>",
    tls
  };
}

function certificateFinding(tls?: PageSnapshot["tls"]) {
  return auditSnapshot(snapshot(tls)).findings.find((finding) => finding.id === "tls-certificate-valid");
}

const trusted = {
  validFrom: "2026-08-01T00:00:00.000Z",
  validTo: "2026-12-30T00:00:00.000Z",
  daysRemaining: 81,
  issuer: "R11",
  authorized: true
};

describe("TLS certificate rule", () => {
  it("passes a trusted certificate with plenty of time left and skips pages without certificate data", () => {
    expect(certificateFinding(trusted)).toBeUndefined();
    expect(certificateFinding({ ...trusted, daysRemaining: 14 })).toBeUndefined();
    expect(certificateFinding(undefined)).toBeUndefined();
  });

  it("flags a certificate with fewer than 14 days left", () => {
    const finding = certificateFinding({ ...trusted, validTo: "2026-10-19T12:00:00.000Z", daysRemaining: 9 });

    expect(finding?.severity).toBe("high");
    expect(finding?.category).toBe("technical-health");
    expect(finding?.evidence[0]?.value).toBe("Certificate expires 2026-10-19 (9 days); issuer R11");
  });

  it("flags an expired certificate", () => {
    const finding = certificateFinding({
      validFrom: "2026-07-02T00:00:00.000Z",
      validTo: "2026-09-30T00:00:00.000Z",
      daysRemaining: -10,
      authorized: false,
      error: "CERT_HAS_EXPIRED"
    });

    expect(finding?.evidence[0]?.value).toBe("Certificate expired 2026-09-30");
  });

  it("flags an untrusted certificate with its error code", () => {
    const finding = certificateFinding({ ...trusted, issuer: "localhost", authorized: false, error: "DEPTH_ZERO_SELF_SIGNED_CERT" });

    expect(finding?.evidence[0]?.value).toBe("Certificate not trusted: DEPTH_ZERO_SELF_SIGNED_CERT; issuer localhost");
  });
});

describe("TLS certificate probe", () => {
  it("reads the peer certificate from a named host on the default port", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-10T00:00:00.000Z"), toFake: ["Date"] });
    try {
      const socket = fakeConnect("secureConnect");
      const tls = await probeTlsCertificate("https://www.example.test/page", 1000);

      expect(connect).toHaveBeenCalledWith({
        host: "www.example.test",
        port: 443,
        servername: "www.example.test",
        rejectUnauthorized: false
      });
      expect(tls).toEqual({
        validFrom: "2026-08-01T00:00:00.000Z",
        validTo: "2026-10-19T12:00:00.000Z",
        daysRemaining: 9,
        issuer: "R11",
        authorized: true
      });
      expect(socket.destroy).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("connects to a checked address while keeping the host name for the certificate", async () => {
    fakeConnect("secureConnect");
    await probeTlsCertificate("https://www.example.test/", 1000, "93.184.216.34");

    expect(connect).toHaveBeenCalledWith({
      host: "93.184.216.34",
      port: 443,
      servername: "www.example.test",
      rejectUnauthorized: false
    });
  });

  it("omits the server name for IP hosts and keeps the authorization error", async () => {
    fakeConnect(
      "secureConnect",
      { ...certificate, issuer: { O: ["Example Org", "Second Org"] } },
      { authorized: false, authorizationError: "DEPTH_ZERO_SELF_SIGNED_CERT" }
    );
    const tls = await probeTlsCertificate("https://127.0.0.1:8443/", 1000);

    expect(connect).toHaveBeenCalledWith({ host: "127.0.0.1", port: 8443, servername: undefined, rejectUnauthorized: false });
    expect(tls).toMatchObject({ issuer: "Example Org", authorized: false, error: "DEPTH_ZERO_SELF_SIGNED_CERT" });
  });

  it("returns no certificate data when the connection fails", async () => {
    const socket = fakeConnect("error");

    await expect(probeTlsCertificate("https://example.test/", 1000)).resolves.toBeUndefined();
    expect(socket.destroy).toHaveBeenCalled();
  });

  it("returns no certificate data when the handshake times out", async () => {
    const socket = fakeConnect("none");

    await expect(probeTlsCertificate("https://example.test/", 20)).resolves.toBeUndefined();
    expect(socket.destroy).toHaveBeenCalled();
  });

  it("returns no certificate data when the certificate dates are missing or invalid", async () => {
    fakeConnect("secureConnect", {});
    await expect(probeTlsCertificate("https://example.test/", 1000)).resolves.toBeUndefined();

    fakeConnect("secureConnect", { ...certificate, valid_to: "not a date" });
    await expect(probeTlsCertificate("https://example.test/", 1000)).resolves.toBeUndefined();
  });
});

describe("TLS certificate checks during an audit", () => {
  function renderedAudit(url = "https://example.test/") {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    return auditUrl(url, {
      render: true,
      timeoutMs: 1000,
      renderPage: async () => snapshot(undefined, url)
    });
  }

  it("probes the final HTTPS URL and reports an untrusted certificate", async () => {
    fakeConnect(
      "secureConnect",
      { ...certificate, valid_to: "Sep 16 06:31:12 2126 GMT", issuer: { CN: "localhost" } },
      { authorized: false, authorizationError: "DEPTH_ZERO_SELF_SIGNED_CERT" }
    );
    const report = await renderedAudit();

    expect(connect).toHaveBeenCalledTimes(1);
    expect(report.findings.find((finding) => finding.id === "tls-certificate-valid")?.evidence[0]?.value).toBe(
      "Certificate not trusted: DEPTH_ZERO_SELF_SIGNED_CERT; issuer localhost"
    );
  });

  it("skips the rule when the certificate probe fails", async () => {
    fakeConnect("error");
    const report = await renderedAudit();

    expect(connect).toHaveBeenCalledTimes(1);
    expect(report.findings.map((finding) => finding.id)).not.toContain("tls-certificate-valid");
  });

  it("does not probe plain HTTP sites", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html><title>Example</title></html>", { headers: { "content-type": "text/html" } }))
    );
    const report = await auditUrl("http://example.test/", { timeoutMs: 1000 });

    expect(report.findings.map((finding) => finding.id)).not.toContain("tls-certificate-valid");
    expect(connect).not.toHaveBeenCalled();
  });

  it("explains a certificate error when the page cannot be fetched", async () => {
    const cause = Object.assign(new Error("certificate has expired"), { code: "CERT_HAS_EXPIRED" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed", { cause })));

    await expect(auditUrl("https://expired.test/", { timeoutMs: 1000 })).rejects.toThrow(
      "TLS certificate error (CERT_HAS_EXPIRED) for https://expired.test/"
    );
  });

  it("rethrows other fetch errors unchanged", async () => {
    const error = new TypeError("fetch failed", { cause: Object.assign(new Error("refused"), { code: "ECONNREFUSED" }) });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));

    await expect(auditUrl("https://refused.test/", { timeoutMs: 1000 })).rejects.toBe(error);
  });
});
