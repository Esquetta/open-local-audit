import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { cleanInputLines, escapeCsvCell, parseCsvLine } from "./csv.js";
import { isPlainEmailAddress } from "./monitor-service.js";
import { addressTokens, streetTypes } from "./rules.js";
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
      let response: Response;
      try {
        response = await fetchImpl(`${apiBase}${path}`, {
          headers: { Authorization: authorization, Accept: "application/json" },
          signal: AbortSignal.timeout(30_000)
        });
      } catch (error) {
        // A dropped connection or a timeout is retried like a server error.
        if (attempt < 4) {
          await sleep(attempt * 2000);
          continue;
        }
        throw error;
      }
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
  const lines = cleanInputLines(csv.replace(/^\uFEFF/, ""));
  const headers = parseCsvLine(lines[0] ?? "");
  const [key, label, email, address, locality, country] = ["leadKey", "label", "publicEmail", "address", "locality", "country"].map((name) => headers.indexOf(name));
  if (key < 0 || label < 0 || email < 0) {
    throw new Error("companies-house --input needs leadKey, label, and publicEmail columns");
  }
  // A lead listed more than once is checked from its first row with an email.
  const rows = new Map<string, { cells: string[]; hasEmail: boolean }>();
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const leadKey = cells[key] ?? "";
    const hasEmail = (cells[email] ?? "").split(/[\s;,]+/).some((candidate) => candidate && isPlainEmailAddress(candidate));
    const first = rows.get(leadKey);
    if (leadKey && (cells[label] ?? "").trim() && (!first || (hasEmail && !first.hasEmail))) {
      rows.set(leadKey, { cells, hasEmail });
    }
  }
  const leads: CompaniesHouseLead[] = [];
  let withoutEmail = 0;
  let outsideUk = 0;
  for (const [leadKey, { cells, hasEmail }] of rows) {
    if (!hasEmail) {
      withoutEmail += 1;
    } else if (country >= 0 && cells[country] && !/^(?:gb|uk)$/i.test(cells[country].trim())) {
      outsideUk += 1;
    } else {
      leads.push({ leadKey, label: cells[label].trim(), address: address >= 0 ? cells[address] ?? "" : "", locality: locality >= 0 ? cells[locality] ?? "" : "" });
    }
  }
  return { leads, withoutEmail, outsideUk };
}

export interface SearchItem {
  title: string;
  companyNumber: string;
  companyStatus: string;
  companyType: string;
  address: string;
  // The premises, streets, and postcode of the address.
  street: string;
  // The town part of the address (district, post town, county), without the premises, streets, or postcode.
  town: string;
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

// Every word and number of the listed street address, from its house number to its street type, is in the company's
// street lines, so "6 Nottingham Road" matches "6 Nottingham Road, Long Eaton" but "12 High Street" does not match
// "12 High Road". A building name before the number ("The Surgery, 14 Regent Street") is left out, and a district
// after the street type ("22 Ruddington Lane Wilford") may be anywhere in the address.
function sameStreet(street: string, item: SearchItem): boolean {
  const tokens = addressTokens(street);
  const listed = tokens.slice(Math.max(tokens.findIndex((token) => /\d/.test(token)), 0));
  if (!listed.some((token) => /\d/.test(token)) || !listed.some((token) => !/\d/.test(token))) {
    return false;
  }
  let end = listed.length - 1;
  while (end >= 0 && !streetTypes.has(listed[end])) {
    end -= 1;
  }
  const streetLines = new Set(addressTokens(item.street));
  const anywhere = new Set(addressTokens(item.address));
  return listed.every((token, index) => (end >= 0 && index > end ? anywhere : streetLines).has(token));
}

function words(value: string): string[] {
  return value.toLowerCase().split(/[^\p{L}]+/u).filter((word) => word.length > 1);
}

// The listed town is in the town part of the company's address, so a street such as "Nottingham Road" does not count.
function sameTown(locality: string, town: string): boolean {
  const listed = words(locality);
  const found = new Set(words(town));
  return listed.length > 0 && listed.every((word) => found.has(word));
}

export interface CompanyCandidate {
  item: SearchItem;
  reason: string;
}

// The search result that is this lead's company, or the close candidates to check by hand. A company name is unique
// on the register, but a sole trader can trade under a company's name, even in the same town, so a match needs the
// name and the listed street address and town.
export function matchCompany(lead: CompaniesHouseLead, items: SearchItem[]): { match?: CompanyCandidate; check: CompanyCandidate[] } {
  const listed = nameTokens(lead.label);
  if (listed.length === 0) {
    return { check: [] };
  }
  const scored = items.map((item) => {
    const name = nameTokens(item.title);
    const exact = name.join("") === listed.join("");
    const contains = !exact && listed.length >= 2 && listed.every((token) => name.includes(token));
    const town = sameTown(lead.locality, item.town);
    const street = sameStreet(lead.address, item);
    return { item, exact, contains, town, street, address: town && street };
  });
  const tiers: Array<[string, typeof scored]> = [
    ["same name and address", scored.filter((entry) => entry.exact && entry.address)],
    ["name includes the listed name, same address", scored.filter((entry) => entry.contains && entry.address)]
  ];
  const [reason, tier] = tiers.find(([, entries]) => entries.length > 0) ?? ["", []];
  const active = tier.filter((entry) => entry.item.companyStatus === "active");
  const chosen = tier.length === 1 ? tier[0] : active.length === 1 ? active[0] : undefined;
  if (chosen) {
    return { match: { item: chosen.item, reason }, check: [] };
  }
  const check = [
    ...tier.map((entry) => ({ item: entry.item, reason: `check: several companies with ${reason}` })),
    ...scored
      .filter((entry) => entry.exact && !entry.address)
      .map((entry) => ({
        item: entry.item,
        reason: entry.town ? "check: same name, another address in the town" : entry.street ? "check: same name and street, another town" : "check: same name, address and town differ"
      })),
    ...scored.filter((entry) => !entry.exact && !entry.contains && entry.address).map((entry) => ({ item: entry.item, reason: "check: same address, different name" })),
    ...scored.filter((entry) => entry.contains && !entry.address && entry.town).map((entry) => ({ item: entry.item, reason: "check: similar name, same town" }))
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

// A part ending in a street type ("Nottingham Road", "Mill Ln") is a street, whichever address field holds it.
function isStreet(part: string): boolean {
  const tokens = addressTokens(part);
  return streetTypes.has(tokens[tokens.length - 1] ?? "");
}

// The address snippet split into its street part (premises, streets, postcode) and its town part (district, post
// town, county): the snippet's parts after the first that hold no number and are not a street. The result's own
// address fields give the town part when it has them.
function addressParts(item: Record<string, unknown>): { street: string; town: string } {
  const parts = text(item.address_snippet)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const isTown = (part: string, index: number) => index > 0 && !/\d/.test(part) && !isStreet(part);
  const address = record(item.address);
  const fields = [address.address_line_2, address.locality, address.region].map(text).filter((part) => part && !isStreet(part));
  return {
    street: parts.filter((part, index) => !isTown(part, index)).join(", "),
    town: (fields.length > 0 ? fields : parts.filter(isTown)).join(", ")
  };
}

export function searchItems(body: unknown): SearchItem[] {
  const items = record(body).items;
  return (Array.isArray(items) ? items : [])
    .map(record)
    .map((item) => ({
      title: text(item.title),
      companyNumber: text(item.company_number),
      companyStatus: text(item.company_status),
      companyType: text(item.company_type),
      address: text(item.address_snippet),
      ...addressParts(item)
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

// kept holds the rows of an earlier file, written back unchanged before the new results.
export function renderLegalStatusCsv(results: CompaniesHouseResult[], kept: string[], generatedAt: string): string {
  // A comment line stays one spreadsheet cell, also where ";" separates cells, so a label cannot start a formula cell.
  const note = (value: string) => value.replace(/[\r\n\t,;"]+/g, " ");
  return [
    `# Companies House results, ${generatedAt}. shortlist --legal-status reads the rows; lines starting with "#" are ignored.`,
    `# A "# check:" line was not matched with confidence: confirm the company's name and address, then delete "# check: " to use it.`,
    legalStatusHeaders.join(","),
    ...kept,
    ...results.flatMap((result) => {
      if (result.outcome === "error") {
        return [`# error: ${note(result.lead.label)} (${note(result.lead.leadKey)}): ${note(result.error ?? "")}`];
      }
      if (result.outcome === "not-found") {
        return [`# not found: ${note(result.lead.label)} (${note(result.lead.leadKey)}): no company with this name; it may be a sole trader or partnership`];
      }
      return result.companies.map((company) => `${result.outcome === "check" ? "# check: " : ""}${row(result.lead, company)}`);
    }),
    ""
  ].join("\n");
}

// The key shortlist --legal-status matches labels by.
function labelKey(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

// The rows already in the output file, which a rerun keeps, and the leads they cover: by leadKey, or by label for a
// row without one. A file with other columns is not merged, so no row is moved into the wrong column.
function readKeptRows(csv: string, path: string): { lines: string[]; leadKeys: Set<string>; labels: Set<string> } {
  // Excel's "CSV UTF-8" starts the file with a byte order mark.
  const lines = cleanInputLines(csv.replace(/^\uFEFF/, ""));
  if (lines.length > 0 && lines[0] !== legalStatusHeaders.join(",")) {
    throw new Error(`${path} has other columns than companies-house writes; use another --out file`);
  }
  const rows = lines.slice(1);
  const cells = rows.map(parseCsvLine);
  return {
    lines: rows,
    leadKeys: new Set(cells.map((row) => row[0]).filter(Boolean)),
    labels: new Set(cells.filter((row) => !row[0] && labelKey(row[1] ?? "")).map((row) => labelKey(row[1])))
  };
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
  let existing = "";
  try {
    existing = await readFile(options.out, "utf8");
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
  const kept = readKeptRows(existing, options.out);
  const results = await checkCompanies(
    leads.filter((lead) => !kept.leadKeys.has(lead.leadKey) && !kept.labels.has(labelKey(lead.label))),
    options.get
  );
  await mkdir(dirname(options.out), { recursive: true });
  await writeWorkflowOutputFile(options.out, renderLegalStatusCsv(results, kept.lines, (options.now ?? new Date()).toISOString()));
  const count = (outcome: CompaniesHouseResult["outcome"]) => results.filter((result) => result.outcome === outcome).length;
  return {
    checked: results.length,
    matched: count("matched"),
    check: count("check"),
    notFound: count("not-found"),
    errors: count("error"),
    kept: kept.lines.length,
    withoutEmail,
    outsideUk
  };
}
