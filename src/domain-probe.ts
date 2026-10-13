import { isIP } from "node:net";
import type { PageSnapshot } from "./types.js";

const dayMs = 24 * 60 * 60 * 1000;
const bootstrapUrl = "https://data.iana.org/rdap/dns.json";

type Fetch = typeof fetch;
type RdapEvent = { eventAction?: unknown; eventDate?: unknown };
type RdapEntity = { roles?: unknown; vcardArray?: unknown };
type RdapDomain = { ldhName?: unknown; status?: unknown; events?: unknown; entities?: unknown };

// One bootstrap download per fetch implementation and process, shared by every audit in a run.
const bootstraps = new WeakMap<Fetch, Promise<Map<string, string> | undefined>>();

async function getJson(url: string, timeoutMs: number, fetcher: Fetch): Promise<{ status: number; json?: unknown }> {
  const response = await fetcher(url, {
    headers: {
      accept: "application/rdap+json, application/json",
      "user-agent": "open-local-audit/0.1 (+https://github.com/Esquetta/open-local-audit)"
    },
    // Registry servers come from IANA's list of HTTPS endpoints; refusing redirects keeps lookups on them.
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) {
    await response.body?.cancel();
    return { status: response.status };
  }
  return { status: response.status, json: await response.json() };
}

// IANA's bootstrap file maps each top-level domain to its registry's RDAP server.
async function rdapServers(timeoutMs: number, fetcher: Fetch): Promise<Map<string, string> | undefined> {
  const json = (await getJson(bootstrapUrl, timeoutMs, fetcher)).json as { services?: unknown } | undefined;
  if (!Array.isArray(json?.services)) {
    return undefined;
  }
  const servers = new Map<string, string>();
  for (const service of json.services) {
    const [tlds, urls] = Array.isArray(service) ? service : [];
    const url = Array.isArray(urls) ? urls.find((item) => typeof item === "string" && item.startsWith("https://")) : undefined;
    if (Array.isArray(tlds) && url) {
      for (const tld of tlds) {
        servers.set(String(tld).toLowerCase(), url.endsWith("/") ? url : `${url}/`);
      }
    }
  }
  return servers;
}

function registrarName(entities: unknown): string | undefined {
  if (!Array.isArray(entities)) {
    return undefined;
  }
  for (const entity of entities as RdapEntity[]) {
    const vcard = Array.isArray(entity?.vcardArray) ? entity.vcardArray[1] : undefined;
    const name = Array.isArray(vcard) ? vcard.find((field) => Array.isArray(field) && field[0] === "fn")?.[3] : undefined;
    if (Array.isArray(entity?.roles) && entity.roles.includes("registrar") && typeof name === "string" && name.trim()) {
      return name.trim();
    }
  }
  return undefined;
}

// Looks up when the site's domain registration expires. Hosts on registries without RDAP, IP addresses, lookup
// errors, and timeouts return undefined and the domain rule is skipped. Subdomains are tried from the full host
// down to two labels, so "book.clinic.co.uk" finds "clinic.co.uk".
export async function probeDomainExpiry(
  url: string,
  timeoutMs: number,
  fetcher: Fetch = fetch
): Promise<PageSnapshot["domain"]> {
  const host = new URL(url).hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  const labels = host.split(".");
  if (isIP(host) || labels.length < 2) {
    return undefined;
  }

  try {
    let bootstrap = bootstraps.get(fetcher);
    if (!bootstrap) {
      bootstrap = rdapServers(timeoutMs, fetcher).catch(() => undefined);
      bootstraps.set(fetcher, bootstrap);
    }
    const servers = await bootstrap;
    if (!servers) {
      // Let a later audit in the same run try the bootstrap file again.
      bootstraps.delete(fetcher);
      return undefined;
    }
    const server = servers.get(labels.at(-1) ?? "");
    if (!server) {
      return undefined;
    }

    for (let start = 0; start <= labels.length - 2; start += 1) {
      const name = labels.slice(start).join(".");
      const response = await getJson(`${server}domain/${encodeURIComponent(name)}`, timeoutMs, fetcher);
      // Only "not found" means the name is a subdomain; rate limits and server errors end the lookup.
      if (response.status === 404) {
        continue;
      }
      const domain = response.json as RdapDomain | undefined;
      if (!domain) {
        return undefined;
      }
      const events = Array.isArray(domain.events) ? (domain.events as RdapEvent[]) : [];
      const expiration = events.find((event) => event?.eventAction === "expiration")?.eventDate;
      const expiresAt = typeof expiration === "string" ? new Date(expiration) : undefined;
      if (!expiresAt || Number.isNaN(expiresAt.getTime())) {
        return undefined;
      }
      const registrar = registrarName(domain.entities);
      return {
        name: typeof domain.ldhName === "string" ? domain.ldhName.toLowerCase() : name,
        expiresAt: expiresAt.toISOString(),
        daysRemaining: Math.floor((expiresAt.getTime() - Date.now()) / dayMs),
        status: Array.isArray(domain.status) ? domain.status.filter((item): item is string => typeof item === "string") : [],
        ...(registrar ? { registrar } : {})
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}
