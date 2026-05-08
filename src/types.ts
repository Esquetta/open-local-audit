export type Severity = "high" | "medium" | "low" | "info";

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
  summary: AuditSummary;
  scores: Record<FindingCategory, Score>;
  findings: Finding[];
  recommendations: string[];
  evidence: Evidence[];
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
}

export interface AuditOptions {
  timeoutMs: number;
  maxRedirects: number;
}

export interface PageResource {
  url: string;
  finalUrl: string;
  statusCode: number;
}
