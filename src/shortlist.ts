import { cleanInputLines, parseCsvLine } from "./csv.js";

export type ShortlistFormat = "markdown" | "json";

export interface ShortlistOptions {
  top?: number;
}

export interface ShortlistLead {
  rank: number;
  companyName: string;
  website: string;
  segment: string;
  profile: string;
  priority: string;
  score?: number;
  opportunityScore?: number;
  topFinding: string;
  contactConfidence: string;
  preferredContactChannel: string;
  contactabilityReason: string;
  reason: string;
  reportPath: string;
  leadKey: string;
}

export interface ShortlistResult {
  totalRows: number;
  selected: number;
  leads: ShortlistLead[];
}

type RawLeadRow = Record<string, string>;

const priorityRank: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1
};

const confidenceRank: Record<string, number> = {
  High: 3,
  Medium: 2,
  Low: 1,
  None: 0
};

function value(row: RawLeadRow, ...columns: string[]): string {
  for (const column of columns) {
    const raw = row[column]?.trim();
    if (raw) {
      return raw;
    }
  }

  return "";
}

function numberValue(row: RawLeadRow, ...columns: string[]): number | undefined {
  const raw = value(row, ...columns);
  if (!raw) {
    return undefined;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseRows(content: string): RawLeadRow[] {
  const lines = cleanInputLines(content);
  if (lines.length < 2) {
    throw new Error("shortlist requires a CSV file with a header and at least one lead row");
  }

  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });
}

function fallbackCompanyName(row: RawLeadRow): string {
  const direct = value(row, "companyName", "label");
  if (direct) {
    return direct;
  }

  const website = value(row, "website", "websiteUrl", "url");
  if (website) {
    try {
      return new URL(website).hostname.replace(/^www\./, "");
    } catch {
      return website;
    }
  }

  return value(row, "leadKey") || "Unknown lead";
}

function leadReason(row: RawLeadRow): string {
  const opportunityReasons = value(row, "opportunityReasons");
  if (opportunityReasons) {
    return opportunityReasons;
  }

  const topFinding = value(row, "topFinding");
  if (topFinding) {
    return topFinding;
  }

  const contactabilityReason = value(row, "contactabilityReason");
  if (contactabilityReason) {
    return contactabilityReason;
  }

  return "Review the report for the strongest local improvement opportunity.";
}

function normalizeLead(row: RawLeadRow): Omit<ShortlistLead, "rank"> {
  return {
    companyName: fallbackCompanyName(row),
    website: value(row, "website", "websiteUrl", "url"),
    segment: value(row, "segment"),
    profile: value(row, "profile"),
    priority: value(row, "priority"),
    score: numberValue(row, "score"),
    opportunityScore: numberValue(row, "opportunityScore"),
    topFinding: value(row, "topFinding"),
    contactConfidence: value(row, "contactConfidence") || "None",
    preferredContactChannel: value(row, "preferredContactChannel"),
    contactabilityReason: value(row, "contactabilityReason"),
    reason: leadReason(row),
    reportPath: value(row, "reportPath", "report paths"),
    leadKey: value(row, "leadKey")
  };
}

function sortLeads(left: Omit<ShortlistLead, "rank">, right: Omit<ShortlistLead, "rank">): number {
  return (
    (right.opportunityScore ?? -1) - (left.opportunityScore ?? -1) ||
    (priorityRank[right.priority.toLowerCase()] ?? 0) - (priorityRank[left.priority.toLowerCase()] ?? 0) ||
    (confidenceRank[right.contactConfidence] ?? 0) - (confidenceRank[left.contactConfidence] ?? 0) ||
    (right.score ?? -1) - (left.score ?? -1) ||
    left.companyName.localeCompare(right.companyName)
  );
}

export function buildLeadShortlist(content: string, options: ShortlistOptions = {}): ShortlistResult {
  const rows = parseRows(content);
  const top = options.top ?? 20;
  if (!Number.isInteger(top) || top < 1) {
    throw new Error("shortlist --top must be a positive integer");
  }

  const leads = rows
    .map(normalizeLead)
    .sort(sortLeads)
    .slice(0, top)
    .map((lead, index) => ({
      rank: index + 1,
      ...lead
    }));

  return {
    totalRows: rows.length,
    selected: leads.length,
    leads
  };
}

export function renderShortlistJson(result: ShortlistResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

function markdownCell(value: string | number | undefined): string {
  return (value ?? "").toString().replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function renderShortlistMarkdown(result: ShortlistResult): string {
  const rows = result.leads.map((lead) =>
    `| ${[
      lead.rank,
      lead.companyName,
      lead.website,
      lead.priority,
      lead.opportunityScore ?? "",
      lead.score ?? "",
      lead.contactConfidence,
      lead.preferredContactChannel,
      lead.reason,
      lead.reportPath
    ]
      .map(markdownCell)
      .join(" | ")} |`
  );

  return `${[
    "# Lead Shortlist",
    "",
    `- Total rows: ${result.totalRows}`,
    `- Selected leads: ${result.selected}`,
    "",
    "| Rank | Company | Website | Priority | Opportunity | Score | Contact | Channel | Reason | Report |",
    "| ---: | --- | --- | --- | ---: | ---: | --- | --- | --- | --- |",
    ...rows
  ].join("\n")}\n`;
}
