import { readFile } from "node:fs/promises";
import { cleanInputLines, escapeCsvCell, parseCsvLine } from "./csv.js";
import { auditProfileSchema, inputUrlSchema } from "./schema.js";
import type { AuditProfile } from "./types.js";

export type DiscoveryProviderName = "manual-csv" | "google-places";

export interface PlaceCandidate {
  source: DiscoveryProviderName;
  sourceId?: string;
  query?: string;
  label?: string;
  segment?: string;
  profile?: AuditProfile;
  websiteUri?: string;
  sourceMetadata?: Record<string, unknown>;
}

export interface WebsiteResolution {
  hasWebsite: boolean;
  websiteUrl?: string;
  status: "resolved" | "missing" | "invalid" | "skipped" | "error";
  reason?: string;
}

export interface DiscoveryAuditResult {
  status: "success" | "failed" | "not-audited";
  score?: number;
  topFinding?: string;
  reportPath?: string;
  error?: string;
}

export interface ProspectRowInput {
  candidate: PlaceCandidate;
  resolution: WebsiteResolution;
  audit?: DiscoveryAuditResult;
}

export interface ProspectExportRow {
  source: string;
  sourceId?: string;
  label?: string;
  segment?: string;
  profile: string;
  hasWebsite: "yes" | "no" | "unknown";
  websiteUrl?: string;
  auditStatus?: "success" | "failed" | "not-audited";
  score?: number;
  topFinding?: string;
  priority: "high" | "medium" | "low";
  nextAction: string;
  reportPath?: string;
  error?: string;
}

export interface ReadManualDiscoveryCsvOptions {
  defaultProfile?: AuditProfile;
}

export interface FetchGooglePlacesCandidatesOptions {
  apiKey?: string;
  defaultProfile?: AuditProfile;
  fetch?: typeof fetch;
}

interface GooglePlacesTextSearchResponse {
  places?: Array<{
    id?: string;
    displayName?: {
      text?: string;
    };
    websiteUri?: string;
  }>;
  error?: {
    message?: string;
  };
}

const googlePlacesTextSearchUrl = "https://places.googleapis.com/v1/places:searchText";
const googlePlacesFieldMask = "places.id,places.displayName,places.websiteUri";

function firstCell(cells: string[], headers: string[], names: string[]): string | undefined {
  for (const name of names) {
    const index = headers.indexOf(name);
    const value = index >= 0 ? cells[index]?.trim() : undefined;
    if (value) {
      return value;
    }
  }

  return undefined;
}

function hasHeader(headers: string[], names: string[]): boolean {
  return names.some((name) => headers.includes(name));
}

function normalizeOptionalUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return inputUrlSchema.parse(value);
  } catch {
    return value;
  }
}

export async function readManualDiscoveryCsv(
  path: string,
  options: ReadManualDiscoveryCsvOptions = {}
): Promise<PlaceCandidate[]> {
  const content = await readFile(path, "utf8");
  const lines = cleanInputLines(content);
  if (lines.length === 0) {
    return [];
  }

  const [rawHeader, ...rows] = lines;
  const headers = parseCsvLine(rawHeader).map((header) => header.trim().toLowerCase());
  if (!hasHeader(headers, ["label", "name", "business"])) {
    throw new Error("Manual discovery CSV requires a label, name, or business column");
  }

  if (!hasHeader(headers, ["website", "websiteuri", "website_uri", "url"])) {
    throw new Error("Manual discovery CSV requires a website, websiteUri, website_uri, or url column");
  }

  return rows.map((row) => {
    const cells = parseCsvLine(row);
    const rawProfile = firstCell(cells, headers, ["profile"]);
    const profile = rawProfile ? auditProfileSchema.parse(rawProfile) : options.defaultProfile;

    return {
      source: "manual-csv",
      sourceId: firstCell(cells, headers, ["sourceid", "source_id", "placeid", "place_id"]),
      query: firstCell(cells, headers, ["query"]),
      label: firstCell(cells, headers, ["label", "name", "business"]),
      segment: firstCell(cells, headers, ["segment"]),
      profile,
      websiteUri: normalizeOptionalUrl(firstCell(cells, headers, ["website", "websiteuri", "website_uri", "url"]))
    };
  });
}

export async function fetchGooglePlacesCandidates(
  query: string,
  options: FetchGooglePlacesCandidatesOptions = {}
): Promise<PlaceCandidate[]> {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) {
    throw new Error("GOOGLE_MAPS_API_KEY is required when --provider google-places is used");
  }

  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    throw new Error("A search query is required when --provider google-places is used");
  }

  const fetchImpl = options.fetch ?? fetch;
  const response = await fetchImpl(googlePlacesTextSearchUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": googlePlacesFieldMask
    },
    body: JSON.stringify({
      textQuery: normalizedQuery
    })
  });
  const payload = (await response.json()) as GooglePlacesTextSearchResponse;

  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Google Places Text Search failed with HTTP ${response.status}`);
  }

  return (payload.places ?? []).map((place) => ({
    source: "google-places",
    sourceId: place.id,
    query: normalizedQuery,
    label: place.displayName?.text,
    profile: options.defaultProfile,
    websiteUri: normalizeOptionalUrl(place.websiteUri)
  }));
}

export function resolveCandidateWebsite(candidate: Pick<PlaceCandidate, "websiteUri">): WebsiteResolution {
  if (!candidate.websiteUri?.trim()) {
    return {
      hasWebsite: false,
      status: "missing",
      reason: "No website URL provided"
    };
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(candidate.websiteUri) && !/^https?:\/\//i.test(candidate.websiteUri)) {
    return {
      hasWebsite: false,
      status: "invalid",
      reason: "Only HTTP and HTTPS website URLs are supported"
    };
  }

  try {
    const websiteUrl = inputUrlSchema.parse(candidate.websiteUri);
    return {
      hasWebsite: true,
      websiteUrl,
      status: "resolved"
    };
  } catch (error) {
    return {
      hasWebsite: false,
      status: "invalid",
      reason: error instanceof Error ? error.message : "Invalid website URL"
    };
  }
}

function priorityFor(input: ProspectRowInput): Pick<ProspectExportRow, "priority" | "nextAction"> {
  if (input.resolution.status === "missing") {
    return {
      priority: "high",
      nextAction: "Build a basic website before deeper audit."
    };
  }

  if (input.resolution.status === "invalid") {
    return {
      priority: "medium",
      nextAction: "Verify the website URL manually before outreach."
    };
  }

  if (input.audit?.status === "failed") {
    return {
      priority: "medium",
      nextAction: "Review the site manually because the audit failed."
    };
  }

  if (input.audit?.status === "success") {
    const score = input.audit.score ?? 0;
    if (score < 60) {
      return {
        priority: "high",
        nextAction: "Prioritize outreach with the top audit issue."
      };
    }

    if (score < 80) {
      return {
        priority: "medium",
        nextAction: "Review for a focused improvement offer."
      };
    }

    return {
      priority: "low",
      nextAction: "Monitor or keep for lower-priority outreach."
    };
  }

  return {
    priority: input.resolution.hasWebsite ? "medium" : "high",
    nextAction: input.resolution.hasWebsite
      ? "Audit the website before prioritizing outreach."
      : "Build a basic website before deeper audit."
  };
}

function hasWebsiteValue(resolution: WebsiteResolution): ProspectExportRow["hasWebsite"] {
  if (resolution.status === "resolved") {
    return "yes";
  }

  if (resolution.status === "missing") {
    return "no";
  }

  return "unknown";
}

export function buildProspectRows(inputs: ProspectRowInput[]): ProspectExportRow[] {
  return inputs.map((input) => {
    const audit = input.audit ?? { status: "not-audited" as const };
    const priority = priorityFor(input);

    return {
      source: input.candidate.source,
      sourceId: input.candidate.sourceId,
      label: input.candidate.label,
      segment: input.candidate.segment,
      profile: input.candidate.profile ?? "generic",
      hasWebsite: hasWebsiteValue(input.resolution),
      websiteUrl: input.resolution.websiteUrl,
      auditStatus: audit.status,
      score: audit.score,
      topFinding: audit.topFinding,
      ...priority,
      reportPath: audit.reportPath,
      error: audit.error ?? input.resolution.reason
    };
  });
}

export function renderProspectRowsCsv(rows: ProspectExportRow[]): string {
  const header = [
    "source",
    "sourceId",
    "label",
    "segment",
    "profile",
    "hasWebsite",
    "websiteUrl",
    "auditStatus",
    "score",
    "topFinding",
    "priority",
    "nextAction",
    "reportPath",
    "error"
  ];
  const body = rows.map((row) =>
    [
      row.source,
      row.sourceId ?? "",
      row.label ?? "",
      row.segment ?? "",
      row.profile,
      row.hasWebsite,
      row.websiteUrl ?? "",
      row.auditStatus ?? "",
      row.score?.toString() ?? "",
      row.topFinding ?? "",
      row.priority,
      row.nextAction,
      row.reportPath ?? "",
      row.error ?? ""
    ]
      .map(escapeCsvCell)
      .join(",")
  );

  return `${[header.join(","), ...body].join("\n")}\n`;
}
