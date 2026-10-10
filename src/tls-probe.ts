import { isIP } from "node:net";
import { connect } from "node:tls";
import type { PageSnapshot } from "./types.js";

const dayMs = 24 * 60 * 60 * 1000;

// Reads the certificate the host presents without trusting it, so expired or untrusted certificates can still be
// reported. Connection errors and timeouts return undefined and the certificate rule is skipped. Pass an address
// that was already checked to connect to it directly instead of resolving the hostname again.
export function probeTlsCertificate(url: string, timeoutMs: number, address?: string): Promise<PageSnapshot["tls"]> {
  const { hostname, port } = new URL(url);
  const host = hostname.replace(/^\[|\]$/g, "");

  return new Promise((resolve) => {
    const socket = connect({
      host: address ?? host,
      port: Number(port) || 443,
      servername: isIP(host) ? undefined : host,
      rejectUnauthorized: false
    });
    const finish = (result?: PageSnapshot["tls"]) => {
      clearTimeout(timeout);
      socket.destroy();
      resolve(result);
    };
    const timeout = setTimeout(() => finish(), timeoutMs);

    socket.once("error", () => finish());
    socket.once("secureConnect", () => {
      const certificate = socket.getPeerCertificate();
      const validFrom = new Date(certificate.valid_from);
      const validTo = new Date(certificate.valid_to);
      if (Number.isNaN(validFrom.getTime()) || Number.isNaN(validTo.getTime())) {
        finish();
        return;
      }

      // Multi-valued issuer fields arrive as arrays.
      const issuer = [certificate.issuer?.CN || certificate.issuer?.O].flat()[0];
      const error = socket.authorizationError ? String(socket.authorizationError) : undefined;
      finish({
        validFrom: validFrom.toISOString(),
        validTo: validTo.toISOString(),
        daysRemaining: Math.floor((validTo.getTime() - Date.now()) / dayMs),
        ...(issuer ? { issuer } : {}),
        authorized: socket.authorized,
        ...(error ? { error } : {})
      });
    });
  });
}
