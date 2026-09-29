import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import type { BoundingBox } from "./overture.js";

export const maximumDiscoveryBboxSpan = 5;

export interface DiscoveryCity {
  name: string;
  country: string;
  region: string;
  latitude: number;
  longitude: number;
}

function normalizedName(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/ı/g, "i").trim();
}

export function findDiscoveryCity(data: string, name: string, country: string): DiscoveryCity {
  if (!name.trim() || !/^[A-Z]{2}$/i.test(country)) {
    throw new Error("City and two-letter country code are required, for example --city Istanbul --country TR");
  }
  const query = normalizedName(name);
  const matches: DiscoveryCity[] = [];
  for (const line of data.split("\n")) {
    const cells = line.split("\t");
    if (cells[8] !== country.toUpperCase()) continue;
    if (![cells[1], cells[2], ...(cells[3] ?? "").split(",")].some((value) => normalizedName(value ?? "") === query)) continue;
    const latitude = Number(cells[4]);
    const longitude = Number(cells[5]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    matches.push({ name: cells[1], country: cells[8], region: cells[10], latitude, longitude });
  }
  if (!matches.length) throw new Error(`City not found in GeoNames cities15000: ${name}, ${country}. Use --bbox for smaller places.`);
  if (matches.length > 1) throw new Error(`City is ambiguous: ${name}, ${country}. Use --bbox to select the intended area.`);
  return matches[0];
}

export function parseDiscoveryBbox(value: string): BoundingBox {
  const parts = value.split(",");
  const values = parts.map(Number);
  if (parts.length !== 4 || parts.some((part) => !part.trim()) || values.some((entry) => !Number.isFinite(entry))) {
    throw new Error("--bbox must be west,south,east,north in decimal degrees");
  }
  const [west, south, east, north] = values;
  if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) {
    throw new Error("Invalid --bbox: use increasing longitude/latitude bounds within world coordinates");
  }
  if (east - west > maximumDiscoveryBboxSpan || north - south > maximumDiscoveryBboxSpan) {
    throw new Error(`Search bounds must span at most ${maximumDiscoveryBboxSpan} degrees on each axis`);
  }
  return [west, south, east, north];
}

export function cityBoundingBox(city: DiscoveryCity, radiusKm = 10): BoundingBox {
  if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 50) throw new Error("--radius-km must be greater than 0 and at most 50");
  const dy = radiusKm / 111.32;
  const dx = dy / Math.cos(city.latitude * Math.PI / 180);
  return parseDiscoveryBbox([Math.max(-180, city.longitude - dx), Math.max(-90, city.latitude - dy), Math.min(180, city.longitude + dx), Math.min(90, city.latitude + dy)].join(","));
}

export async function resolveDiscoveryCity(name: string, country: string, cacheDir: string): Promise<DiscoveryCity> {
  const path = join(cacheDir, "geonames-cities15000.txt");
  let data: string | undefined;
  try {
    const info = await stat(path);
    if (Date.now() - info.mtimeMs < 30 * 24 * 60 * 60 * 1000 && info.size < 40 * 1024 * 1024) data = await readFile(path, "utf8");
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
  }
  if (data === undefined) {
    const response = await fetch("https://download.geonames.org/export/dump/cities15000.zip", { signal: AbortSignal.timeout(60000) });
    if (!response.ok || !response.body) throw new Error(`GeoNames city download failed: HTTP ${response.status}`);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 20 * 1024 * 1024) throw new Error("GeoNames download exceeds 20 MB limit");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const files = unzipSync(Buffer.concat(chunks), { filter: (file) => file.name === "cities15000.txt" && file.originalSize < 40 * 1024 * 1024 });
    if (!files["cities15000.txt"]) throw new Error("GeoNames archive has no bounded cities15000.txt dataset");
    data = strFromU8(files["cities15000.txt"]);
    // Validate before retaining downloaded content for subsequent runs.
    const city = findDiscoveryCity(data, name, country);
    await mkdir(cacheDir, { recursive: true });
    await writeFile(path, data, "utf8");
    return city;
  }
  return findDiscoveryCity(data, name, country);
}
