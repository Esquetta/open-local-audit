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
// first cold email hurt delivery, so --no-links keeps drafts free of them. File names such as robots.txt or Next.js
// are not domains.
const linkPattern =
  /\bhttps?:\/\/|\bwww\.|\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.(?!(?:txt|js|json|html?|php|xml|css|pdf|png|jpe?g|gif|svg|webp)\b)[a-z]{2,63}\b/i;

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

export interface OutreachDraftResult {
  rank: number;
  companyName: string;
  strength: PitchBrief["strength"];
  to?: string;
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
// and a lead whose website domain does not resolve would bounce, so those are listed with the reason instead.
export function planOutreachDrafts(
  briefs: PitchBrief[],
  config: OutreachConfig,
  options: { emails: Map<string, string>; links: boolean }
): Array<OutreachDraftResult & { draft?: OutreachDraft }> {
  return briefs.map((brief) => {
    const to = options.emails.get(brief.leadKey);
    const base = { rank: brief.rank, companyName: brief.companyName, strength: brief.strength, ...(to ? { to } : {}) };
    if (brief.reasons.some((reason) => /domain does not resolve/i.test(reason))) {
      return { ...base, skipped: "website domain does not resolve; email there may bounce, so phone or use another public channel" };
    }
    if (!meetsPitchStrength(brief.strength, "medium") || brief.points.length === 0) {
      return { ...base, skipped: `pitch strength ${brief.strength}: not worth a cold email` };
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
    "- [ ] Confirm the business may receive cold email. In the UK (PECR) that means a limited company or LLP; sole traders and partnerships need prior consent.",
    "- [ ] Add a recipient where none was found, and edit the wording to sound like you.",
    "",
    "| # | Business | Strength | To | Draft |",
    "| --- | --- | --- | --- | --- |",
    ...results.map(
      (result) =>
        `| ${result.rank} | ${cell(result.companyName)} | ${result.strength} | ${result.to ? cell(result.to) : "none found"} | ${
          result.file ? cell(result.file) : `skipped: ${cell(result.skipped ?? "")}`
        } |`
    ),
    ""
  ].join("\n");
}
