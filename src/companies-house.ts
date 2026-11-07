import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { cleanInputLines, escapeCsvCell, parseCsvLine } from "./csv.js";
import { isPlainEmailAddress } from "./monitor-service.js";
import { addressTokens } from "./rules.js";
import { writeWorkflowOutputFile } from "./workflow-output.js";

// Companies House checks for leads with a public email, written as the CSV that shortlist --legal-status reads. Only a
// company matched with confidence gets a row; a close candidate gets a commented row to confirm by hand, because a
// wrong match could put a sole trader's address into a cold email run.

const apiBase = "https://api.company-information.service.gov.uk";

// Resolves the parsed JSON body, or undefined when Companies House has no such record.
export type CompaniesHouseGet = (path: string) => Promise<unknown>;

export class CompaniesHouseKeyError extends Error {}

export function companiesHouseClient(
  apiKey: string,
  options: { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number } = {}
): CompaniesHouseGet {
  const fetchImpl = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const authorization = `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
  return async (path) => {
    for (let attempt = 1; ; attempt += 1) {
      const response = await fetchImpl(`${apiBase}${path}`, {
        headers: { Authorization: authorization, Accept: "application/json" },
        signal: AbortSignal.timeout(30_000)
      });
      if (response.status === 404) {
        return undefined;
      }
      if (response.status === 401 || response.status === 403) {
        throw new CompaniesHouseKeyError(`Companies House rejected the API key (HTTP ${response.status}); check COMPANIES_HOUSE_API_KEY`);
      }
      if ((response.status === 429 || response.status >= 500) && attempt < 4) {
        // A key may make 600 requests in five minutes; the reset header gives the end of the window in epoch seconds.
        const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
        await sleep(response.status === 429 ? (reset > now() ? Math.min(reset - now() + 1000, 300_000) : 60_000) : attempt * 2000);
        continue;
      }
      if (!response.ok) {
        throw new Error(`Companies House answered HTTP ${response.status}`);
      }
      return response.json();
    }
  };
}

export interface CompaniesHouseLead {
  leadKey: string;
  label: string;
  address: string;
  locality: string;
}

// Leads with a plain public email in a discovery or CRM export, once each; only they can get a cold email draft.
export function readCompaniesHouseLeads(csv: string): { leads: CompaniesHouseLead[]; withoutEmail: number; outsideUk: number } {
  const lines = cleanInputLines(csv);
  const headers = parseCsvLine(lines[0] ?? "");
  const [key, label, email, address, locality, country] = ["leadKey", "label", "publicEmail", "address", "locality", "country"].map((name) => headers.indexOf(name));
  if (key < 0 || label < 0 || email < 0) {
    throw new Error("companies-house --input needs leadKey, label, and publicEmail columns");
  }
  const leads: CompaniesHouseLead[] = [];
  const seen = new Set<string>();
  let withoutEmail = 0;
  let outsideUk = 0;
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const leadKey = cells[key] ?? "";
    if (!leadKey || !(cells[label] ?? "").trim() || seen.has(leadKey)) {
      continue;
    }
    seen.add(leadKey);
    if (!(cells[email] ?? "").split(/[\s;,]+/).some((candidate) => candidate && isPlainEmailAddress(candidate))) {
      withoutEmail += 1;
      continue;
    }
    if (country >= 0 && cells[country] && !/^(?:gb|uk)$/i.test(cells[country].trim())) {
      outsideUk += 1;
      continue;
    }
    leads.push({ leadKey, label: cells[label].trim(), address: address >= 0 ? cells[address] ?? "" : "", locality: locality >= 0 ? cells[locality] ?? "" : "" });
  }
  return { leads, withoutEmail, outsideUk };
}

interface SearchItem {
  title: string;
  companyNumber: string;
  companyStatus: string;
  companyType: string;
  address: string;
}

// Name words without legal suffixes, so "Smith & Co Ltd" and "SMITH AND COMPANY LIMITED" compare equal.
function nameTokens(value: string): string[] {
  const tokens = value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[&+]/g, " and ")
    .replace(/['’`]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((token) => (token === "company" ? "co" : token));
  const joined = tokens
    .join(" ")
    .replace(/^the /, "")
    .replace(/(?: (?:limited liability partnership|community interest co|public limited co|limited|ltd|llp|plc|cic))+$/, "");
  return joined.split(" ").filter(Boolean);
}

// The listed street address is on the company's address: every house number and at least two of its words, or all of
// them when it has fewer ("6 Nottingham Road" against "6 Nottingham Road, Long Eaton, NG10 1HP").
function sameAddress(street: string, candidate: string): boolean {
  const listed = addressTokens(street);
  const numbers = listed.filter((token) => /\d/.test(token));
  const words = listed.filter((token) => !/\d/.test(token));
  if (numbers.length === 0 || words.length === 0) {
    return false;
  }
  const found = new Set(addressTokens(candidate));
  return numbers.every((token) => found.has(token)) && words.filter((token) => found.has(token)).length >= Math.min(2, words.length);
}

function words(value: string): string[] {
  return value.toLowerCase().split(/[^\p{L}]+/u).filter((word) => word.length > 1);
}

function sameTown(locality: string, candidate: string): boolean {
  const town = words(locality);
  const found = new Set(words(candidate));
  return town.length > 0 && town.every((word) => found.has(word));
}

export interface CompanyCandidate {
  item: SearchItem;
  reason: string;
}

// The search result that is this lead's company, or the close candidates to check by hand. A company name is unique
// on the register, but a sole trader can trade under a company's name elsewhere, so a name alone is not enough: it
// needs the listed address, or the listed town.
export function matchCompany(lead: CompaniesHouseLead, items: SearchItem[]): { match?: CompanyCandidate; check: CompanyCandidate[] } {
  const listed = nameTokens(lead.label);
  if (listed.length === 0) {
    return { check: [] };
  }
  const scored = items.map((item) => {
    const name = nameTokens(item.title);
    const exact = name.join("") === listed.join("");
    const contains = listed.length >= 2 && listed.every((token) => name.includes(token));
    return { item, exact, contains, address: sameAddress(lead.address, item.address), town: sameTown(lead.locality, item.address) };
  });
  const tiers: Array<[string, typeof scored]> = [
    ["same name and address", scored.filter((entry) => entry.exact && entry.address)],
    ["name includes the listed name, same address", scored.filter((entry) => !entry.exact && entry.contains && entry.address)],
    ["same name and town", scored.filter((entry) => entry.exact && !entry.address && entry.town)]
  ];
  const [reason, tier] = tiers.find(([, entries]) => entries.length > 0) ?? ["", []];
  const active = tier.filter((entry) => entry.item.companyStatus === "active");
  const chosen = tier.length === 1 ? tier[0] : active.length === 1 ? active[0] : undefined;
  if (chosen) {
    return { match: { item: chosen.item, reason }, check: [] };
  }
  const check = [
    ...tier.map((entry) => ({ item: entry.item, reason: `check: several companies with ${reason}` })),
    ...scored.filter((entry) => entry.exact && !entry.address && !entry.town).map((entry) => ({ item: entry.item, reason: "check: same name, address and town differ" })),
    ...scored.filter((entry) => !entry.exact && entry.address && !entry.contains).map((entry) => ({ item: entry.item, reason: "check: same address, different name" })),
    ...scored.filter((entry) => !entry.exact && entry.contains && !entry.address && entry.town).map((entry) => ({ item: entry.item, reason: "check: similar name, same town" }))
  ];
  return { check: check.filter((entry, index) => check.findIndex((other) => other.item.companyNumber === entry.item.companyNumber) === index).slice(0, 3) };
}

export interface CompanyRecord {
  companyNumber: string;
  companyName: string;
  companyType: string;
  companyStatus: string;
  statusDetail: string;
  overdue: string;
  registeredAddress: string;
}

export interface CompaniesHouseResult {
  lead: CompaniesHouseLead;
  outcome: "matched" | "check" | "not-found" | "error";
  companies: Array<CompanyRecord & { match: string }>;
  error?: string;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function searchItems(body: unknown): SearchItem[] {
  const items = record(body).items;
  return (Array.isArray(items) ? items : [])
    .map(record)
    .map((item) => ({
      title: text(item.title),
      companyNumber: text(item.company_number),
      companyStatus: text(item.company_status),
      companyType: text(item.company_type),
      address: text(item.address_snippet)
    }))
    .filter((item) => item.title && item.companyNumber);
}

// The company's own record adds its status detail (such as a proposal to strike off) and overdue filings.
async function companyRecord(get: CompaniesHouseGet, item: SearchItem): Promise<CompanyRecord> {
  const profile = record(await get(`/company/${encodeURIComponent(item.companyNumber)}`));
  const office = record(profile.registered_office_address);
  const overdue = [record(profile.accounts).overdue === true ? "accounts" : "", record(profile.confirmation_statement).overdue === true ? "confirmation statement" : ""];
  return {
    companyNumber: item.companyNumber,
    companyName: text(profile.company_name) || item.title,
    companyType: text(profile.type) || item.companyType,
    companyStatus: text(profile.company_status) || item.companyStatus,
    statusDetail: text(profile.company_status_detail),
    overdue: overdue.filter(Boolean).join("; "),
    registeredAddress:
      ["premises", "address_line_1", "address_line_2", "locality", "region", "postal_code"].map((field) => text(office[field])).filter(Boolean).join(", ") || item.address
  };
}

// One lead at a time, so a run stays well inside the API's rate limit; a rejected key stops the run.
export async function checkCompanies(leads: CompaniesHouseLead[], get: CompaniesHouseGet): Promise<CompaniesHouseResult[]> {
  const results: CompaniesHouseResult[] = [];
  for (const lead of leads) {
    try {
      const { match, check } = matchCompany(lead, searchItems(await get(`/search/companies?q=${encodeURIComponent(lead.label)}&items_per_page=20`)));
      const chosen = match ? [match] : check;
      const companies = [];
      for (const candidate of chosen) {
        companies.push({ ...(await companyRecord(get, candidate.item)), match: candidate.reason });
      }
      results.push({ lead, outcome: match ? "matched" : companies.length > 0 ? "check" : "not-found", companies });
    } catch (error) {
      if (error instanceof CompaniesHouseKeyError) {
        throw error;
      }
      results.push({ lead, outcome: "error", companies: [], error: error instanceof Error ? error.message : "unknown error" });
    }
  }
  return results;
}

export const legalStatusHeaders = ["leadKey", "label", "companyNumber", "companyName", "companyType", "companyStatus", "statusDetail", "overdue", "registeredAddress", "match"];

function row(lead: CompaniesHouseLead, company: CompanyRecord & { match: string }): string {
  return [lead.leadKey, lead.label, company.companyNumber, company.companyName, company.companyType, company.companyStatus, company.statusDetail, company.overdue, company.registeredAddress, company.match]
    .map((value) => escapeCsvCell(value.replace(/[\r\n]+/g, " ")))
    .join(",");
}

// kept holds rows from an earlier file, by leadKey, written back unchanged.
export function renderLegalStatusCsv(results: CompaniesHouseResult[], kept: Map<string, string>, generatedAt: string): string {
  const oneLine = (value: string) => value.replace(/[\r\n]+/g, " ");
  return [
    `# Companies House results, ${generatedAt}. shortlist --legal-status reads the rows; lines starting with "#" are ignored.`,
    `# A "# check:" line was not matched with confidence: confirm the company's name and address, then delete "# check: " to use it.`,
    legalStatusHeaders.join(","),
    ...[...kept.values()],
    ...results.flatMap((result) => {
      if (result.outcome === "error") {
        return [`# error: ${oneLine(result.lead.label)} (${result.lead.leadKey}): ${oneLine(result.error ?? "")}`];
      }
      if (result.outcome === "not-found") {
        return [`# not found: ${oneLine(result.lead.label)} (${result.lead.leadKey}): no company with this name; it may be a sole trader or partnership`];
      }
      return result.companies.map((company) => `${result.outcome === "check" ? "# check: " : ""}${row(result.lead, company)}`);
    }),
    ""
  ].join("\n");
}

// Rows already in the output file: a rerun keeps the operator's confirmed rows instead of overwriting them.
function readKeptRows(csv: string): Map<string, string> {
  const lines = cleanInputLines(csv);
  const key = parseCsvLine(lines[0] ?? "").indexOf("leadKey");
  const kept = new Map<string, string>();
  for (const line of key < 0 ? [] : lines.slice(1)) {
    const leadKey = parseCsvLine(line)[key];
    if (leadKey && !kept.has(leadKey)) {
      kept.set(leadKey, line);
    }
  }
  return kept;
}

export interface CompaniesHouseRunResult {
  checked: number;
  matched: number;
  check: number;
  notFound: number;
  errors: number;
  kept: number;
  withoutEmail: number;
  outsideUk: number;
}

export async function runCompaniesHouse(options: { input: string; out: string; get: CompaniesHouseGet; now?: Date }): Promise<CompaniesHouseRunResult> {
  const { leads, withoutEmail, outsideUk } = readCompaniesHouseLeads(await readFile(options.input, "utf8"));
  let kept = new Map<string, string>();
  try {
    kept = readKeptRows(await readFile(options.out, "utf8"));
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
  const results = await checkCompanies(leads.filter((lead) => !kept.has(lead.leadKey)), options.get);
  await mkdir(dirname(options.out), { recursive: true });
  await writeWorkflowOutputFile(options.out, renderLegalStatusCsv(results, kept, (options.now ?? new Date()).toISOString()));
  const count = (outcome: CompaniesHouseResult["outcome"]) => results.filter((result) => result.outcome === outcome).length;
  return {
    checked: results.length,
    matched: count("matched"),
    check: count("check"),
    notFound: count("not-found"),
    errors: count("error"),
    kept: kept.size,
    withoutEmail,
    outsideUk
  };
}
