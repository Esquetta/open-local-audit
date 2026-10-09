import { readFile } from "node:fs/promises";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { cleanInputLines, escapeCsvCell, parseCsvLine } from "./csv.js";
import { auditProfileSchema, inputUrlSchema } from "./schema.js";
import type { AuditProfile, DotnetStack, PublicContact } from "./types.js";
import type { BusinessIdentityEvidence, BusinessIdentityResult } from "./business-identity.js";
import type { AuditSelectionDecision } from "./audit-selection.js";

export type DiscoveryProviderName = "manual-csv" | "google-places" | "overture";

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
  contact?: PublicContact;
  identity?: BusinessIdentityResult;
  dotnetStack?: DotnetStack;
  placeholder?: boolean;
}

export interface ProspectRowInput {
  candidate: PlaceCandidate;
  resolution: WebsiteResolution;
  audit?: DiscoveryAuditResult;
  auditSelection?: AuditSelectionDecision;
}

export interface ProspectExportRow {
  leadKey: string;
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
  opportunityScore: number;
  opportunityReasons: string[];
  pitchAngle: string;
  recommendedOffer: string;
  estimatedNeed: "High" | "Medium" | "Low" | "Unknown";
  outreachPriorityReason: string;
  publicEmail?: string;
  publicPhone?: string;
  whatsappUrl?: string;
  contactPageUrl?: string;
  socialProfiles?: string[];
  contactConfidence?: PublicContact["contactConfidence"];
  contactSource?: string;
  preferredContactChannel: string;
  outreachAction: string;
  contactabilityReason: string;
  priority: "high" | "medium" | "low";
  nextAction: string;
  reviewStatus: string;
  reviewReason?: string;
  lastReviewedAt?: string;
  reportPath?: string;
  error?: string;
  dotnetStack?: DotnetStack["stack"];
  dotnetLegacyFramework?: boolean;
  address?: string;
  country?: string;
  locality?: string;
  region?: string;
  latitude?: number;
  longitude?: number;
  datasetRelease?: string;
  sourceUrl?: string;
  retrievedAt?: string;
  confidence?: number;
  operatingStatus?: string;
  sourceProvenance?: Array<Record<string, string>>;
  identityStatus?: BusinessIdentityResult["status"] | "not-checked";
  identityReasons?: string[];
  identityEvidence?: BusinessIdentityEvidence[];
  auditSelected?: boolean;
  auditSelectionReason?: string;
  auditSelectionRank?: number;
}

export interface LeadSuppressionEntry {
  leadKey: string;
  reviewStatus?: string;
  reviewReason?: string;
  lastReviewedAt?: string;
}

export interface LeadReviewRow {
  leadKey: string;
  source: string;
  sourceId?: string;
  label?: string;
  websiteUrl?: string;
  reviewStatus: string;
  reviewReason?: string;
  lastReviewedAt?: string;
  opportunityScore?: number;
  priority?: ProspectExportRow["priority"];
  nextAction?: string;
}

export interface DuplicateProspectGroup {
  leadKey: string;
  count: number;
  labels: string[];
  sources: string[];
}

export type FuzzyDuplicateConfidence = "high" | "medium" | "low";

export interface FuzzyDuplicateProspectGroup {
  matchKey: string;
  confidence: FuzzyDuplicateConfidence;
  matchReasons: string[];
  count: number;
  labels: string[];
  leadKeys: string[];
  sources: string[];
}

export interface ReadManualDiscoveryCsvOptions {
  defaultProfile?: AuditProfile;
}

export type ProspectCsvExportPreset = "standard" | "crm";

export interface FetchGooglePlacesCandidatesOptions {
  apiKey?: string;
  defaultProfile?: AuditProfile;
  limit?: number;
  fetch?: typeof fetch;
}

export interface DiscoverySummary {
  totalCandidates: number;
  suppressedCandidates: number;
  withWebsite: number;
  withoutWebsite: number;
  unknownWebsite: number;
  audited: number;
  auditFailed: number;
  notAudited: number;
  averageScore?: number;
  priority: Record<ProspectExportRow["priority"], number>;
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
const defaultGooglePlacesLimit = 10;
const maxGooglePlacesLimit = 50;
const suppressedReviewStatuses = new Set(["rejected", "contacted", "not-fit", "not_a_fit", "do-not-contact", "suppressed"]);

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

function normalizeIdentityUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  try {
    const parsed = new URL(inputUrlSchema.parse(value));
    parsed.hash = "";
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    const normalized = parsed.toString();
    return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
  } catch {
    return undefined;
  }
}

function normalizeLabel(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, " ").toLowerCase();
  return normalized || undefined;
}

function normalizeHostname(value: string | undefined): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  try {
    const parsed = new URL(inputUrlSchema.parse(value));
    return parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function normalizeEmail(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized.includes("@") ? normalized : undefined;
}

function normalizePhone(value: string | undefined): string | undefined {
  const digits = value?.replace(/\D+/g, "");
  return digits && digits.length >= 7 ? digits : undefined;
}

const weakLabelTokens = new Set([
  "a",
  "and",
  "clinic",
  "co",
  "company",
  "dental",
  "group",
  "inc",
  "ltd",
  "merkezi",
  "the"
]);

const sharedProfileHostnames = new Set([
  "beacons.ai",
  "bio.site",
  "campsite.bio",
  "forms.gle",
  "linktr.ee",
  "lnk.bio",
  "msha.ke",
  "taplink.cc"
]);

function sortStrings(values: string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function labelTokens(value: string | undefined): string[] {
  const normalized = normalizeLabel(
    value
      ?.normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/gi, " ")
  );
  if (!normalized) {
    return [];
  }

  return [...new Set(normalized.split(" ").filter((token) => token.length > 2 && !weakLabelTokens.has(token)))];
}

function labelSimilarity(left: string | undefined, right: string | undefined): number {
  const leftTokens = labelTokens(left);
  const rightTokens = labelTokens(right);
  if (leftTokens.length < 2 || rightTokens.length < 2) {
    return 0;
  }

  const rightSet = new Set(rightTokens);
  const overlap = leftTokens.filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union > 0 ? overlap / union : 0;
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return defaultGooglePlacesLimit;
  }

  return Math.min(maxGooglePlacesLimit, Math.max(1, Math.floor(limit)));
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

export async function readLeadSuppressionCsv(path: string): Promise<LeadSuppressionEntry[]> {
  const content = await readFile(path, "utf8");
  const lines = cleanInputLines(content);
  if (lines.length === 0) {
    return [];
  }

  const [rawHeader, ...rows] = lines;
  const headers = parseCsvLine(rawHeader).map((header) => header.trim().toLowerCase());
  return rows.flatMap((row) => {
    const cells = parseCsvLine(row);
    const explicitLeadKey = firstCell(cells, headers, ["leadkey", "lead_key"]);
    const source = firstCell(cells, headers, ["source"]) ?? "manual-csv";
    const sourceId = firstCell(cells, headers, ["sourceid", "source_id", "placeid", "place_id"]);
    const websiteUrl = normalizeIdentityUrl(firstCell(cells, headers, ["websiteurl", "website_url", "website", "url"]));
    const label = normalizeLabel(firstCell(cells, headers, ["label", "name", "business"]));
    const leadKey =
      explicitLeadKey ??
      (sourceId ? `${source}:${sourceId}` : undefined) ??
      (websiteUrl ? `url:${websiteUrl}` : undefined) ??
      (label ? `label:${source}:${label}` : undefined);

    if (!leadKey) {
      return [];
    }

    return [
      {
        leadKey,
        reviewStatus: firstCell(cells, headers, ["reviewstatus", "review_status"]),
        reviewReason: firstCell(cells, headers, ["reviewreason", "review_reason"]),
        lastReviewedAt: firstCell(cells, headers, ["lastreviewedat", "last_reviewed_at"])
      }
    ];
  });
}

export async function readLeadReviewCsv(path: string): Promise<LeadReviewRow[]> {
  const content = await readFile(path, "utf8");
  const lines = cleanInputLines(content);
  if (lines.length === 0) {
    return [];
  }

  const [rawHeader, ...rows] = lines;
  const headers = parseCsvLine(rawHeader).map((header) => header.trim().toLowerCase());
  return rows.flatMap((row) => {
    const cells = parseCsvLine(row);
    const explicitLeadKey = firstCell(cells, headers, ["leadkey", "lead_key"]);
    const source = firstCell(cells, headers, ["source"]) ?? "manual-csv";
    const sourceId = firstCell(cells, headers, ["sourceid", "source_id", "placeid", "place_id"]);
    const websiteUrl = normalizeIdentityUrl(firstCell(cells, headers, ["websiteurl", "website_url", "website", "url"]));
    const label = normalizeLabel(firstCell(cells, headers, ["label", "name", "business"]));
    const leadKey =
      explicitLeadKey ??
      (sourceId ? `${source}:${sourceId}` : undefined) ??
      (websiteUrl ? `url:${websiteUrl}` : undefined) ??
      (label ? `label:${source}:${label}` : undefined);

    if (!leadKey) {
      return [];
    }

    return [
      {
        leadKey,
        source,
        sourceId,
        label: firstCell(cells, headers, ["label", "name", "business"]),
        websiteUrl: firstCell(cells, headers, ["websiteurl", "website_url", "website", "url"]),
        reviewStatus: firstCell(cells, headers, ["reviewstatus", "review_status"]) ?? "pending",
        reviewReason: firstCell(cells, headers, ["reviewreason", "review_reason"]),
        lastReviewedAt: firstCell(cells, headers, ["lastreviewedat", "last_reviewed_at"]),
        opportunityScore: Number(firstCell(cells, headers, ["opportunityscore", "opportunity_score"])) || undefined,
        priority: firstCell(cells, headers, ["priority"]) as ProspectExportRow["priority"] | undefined,
        nextAction: firstCell(cells, headers, ["nextaction", "next_action"])
      }
    ];
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
  const limit = normalizeLimit(options.limit);
  const response = await fetchImpl(googlePlacesTextSearchUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": googlePlacesFieldMask
    },
    body: JSON.stringify({
      textQuery: normalizedQuery,
      maxResultCount: limit
    })
  });
  const payload = (await response.json()) as GooglePlacesTextSearchResponse;

  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Google Places Text Search failed with HTTP ${response.status}`);
  }

  return (payload.places ?? []).slice(0, limit).map((place) => ({
    source: "google-places",
    sourceId: place.id,
    query: normalizedQuery,
    label: place.displayName?.text,
    profile: options.defaultProfile,
    websiteUri: normalizeOptionalUrl(place.websiteUri)
  }));
}

export function resolveCandidateWebsite(candidate: Pick<PlaceCandidate, "websiteUri"> & Partial<Pick<PlaceCandidate, "source">>): WebsiteResolution {
  if (!candidate.websiteUri?.trim()) {
    return {
      hasWebsite: false,
      status: candidate.source === "overture" ? "skipped" : "missing",
      reason: candidate.source === "overture" ? "Website availability is unknown; source contains no website URL" : "No website URL provided"
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

export function stableLeadKey(input: ProspectRowInput): string {
  if (input.candidate.sourceId?.trim()) {
    return `${input.candidate.source}:${input.candidate.sourceId.trim()}`;
  }

  const websiteUrl = normalizeIdentityUrl(input.resolution.websiteUrl ?? input.candidate.websiteUri);
  if (websiteUrl) {
    return `url:${websiteUrl}`;
  }

  const label = normalizeLabel(input.candidate.label);
  return label ? `label:${input.candidate.source}:${label}` : `candidate:${input.candidate.source}:unknown`;
}

function isSuppressed(entry: LeadSuppressionEntry): boolean {
  const status = entry.reviewStatus?.trim().toLowerCase();
  return status ? suppressedReviewStatuses.has(status) : true;
}

export function filterSuppressedProspects(
  inputs: ProspectRowInput[],
  entries: LeadSuppressionEntry[]
): { included: ProspectRowInput[]; suppressedCount: number } {
  const suppressedKeys = new Set(entries.filter(isSuppressed).map((entry) => entry.leadKey));
  const included = inputs.filter((input) => !suppressedKeys.has(stableLeadKey(input)));

  return {
    included,
    suppressedCount: inputs.length - included.length
  };
}

function reviewRowForProspect(row: ProspectExportRow, existing?: LeadReviewRow): LeadReviewRow {
  return {
    leadKey: row.leadKey,
    source: row.source,
    sourceId: row.sourceId,
    label: row.label,
    websiteUrl: row.websiteUrl,
    reviewStatus: existing?.reviewStatus ?? "pending",
    reviewReason: existing?.reviewReason,
    lastReviewedAt: existing?.lastReviewedAt,
    opportunityScore: row.opportunityScore,
    priority: row.priority,
    nextAction: row.nextAction
  };
}

export function mergeDiscoveryReviewRows(rows: ProspectExportRow[], existingRows: LeadReviewRow[] = []): LeadReviewRow[] {
  const currentByKey = new Map(rows.map((row) => [row.leadKey, row]));
  const existingByKey = new Map(existingRows.map((row) => [row.leadKey, row]));
  const merged = existingRows.map((existing) => {
    const current = currentByKey.get(existing.leadKey);
    return current ? reviewRowForProspect(current, existing) : existing;
  });

  for (const row of rows) {
    if (!existingByKey.has(row.leadKey)) {
      merged.push(reviewRowForProspect(row));
    }
  }

  return merged;
}

export function findDuplicateProspectGroups(rows: ProspectExportRow[]): DuplicateProspectGroup[] {
  const groups = new Map<string, ProspectExportRow[]>();
  for (const row of rows) {
    const group = groups.get(row.leadKey) ?? [];
    group.push(row);
    groups.set(row.leadKey, group);
  }

  return [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([leadKey, group]) => ({
      leadKey,
      count: group.length,
      labels: [...new Set(group.flatMap((row) => (row.label ? [row.label] : [])))],
      sources: [...new Set(group.map((row) => row.source))]
    }));
}

interface FuzzyDuplicateSignal {
  matchKey: string;
  confidence: FuzzyDuplicateConfidence;
  reason: string;
}

function fuzzySignalsFor(row: ProspectExportRow): FuzzyDuplicateSignal[] {
  const signals: FuzzyDuplicateSignal[] = [];
  const domain = normalizeHostname(row.websiteUrl);
  if (domain && !sharedProfileHostnames.has(domain)) {
    signals.push({
      matchKey: `domain:${domain}`,
      confidence: "high",
      reason: `Shared website domain: ${domain}`
    });
  }

  const email = normalizeEmail(row.publicEmail);
  if (email) {
    signals.push({
      matchKey: `email:${email}`,
      confidence: "high",
      reason: `Shared public email: ${email}`
    });
  }

  const phone = normalizePhone(row.publicPhone);
  if (phone) {
    signals.push({
      matchKey: `phone:${phone}`,
      confidence: "high",
      reason: "Shared public phone number"
    });
  }

  return signals;
}

function confidenceRank(confidence: FuzzyDuplicateConfidence): number {
  return confidence === "high" ? 3 : confidence === "medium" ? 2 : 1;
}

function strongestConfidence(signals: FuzzyDuplicateSignal[]): FuzzyDuplicateConfidence {
  return signals.reduce<FuzzyDuplicateConfidence>(
    (strongest, signal) => (confidenceRank(signal.confidence) > confidenceRank(strongest) ? signal.confidence : strongest),
    "low"
  );
}

function compactGroup(rows: ProspectExportRow[], signals: FuzzyDuplicateSignal[]): FuzzyDuplicateProspectGroup | undefined {
  const leadKeys = sortStrings([...new Set(rows.map((row) => row.leadKey))]);
  if (leadKeys.length < 2) {
    return undefined;
  }

  const sortedSignals = [...signals].sort((left, right) => {
    const confidenceDelta = confidenceRank(right.confidence) - confidenceRank(left.confidence);
    return confidenceDelta !== 0 ? confidenceDelta : left.matchKey.localeCompare(right.matchKey);
  });

  return {
    matchKey: sortedSignals[0]?.matchKey ?? `review:${leadKeys.join("|")}`,
    confidence: strongestConfidence(sortedSignals),
    matchReasons: sortStrings([...new Set(sortedSignals.map((signal) => signal.reason))]),
    count: rows.length,
    labels: sortStrings([...new Set(rows.flatMap((row) => (row.label ? [row.label] : [])))]),
    leadKeys,
    sources: sortStrings([...new Set(rows.map((row) => row.source))])
  };
}

function mergeFuzzyGroups(
  existing: FuzzyDuplicateProspectGroup,
  next: FuzzyDuplicateProspectGroup
): FuzzyDuplicateProspectGroup {
  const confidence =
    confidenceRank(next.confidence) > confidenceRank(existing.confidence) ? next.confidence : existing.confidence;
  const matchKey =
    confidenceRank(next.confidence) > confidenceRank(existing.confidence)
      ? next.matchKey
      : sortStrings([existing.matchKey, next.matchKey])[0];

  return {
    matchKey,
    confidence,
    matchReasons: sortStrings([...new Set([...existing.matchReasons, ...next.matchReasons])]),
    count: Math.max(existing.count, next.count),
    labels: sortStrings([...new Set([...existing.labels, ...next.labels])]),
    leadKeys: sortStrings([...new Set([...existing.leadKeys, ...next.leadKeys])]),
    sources: sortStrings([...new Set([...existing.sources, ...next.sources])])
  };
}

export function findFuzzyDuplicateProspectGroups(rows: ProspectExportRow[]): FuzzyDuplicateProspectGroup[] {
  const groupsBySignal = new Map<string, { rows: ProspectExportRow[]; signals: FuzzyDuplicateSignal[] }>();

  for (const row of rows) {
    for (const signal of fuzzySignalsFor(row)) {
      const group = groupsBySignal.get(signal.matchKey) ?? { rows: [], signals: [] };
      group.rows.push(row);
      group.signals.push(signal);
      groupsBySignal.set(signal.matchKey, group);
    }
  }

  const signalGroups = [...groupsBySignal.values()]
    .filter((group) => group.rows.length > 1)
    .flatMap((group) => compactGroup(group.rows, group.signals) ?? []);

  const labelGroups: FuzzyDuplicateProspectGroup[] = [];
  for (let leftIndex = 0; leftIndex < rows.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < rows.length; rightIndex += 1) {
      const left = rows[leftIndex];
      const right = rows[rightIndex];
      if (left.leadKey === right.leadKey) {
        continue;
      }

      const similarity = labelSimilarity(left.label, right.label);
      if (similarity < 0.75) {
        continue;
      }

      const compacted = compactGroup([left, right], [
        {
          matchKey: `label:${labelTokens(left.label).filter((token) => labelTokens(right.label).includes(token)).join("-")}`,
          confidence: "medium",
          reason: "Similar business labels"
        }
      ]);
      if (compacted) {
        labelGroups.push(compacted);
      }
    }
  }

  const byLeadKeys = new Map<string, FuzzyDuplicateProspectGroup>();
  for (const group of [...signalGroups, ...labelGroups]) {
    const key = [...group.leadKeys].sort().join("|");
    const existing = byLeadKeys.get(key);
    if (existing) {
      byLeadKeys.set(key, mergeFuzzyGroups(existing, group));
    } else {
      byLeadKeys.set(key, group);
    }
  }

  return [...byLeadKeys.values()].sort((left, right) => {
    const confidenceDelta = confidenceRank(right.confidence) - confidenceRank(left.confidence);
    return confidenceDelta !== 0 ? confidenceDelta : left.matchKey.localeCompare(right.matchKey);
  });
}

function priorityFor(input: ProspectRowInput): Pick<ProspectExportRow, "priority" | "nextAction"> {
  if (input.audit?.identity?.status === "conflict") {
    return { priority: "medium", nextAction: "Verify the business website manually; its identity conflicts with the source." };
  }
  if (input.audit?.identity?.status === "uncertain") {
    return { priority: "medium", nextAction: "Confirm that this website belongs to the business before using its audit for outreach." };
  }
  if (input.candidate.source === "overture" && !input.resolution.hasWebsite) {
    return { priority: "medium", nextAction: "Verify the business and its website before proposing work." };
  }
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

  if (input.audit?.status === "success" && input.audit.placeholder) {
    return {
      priority: "high",
      nextAction: "Replace the placeholder or parked page with a basic website."
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

function opportunityScoreFor(input: ProspectRowInput): number {
  if (input.audit?.identity?.status === "conflict") return 0;
  if (input.candidate.source === "overture" && !input.resolution.hasWebsite) return 0;
  if (input.resolution.status === "missing") {
    return 95;
  }

  if (input.resolution.status === "invalid") {
    return 70;
  }

  if (input.audit?.status === "failed") {
    return 60;
  }

  if (input.audit?.status === "success" && input.audit.placeholder) {
    return 95;
  }

  if (input.audit?.status === "success") {
    const score = input.audit.score ?? 0;
    if (score < 60) {
      return 90;
    }

    if (score < 80) {
      return 65;
    }

    return 30;
  }

  return input.resolution.hasWebsite ? 55 : 95;
}

function opportunityReasonsFor(input: ProspectRowInput): string[] {
  if (input.audit?.identity?.status === "conflict") return ["Website identity conflicts with the source", ...input.audit.identity.reasons];
  if (input.candidate.source === "overture" && !input.resolution.hasWebsite) {
    return ["Website availability is unknown; missing source data is not evidence of a website-build opportunity"];
  }
  if (input.resolution.status === "missing") {
    return ["No website URL found", "Website-build opportunity"];
  }

  if (input.resolution.status === "invalid") {
    return ["Website URL is invalid", "Manual cleanup needed before audit"];
  }

  if (input.audit?.status === "failed") {
    return ["Audit failed and needs manual review"];
  }

  if (input.audit?.status === "success" && input.audit.placeholder) {
    return [`Top finding: ${input.audit.topFinding}`, "Website-build opportunity"];
  }

  if (input.audit?.status === "success") {
    const score = input.audit.score ?? 0;
    const reasons: string[] = [];
    if (score < 60) {
      reasons.push("Audit score is below 60");
    } else if (score < 80) {
      reasons.push("Audit score is below 80");
    } else {
      reasons.push("Audit score is 80 or higher");
    }

    if (input.audit.topFinding) {
      reasons.push(`Top finding: ${input.audit.topFinding}`);
    }

    return reasons;
  }

  return input.resolution.hasWebsite ? ["Website found but not audited yet"] : ["No website URL found"];
}

function enrichmentFor(input: ProspectRowInput): Pick<
  ProspectExportRow,
  "pitchAngle" | "recommendedOffer" | "estimatedNeed" | "outreachPriorityReason"
> {
  const reasons = opportunityReasonsFor(input);
  if (input.audit?.identity?.status === "conflict") {
    return { pitchAngle: "Verify business information", recommendedOffer: "Manual qualification", estimatedNeed: "Unknown", outreachPriorityReason: reasons.join("; ") };
  }
  if (input.candidate.source === "overture" && !input.resolution.hasWebsite) {
    return { pitchAngle: "Verify business information", recommendedOffer: "Manual qualification", estimatedNeed: "Unknown", outreachPriorityReason: reasons.join("; ") };
  }
  if (input.resolution.status === "missing" || (input.audit?.status === "success" && input.audit.placeholder)) {
    return {
      pitchAngle: "Launch a credible local website",
      recommendedOffer: "Starter website build",
      estimatedNeed: "High",
      outreachPriorityReason: reasons.join("; ")
    };
  }

  if (input.audit?.status === "success") {
    const score = input.audit.score ?? 0;
    if (score < 60) {
      return {
        pitchAngle: "Fix visible conversion blockers",
        recommendedOffer: "Conversion-focused website tune-up",
        estimatedNeed: "High",
        outreachPriorityReason: reasons.join("; ")
      };
    }

    if (score < 80) {
      return {
        pitchAngle: "Improve local trust signals",
        recommendedOffer: "Local SEO and trust cleanup",
        estimatedNeed: "Medium",
        outreachPriorityReason: reasons.join("; ")
      };
    }

    return {
      pitchAngle: "Maintain a healthy local presence",
      recommendedOffer: "Monitoring and periodic audit",
      estimatedNeed: "Low",
      outreachPriorityReason: reasons.join("; ")
    };
  }

  if (input.audit?.status === "failed") {
    return {
      pitchAngle: "Manually qualify technical blockers",
      recommendedOffer: "Manual audit follow-up",
      estimatedNeed: "Medium",
      outreachPriorityReason: reasons.join("; ")
    };
  }

  return {
    pitchAngle: input.resolution.hasWebsite ? "Qualify website improvement potential" : "Launch a credible local website",
    recommendedOffer: input.resolution.hasWebsite ? "Website audit follow-up" : "Starter website build",
    estimatedNeed: input.resolution.hasWebsite ? "Medium" : "High",
    outreachPriorityReason: reasons.join("; ")
  };
}

function contactHandoffFor(input: ProspectRowInput): Pick<
  ProspectExportRow,
  "preferredContactChannel" | "outreachAction" | "contactabilityReason"
> {
  const contact = prospectContact(input);
  if (input.audit?.identity?.status === "conflict") {
    return { preferredContactChannel: "manual-review", outreachAction: "Resolve the website identity conflict before outreach.", contactabilityReason: "Only source contacts are retained; website identity conflicts with the business record." };
  }
  if (input.audit?.identity?.status === "uncertain") {
    return { preferredContactChannel: "manual-review", outreachAction: "Verify the business and branch before using website contacts or audit findings.", contactabilityReason: "Website identity has insufficient or mixed evidence; contacts require manual verification." };
  }
  if (input.candidate.source === "overture" && (contact?.publicEmail || contact?.publicPhone)) {
    return {
      preferredContactChannel: contact.publicEmail ? "email" : "phone",
      outreachAction: "Verify the business contact and review available evidence before outreach.",
      contactabilityReason: "Public contact found in the business source or website; ownership and deliverability are not verified."
    };
  }
  if (contact?.publicEmail) {
    return {
      preferredContactChannel: "email",
      outreachAction: "Send a personalized audit summary by email.",
      contactabilityReason: "Public email found on the audited website."
    };
  }

  if (contact?.whatsappUrl) {
    return {
      preferredContactChannel: "whatsapp",
      outreachAction: "Send a short WhatsApp message with the top audit issue.",
      contactabilityReason: "WhatsApp link found on the audited website."
    };
  }

  if (contact?.publicPhone) {
    return {
      preferredContactChannel: "phone",
      outreachAction: "Call with the top audit issue and offer a review.",
      contactabilityReason: "Public phone number found on the audited website."
    };
  }

  if (contact?.contactPageUrl) {
    return {
      preferredContactChannel: "contact-page",
      outreachAction: "Use the website contact page with the top audit issue.",
      contactabilityReason: "Contact page found on the audited website."
    };
  }

  if (input.resolution.status === "missing") {
    return {
      preferredContactChannel: "manual-review",
      outreachAction: "Find or create a website path before outreach.",
      contactabilityReason: "No website URL found."
    };
  }

  if (input.audit?.status === "failed") {
    return {
      preferredContactChannel: "manual-review",
      outreachAction: "Review the failed audit before outreach.",
      contactabilityReason: "Audit failed before contactability could be trusted."
    };
  }

  if (!input.audit || input.audit.status === "not-audited") {
    return {
      preferredContactChannel: "manual-review",
      outreachAction: "Audit the website before choosing an outreach channel.",
      contactabilityReason: "Website was not audited, so public contactability is unknown."
    };
  }

  return {
    preferredContactChannel: "manual-review",
    outreachAction: "Find a public contact path manually before outreach.",
    contactabilityReason: "No public contact channel found on the audited website."
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

function prospectContact(input: ProspectRowInput): PublicContact | undefined {
  if (input.candidate.source !== "overture") return input.audit?.contact;
  const metadata = input.candidate.sourceMetadata ?? {};
  const first = (key: string): string | undefined => Array.isArray(metadata[key]) ? metadata[key].find((value: unknown) => typeof value === "string" && value.trim()) : undefined;
  const websiteContact = input.audit?.identity?.status === "conflict" ? undefined : input.audit?.contact;
  const publicEmail = websiteContact?.publicEmail ?? first("emails");
  const publicPhone = websiteContact?.publicPhone ?? first("phones");
  return {
    ...websiteContact,
    publicEmail,
    publicPhone,
    socialProfiles: Array.from(new Set([...(websiteContact?.socialProfiles ?? []), ...(Array.isArray(metadata.socials) ? metadata.socials.filter((value): value is string => typeof value === "string") : [])])),
    contactConfidence: websiteContact?.contactConfidence !== undefined && websiteContact.contactConfidence !== "None" ? input.audit?.identity?.status === "uncertain" ? "Low" : websiteContact.contactConfidence : publicEmail || publicPhone ? "Low" : "None",
    contactSource: [websiteContact?.contactSource, "Overture Places (source data; not independently verified)"].filter(Boolean).join("; ")
  };
}

// UK geographic area codes: 02x (020 London), 011x and 01x1 (0113 Leeds, 0161 Manchester), otherwise 01xxx (01934).
function ukAreaCode(phone: string | undefined): string | undefined {
  const parsed = phone ? parsePhoneNumberFromString(phone, "GB") : undefined;
  if (parsed?.country !== "GB" || parsed.getType() !== "FIXED_LINE") return undefined;
  const national = `0${parsed.nationalNumber}`;
  if (national.startsWith("02")) return national.slice(0, 3);
  if (/^01(1\d|\d1)/.test(national)) return national.slice(0, 4);
  return national.startsWith("01") ? national.slice(0, 5) : undefined;
}

function mostCommon(values: Array<string | undefined>): [string, number] | undefined {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0];
}

// A lead listed in the search's main locality whose landline area code belongs elsewhere may be in the wrong
// place (a Weston-super-Mare 01934 clinic geocoded into Leeds). Neighbouring towns at the edge of the search box
// list their own locality, so they are not flagged. Only a clear majority area code counts.
function areaCodeMismatches(inputs: ProspectRowInput[]): Map<ProspectRowInput, string> {
  const leads = inputs.map((input) => {
    const locality = input.candidate.sourceMetadata?.locality;
    // Manual and Google Places lists can span several towns on purpose; only an Overture area search has one place,
    // and only UK listings are compared so a +44 number on a business abroad is never read as a UK area.
    const ukOverture = input.candidate.source === "overture" && input.candidate.sourceMetadata?.country === "GB";
    const code = ukOverture ? ukAreaCode(prospectContact(input)?.publicPhone) : undefined;
    return { input, code, locality: typeof locality === "string" ? locality.trim().toLowerCase() : undefined };
  });
  const codes = leads.map((lead) => lead.code).filter(Boolean);
  const [dominant, dominantCount] = mostCommon(codes) ?? [];
  const mismatches = new Map<ProspectRowInput, string>();
  if (!dominant || codes.length < 5 || dominantCount! / codes.length < 0.6) return mismatches;
  const [mainLocality] = mostCommon(leads.filter((lead) => lead.code === dominant).map((lead) => lead.locality)) ?? [];
  for (const { input, code, locality } of leads) {
    if (code && code !== dominant && locality !== undefined && locality === mainLocality) {
      mismatches.set(input, `Phone area code ${code} differs from ${dominant}, which most leads in this search use; the business may be listed in the wrong place`);
    }
  }
  return mismatches;
}

export function buildProspectRows(inputs: ProspectRowInput[]): ProspectExportRow[] {
  const locationMismatches = areaCodeMismatches(inputs);
  return inputs.map((input) => {
    const locationMismatch = locationMismatches.get(input);
    if (input.audit?.identity?.status === "conflict") {
      input = { ...input, audit: { ...input.audit, status: "failed", contact: undefined, dotnetStack: undefined, score: undefined, topFinding: undefined, reportPath: undefined, error: input.audit.error ?? "Website identity conflicts with the source; manual review is required." } };
    }
    const audit = input.audit ?? { status: "not-audited" as const };
    const basePriority = priorityFor(input);
    const priority: Pick<ProspectExportRow, "priority" | "nextAction"> = locationMismatch
      ? { priority: basePriority.priority === "low" ? "low" : "medium", nextAction: "Confirm the business location before outreach; its phone area code does not match this search." }
      : basePriority;
    const enrichment = enrichmentFor(input);
    const handoff = contactHandoffFor(input);
    const contact = prospectContact(input);
    const metadata = input.candidate.sourceMetadata ?? {};
    const details = input.candidate.source === "overture" ? Object.fromEntries(
      ["address", "country", "locality", "region", "latitude", "longitude", "datasetRelease", "sourceUrl", "retrievedAt", "confidence", "operatingStatus", "sourceProvenance"].map((key) => [key, metadata[key]])
    ) : {};

    return {
      leadKey: stableLeadKey(input),
      source: input.candidate.source,
      sourceId: input.candidate.sourceId,
      label: input.candidate.label,
      segment: input.candidate.segment,
      profile: input.candidate.profile ?? "generic",
      hasWebsite: input.audit?.identity?.status === "conflict" ? "unknown" : hasWebsiteValue(input.resolution),
      websiteUrl: input.resolution.websiteUrl,
      auditStatus: audit.status,
      score: audit.score,
      topFinding: audit.topFinding,
      opportunityScore: opportunityScoreFor(input),
      opportunityReasons: locationMismatch ? [...opportunityReasonsFor(input), locationMismatch] : opportunityReasonsFor(input),
      ...enrichment,
      ...details,
      ...(input.candidate.source === "overture" ? {
        identityStatus: input.audit?.identity?.status ?? "not-checked",
        identityReasons: input.audit?.identity?.reasons ?? [],
        identityEvidence: input.audit?.identity?.evidence ?? [],
        auditSelected: input.auditSelection?.selected,
        auditSelectionReason: input.auditSelection?.reason,
        auditSelectionRank: input.auditSelection?.rank
      } : {}),
      publicEmail: contact?.publicEmail,
      publicPhone: contact?.publicPhone,
      whatsappUrl: contact?.whatsappUrl,
      contactPageUrl: contact?.contactPageUrl,
      socialProfiles: contact?.socialProfiles ?? [],
      contactConfidence: contact?.contactConfidence ?? "None",
      contactSource: contact?.contactSource,
      ...handoff,
      ...priority,
      reviewStatus: "new",
      reportPath: audit.reportPath,
      error: audit.error ?? input.resolution.reason,
      dotnetStack: audit.dotnetStack?.stack,
      dotnetLegacyFramework: audit.dotnetStack?.legacyFramework
    };
  });
}

export function buildDiscoverySummary(rows: ProspectExportRow[], suppressedCandidates = 0): DiscoverySummary {
  const scores = rows.flatMap((row) => (row.auditStatus === "success" && row.score !== undefined ? [row.score] : []));

  return {
    totalCandidates: rows.length,
    suppressedCandidates,
    withWebsite: rows.filter((row) => row.hasWebsite === "yes").length,
    withoutWebsite: rows.filter((row) => row.hasWebsite === "no").length,
    unknownWebsite: rows.filter((row) => row.hasWebsite === "unknown").length,
    audited: rows.filter((row) => row.auditStatus === "success").length,
    auditFailed: rows.filter((row) => row.auditStatus === "failed").length,
    notAudited: rows.filter((row) => row.auditStatus === "not-audited").length,
    averageScore:
      scores.length > 0 ? Math.round(scores.reduce((total, score) => total + score, 0) / scores.length) : undefined,
    priority: {
      high: rows.filter((row) => row.priority === "high").length,
      medium: rows.filter((row) => row.priority === "medium").length,
      low: rows.filter((row) => row.priority === "low").length
    }
  };
}

function fallbackCompanyName(row: Pick<ProspectExportRow, "label" | "websiteUrl" | "leadKey">): string {
  if (row.label?.trim()) {
    return row.label;
  }

  if (row.websiteUrl) {
    try {
      return new URL(row.websiteUrl).hostname.replace(/^www\./, "");
    } catch {
      return row.websiteUrl;
    }
  }

  return row.leadKey;
}

function renderCrmProspectRowsCsv(rows: ProspectExportRow[]): string {
  const header = [
    "companyName",
    "website",
    "segment",
    "profile",
    "priority",
    "score",
    "opportunityScore",
    "topFinding",
    "contactConfidence",
    "preferredContactChannel",
    "contactabilityReason",
    "publicEmail",
    "publicPhone",
    "contactPageUrl",
    "source",
    "leadKey",
    "reportPath"
  ];
  const body = rows.map((row) =>
    [
      fallbackCompanyName(row),
      row.websiteUrl ?? "",
      row.segment ?? "",
      row.profile,
      row.priority,
      row.score?.toString() ?? "",
      row.opportunityScore.toString(),
      row.topFinding ?? "",
      row.contactConfidence ?? "None",
      row.preferredContactChannel,
      row.contactabilityReason,
      row.publicEmail ?? "",
      row.publicPhone ?? "",
      row.contactPageUrl ?? "",
      row.source,
      row.leadKey,
      row.reportPath ?? ""
    ]
      .map(escapeCsvCell)
      .join(",")
  );

  return `${[header.join(","), ...body].join("\n")}\n`;
}

export function renderProspectRowsCsv(rows: ProspectExportRow[], preset: ProspectCsvExportPreset = "standard"): string {
  if (preset === "crm") {
    return renderCrmProspectRowsCsv(rows);
  }

  const detailColumns = rows.some((row) => row.source === "overture")
    ? ["address", "country", "locality", "region", "latitude", "longitude", "datasetRelease", "sourceUrl", "retrievedAt", "confidence", "operatingStatus", "sourceProvenance", "identityStatus", "identityReasons", "identityEvidence", "auditSelected", "auditSelectionReason", "auditSelectionRank"] as const
    : [];
  const header = [
    "leadKey",
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
    "opportunityScore",
    "opportunityReasons",
    "pitchAngle",
    "recommendedOffer",
    "estimatedNeed",
    "outreachPriorityReason",
    "publicEmail",
    "publicPhone",
    "whatsappUrl",
    "contactPageUrl",
    "socialProfiles",
    "contactConfidence",
    "contactSource",
    "preferredContactChannel",
    "outreachAction",
    "contactabilityReason",
    "priority",
    "nextAction",
    "reviewStatus",
    "reviewReason",
    "lastReviewedAt",
    "reportPath",
    "error",
    "dotnetStack",
    "dotnetLegacyFramework",
    ...detailColumns
  ];
  const body = rows.map((row) =>
    [
      row.leadKey,
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
      row.opportunityScore.toString(),
      row.opportunityReasons.join("; "),
      row.pitchAngle,
      row.recommendedOffer,
      row.estimatedNeed,
      row.outreachPriorityReason,
      row.publicEmail ?? "",
      row.publicPhone ?? "",
      row.whatsappUrl ?? "",
      row.contactPageUrl ?? "",
      row.socialProfiles?.join("; ") ?? "",
      row.contactConfidence ?? "None",
      row.contactSource ?? "",
      row.preferredContactChannel,
      row.outreachAction,
      row.contactabilityReason,
      row.priority,
      row.nextAction,
      row.reviewStatus,
      row.reviewReason ?? "",
      row.lastReviewedAt ?? "",
      row.reportPath ?? "",
      row.error ?? "",
      row.dotnetStack ?? "",
      row.dotnetLegacyFramework === undefined ? "" : row.dotnetLegacyFramework ? "yes" : "no",
      ...detailColumns.map((key) => key === "sourceProvenance" || key === "identityReasons" || key === "identityEvidence" ? JSON.stringify(row[key] ?? []) : String(row[key] ?? ""))
    ]
      .map(escapeCsvCell)
      .join(",")
  );

  return `${[header.join(","), ...body].join("\n")}\n`;
}

export function renderDiscoveryReviewCsv(rows: LeadReviewRow[]): string {
  const header = [
    "leadKey",
    "source",
    "sourceId",
    "label",
    "websiteUrl",
    "reviewStatus",
    "reviewReason",
    "lastReviewedAt",
    "opportunityScore",
    "priority",
    "nextAction"
  ];
  const body = rows.map((row) =>
    [
      row.leadKey,
      row.source,
      row.sourceId ?? "",
      row.label ?? "",
      row.websiteUrl ?? "",
      row.reviewStatus,
      row.reviewReason ?? "",
      row.lastReviewedAt ?? "",
      row.opportunityScore?.toString() ?? "",
      row.priority ?? "",
      row.nextAction ?? ""
    ]
      .map(escapeCsvCell)
      .join(",")
  );

  return `${[header.join(","), ...body].join("\n")}\n`;
}
