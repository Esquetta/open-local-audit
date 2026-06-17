import { cleanInputLines, escapeCsvCell, parseCsvLine } from "./csv.js";

export type ShortlistFormat = "markdown" | "json" | "csv";
export type ShortlistSort = "opportunity-desc" | "score-desc" | "company-asc" | "last-reviewed-asc";

export interface ShortlistOptions {
  top?: number;
  minOpportunityScore?: number;
  segment?: string;
  profile?: string;
  priority?: string;
  contactConfidence?: string;
  preferredContactChannel?: string;
  reviewStatus?: string;
  excludeReviewStatus?: string;
  requireWebsite?: boolean;
  missingWebsite?: boolean;
  requireContact?: boolean;
  missingContact?: boolean;
  requireReport?: boolean;
  missingReport?: boolean;
  sort?: ShortlistSort;
  reviewRows?: ShortlistReviewRow[];
}

export interface ShortlistReviewRow {
  leadKey?: string;
  website?: string;
  websiteUrl?: string;
  url?: string;
  label?: string;
  companyName?: string;
  reviewStatus?: string;
  reviewReason?: string;
  lastReviewedAt?: string;
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
  reviewStatus: string;
  reviewReason: string;
  lastReviewedAt: string;
}

export interface ShortlistResult {
  totalRows: number;
  suppressedRows: number;
  filteredRows: number;
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

const shortlistSortModes: ShortlistSort[] = ["opportunity-desc", "score-desc", "company-asc", "last-reviewed-asc"];

const suppressedReviewStatuses = new Set([
  "rejected",
  "contacted",
  "not-fit",
  "not_a_fit",
  "do-not-contact",
  "suppressed"
]);

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

function parseOptionalRows(content: string): RawLeadRow[] {
  const lines = cleanInputLines(content);
  if (lines.length < 2) {
    return [];
  }

  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });
}

export function readShortlistReviewCsv(content: string): ShortlistReviewRow[] {
  return parseOptionalRows(content).map((row) => ({
    leadKey: value(row, "leadKey"),
    website: value(row, "website"),
    websiteUrl: value(row, "websiteUrl"),
    url: value(row, "url"),
    label: value(row, "label"),
    companyName: value(row, "companyName"),
    reviewStatus: value(row, "reviewStatus"),
    reviewReason: value(row, "reviewReason"),
    lastReviewedAt: value(row, "lastReviewedAt")
  }));
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
    leadKey: value(row, "leadKey"),
    reviewStatus: value(row, "reviewStatus") || "new",
    reviewReason: value(row, "reviewReason"),
    lastReviewedAt: value(row, "lastReviewedAt")
  };
}

function normalizeWebsite(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }

  try {
    const url = new URL(trimmed.startsWith("http://") || trimmed.startsWith("https://") ? trimmed : `https://${trimmed}`);
    return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return trimmed.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
  }
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function matchesFilter(value: string, filter: string | undefined): boolean {
  return filter === undefined || normalizeText(value) === normalizeText(filter);
}

function excludesFilter(value: string, filter: string | undefined): boolean {
  return filter === undefined || normalizeText(value) !== normalizeText(filter);
}

function reviewIdentity(row: ShortlistReviewRow): { leadKey: string; website: string; label: string } {
  return {
    leadKey: normalizeText(row.leadKey ?? ""),
    website: normalizeWebsite(row.websiteUrl ?? row.website ?? row.url ?? ""),
    label: normalizeText(row.companyName ?? row.label ?? "")
  };
}

function leadIdentity(lead: Omit<ShortlistLead, "rank">): { leadKey: string; website: string; label: string } {
  return {
    leadKey: normalizeText(lead.leadKey),
    website: normalizeWebsite(lead.website),
    label: normalizeText(lead.companyName)
  };
}

function findReviewRow(
  lead: Omit<ShortlistLead, "rank">,
  reviewRows: ShortlistReviewRow[]
): ShortlistReviewRow | undefined {
  const identity = leadIdentity(lead);

  return reviewRows.find((row) => {
    const review = reviewIdentity(row);
    return (
      (identity.leadKey && identity.leadKey === review.leadKey) ||
      (identity.website && identity.website === review.website) ||
      (identity.label && identity.label === review.label)
    );
  });
}

function applyReviewState(
  lead: Omit<ShortlistLead, "rank">,
  reviewRows: ShortlistReviewRow[]
): { lead?: Omit<ShortlistLead, "rank">; suppressed: boolean } {
  const review = findReviewRow(lead, reviewRows);
  if (!review) {
    return { lead, suppressed: false };
  }

  const reviewStatus = review.reviewStatus?.trim() || lead.reviewStatus;
  if (suppressedReviewStatuses.has(reviewStatus.toLowerCase())) {
    return { suppressed: true };
  }

  return {
    lead: {
      ...lead,
      reviewStatus,
      reviewReason: review.reviewReason?.trim() || lead.reviewReason,
      lastReviewedAt: review.lastReviewedAt?.trim() || lead.lastReviewedAt
    },
    suppressed: false
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

function reviewedAtRank(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function sortByMode(mode: ShortlistSort): (left: Omit<ShortlistLead, "rank">, right: Omit<ShortlistLead, "rank">) => number {
  if (mode === "score-desc") {
    return (left, right) => (right.score ?? -1) - (left.score ?? -1) || sortLeads(left, right);
  }

  if (mode === "company-asc") {
    return (left, right) => left.companyName.localeCompare(right.companyName) || sortLeads(left, right);
  }

  if (mode === "last-reviewed-asc") {
    return (left, right) => reviewedAtRank(left.lastReviewedAt) - reviewedAtRank(right.lastReviewedAt) || sortLeads(left, right);
  }

  return sortLeads;
}

export function buildLeadShortlist(content: string, options: ShortlistOptions = {}): ShortlistResult {
  const rows = parseRows(content);
  const top = options.top ?? 20;
  if (!Number.isInteger(top) || top < 1) {
    throw new Error("shortlist --top must be a positive integer");
  }

  if (options.minOpportunityScore !== undefined && !Number.isFinite(options.minOpportunityScore)) {
    throw new Error("shortlist --min-opportunity-score must be a number");
  }

  const sort = options.sort ?? "opportunity-desc";
  if (!shortlistSortModes.includes(sort)) {
    throw new Error("shortlist --sort must be opportunity-desc, score-desc, company-asc, or last-reviewed-asc");
  }

  const reviewedLeads = rows
    .map(normalizeLead)
    .map((lead) => applyReviewState(lead, options.reviewRows ?? []));
  const suppressedRows = reviewedLeads.filter((result) => result.suppressed).length;
  const unsuppressedLeads = reviewedLeads.flatMap((result) => (result.lead ? [result.lead] : []));
  const eligibleLeads = unsuppressedLeads.filter(
    (lead) =>
      (options.minOpportunityScore === undefined ||
        (lead.opportunityScore ?? -1) >= options.minOpportunityScore) &&
      matchesFilter(lead.segment, options.segment) &&
      matchesFilter(lead.profile, options.profile) &&
      matchesFilter(lead.priority, options.priority) &&
      matchesFilter(lead.contactConfidence, options.contactConfidence) &&
      matchesFilter(lead.preferredContactChannel, options.preferredContactChannel) &&
      matchesFilter(lead.reviewStatus, options.reviewStatus) &&
      excludesFilter(lead.reviewStatus, options.excludeReviewStatus) &&
      (!options.requireWebsite || lead.website !== "") &&
      (!options.missingWebsite || lead.website === "") &&
      (!options.requireContact || normalizeText(lead.contactConfidence) !== "none") &&
      (!options.missingContact || normalizeText(lead.contactConfidence) === "none") &&
      (!options.requireReport || lead.reportPath !== "") &&
      (!options.missingReport || lead.reportPath === "")
  );
  const filteredRows = unsuppressedLeads.length - eligibleLeads.length;
  const leads = eligibleLeads
    .sort(sortByMode(sort))
    .slice(0, top)
    .map((lead, index) => ({
      rank: index + 1,
      ...lead
    }));

  return {
    totalRows: rows.length,
    suppressedRows,
    filteredRows,
    selected: leads.length,
    leads
  };
}

export function renderShortlistJson(result: ShortlistResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function renderShortlistSummaryJson(result: ShortlistResult): string {
  return `${JSON.stringify(
    {
      totalRows: result.totalRows,
      suppressedRows: result.suppressedRows,
      filteredRows: result.filteredRows,
      selected: result.selected,
      leads: result.leads.map((lead) => ({
        rank: lead.rank,
        companyName: lead.companyName,
        website: lead.website,
        opportunityScore: lead.opportunityScore,
        score: lead.score,
        reviewStatus: lead.reviewStatus
      }))
    },
    null,
    2
  )}\n`;
}

export function renderShortlistCsv(result: ShortlistResult): string {
  const headers = [
    "rank",
    "companyName",
    "website",
    "segment",
    "profile",
    "priority",
    "opportunityScore",
    "score",
    "contactConfidence",
    "preferredContactChannel",
    "reason",
    "reviewStatus",
    "reviewReason",
    "lastReviewedAt",
    "leadKey",
    "reportPath"
  ];
  const rows = result.leads.map((lead) =>
    [
      lead.rank.toString(),
      lead.companyName,
      lead.website,
      lead.segment,
      lead.profile,
      lead.priority,
      lead.opportunityScore?.toString() ?? "",
      lead.score?.toString() ?? "",
      lead.contactConfidence,
      lead.preferredContactChannel,
      lead.reason,
      lead.reviewStatus,
      lead.reviewReason,
      lead.lastReviewedAt,
      lead.leadKey,
      lead.reportPath
    ]
      .map(escapeCsvCell)
      .join(",")
  );

  return `${[headers.join(","), ...rows].join("\n")}\n`;
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
      lead.reviewStatus,
      lead.reviewReason,
      lead.lastReviewedAt,
      lead.reportPath
    ]
      .map(markdownCell)
      .join(" | ")} |`
  );

  return `${[
    "# Lead Shortlist",
    "",
    `- Total rows: ${result.totalRows}`,
    `- Suppressed rows: ${result.suppressedRows}`,
    `- Filtered rows: ${result.filteredRows}`,
    `- Selected leads: ${result.selected}`,
    "",
    "| Rank | Company | Website | Priority | Opportunity | Score | Contact | Channel | Reason | Review | Review Reason | Last Reviewed | Report |",
    "| ---: | --- | --- | --- | ---: | ---: | --- | --- | --- | --- | --- | --- | --- |",
    ...rows
  ].join("\n")}\n`;
}
