import { readFile } from "node:fs/promises";
import { z } from "zod";
import { cleanInputLines, parseCsvLine } from "./csv.js";
import { renderClientEml } from "./monitor.js";
import { isPlainEmailAddress } from "./monitor-service.js";
import { meetsPitchStrength, type PitchBrief } from "./pitch-brief.js";

// The operator's own cold email wording and legal details; the tool only adds the audit's points.
const text = (max: number) => z.string().trim().min(1).max(max);
const outreachSchema = z
  .object({
    senderName: text(80),
    company: text(120),
    // Where the company is registered, such as "England and Wales".
    registeredIn: text(80).optional(),
    companyNumber: text(40).optional(),
    registeredOffice: text(200).optional(),
    // "{name}" is replaced with the business name.
    opener: text(400).optional(),
    offer: text(800),
    callToAction: text(400).optional(),
    signature: text(400).optional(),
    optOut: text(300).optional()
  })
  .strict();

export type OutreachConfig = z.infer<typeof outreachSchema>;

export async function readOutreachConfig(path: string): Promise<OutreachConfig> {
  let raw: unknown;
  try {
    raw = JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`Outreach config ${path} could not be read: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  const parsed = outreachSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Outreach config ${path}: ${issue.path.join(".") || "file"}: ${issue.message}`);
  }
  return parsed.data;
}

// A URL, a bare domain, or an email address. Some mail tools rewrite these into tracking redirects, and links in a
// first cold email hurt delivery, so --no-links keeps drafts free of them. A domain ends in a country code or a common
// generic top-level domain, so file names (robots.txt, Next.js) and names such as "Howard & Co.leads" do not count.
const genericTlds = [
  "com", "net", "org", "info", "biz", "io", "app", "dev", "ai", "tv", "xyz", "online", "site", "website", "web", "page",
  "shop", "store", "tech", "cloud", "digital", "email", "agency", "studio", "services", "solutions", "consulting",
  "company", "business", "group", "global", "london", "scot", "wales", "cymru", "clinic", "dental", "dentist", "health",
  "care", "law", "legal", "lawyer", "attorney", "accountant", "accountants", "finance", "tax", "properties", "homes",
  "estate", "plumbing", "builders", "construction", "fitness", "salon", "beauty", "hair", "spa", "restaurant", "cafe",
  "bar", "pub", "hotel", "travel", "events", "photography", "media", "news", "blog", "live", "life", "world", "today",
  "space", "pro", "club", "design", "marketing", "education", "academy", "school", "ltd", "limited", "art", "vet",
  "church", "garden", "cleaning", "photo", "photos", "florist", "works"
];
const label = "[a-z0-9](?:[a-z0-9-]*[a-z0-9])?";
const linkPattern = new RegExp(
  `\\bhttps?://|\\bwww\\.|[^\\s@]+@[^\\s@]+\\.[a-z]{2,}|\\b${label}(?:\\.${label})*\\.(?:(?!js\\b)[a-z]{2}|${genericTlds.join("|")})\\b`,
  "i"
);

export function findLink(value: string): string | undefined {
  return value.match(linkPattern)?.[0];
}

// The subject names the strongest point an owner would notice first. An http final URL is left to the generic subject,
// because HTTPS may still work on the site.
const subjects: Array<[RegExp, string]> = [
  [/^website-placeholder$/, "The {name} website shows a placeholder page"],
  [/^http-status-ok$/, "The {name} website returns an error"],
  [/^tls-certificate-valid$/, "Security warning on the {name} website"],
  [/^domain-expiry$/, "Domain renewal for the {name} website"],
  [/^(?:page-indexable|robots-txt-allows-page)$/, "The {name} website is hidden from Google"],
  [/^viewport-present$/, "The {name} website on phones"],
  [/^phone-link-present$/, "Tap-to-call on the {name} website"],
  [/^title-present$/, "Page title for the {name} website"]
];

const defaultOpener = "I came across {name} and had a quick look at the website.";
const defaultOptOut = "If you would rather not hear from me, just reply \"no\" and I will not contact you again.";

export interface OutreachDraft {
  to?: string;
  subject: string;
  body: string;
}

function fill(template: string, name: string): string {
  return template.replace(/\{name\}/g, name);
}

export function legalLine(config: OutreachConfig): string {
  const line = `${config.company}${config.registeredIn ? `, registered in ${config.registeredIn}` : ""}${
    config.companyNumber ? `, Company No. ${config.companyNumber}` : ""
  }${
    config.registeredOffice ? `, registered office: ${config.registeredOffice}` : ""
  }`;
  return `${line.replace(/\.$/, "")}.`;
}

// The operator's own wording is checked once, so a link there fails the run instead of skipping every lead.
export function configLink(config: OutreachConfig): string | undefined {
  return findLink(Object.values(config).join("\n"));
}

// A first cold email from a pitch brief: the owner-visible points in plain words, the operator's offer, and the
// sender's company details with an opt-out, as UK and EU rules expect from business marketing email.
export function buildOutreachDraft(brief: PitchBrief, config: OutreachConfig, options: { to?: string; links: boolean }): OutreachDraft {
  const name = brief.companyName;
  const top = brief.points[0];
  const subject = fill(subjects.find(([pattern]) => top && pattern.test(top.findingId))?.[1] ?? "A few quick fixes for the {name} website", name);
  const where = options.links && brief.website ? brief.website : "the website";
  const body = [
    "Hi,",
    "",
    fill(config.opener ?? defaultOpener, name),
    "",
    brief.points.length === 1 ? `One thing on ${where} may be putting visitors off:` : `A few things on ${where} may be putting visitors off:`,
    ...brief.points.map((point) => `- ${point.whyItMatters}`),
    "",
    config.offer,
    ...(config.callToAction ? ["", config.callToAction] : []),
    "",
    config.signature ?? `${config.senderName}\n${config.company}`,
    "",
    config.optOut ?? defaultOptOut,
    legalLine(config),
    ""
  ].join("\n");
  return { ...(options.to ? { to: options.to } : {}), subject, body };
}

// The first plain email address in a lead's publicEmail cell, keyed by leadKey.
export function readLeadEmails(csv: string): Map<string, string> {
  const lines = cleanInputLines(csv);
  const emails = new Map<string, string>();
  if (lines.length < 2) {
    return emails;
  }
  const headers = parseCsvLine(lines[0]);
  const keyColumn = headers.indexOf("leadKey");
  const emailColumn = headers.indexOf("publicEmail");
  if (keyColumn < 0 || emailColumn < 0) {
    return emails;
  }
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const address = (cells[emailColumn] ?? "").split(/[\s;,]+/).find((candidate) => candidate && isPlainEmailAddress(candidate));
    if (cells[keyColumn] && address) {
      emails.set(cells[keyColumn], address);
    }
  }
  return emails;
}

export interface LegalStatus {
  companyNumber: string;
  companyType: string;
  companyStatus: string;
}

function nameKey(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

// The operator's Companies House results, one row per lead, matched by leadKey or else by the lead's label.
export interface LegalStatusIndex {
  byKey: Map<string, LegalStatus>;
  byName: Map<string, LegalStatus>;
}

export function readLegalStatus(csv: string): LegalStatusIndex {
  const lines = cleanInputLines(csv);
  const byKey = new Map<string, LegalStatus>();
  const byName = new Map<string, LegalStatus>();
  const headers = parseCsvLine(lines[0] ?? "");
  const column = (...names: string[]) => names.map((name) => headers.indexOf(name)).find((index) => index >= 0) ?? -1;
  const [key, name, number, type, status] = [
    column("leadKey"),
    column("label", "companyName"),
    column("companyNumber"),
    column("companyType"),
    column("companyStatus")
  ];
  if ((key < 0 && name < 0) || type < 0 || status < 0) {
    throw new Error("--legal-status needs leadKey or label, companyType, and companyStatus columns");
  }
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const row = { companyNumber: cells[number] ?? "", companyType: cells[type] ?? "", companyStatus: cells[status] ?? "" };
    // A row is found by its leadKey first and by its label as well, in case the leads come from another export.
    if (key >= 0 && cells[key]) {
      byKey.set(cells[key], row);
    }
    if (name >= 0 && nameKey(cells[name] ?? "")) {
      byName.set(nameKey(cells[name]), row);
    }
  }
  return { byKey, byName };
}

// Bodies corporate under UK PECR, which may receive business marketing email without prior consent: companies
// (Companies House types such as ltd, plc, private-limited-guarant-nsc), LLPs, CICs, CIOs, and registered societies,
// written as Companies House codes or labels. Sole traders, partnerships, and limited partnerships are not.
const corporateType = new RegExp(
  [
    "^(?:ltd|plc|llp|cic|cio|private-limited\\S*|private-unlimited\\S*|old-public-company|northern-ireland|royal-charter",
    "registered-society\\S*|industrial-and-provident-society|european-public-limited-liability-company-se",
    "investment-company-with-variable-capital|(?:scottish-)?charitable-incorporated-organisation)$",
    "^(?:(?:private|public) )?(?:limited|unlimited) company$|^limited liability partnership$|^community interest company$",
    "^(?:scottish )?charitable incorporated organisation$|^registered society$"
  ].join("|"),
  "i"
);

function legalReason(status: LegalStatus | undefined): string | undefined {
  if (!status) {
    return "legal form not confirmed: add the lead to --legal-status after a Companies House check";
  }
  if (!corporateType.test(status.companyType.trim())) {
    return `not a company or LLP (${status.companyType || "type unknown"}); UK PECR needs prior consent, so phone or use the contact form`;
  }
  if (status.companyStatus.trim().toLowerCase() !== "active") {
    return `company status is ${status.companyStatus || "unknown"}, not active`;
  }
  return undefined;
}

export interface OutreachDraftResult {
  rank: number;
  companyName: string;
  strength: PitchBrief["strength"];
  to?: string;
  company?: string;
  file?: string;
  skipped?: string;
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .replace(/ı/g, "i")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "lead"
  );
}

// Which shortlisted leads get a draft, and the draft file for each. Weak and unrated leads are not worth a cold email,
// and a lead whose website domain does not resolve would bounce, so those are listed with the reason instead. With
// Companies House results, only active companies and LLPs get a draft.
export function planOutreachDrafts(
  briefs: PitchBrief[],
  config: OutreachConfig,
  options: { emails: Map<string, string>; links: boolean; legal?: LegalStatusIndex }
): Array<OutreachDraftResult & { draft?: OutreachDraft }> {
  return briefs.map((brief) => {
    const to = options.emails.get(brief.leadKey);
    const legal = options.legal && (options.legal.byKey.get(brief.leadKey) ?? options.legal.byName.get(nameKey(brief.companyName)));
    const base = {
      rank: brief.rank,
      companyName: brief.companyName,
      strength: brief.strength,
      ...(to ? { to } : {}),
      ...(legal ? { company: `${legal.companyNumber ? `${legal.companyNumber} ` : ""}(${legal.companyType || "type unknown"}, ${legal.companyStatus || "status unknown"})` } : {})
    };
    if (brief.reasons.some((reason) => /domain does not resolve/i.test(reason))) {
      return { ...base, skipped: "website domain does not resolve; email there may bounce, so phone or use another public channel" };
    }
    if (!meetsPitchStrength(brief.strength, "medium") || brief.points.length === 0) {
      return { ...base, skipped: `pitch strength ${brief.strength}: not worth a cold email` };
    }
    const notCorporate = options.legal ? legalReason(legal) : undefined;
    if (notCorporate) {
      return { ...base, skipped: notCorporate };
    }
    const draft = buildOutreachDraft(brief, config, { to, links: options.links });
    const link = options.links ? undefined : findLink(`${draft.subject}\n${draft.body}`);
    if (link) {
      return { ...base, skipped: `the draft would contain "${link}", which --no-links leaves out` };
    }
    return { ...base, file: `${String(brief.rank).padStart(2, "0")}-${slug(brief.companyName)}.eml`, draft };
  });
}

export function renderOutreachEml(draft: OutreachDraft): string {
  return renderClientEml({ ...(draft.to ? { to: [draft.to] } : {}), subject: draft.subject, body: draft.body });
}

function cell(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/([`*_~&\[\]<>|\\])/g, "\\$1");
}

export function renderOutreachIndex(results: OutreachDraftResult[], generatedAt: string): string {
  const drafted = results.filter((result) => result.file).length;
  return [
    "# Outreach Drafts",
    "",
    `Generated ${generatedAt}: ${drafted} draft${drafted === 1 ? "" : "s"} for ${results.length} shortlisted lead${results.length === 1 ? "" : "s"}. Nothing has been sent.`,
    "",
    "Before sending each draft:",
    "",
    "- [ ] Re-check every point on the live site; audits can be wrong or out of date.",
    "- [ ] Confirm the business may receive cold email. In the UK (PECR) that means a corporate body, such as a limited company or LLP; sole traders and partnerships need prior consent. A Company entry only repeats your Companies House results; check that the record's name and address are this business.",
    "- [ ] Add a recipient where none was found, and edit the wording to sound like you.",
    "",
    "| # | Business | Strength | To | Company | Draft |",
    "| --- | --- | --- | --- | --- | --- |",
    ...results.map(
      (result) =>
        `| ${result.rank} | ${cell(result.companyName)} | ${result.strength} | ${result.to ? cell(result.to) : "none found"} | ${
          result.company ? cell(result.company) : "not checked"
        } | ${
          result.file ? cell(result.file) : `skipped: ${cell(result.skipped ?? "")}`
        } |`
    ),
    ""
  ].join("\n");
}
