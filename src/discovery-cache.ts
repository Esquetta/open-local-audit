import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, mkdir, open, type FileHandle } from "node:fs/promises";
import { isIP } from "node:net";
import { homedir } from "node:os";
import { isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import type { PlaceCandidate } from "./discovery.js";

const cacheSchemaVersion = 1;
const cacheFreshnessMs = 7 * 24 * 60 * 60 * 1000;
const maximumCacheBytes = 2 * 1024 * 1024;
const minimumConfidence = 0.5;
const socialProfileHosts = ["facebook.com", "instagram.com", "linkedin.com", "x.com", "twitter.com", "tiktok.com", "youtube.com", "wa.me", "whatsapp.com"];
const shortLinkHosts = ["fbf.bz", "fb.me", "bit.ly", "tinyurl.com", "t.co", "goo.gl", "maps.app.goo.gl", "linktr.ee"];

export interface DiscoveryCacheInfo {
  status: "hit" | "miss" | "refresh" | "disabled" | "unavailable";
  release: string;
  fetchedAt?: string;
  cachedAt?: string;
  message?: string;
}

export interface DiscoveryCacheKeyInput {
  category: string;
  bbox: readonly [number, number, number, number];
  limit: number;
  release: string;
}

export interface DiscoveryCacheRequest extends DiscoveryCacheKeyInput {
  cacheDir: string;
}

interface DiscoveryCacheRecord extends DiscoveryCacheKeyInput {
  schemaVersion: number;
  source: "overture";
  fetchedAt: string;
  cachedAt: string;
  candidates: PlaceCandidate[];
}

export function defaultDiscoveryCacheDirectory(): string {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    return join(localAppData && isAbsolute(localAppData) ? localAppData : join(homedir(), "AppData", "Local"), "open-local-audit", "cache", "discovery");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Caches", "open-local-audit", "discovery");
  }
  const xdgCacheHome = process.env.XDG_CACHE_HOME;
  return join(xdgCacheHome && isAbsolute(xdgCacheHome) ? xdgCacheHome : join(homedir(), ".cache"), "open-local-audit", "discovery");
}

export function discoveryCacheKey(input: DiscoveryCacheKeyInput): string {
  return createHash("sha256")
    .update(JSON.stringify({ schemaVersion: cacheSchemaVersion, category: input.category, bbox: input.bbox, limit: input.limit, release: input.release }))
    .digest("hex");
}

function cacheFilePath(input: DiscoveryCacheRequest): string {
  return join(input.cacheDir, `${discoveryCacheKey(input)}.json`);
}

function cacheError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Cache storage was unavailable";
}

function isPublicHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || host === "localhost" || host.endsWith(".localhost")) {
      return false;
    }
    if (isIP(host) === 4) {
      const octets = host.split(".").map(Number);
      return !(octets[0] === 0 || octets[0] === 10 || octets[0] === 127 || (octets[0] === 169 && octets[1] === 254) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168));
    }
    if (isIP(host) === 6) {
      const mappedIpv4 = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
      return !(host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:") || (mappedIpv4 !== undefined && !isPublicHttpUrl(`http://${mappedIpv4}`)));
    }
    return true;
  } catch {
    return false;
  }
}

function hasHost(value: string, hosts: readonly string[]): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return hosts.some((entry) => host === entry || host.endsWith(`.${entry}`));
  } catch {
    return false;
  }
}

function isSafeWebsite(value: unknown): value is string {
  return typeof value === "string" && isPublicHttpUrl(value) && !hasHost(value, socialProfileHosts) && !hasHost(value, shortLinkHosts);
}

function isPastIsoDate(value: unknown, now: number): value is string {
  const time = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) && time <= now;
}

function isStringList(value: unknown, predicate: (entry: string) => boolean): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string" && predicate(entry));
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isFiniteCoordinate(value: unknown, minimum: number, maximum: number): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum);
}

function isStringRecord(value: unknown, allowedKeys: readonly string[]): boolean {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && Object.keys(value).every((key) => allowedKeys.includes(key) && typeof (value as Record<string, unknown>)[key] === "string");
}

function isSafeCandidate(value: unknown, request: DiscoveryCacheRequest, now: number, allowProfile = false): value is PlaceCandidate {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as PlaceCandidate;
  if (candidate.source !== "overture" || typeof candidate.sourceId !== "string" || !candidate.sourceId.trim() || candidate.segment !== request.category) return false;
  if (candidate.label !== undefined && typeof candidate.label !== "string") return false;
  if (candidate.websiteUri !== undefined && !isSafeWebsite(candidate.websiteUri)) return false;
  if (!Object.keys(candidate).every((key) => ["source", "sourceId", "label", "segment", "websiteUri", "sourceMetadata", ...(allowProfile ? ["profile"] : [])].includes(key))) return false;
  if (candidate.profile !== undefined && !["generic", "dental", "beauty", "restaurant", "contractor", "lawyer", "clinic", "gym", "hotel", "auto-service"].includes(candidate.profile)) return false;
  if (typeof candidate.sourceMetadata !== "object" || candidate.sourceMetadata === null || Array.isArray(candidate.sourceMetadata)) return false;
  const metadata = candidate.sourceMetadata;
  if (metadata.datasetRelease !== request.release || !isPastIsoDate(metadata.retrievedAt, now)) return false;
  if (!Object.keys(metadata).every((key) => ["address", "country", "locality", "region", "latitude", "longitude", "phones", "emails", "socials", "confidence", "operatingStatus", "datasetRelease", "sourceUrl", "sourceUrls", "sourceProvenance", "retrievedAt"].includes(key))) return false;
  if (![metadata.address, metadata.country, metadata.locality, metadata.region, metadata.operatingStatus].every(isOptionalString)) return false;
  if (!isFiniteCoordinate(metadata.latitude, -90, 90) || !isFiniteCoordinate(metadata.longitude, -180, 180)) return false;
  if (!isStringList(metadata.phones, () => true) || !isStringList(metadata.emails, () => true) || !isStringList(metadata.socials, isPublicHttpUrl)) return false;
  if (metadata.confidence !== undefined && (typeof metadata.confidence !== "number" || !Number.isFinite(metadata.confidence) || metadata.confidence < minimumConfidence || metadata.confidence > 1)) return false;
  if (typeof metadata.operatingStatus === "string" && metadata.operatingStatus.toLowerCase() === "closed_permanently") return false;
  if (typeof metadata.sourceUrl !== "string" || !isPublicHttpUrl(metadata.sourceUrl)) return false;
  if (!isStringList(metadata.sourceUrls, isPublicHttpUrl)) return false;
  if (!Array.isArray(metadata.sourceProvenance) || !metadata.sourceProvenance.every((entry) => isStringRecord(entry, ["provider", "dataset", "license", "recordId", "resource", "version", "updateTime"]))) return false;
  return true;
}

function isSafeRecord(value: unknown, request: DiscoveryCacheRequest, now: number): value is DiscoveryCacheRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as DiscoveryCacheRecord;
  if (record.schemaVersion !== cacheSchemaVersion || record.source !== "overture" || record.category !== request.category || record.limit !== request.limit || record.release !== request.release) return false;
  if (!Array.isArray(record.bbox) || record.bbox.length !== 4 || record.bbox.some((entry, index) => entry !== request.bbox[index])) return false;
  if (!isPastIsoDate(record.fetchedAt, now) || !isPastIsoDate(record.cachedAt, now) || Date.parse(record.cachedAt) < Date.parse(record.fetchedAt) || now - Date.parse(record.cachedAt) > cacheFreshnessMs) return false;
  if (!Array.isArray(record.candidates) || record.candidates.length > request.limit || !record.candidates.every((candidate) => isSafeCandidate(candidate, request, now))) return false;
  return new Set(record.candidates.map((candidate) => candidate.sourceId)).size === record.candidates.length;
}

async function ensureSafeDirectory(cacheDir: string): Promise<void> {
  if (!isAbsolute(cacheDir)) throw new Error("Discovery cache directory must be absolute");
  const normalized = resolve(cacheDir);
  const parsed = parse(normalized);
  const parts = relative(parsed.root, normalized).split(sep).filter(Boolean);
  let current = parsed.root;
  for (const part of parts) {
    current = join(current, part);
    try {
      const entry = await lstat(current);
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("Discovery cache path is not a safe directory");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(current);
      const created = await lstat(current);
      if (!created.isDirectory() || created.isSymbolicLink()) throw new Error("Discovery cache path is not a safe directory");
    }
  }
}

type CacheFile = { state: "missing" | "unsafe" } | { state: "file"; stat: Stats };

async function safeCacheFile(path: string): Promise<CacheFile> {
  try {
    const entry = await lstat(path);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1) return { state: "unsafe" };
    return { state: "file", stat: entry };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { state: "missing" };
    throw error;
  }
}

function noFollow(flags: number): number {
  return process.platform === "win32" ? flags : flags | constants.O_NOFOLLOW;
}

function matchesCacheFile(expected: Stats, actual: Stats): boolean {
  return actual.isFile() && actual.nlink === 1 && actual.dev === expected.dev && actual.ino === expected.ino;
}

async function openExistingCacheFile(path: string, expected: Stats, flags: number) {
  const handle = await open(path, noFollow(flags));
  try {
    const actual = await handle.stat();
    if (!matchesCacheFile(expected, actual)) throw new Error("Discovery cache entry changed while opening");
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function openNewCacheFile(path: string) {
  const handle = await open(path, noFollow(constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL));
  try {
    const actual = await handle.stat();
    if (!actual.isFile() || actual.nlink !== 1) throw new Error("Discovery cache entry was unsafe");
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export async function readDiscoveryCache(request: DiscoveryCacheRequest): Promise<{ candidates?: PlaceCandidate[]; info: DiscoveryCacheInfo }> {
  try {
    await ensureSafeDirectory(request.cacheDir);
    const path = cacheFilePath(request);
    const file = await safeCacheFile(path);
    if (file.state === "missing") return { info: { status: "miss", release: request.release } };
    if (file.state !== "file" || file.stat.size > maximumCacheBytes) return { info: { status: "unavailable", release: request.release, message: "Discovery cache entry was unsafe or oversized" } };
    const handle = await openExistingCacheFile(path, file.stat, constants.O_RDONLY);
    let content: string;
    try {
      await ensureSafeDirectory(request.cacheDir);
      if (!matchesCacheFile(file.stat, await handle.stat())) throw new Error("Discovery cache entry changed while reading");
      const buffer = Buffer.alloc(maximumCacheBytes + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > maximumCacheBytes) {
        return { info: { status: "unavailable", release: request.release, message: "Discovery cache record exceeded its size limit" } };
      }
      content = buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
    if (Buffer.byteLength(content, "utf8") > maximumCacheBytes) {
      return { info: { status: "unavailable", release: request.release, message: "Discovery cache record exceeded its size limit" } };
    }
    const record: unknown = JSON.parse(content);
    const now = Date.now();
    if (!isSafeRecord(record, request, now)) {
      return { info: { status: "unavailable", release: request.release, message: "Discovery cache record was invalid or expired" } };
    }
    return { candidates: record.candidates, info: { status: "hit", release: request.release, fetchedAt: record.fetchedAt, cachedAt: record.cachedAt } };
  } catch (error) {
    return { info: { status: "unavailable", release: request.release, message: cacheError(error) } };
  }
}

export async function writeDiscoveryCache(request: DiscoveryCacheRequest, candidates: PlaceCandidate[], fetchedAt: string, status: "miss" | "refresh"): Promise<DiscoveryCacheInfo> {
  try {
    const now = Date.now();
    if (!isPastIsoDate(fetchedAt, now) || !candidates.every((candidate) => isSafeCandidate(candidate, request, now, true))) {
      return { status: "unavailable", release: request.release, message: "Discovery results did not satisfy the cache record contract" };
    }
    await ensureSafeDirectory(request.cacheDir);
    const path = cacheFilePath(request);
    const existing = await safeCacheFile(path);
    if (existing.state === "unsafe") return { status: "unavailable", release: request.release, message: "Discovery cache entry was unsafe" };
    const cachedAt = new Date().toISOString();
    const sourceCandidates = candidates.map(({ profile: _profile, ...candidate }) => candidate);
    const record: DiscoveryCacheRecord = {
      schemaVersion: cacheSchemaVersion,
      source: "overture",
      category: request.category,
      bbox: request.bbox,
      limit: request.limit,
      release: request.release,
      fetchedAt,
      cachedAt,
      candidates: sourceCandidates
    };
    const content = JSON.stringify(record);
    if (Buffer.byteLength(content, "utf8") > maximumCacheBytes) return { status: "unavailable", release: request.release, message: "Discovery cache record exceeded its size limit" };
    let handle: FileHandle;
    let expected: Stats | undefined;
    if (existing.state === "file") {
      expected = existing.stat;
      handle = await openExistingCacheFile(path, existing.stat, constants.O_WRONLY);
    } else {
      try {
        handle = await openNewCacheFile(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const createdByPeer = await safeCacheFile(path);
        if (createdByPeer.state !== "file") throw new Error("Discovery cache entry was unsafe");
        expected = createdByPeer.stat;
        handle = await openExistingCacheFile(path, createdByPeer.stat, constants.O_WRONLY);
      }
    }
    try {
      await ensureSafeDirectory(request.cacheDir);
      const current = await handle.stat();
      if (expected ? !matchesCacheFile(expected, current) : !current.isFile() || current.nlink !== 1) throw new Error("Discovery cache entry changed while writing");
      await handle.truncate(0);
      await handle.writeFile(content, "utf8");
    } finally {
      await handle.close();
    }
    return { status, release: request.release, fetchedAt, cachedAt };
  } catch (error) {
    return { status: "unavailable", release: request.release, message: cacheError(error) };
  }
}
