export type Severity = "high" | "medium" | "low" | "info";

export type AuditProfile =
  | "generic"
  | "dental"
  | "beauty"
  | "restaurant"
  | "contractor"
  | "lawyer"
  | "clinic"
  | "gym"
  | "hotel"
  | "auto-service";

export type FindingCategory =
  | "technical-health"
  | "search-basics"
  | "mobile-usability"
  | "trust-contact";

export interface Evidence {
  label: string;
  value: string;
}

export interface Finding {
  id: string;
  title: string;
  severity: Severity;
  category: FindingCategory;
  evidence: Evidence[];
  recommendation: string;
  source: string;
}

export interface Score {
  label: string;
  score: number;
  max: number;
}

export interface AuditSummary {
  totalFindings: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface AuditReport {
  url: string;
  finalUrl: string;
  scannedAt: string;
  statusCode: number;
  profile?: AuditProfile;
  summary: AuditSummary;
  scores: Record<FindingCategory, Score>;
  findings: Finding[];
  recommendations: string[];
  evidence: Evidence[];
  visualEvidence?: VisualEvidence[];
  lighthouse?: LighthouseSummary;
}

export interface PageSnapshot {
  url: string;
  finalUrl: string;
  statusCode: number;
  headers: Record<string, string>;
  html: string;
  resources?: {
    robotsTxt?: PageResource;
    sitemapXml?: PageResource;
  };
  internalLinks?: PageResource[];
  visualEvidence?: VisualEvidence[];
}

export interface AuditOptions {
  timeoutMs: number;
  maxRedirects: number;
  checkLinks: boolean;
  maxPages: number;
  profile?: AuditProfile;
  render: boolean;
  screenshot: boolean;
  lighthouse: boolean;
  screenshotPath?: string;
  screenshotReportPath?: string;
  runLighthouse?: LighthouseRunner;
  renderPage?: (
    url: string,
    options: Pick<AuditOptions, "timeoutMs" | "screenshot" | "screenshotPath" | "screenshotReportPath">
  ) => Promise<PageSnapshot>;
}

export interface PageResource {
  url: string;
  finalUrl: string;
  statusCode: number;
}

export interface VisualEvidence {
  label: string;
  path: string;
  screenshotPath?: string;
}

export interface LighthouseCategoryScores {
  performance?: number;
  accessibility?: number;
  bestPractices?: number;
  seo?: number;
}

export interface LighthouseSummary {
  requestedUrl: string;
  finalUrl?: string;
  fetchTime?: string;
  categories: LighthouseCategoryScores;
  warnings?: string[];
}

export type LighthouseRunner = (url: string, options: Pick<AuditOptions, "timeoutMs">) => Promise<LighthouseSummary>;
