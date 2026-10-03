import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compareBusinessIdentity, type BusinessIdentityResult, type ObservedBusinessIdentity } from "../src/business-identity.js";
import { selectAuditCandidates, type AuditPriority } from "../src/audit-selection.js";
import { resolveCandidateWebsite, stableLeadKey, type PlaceCandidate, type ProspectRowInput } from "../src/discovery.js";
import type { PublicContact } from "../src/types.js";
import { enrichWebsite } from "../src/website-enrichment.js";

export interface WebsiteObservation {
  url: string;
  status: "success" | "blocked" | "failed";
  durationMs?: number;
  pagesFetched?: number;
  sourceUrls?: string[];
  error?: string;
  warnings?: string[];
  contact?: PublicContact;
  businessIdentities?: ObservedBusinessIdentity[];
}

interface PreparedCandidate {
  sourceId: string;
  candidate: PlaceCandidate;
  input: ProspectRowInput;
  websiteUrl?: string;
}

export interface PreparedComparison {
  candidates: PreparedCandidate[];
  selections: Record<AuditPriority, ReturnType<typeof selectAuditCandidates>>;
  unionWebsiteUrls: string[];
}

interface ContactFieldCounts {
  email: number;
  phone: number;
  whatsapp: number;
  contactPage: number;
  social: number;
}

interface SelectedCandidateResult {
  sourceId: string;
  label?: string;
  websiteUrl?: string;
  selection: { reason: string; rank?: number };
  sourceContact: ContactFieldCounts;
  observation?: WebsiteObservation;
  identity: BusinessIdentityResult;
  acceptedWebsiteContact?: PublicContact;
}

interface ModeResult {
  selected: SelectedCandidateResult[];
  sourceContactCoverage: ContactFieldCounts;
  acceptedWebsiteContactCoverage: ContactFieldCounts;
  newContactFields: ContactFieldCounts;
  outcomes: { attempted: number; success: number; blocked: number; failed: number };
}

export interface ComparisonResult {
  modes: Record<AuditPriority, ModeResult>;
}

export function prepareComparison(candidates: readonly PlaceCandidate[], budget = 3): PreparedComparison {
  if (budget !== 3) throw new Error("This bounded comparison requires an audit budget of 3");
  const prepared = candidates.map((candidate, index) => {
    const resolution = resolveCandidateWebsite(candidate);
    const input: ProspectRowInput = { candidate, resolution };
    return {
      sourceId: stableLeadKey(input) || `candidate-${index + 1}`,
      candidate,
      input,
      websiteUrl: resolution.websiteUrl
    };
  });
  const selections = {
    "source-order": selectAuditCandidates(prepared.map((item) => item.input), { priority: "source-order", maxAudits: budget }),
    "missing-contact": selectAuditCandidates(prepared.map((item) => item.input), { priority: "missing-contact", maxAudits: budget })
  };
  const unionSelectedIndices = Array.from(new Set([
    ...selections["source-order"].selectedIndices,
    ...selections["missing-contact"].selectedIndices
  ]));
  const unionWebsiteUrls = Array.from(new Set(unionSelectedIndices.flatMap((index) => prepared[index]?.websiteUrl ? [prepared[index].websiteUrl!] : [])));
  if (unionWebsiteUrls.length > 6) throw new Error("Comparison would fetch more than 6 unique websites");
  return { candidates: prepared, selections, unionWebsiteUrls };
}

export function evaluateComparison(plan: PreparedComparison, observations: ReadonlyMap<string, WebsiteObservation>): ComparisonResult {
  const modes = Object.fromEntries((["source-order", "missing-contact"] as const).map((priority) => {
    const selection = plan.selections[priority];
    const selected = selection.selectedIndices.map((index) => {
      const prepared = plan.candidates[index]!;
      const observation = prepared.websiteUrl ? observations.get(prepared.websiteUrl) : undefined;
      const identity = compareBusinessIdentity(prepared.candidate, observation?.businessIdentities ?? []);
      const acceptedWebsiteContact = acceptedContact(observation, identity);
      return {
        sourceId: prepared.sourceId,
        label: prepared.candidate.label,
        websiteUrl: prepared.websiteUrl,
        selection: selection.decisions[index]!,
        sourceContact: sourceContactFields(prepared.candidate),
        ...(observation ? { observation } : {}),
        identity,
        ...(acceptedWebsiteContact ? { acceptedWebsiteContact } : {})
      };
    });
    return [priority, modeResult(selected)] as const;
  }));
  return { modes: modes as Record<AuditPriority, ModeResult> };
}

function acceptedContact(observation: WebsiteObservation | undefined, identity: BusinessIdentityResult): PublicContact | undefined {
  if (observation?.status !== "success" || identity.status === "conflict" || !observation.contact) return undefined;
  return identity.status === "uncertain" && observation.contact.contactConfidence !== "None"
    ? { ...observation.contact, contactConfidence: "Low" }
    : observation.contact;
}

function modeResult(selected: SelectedCandidateResult[]): ModeResult {
  const sourceContactCoverage = sumFields(selected.map((item) => item.sourceContact));
  const acceptedWebsiteContactCoverage = sumFields(selected.map((item) => contactFields(item.acceptedWebsiteContact)));
  const newContactFields = sumFields(selected.map((item) => newFields(item.sourceContact, item.acceptedWebsiteContact)));
  return {
    selected,
    sourceContactCoverage,
    acceptedWebsiteContactCoverage,
    newContactFields,
    outcomes: {
      attempted: selected.filter((item) => item.observation).length,
      success: selected.filter((item) => item.observation?.status === "success").length,
      blocked: selected.filter((item) => item.observation?.status === "blocked").length,
      failed: selected.filter((item) => item.observation?.status === "failed").length
    }
  };
}

function sourceContactFields(candidate: PlaceCandidate): ContactFieldCounts {
  const metadata = candidate.sourceMetadata ?? {};
  return {
    email: hasValue(metadata.emails) ? 1 : 0,
    phone: hasValue(metadata.phones) ? 1 : 0,
    whatsapp: 0,
    contactPage: 0,
    social: hasValue(metadata.socials) ? 1 : 0
  };
}

function contactFields(contact: PublicContact | undefined): ContactFieldCounts {
  return {
    email: contact?.publicEmail ? 1 : 0,
    phone: contact?.publicPhone ? 1 : 0,
    whatsapp: contact?.whatsappUrl ? 1 : 0,
    contactPage: contact?.contactPageUrl ? 1 : 0,
    social: contact?.socialProfiles.length ? 1 : 0
  };
}

function newFields(source: ContactFieldCounts, contact: PublicContact | undefined): ContactFieldCounts {
  const website = contactFields(contact);
  return {
    email: website.email && !source.email ? 1 : 0,
    phone: website.phone && !source.phone ? 1 : 0,
    whatsapp: website.whatsapp,
    contactPage: website.contactPage,
    social: website.social && !source.social ? 1 : 0
  };
}

function emptyFields(): ContactFieldCounts {
  return { email: 0, phone: 0, whatsapp: 0, contactPage: 0, social: 0 };
}

function sumFields(items: ContactFieldCounts[]): ContactFieldCounts {
  return items.reduce<ContactFieldCounts>((total, item) => ({
    email: total.email + item.email,
    phone: total.phone + item.phone,
    whatsapp: total.whatsapp + item.whatsapp,
    contactPage: total.contactPage + item.contactPage,
    social: total.social + item.social
  }), emptyFields());
}

function hasValue(value: unknown): boolean {
  return Array.isArray(value) && value.some((entry) => typeof entry === "string" && entry.trim());
}

interface CachedPool {
  source?: string;
  category?: string;
  bbox?: unknown;
  limit?: number;
  release?: string;
  fetchedAt?: string;
  cachedAt?: string;
  candidates?: unknown;
}

async function observeWebsites(urls: readonly string[]): Promise<Map<string, WebsiteObservation>> {
  const observations = new Map<string, WebsiteObservation>();
  for (const [index, url] of urls.entries()) {
    process.stdout.write(`[${index + 1}/${urls.length}] Fetching ${url}\n`);
    const enriched = await enrichWebsite(url);
    observations.set(url, {
      url,
      status: enriched.status,
      durationMs: enriched.durationMs,
      pagesFetched: enriched.pagesFetched,
      sourceUrls: enriched.sourceUrls,
      error: enriched.error,
      warnings: enriched.warnings,
      contact: enriched.contact,
      businessIdentities: enriched.businessIdentities
    });
  }
  return observations;
}

function parseArgs(argv: string[]): { cacheFile: string; outDir: string; poolLimit: 10 | 20; budget: number } {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!option?.startsWith("--") || !value || value.startsWith("--")) throw new Error(`Expected a value for ${option ?? "argument"}`);
    values.set(option, value);
    index += 1;
  }
  for (const option of values.keys()) if (!["--cache-file", "--out-dir", "--pool-limit", "--budget"].includes(option)) throw new Error(`Unknown argument: ${option}`);
  const poolLimit = Number(values.get("--pool-limit") ?? 10);
  const budget = Number(values.get("--budget") ?? 3);
  const cacheFile = values.get("--cache-file");
  if (!cacheFile) throw new Error("--cache-file is required; supply the frozen Overture cache for the pool you want to compare");
  if (poolLimit !== 10 && poolLimit !== 20) throw new Error("--pool-limit must be 10 or 20");
  if (budget !== 3) throw new Error("--budget must be 3 for this bounded comparison");
  return {
    cacheFile,
    outDir: values.get("--out-dir") ?? "reports/identity-priority-benchmark",
    poolLimit,
    budget
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const cacheFile = resolve(options.cacheFile);
  const cached = JSON.parse(await readFile(cacheFile, "utf8")) as CachedPool;
  if (!Array.isArray(cached.candidates) || !cached.candidates.every((item) => item && typeof item === "object")) throw new Error("Cache file does not contain a candidate array");
  const candidates = (cached.candidates as PlaceCandidate[]).slice(0, options.poolLimit);
  if (candidates.length !== options.poolLimit) throw new Error(`Cache contains ${candidates.length} candidates; requested pool limit is ${options.poolLimit}`);
  const plan = prepareComparison(candidates, options.budget);
  const observations = await observeWebsites(plan.unionWebsiteUrls);
  const comparison = evaluateComparison(plan, observations);
  const timestamp = new Date().toISOString();
  const runDir = join(options.outDir, `run-${timestamp.replace(/[:.]/g, "-")}`);
  await mkdir(runDir, { recursive: true });
  const result = {
    timestamp,
    input: {
      cacheFile,
      source: cached.source,
      category: cached.category,
      bbox: cached.bbox,
      release: cached.release,
      fetchedAt: cached.fetchedAt,
      cachedAt: cached.cachedAt,
      poolLimit: options.poolLimit,
      budget: options.budget
    },
    rawPool: candidates,
    sharedWebsiteObservations: Object.fromEntries(observations),
    comparison
  };
  await writeFile(join(runDir, "comparison.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`Saved comparison: ${runDir}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
