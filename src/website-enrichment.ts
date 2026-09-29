import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { createRequire } from "node:module";
import { isIP } from "node:net";
import { load } from "cheerio";
import { extractPublicContact } from "./contact.js";
import type { PageSnapshot, PublicContact } from "./types.js";

const USER_AGENT = "open-local-audit/0.1 (+https://github.com/Esquetta/open-local-audit)";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_HTML_BYTES = 1_048_576;
const MAX_REDIRECTS = 3;
const require = createRequire(import.meta.url);
const robotsParser = require("robots-parser") as (url: string, rules: string) => { isAllowed: (url: string, userAgent: string) => boolean | undefined };

type Resolver = (hostname: string) => Promise<string[]>;

export interface WebsiteEnrichmentResult {
  status: "success" | "blocked" | "failed";
  snapshot?: PageSnapshot;
  contact?: PublicContact;
  sourceUrls: string[];
  pagesFetched: number;
  durationMs: number;
  error?: string;
  warnings?: string[];
}

export interface WebsiteEnrichmentOptions {
  timeoutMs?: number;
  maxPages?: number;
  fetch?: typeof fetch;
  /** Test seam for deterministic DNS checks. Production uses Node's resolver. */
  resolve?: Resolver;
}

class BlockedError extends Error {}

class TimeoutError extends Error {}

function normalizeHeaders(headers: Headers): Record<string, string> {
  const output: Record<string, string> = {};
  headers.forEach((value, key) => {
    output[key] = value;
  });
  return output;
}

function sameBusinessHost(first: string, second: string): boolean {
  return first.replace(/^www\./i, "").toLowerCase() === second.replace(/^www\./i, "").toLowerCase();
}

function isPublicAddress(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0] ?? "";
  if (isIP(normalized) === 4) {
    const octets = normalized.split(".").map(Number);
    const [first, second] = octets;
    return !(
      first === 0 ||
      first === 10 ||
      first === 127 ||
      first >= 224 ||
      (first === 192 && second === 0) ||
      (first === 198 && (second === 18 || second === 19)) ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }

  if (isIP(normalized) !== 6) {
    return false;
  }

  // Only native global unicast; exclude mapped/translation/tunnel and documentation ranges.
  return /^[23]/.test(normalized) && !/^2001:(?:0:|db8:)/.test(normalized) && !normalized.startsWith("2002:");
}

async function resolvePublicAddresses(hostname: string, resolve: Resolver): Promise<string[]> {
  hostname = hostname.replace(/^\[|\]$/g, "");
  if (hostname.toLowerCase() === "localhost") {
    throw new BlockedError("localhost is not a public website target");
  }

  const addresses = isIP(hostname) ? [hostname] : await resolve(hostname);
  if (addresses.length === 0 || addresses.some((address) => !isPublicAddress(address))) {
    throw new BlockedError("target resolved to a non-public address");
  }

  return addresses;
}

async function defaultResolver(hostname: string): Promise<string[]> {
  const entries = await dnsLookup(hostname, { all: true, verbatim: true });
  return entries.map((entry) => entry.address);
}

function requestWithPinnedLookup(url: URL, addresses: string[], signal: AbortSignal): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request(
      url,
      {
        method: "GET",
        family: isIP(addresses[0]!) || 4,
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.1" },
        lookup: (_hostname, _options, callback) => callback(null, addresses[0]!, isIP(addresses[0]!) || 4)
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        let total = 0;
        incoming.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > MAX_HTML_BYTES) {
            request.destroy(new Error("response exceeded the maximum allowed size"));
            return;
          }
          chunks.push(chunk);
        });
        incoming.on("error", reject);
        incoming.on("end", () => {
          const headers = new Headers();
          for (const [name, value] of Object.entries(incoming.headers)) {
            if (value !== undefined) {
              headers.set(name, Array.isArray(value) ? value.join(", ") : value);
            }
          }
          const status = incoming.statusCode ?? 500;
          resolve(new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), { status, headers }));
        });
      }
    );

    const abort = () => request.destroy(new TimeoutError("request timed out"));
    signal.addEventListener("abort", abort, { once: true });
    request.on("close", () => signal.removeEventListener("abort", abort));
    request.on("error", reject);
    request.end();
  });
}

async function readLimitedText(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_HTML_BYTES) throw new Error("response exceeded the maximum allowed size");
      chunks.push(value);
    }
    return new TextDecoder().decode(Buffer.concat(chunks));
  } finally {
    await reader.cancel();
  }
}

function isRedirect(response: Response): boolean {
  return response.status >= 300 && response.status < 400;
}

function contactLinks(html: string, baseUrl: string, origin: string, maxCount: number): string[] {
  const $ = load(html);
  const candidates: string[] = [];
  const signal = /contact|contact-us|iletisim|iletişim|kontakt|impressum|about|about-us|über|uber/i;

  for (const anchor of $("a[href]").toArray()) {
    const href = $(anchor).attr("href")?.trim();
    if (!href || /^(mailto:|tel:|javascript:)/i.test(href)) {
      continue;
    }
    const label = `${$(anchor).text()} ${$(anchor).attr("rel") ?? ""} ${href}`;
    if (!signal.test(label)) {
      continue;
    }
    try {
      const candidate = new URL(href, baseUrl);
      candidate.hash = "";
      if (candidate.origin === origin && /^https?:$/.test(candidate.protocol) && !candidate.username && !candidate.password) {
        candidates.push(candidate.toString());
      }
    } catch {
      continue;
    }
  }

  return Array.from(new Set(candidates)).slice(0, maxCount);
}

function normalizeEmail(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const email = value.trim().replace(/^mailto:/i, "").split("?")[0]?.toLowerCase();
  return email && /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email) ? email : undefined;
}

function normalizePhone(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const phone = value.trim().replace(/^tel:/i, "").replace(/[^\d+]/g, "");
  return phone.replace(/\D/g, "").length >= 7 ? phone : undefined;
}

function socialProfile(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();
    return ["facebook.com", "instagram.com", "linkedin.com", "x.com", "twitter.com", "tiktok.com", "youtube.com"].some((name) => host === name || host.endsWith(`.${name}`)) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function extractSchemaContact(html: string): Pick<PublicContact, "publicEmail" | "publicPhone" | "socialProfiles"> {
  const $ = load(html);
  const emails: string[] = [];
  const phones: string[] = [];
  const socials: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") {
      return;
    }
    const record = value as Record<string, unknown>;
    const email = normalizeEmail(record.email);
    const phone = normalizePhone(record.telephone);
    if (email) emails.push(email);
    if (phone) phones.push(phone);
    const sameAs = Array.isArray(record.sameAs) ? record.sameAs : [record.sameAs];
    sameAs.map(socialProfile).filter((url): url is string => Boolean(url)).forEach((url) => socials.push(url));
    visit(record.contactPoint);
    visit(record["@graph"]);
  };

  for (const script of $("script[type='application/ld+json']").toArray()) {
    try {
      visit(JSON.parse($(script).text()));
    } catch {
      continue;
    }
  }
  return { publicEmail: emails[0], publicPhone: phones[0], socialProfiles: Array.from(new Set(socials)) };
}

function mergeContacts(entries: Array<{ contact: PublicContact; pageUrl: string }>): PublicContact | undefined {
  const populated = entries.filter(({ contact }) => contact.publicEmail || contact.publicPhone || contact.whatsappUrl || contact.contactPageUrl || contact.socialProfiles.length > 0);
  if (populated.length === 0) {
    return undefined;
  }
  const first = <K extends keyof PublicContact>(key: K): PublicContact[K] | undefined => populated.map(({ contact }) => contact[key]).find(Boolean);
  const socialProfiles = Array.from(new Set(populated.flatMap(({ contact }) => contact.socialProfiles)));
  const channelCount = [first("publicEmail"), first("publicPhone"), first("whatsappUrl"), first("contactPageUrl"), ...socialProfiles].filter(Boolean).length;
  const publicEmail = first("publicEmail") as string | undefined;
  const publicPhone = first("publicPhone") as string | undefined;
  return {
    publicEmail,
    publicPhone,
    whatsappUrl: first("whatsappUrl") as string | undefined,
    contactPageUrl: first("contactPageUrl") as string | undefined,
    socialProfiles,
    contactConfidence: publicEmail && publicPhone || channelCount >= 3 ? "High" : "Medium",
    contactSource: populated.map(({ pageUrl }) => pageUrl).join(", ")
  };
}

function combinePageContact(html: string, pageUrl: string): PublicContact {
  const contact = extractPublicContact(html, pageUrl);
  const schema = extractSchemaContact(html);
  return {
    ...contact,
    publicEmail: contact.publicEmail ?? schema.publicEmail,
    publicPhone: contact.publicPhone ?? schema.publicPhone,
    socialProfiles: Array.from(new Set([...contact.socialProfiles, ...schema.socialProfiles]))
  };
}

export async function enrichWebsite(url: string, options: WebsiteEnrichmentOptions = {}): Promise<WebsiteEnrichmentResult> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxPages = Math.max(1, Math.min(options.maxPages ?? 3, 3));
  const resolve = options.resolve ?? defaultResolver;
  const robotsRules = new Map<string, ReturnType<typeof robotsParser>>();
  const warnings: string[] = [];
  const sourceUrls: string[] = [];
  let pagesFetched = 0;
  const finish = (status: WebsiteEnrichmentResult["status"], values: Omit<WebsiteEnrichmentResult, "status" | "durationMs" | "sourceUrls" | "pagesFetched"> = {}): WebsiteEnrichmentResult => ({
    status,
    ...values,
    sourceUrls,
    pagesFetched,
    ...(warnings.length ? { warnings } : {}),
    durationMs: Date.now() - startedAt
  });
  const remainingMs = (): number => {
    const remaining = timeoutMs - (Date.now() - startedAt);
    if (remaining <= 0) throw new TimeoutError("operation timed out");
    return remaining;
  };
  const request = async (target: URL): Promise<Response> => {
    const controller = new AbortController();
    const requestTimeout = remainingMs();
    const timer = setTimeout(() => controller.abort(), requestTimeout);
    let raceTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const operation = (async () => {
        const addresses = await resolvePublicAddresses(target.hostname, resolve);
        if (controller.signal.aborted) throw new TimeoutError("request timed out");
        const response = options.fetch
          ? await options.fetch(target.toString(), { redirect: "manual", signal: controller.signal, headers: { "user-agent": USER_AGENT } })
          : await requestWithPinnedLookup(target, addresses, controller.signal);
        const body = await readLimitedText(response);
        return new Response([204, 205, 304].includes(response.status) ? null : body, { status: response.status, headers: response.headers });
      })();
      return await Promise.race([
        operation,
        new Promise<Response>((_resolve, reject) => {
          raceTimer = setTimeout(() => reject(new TimeoutError("request timed out")), requestTimeout);
        })
      ]);
    } finally {
      clearTimeout(timer);
      if (raceTimer) clearTimeout(raceTimer);
    }
  };
  const allowedByRobots = async (target: URL): Promise<void> => {
    const cacheKey = target.origin;
    const cached = robotsRules.get(cacheKey);
    if (cached) {
      if (cached.isAllowed(target.toString(), USER_AGENT) === false) throw new BlockedError("robots.txt disallows this URL");
      return;
    }
    let robotsUrl = new URL("/robots.txt", target.origin);
    let response: Response;
    try {
      response = await request(robotsUrl);
      for (let count = 0; isRedirect(response) && count < MAX_REDIRECTS; count++) {
        const location = response.headers.get("location");
        if (!location) break;
        const next = new URL(location, robotsUrl);
        if (!/^https?:$/.test(next.protocol) || next.username || next.password || !sameBusinessHost(target.hostname, next.hostname)) throw new BlockedError("robots redirect left the business website");
        robotsUrl = next;
        response = await request(robotsUrl);
      }
    } catch (error) {
      if (error instanceof BlockedError) throw error;
      if (error instanceof TimeoutError) throw error;
      throw new BlockedError("robots.txt could not be reached");
    }
    if (response.status === 404) {
      robotsRules.set(cacheKey, robotsParser(new URL("/robots.txt", target.origin).toString(), ""));
      return;
    }
    if (response.status === 403 || response.status < 200 || response.status >= 300) {
      throw new BlockedError("robots.txt did not permit crawling");
    }
    const policy = robotsParser(new URL("/robots.txt", target.origin).toString(), await readLimitedText(response));
    robotsRules.set(cacheKey, policy);
    if (policy.isAllowed(target.toString(), USER_AGENT) === false) {
      throw new BlockedError("robots.txt disallows this URL");
    }
  };
  const fetchPage = async (requestedUrl: string, homepageHost: string): Promise<PageSnapshot> => {
    let current = new URL(requestedUrl);
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      if (!/^https?:$/.test(current.protocol) || current.username || current.password || !sameBusinessHost(homepageHost, current.hostname)) {
        throw new BlockedError("redirect left the business website");
      }
      await allowedByRobots(current);
      const response = await request(current);
      if (isRedirect(response)) {
        const location = response.headers.get("location");
        if (!location) throw new Error("redirect response had no location");
        current = new URL(location, current);
        continue;
      }
      if (response.status === 403) throw new BlockedError("website denied the request");
      if (response.status === 429) throw new Error("website rate limited the request");
      if (!response.ok) throw new Error(`website returned HTTP ${response.status}`);
      const contentType = response.headers.get("content-type")?.toLowerCase();
      if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
        throw new Error("website response was not HTML");
      }
      const html = await readLimitedText(response);
      pagesFetched += 1;
      if (!sourceUrls.includes(current.toString())) sourceUrls.push(current.toString());
      return { url: requestedUrl, finalUrl: current.toString(), statusCode: response.status, headers: normalizeHeaders(response.headers), html };
    }
    throw new Error(`exceeded redirect limit of ${MAX_REDIRECTS}`);
  };

  try {
    const initial = new URL(url);
    if (!/^https?:$/.test(initial.protocol) || initial.username || initial.password) {
      throw new BlockedError("only public HTTP(S) URLs are allowed");
    }
    const homepage = await fetchPage(initial.toString(), initial.hostname);
    const contactEntries = [{ contact: combinePageContact(homepage.html, homepage.finalUrl), pageUrl: homepage.finalUrl }];
    const followUps = contactLinks(homepage.html, homepage.finalUrl, new URL(homepage.finalUrl).origin, maxPages - 1);
    for (const followUp of followUps) {
      try {
        const page = await fetchPage(followUp, initial.hostname);
        contactEntries.push({ contact: combinePageContact(page.html, page.finalUrl), pageUrl: page.finalUrl });
      } catch (error) {
        warnings.push(`${followUp}: ${error instanceof Error ? error.message : "could not read page"}`);
        break;
      }
    }
    return finish("success", { snapshot: homepage, contact: mergeContacts(contactEntries) });
  } catch (error) {
    if (error instanceof BlockedError) return finish("blocked", { error: error.message });
    return finish("failed", { error: error instanceof Error ? error.message : "website enrichment failed" });
  }
}
