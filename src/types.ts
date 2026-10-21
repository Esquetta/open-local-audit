import type { BusinessIdentityResult } from "./business-identity.js";
import type { ServiceSection } from "./monitor-service.js";

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
  contact?: PublicContact;
  businessIdentity?: BusinessIdentityResult;
  dotnetStack?: DotnetStack;
  // Time to fetch the page HTML in a static audit, including redirects; rendered audits leave it out.
  responseTimeMs?: number;
}

export interface DotnetStackEvidence {
  source: "header" | "cookie" | "html";
  signal: string;
  value: string;
}

export interface DotnetStack {
  detected: boolean;
  stack: "aspnet-webforms" | "aspnet-mvc" | "aspnet-framework" | "aspnet-core" | "blazor" | "aspnet-unknown" | "none";
  legacyFramework: boolean;
  confidence: "high" | "medium" | "low" | "none";
  frameworkVersion?: string;
  evidence: DotnetStackEvidence[];
}

export interface PublicContact {
  publicEmail?: string;
  publicPhone?: string;
  whatsappUrl?: string;
  contactPageUrl?: string;
  contactFormUrl?: string;
  socialProfiles: string[];
  contactConfidence: "High" | "Medium" | "Low" | "None";
  contactSource?: string;
}

export interface ReportBrandConfig {
  name?: string;
  primaryColor?: string;
  accentColor?: string;
  footerText?: string;
  contact?: string;
  // Closing lines for client emails, used as written instead of the generated sign-off.
  signature?: string;
}

export interface ReportRenderOptions {
  brand?: ReportBrandConfig;
  // Monitoring adds availability from the daily checks and the work done since the last check (PDF and comparison reports).
  service?: ServiceSection[];
}

export interface PageSnapshot {
  url: string;
  finalUrl: string;
  statusCode: number;
  headers: Record<string, string>;
  html: string;
  redirects?: RedirectHop[];
  resources?: {
    robotsTxt?: PageResource;
    sitemapXml?: PageResource;
  };
  internalLinks?: PageResource[];
  visualEvidence?: VisualEvidence[];
  responseTimeMs?: number;
  tls?: {
    validFrom: string;
    validTo: string;
    // Whole days from the probe time to validTo, negative once expired, so rules do not read the clock.
    daysRemaining: number;
    issuer?: string;
    authorized: boolean;
    error?: string;
  };
  domain?: {
    name: string;
    expiresAt: string;
    // Whole days from the lookup time to expiresAt, negative once expired, so rules do not read the clock.
    daysRemaining: number;
    // RDAP status values such as "active", "redemption period", or "pending delete".
    status: string[];
    registrar?: string;
  };
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
  checkDomain?: boolean;
  probeDomain?: (url: string, timeoutMs: number) => Promise<PageSnapshot["domain"]>;
  screenshotPath?: string;
  screenshotReportPath?: string;
  runLighthouse?: LighthouseRunner;
  renderPage?: (
    url: string,
    options: Pick<AuditOptions, "timeoutMs" | "screenshot" | "screenshotPath" | "screenshotReportPath">
  ) => Promise<PageSnapshot>;
}

export interface RedirectHop {
  url: string;
  statusCode: number;
}

export interface PageResource {
  url: string;
  finalUrl: string;
  statusCode: number;
  // Kept only for robots.txt, up to the 500 KiB that Google reads.
  content?: string;
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
