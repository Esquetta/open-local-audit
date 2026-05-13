export { auditUrl, auditSnapshot } from "./audit.js";
export { readBatchInput, readInputUrls, runBatchReports, safeReportSlug } from "./batch.js";
export {
  buildDiscoverySummary,
  buildProspectRows,
  fetchGooglePlacesCandidates,
  readManualDiscoveryCsv,
  renderProspectRowsCsv,
  resolveCandidateWebsite
} from "./discovery.js";
export { shouldFailOnThreshold } from "./exit-policy.js";
export { auditProfiles } from "./profiles.js";
export { writeReportOutputs } from "./output.js";
export { renderHtmlReport, renderJsonReport, renderMarkdownReport } from "./reporters.js";
export { renderTerminalSummary } from "./summary.js";
export type {
  BatchAuditContext,
  BatchIndexOptions,
  BatchInputEntry,
  BatchReportOptions,
  BatchReportResult,
  FailedBatchReportResult,
  SuccessfulBatchReportResult
} from "./batch.js";
export type {
  DiscoveryAuditResult,
  DiscoveryProviderName,
  DiscoverySummary,
  FetchGooglePlacesCandidatesOptions,
  PlaceCandidate,
  ProspectExportRow,
  ProspectRowInput,
  ReadManualDiscoveryCsvOptions,
  WebsiteResolution
} from "./discovery.js";
export type {
  AuditOptions,
  AuditProfile,
  AuditReport,
  AuditSummary,
  Evidence,
  Finding,
  FindingCategory,
  PageSnapshot,
  Score,
  Severity
} from "./types.js";
