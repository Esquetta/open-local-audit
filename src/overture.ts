import { isIP } from "node:net";
import { DuckDBInstance, type DuckDBConnection, type DuckDBResultReader } from "@duckdb/node-api";
import type { PlaceCandidate } from "./discovery.js";
import type { AuditProfile } from "./types.js";
import { maximumDiscoveryBboxSpan } from "./discovery-location.js";
import { readDiscoveryCache, writeDiscoveryCache, type DiscoveryCacheInfo } from "./discovery-cache.js";

export type BoundingBox = [west: number, south: number, east: number, north: number];

export interface FetchOvertureCandidatesOptions {
  bbox: BoundingBox;
  category: string;
  limit?: number;
  defaultProfile?: AuditProfile;
  timeoutMs?: number;
  release?: string;
  cacheDir?: string;
  refreshCache?: boolean;
  onCacheStatus?: (info: DiscoveryCacheInfo) => void;
}

const overtureStacUrl = "https://stac.overturemaps.org/catalog.json";
const overturePlacesGuideUrl = "https://docs.overturemaps.org/guides/places/";
const overtureS3BaseUrl = "s3://overturemaps-us-west-2/release";
const defaultLimit = 25;
const maximumLimit = 100;
const defaultTimeoutMs = 90_000;
const minimumConfidence = 0.5;
const releasePattern = /^\d{4}-\d{2}-\d{2}\.\d+$/;
const categoryPattern = /^[a-z][a-z0-9_]{0,80}$/;
const socialProfileHosts = ["facebook.com", "instagram.com", "linkedin.com", "x.com", "twitter.com", "tiktok.com", "youtube.com", "wa.me", "whatsapp.com"];
const shortLinkHosts = ["fbf.bz", "fb.me", "bit.ly", "tinyurl.com", "t.co", "goo.gl", "maps.app.goo.gl", "linktr.ee"];

export const overtureCategoryMappings: Readonly<Record<string, readonly string[]>> = {
  dental: ["dentist", "dental_clinic"],
  restaurant: ["restaurant"],
  beauty: ["beauty_salon", "hair_salon", "nail_salon", "spa"],
  hotel: ["hotel", "motel", "resort_hotel"],
  gym: ["gym", "fitness_center"],
  lawyer: ["attorney_or_law_firm"],
  solicitor: ["attorney_or_law_firm"],
  attorney: ["attorney_or_law_firm"],
  legal: ["legal_service"],
  // Category names from older Overture schemas that users still type.
  legal_services: ["legal_service"],
  attorney_and_law_services: ["attorney_or_law_firm"]
};

interface OverturePlaceRow {
  id?: unknown;
  label?: unknown;
  address?: unknown;
  country?: unknown;
  locality?: unknown;
  region?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  websites?: unknown;
  phones?: unknown;
  emails?: unknown;
  socials?: unknown;
  confidence?: unknown;
  operating_status?: unknown;
  sources?: unknown;
}

interface OvertureSourceItem {
  provider?: unknown;
  dataset?: unknown;
  license?: unknown;
  record_id?: unknown;
  resource?: unknown;
  version?: unknown;
  update_time?: unknown;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(stringOrUndefined).filter((item): item is string => item !== undefined)
    : [];
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isPublicHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }
    if (url.username || url.password || host === "localhost" || host.endsWith(".localhost")) {
      return false;
    }
    if (isIP(host) === 4) {
      const octets = host.split(".").map(Number);
      return !(
        octets[0] === 0 ||
        octets[0] === 10 ||
        octets[0] === 127 ||
        (octets[0] === 169 && octets[1] === 254) ||
        (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
        (octets[0] === 192 && octets[1] === 168)
      );
    }
    if (isIP(host) === 6) {
      const mappedIpv4 = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
      return !(
        host === "::1" ||
        host.startsWith("fc") ||
        host.startsWith("fd") ||
        host.startsWith("fe80:") ||
        (mappedIpv4 !== undefined && !isPublicHttpUrl(`http://${mappedIpv4}`))
      );
    }
    return true;
  } catch {
    return false;
  }
}

function firstPublicHttpUrl(value: unknown): string | undefined {
  const website = stringList(value).find((url) => isPublicHttpUrl(url) && !hasHost(url, socialProfileHosts) && !hasHost(url, shortLinkHosts));
  return website ? new URL(website).toString() : undefined;
}

function hasHost(value: string, hosts: readonly string[]): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return hosts.some((entry) => host === entry || host.endsWith(`.${entry}`));
  } catch {
    return false;
  }
}

function sourceItems(value: unknown): OvertureSourceItem[] {
  return Array.isArray(value) ? value.filter((item): item is OvertureSourceItem => typeof item === "object" && item !== null) : [];
}

function sourceUrl(item: OvertureSourceItem): string | undefined {
  const provider = stringOrUndefined(item.provider)?.toLowerCase();
  const recordId = stringOrUndefined(item.record_id);
  if ((provider === "meta" || provider === "facebook") && recordId && /^\d+$/.test(recordId)) {
    return `https://www.facebook.com/${recordId}`;
  }
  if (provider === "osm" && recordId) {
    const match = recordId.match(/^([nwr])(\d+)(?:@\d+)?$/);
    if (match) {
      const type = match[1] === "n" ? "node" : match[1] === "w" ? "way" : "relation";
      return `https://www.openstreetmap.org/${type}/${match[2]}`;
    }
  }
  const resource = stringOrUndefined(item.resource);
  return resource && isPublicHttpUrl(resource) ? new URL(resource).toString() : undefined;
}

function sourceProvenance(items: OvertureSourceItem[]): Array<Record<string, string>> {
  return items.map((item) => {
    const entry: Record<string, string> = {};
    const fields: Array<[string, unknown]> = [
      ["provider", item.provider],
      ["dataset", item.dataset],
      ["license", item.license],
      ["recordId", item.record_id],
      ["resource", item.resource],
      ["version", item.version],
      ["updateTime", item.update_time]
    ];
    for (const [name, value] of fields) {
      const normalized = stringOrUndefined(value);
      if (normalized) {
        entry[name] = normalized;
      }
    }
    return entry;
  });
}

function validateBoundingBox(bbox: BoundingBox): void {
  const [west, south, east, north] = bbox;
  if (![west, south, east, north].every(Number.isFinite)) {
    throw new Error("Bounding box coordinates must be finite numbers");
  }
  if (west < -180 || east > 180 || south < -90 || north > 90) {
    throw new Error("Bounding box coordinates are outside WGS84 limits");
  }
  if (west >= east || south >= north) {
    throw new Error("Bounding box must have west < east and south < north");
  }
  if (east - west > maximumDiscoveryBboxSpan || north - south > maximumDiscoveryBboxSpan) {
    throw new Error(`Bounding box must span at most ${maximumDiscoveryBboxSpan} degrees per axis`);
  }
}

function resolveCategories(category: string): readonly string[] {
  const normalized = category.trim().toLowerCase();
  if (!categoryPattern.test(normalized)) {
    throw new Error("Unsupported Overture category");
  }
  return overtureCategoryMappings[normalized] ?? [normalized];
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return defaultLimit;
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > maximumLimit) {
    throw new Error(`Overture limit must be an integer between 1 and ${maximumLimit}`);
  }
  return limit;
}

function normalizeTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) {
    return defaultTimeoutMs;
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new Error("Overture timeout must be an integer between 1 and 120000ms");
  }
  return timeoutMs;
}

function validateRelease(release: string): string {
  if (!releasePattern.test(release)) {
    throw new Error("Invalid Overture release");
  }
  return release;
}

async function fetchLatestRelease(timeoutMs: number): Promise<string> {
  let response: Response;
  try {
    response = await fetch(overtureStacUrl, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new Error(`Unable to retrieve the current Overture release: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    throw new Error(`Unable to retrieve the current Overture release: STAC returned HTTP ${response.status}`);
  }
  const body: unknown = await response.json();
  const release = typeof body === "object" && body !== null ? (body as { latest?: unknown }).latest : undefined;
  return validateRelease(stringOrUndefined(release) ?? "");
}

function categorySql(categories: readonly string[]): string {
  return categories.map((category) => `'${category}'`).join(", ");
}

function buildQuery(release: string, categories: readonly string[]): string {
  const source = `${overtureS3BaseUrl}/${release}/theme=places/type=place/*`;
  return `
    SELECT
      id,
      names.primary AS label,
      addresses[1].freeform AS address,
      addresses[1].country AS country,
      addresses[1].locality AS locality,
      addresses[1].region AS region,
      bbox.ymin AS latitude,
      bbox.xmin AS longitude,
      websites,
      phones,
      emails,
      socials,
      sources,
      confidence,
      operating_status
    FROM read_parquet('${source}')
    WHERE bbox.xmin BETWEEN $west AND $east
      AND bbox.ymin BETWEEN $south AND $north
      AND (
        taxonomy.primary IN (${categorySql(categories)})
        OR list_has_any(taxonomy.hierarchy, [${categorySql(categories)}])
      )
      AND (confidence IS NULL OR confidence >= ${minimumConfidence})
      AND (operating_status IS NULL OR lower(operating_status) <> 'closed_permanently')
    ORDER BY id ASC
    LIMIT $limit
  `;
}

async function runWithinDeadline<T>(
  operation: Promise<T>,
  connection: DuckDBConnection,
  deadline: number,
  timeoutMs: number
): Promise<T> {
  const settledOperation = Promise.resolve(operation);
  const remainingMs = deadline - Date.now();
  const timeoutError = new Error(`Overture query timed out after ${timeoutMs}ms`);
  if (remainingMs <= 0) {
    connection.interrupt();
    void settledOperation.catch(() => undefined);
    throw timeoutError;
  }
  let timer: NodeJS.Timeout | undefined;
  let timedOut = false;
  try {
    return await Promise.race([
      settledOperation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(timeoutError);
          queueMicrotask(() => connection.interrupt());
        }, remainingMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    if (timedOut) {
      void settledOperation.catch(() => undefined);
    }
  }
}

function mapCandidate(
  row: OverturePlaceRow,
  category: string,
  defaultProfile: AuditProfile | undefined,
  release: string,
  retrievedAt: string
): PlaceCandidate | undefined {
  const sourceId = stringOrUndefined(row.id);
  if (!sourceId) {
    return undefined;
  }

  const sources = sourceItems(row.sources);
  const sourceUrls = [...new Set(sources.map(sourceUrl).filter((url): url is string => url !== undefined))];
  const candidate: PlaceCandidate = {
    source: "overture",
    sourceId,
    label: stringOrUndefined(row.label),
    segment: category,
    profile: defaultProfile,
    sourceMetadata: {
      address: stringOrUndefined(row.address),
      country: stringOrUndefined(row.country),
      locality: stringOrUndefined(row.locality),
      region: stringOrUndefined(row.region),
      latitude: numberOrUndefined(row.latitude),
      longitude: numberOrUndefined(row.longitude),
      phones: stringList(row.phones),
      emails: stringList(row.emails),
      socials: [...new Set([...stringList(row.socials).filter(isPublicHttpUrl), ...stringList(row.websites).filter((url) => isPublicHttpUrl(url) && hasHost(url, socialProfileHosts))])],
      confidence: numberOrUndefined(row.confidence),
      operatingStatus: stringOrUndefined(row.operating_status),
      datasetRelease: release,
      sourceUrl: sourceUrls[0] ?? overturePlacesGuideUrl,
      sourceUrls,
      sourceProvenance: sourceProvenance(sources),
      retrievedAt
    }
  };
  const websiteUri = firstPublicHttpUrl(row.websites);
  return websiteUri ? { ...candidate, websiteUri } : candidate;
}

export async function fetchOvertureCandidates(options: FetchOvertureCandidatesOptions): Promise<PlaceCandidate[]> {
  validateBoundingBox(options.bbox);
  const categories = resolveCategories(options.category);
  const limit = normalizeLimit(options.limit);
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  const deadline = Date.now() + timeoutMs;
  const release = options.release ? validateRelease(options.release) : await fetchLatestRelease(Math.max(1, deadline - Date.now()));
  const category = options.category.trim().toLowerCase();
  const cacheRequest = options.cacheDir ? { cacheDir: options.cacheDir, category, bbox: options.bbox, limit, release } : undefined;
  if (!cacheRequest) {
    options.onCacheStatus?.({ status: "disabled", release });
  } else if (options.refreshCache) {
    options.onCacheStatus?.({ status: "refresh", release });
  } else {
    const cached = await readDiscoveryCache(cacheRequest);
    options.onCacheStatus?.(cached.info);
    if (cached.candidates) {
      return cached.candidates.map((candidate) => ({ ...candidate, profile: options.defaultProfile }));
    }
  }
  const [west, south, east, north] = options.bbox;
  const instance = await DuckDBInstance.create(":memory:", { threads: "2", memory_limit: "256MB" });
  let connection: DuckDBConnection | undefined;

  try {
    connection = await instance.connect();
    await runWithinDeadline(connection.run("INSTALL httpfs"), connection, deadline, timeoutMs);
    await runWithinDeadline(connection.run("LOAD httpfs"), connection, deadline, timeoutMs);
    await runWithinDeadline(connection.run("SET http_timeout=15"), connection, deadline, timeoutMs);
    await runWithinDeadline(connection.run("SET http_retries=1"), connection, deadline, timeoutMs);
    await runWithinDeadline(connection.run("SET s3_region='us-west-2'"), connection, deadline, timeoutMs);
    const reader: DuckDBResultReader = await runWithinDeadline(
      connection.runAndReadAll(buildQuery(release, categories), { west, south, east, north, limit }),
      connection,
      deadline,
      timeoutMs
    );
    const retrievedAt = new Date().toISOString();
    const candidates = reader
      .getRowObjectsJS()
      .map((row) => mapCandidate(row as OverturePlaceRow, category, options.defaultProfile, release, retrievedAt))
      .filter((candidate): candidate is PlaceCandidate => candidate !== undefined)
      .filter((candidate) => {
        const metadata = candidate.sourceMetadata ?? {};
        const confidence = numberOrUndefined(metadata.confidence);
        const operatingStatus = stringOrUndefined(metadata.operatingStatus)?.toLowerCase();
        return operatingStatus !== "closed_permanently" && (confidence === undefined || confidence >= minimumConfidence);
      })
      .sort((left, right) => left.sourceId!.localeCompare(right.sourceId!));
    const completeCandidates = candidates.filter((candidate, index) => index === 0 || candidate.sourceId !== candidates[index - 1]?.sourceId);
    if (cacheRequest) {
      const cacheStatus = await writeDiscoveryCache(cacheRequest, completeCandidates, retrievedAt, options.refreshCache ? "refresh" : "miss");
      options.onCacheStatus?.(cacheStatus);
    }
    return completeCandidates;
  } finally {
    connection?.closeSync();
    instance.closeSync();
  }
}
