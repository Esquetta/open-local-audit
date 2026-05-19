export { auditUrl, auditSnapshot } from "./audit.js";
export { readBatchInput, readInputUrls, runBatchReports, safeReportSlug } from "./batch.js";
export { readBrandConfig } from "./brand.js";
export { extractPublicContact } from "./contact.js";
export {
  buildDiscoverySummary,
  buildProspectRows,
  findDuplicateProspectGroups,
  fetchGooglePlacesCandidates,
  filterSuppressedProspects,
  mergeDiscoveryReviewRows,
  readLeadSuppressionCsv,
  readLeadReviewCsv,
  readManualDiscoveryCsv,
  renderDiscoveryReviewCsv,
  renderProspectRowsCsv,
  resolveCandidateWebsite,
  stableLeadKey
} from "./discovery.js";
export { shouldFailOnThreshold } from "./exit-policy.js";
export { auditProfiles } from "./profiles.js";
export { writeReportOutputs } from "./output.js";
export { runLighthouseAudit } from "./lighthouse.js";
export { renderPdfReport } from "./pdf.js";
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
  DuplicateProspectGroup,
  FetchGooglePlacesCandidatesOptions,
  LeadReviewRow,
  LeadSuppressionEntry,
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
  LighthouseCategoryScores,
  LighthouseRunner,
  LighthouseSummary,
  PublicContact,
  ReportBrandConfig,
  ReportRenderOptions,
  PageSnapshot,
  Score,
  Severity
} from "./types.js";
