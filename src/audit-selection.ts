import type { ProspectRowInput } from "./discovery.js";

export type AuditPriority = "source-order" | "missing-contact";

export interface AuditSelectionDecision {
  selected: boolean;
  reason: string;
  rank?: number;
}

interface EligibleCandidate {
  index: number;
  missingEmail: boolean;
  missingPhone: boolean;
}

function hasSourceContact(value: unknown): boolean {
  return Array.isArray(value) && value.some((entry) => typeof entry === "string" && entry.trim().length > 0);
}

function isResolvedHttpWebsite(input: ProspectRowInput): boolean {
  if (input.resolution.status !== "resolved" || !input.resolution.websiteUrl) {
    return false;
  }

  try {
    const parsed = new URL(input.resolution.websiteUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function invalidWebsiteReason(input: ProspectRowInput): string {
  return input.resolution.status === "resolved" && input.resolution.websiteUrl
    ? "Resolved website URL is invalid or unsupported"
    : "No resolved HTTP(S) website URL";
}

function selectedReason(candidate: EligibleCandidate, priority: AuditPriority): string {
  if (priority === "missing-contact") {
    if (candidate.missingEmail && candidate.missingPhone) return "Selected because source email and phone are missing";
    if (candidate.missingEmail) return "Selected because source email is missing";
    if (candidate.missingPhone) return "Selected because source phone is missing";
  }
  return "Selected by source order";
}

function validateOptions(priority: AuditPriority, maxAudits: number | undefined): void {
  if (priority !== "source-order" && priority !== "missing-contact") {
    throw new Error(`Unsupported audit priority: ${String(priority)}`);
  }
  if (maxAudits !== undefined && (!Number.isFinite(maxAudits) || !Number.isInteger(maxAudits) || maxAudits < 0)) {
    throw new Error("maxAudits must be a non-negative whole number");
  }
}

export function selectAuditCandidates(
  inputs: readonly ProspectRowInput[],
  options: { priority?: AuditPriority; maxAudits?: number; dryRun?: boolean } = {}
): { selectedIndices: number[]; decisions: AuditSelectionDecision[] } {
  const priority = options.priority === undefined ? "source-order" : options.priority;
  const { maxAudits, dryRun = false } = options;
  validateOptions(priority, maxAudits);

  const decisions: AuditSelectionDecision[] = inputs.map((input) => ({
    selected: false,
    reason: isResolvedHttpWebsite(input) ? "Audit budget exhausted" : invalidWebsiteReason(input)
  }));
  const eligible = inputs.flatMap((input, index): EligibleCandidate[] => {
    if (!isResolvedHttpWebsite(input)) return [];
    const metadata = input.candidate.sourceMetadata ?? {};
    return [{
      index,
      missingEmail: !hasSourceContact(metadata.emails),
      missingPhone: !hasSourceContact(metadata.phones)
    }];
  });

  if (priority === "missing-contact") {
    eligible.sort((left, right) => {
      const emailDifference = Number(right.missingEmail) - Number(left.missingEmail);
      if (emailDifference !== 0) return emailDifference;
      const phoneDifference = Number(right.missingPhone) - Number(left.missingPhone);
      if (phoneDifference !== 0) return phoneDifference;
      return left.index - right.index;
    });
  }

  const selectionLimit = dryRun ? 0 : maxAudits ?? eligible.length;
  const disabledReason = dryRun ? "Auditing is disabled in dry run" : "Auditing is disabled by maxAudits";
  const selectedIndices: number[] = [];

  for (const [rankIndex, candidate] of eligible.entries()) {
    const decision = decisions[candidate.index]!;
    decision.rank = rankIndex + 1;
    if (rankIndex < selectionLimit) {
      decision.selected = true;
      decision.reason = selectedReason(candidate, priority);
      selectedIndices.push(candidate.index);
    } else {
      decision.reason = dryRun || maxAudits === 0 ? disabledReason : "Audit budget exhausted";
    }
  }

  return { selectedIndices, decisions };
}
