import type { AuditOptions, AuditReport, AuditSummary, FindingCategory, PageResource, PageSnapshot, Score } from "./types.js";
import { runRules } from "./rules.js";
import { load } from "cheerio";
import { renderPageSnapshot } from "./render.js";

const defaultOptions: AuditOptions = {
  timeoutMs: 10000,
  maxRedirects: 5,
  checkLinks: false,
  maxPages: 10,
  render: false
};

const categories: FindingCategory[] = [
  "technical-health",
  "search-basics",
  "mobile-usability",
  "trust-contact"
];

function normalizeHeaders(headers: Headers): Record<string, string> {
  const output: Record<string, string> = {};
  headers.forEach((value, key) => {
    output[key] = value;
  });
  return output;
}

async function fetchWithRedirects(url: string, options: AuditOptions): Promise<PageSnapshot> {
  let currentUrl = url;

  for (let redirectCount = 0; redirectCount <= options.maxRedirects; redirectCount += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      const response = await fetch(currentUrl, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": "open-local-audit/0.1 (+https://github.com/Esquetta/open-local-audit)"
        }
      });

      const location = response.headers.get("location");
      if (location && response.status >= 300 && response.status < 400) {
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      return {
        url,
        finalUrl: response.url || currentUrl,
        statusCode: response.status,
        headers: normalizeHeaders(response.headers),
        html: await response.text()
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`Exceeded redirect limit of ${options.maxRedirects}`);
}

async function fetchResource(url: string, options: AuditOptions): Promise<PageResource> {
  try {
    const snapshot = await fetchWithRedirects(url, {
      ...options,
      maxRedirects: Math.min(options.maxRedirects, 3)
    });

    return {
      url,
      finalUrl: snapshot.finalUrl,
      statusCode: snapshot.statusCode
    };
  } catch {
    return {
      url,
      finalUrl: url,
      statusCode: 0
    };
  }
}

function collectInternalLinks(snapshot: PageSnapshot, maxPages: number): string[] {
  const $ = load(snapshot.html);
  const origin = new URL(snapshot.finalUrl).origin;
  const seen = new Set<string>();

  for (const element of $("a").toArray()) {
    const href = $(element).attr("href")?.trim();
    if (!href || /^(mailto|tel|javascript):/i.test(href)) {
      continue;
    }

    try {
      const url = new URL(href, snapshot.finalUrl);
      url.hash = "";
      if (url.origin !== origin) {
        continue;
      }

      seen.add(url.toString());
    } catch {
      continue;
    }

    if (seen.size >= maxPages) {
      break;
    }
  }

  return Array.from(seen);
}

function summarize(reportFindings: ReturnType<typeof runRules>): AuditSummary {
  return {
    totalFindings: reportFindings.length,
    high: reportFindings.filter((finding) => finding.severity === "high").length,
    medium: reportFindings.filter((finding) => finding.severity === "medium").length,
    low: reportFindings.filter((finding) => finding.severity === "low").length,
    info: reportFindings.filter((finding) => finding.severity === "info").length
  };
}

function scoreCategories(reportFindings: ReturnType<typeof runRules>): Record<FindingCategory, Score> {
  const labels: Record<FindingCategory, string> = {
    "technical-health": "Technical health",
    "search-basics": "Search basics",
    "mobile-usability": "Mobile and usability",
    "trust-contact": "Trust and contact readiness"
  };

  return Object.fromEntries(
    categories.map((category) => {
      const findings = reportFindings.filter((finding) => finding.category === category);
      const penalty = findings.reduce((total, finding) => {
        if (finding.severity === "high") {
          return total + 25;
        }
        if (finding.severity === "medium") {
          return total + 15;
        }
        if (finding.severity === "low") {
          return total + 8;
        }
        return total + 3;
      }, 0);

      return [
        category,
        {
          label: labels[category],
          max: 100,
          score: Math.max(0, 100 - penalty)
        }
      ];
    })
  ) as Record<FindingCategory, Score>;
}

export function auditSnapshot(snapshot: PageSnapshot, scannedAt = new Date().toISOString()): AuditReport {
  const findings = runRules(snapshot);
  const recommendations = findings.map((finding) => finding.recommendation);

  return {
    url: snapshot.url,
    finalUrl: snapshot.finalUrl,
    scannedAt,
    statusCode: snapshot.statusCode,
    summary: summarize(findings),
    scores: scoreCategories(findings),
    findings,
    recommendations: Array.from(new Set(recommendations)),
    evidence: [
      {
        label: "Status code",
        value: `${snapshot.statusCode}`
      },
      {
        label: "Final URL",
        value: snapshot.finalUrl
      },
      {
        label: "Content type",
        value: snapshot.headers["content-type"] ?? "Unknown"
      }
    ]
  };
}

export async function auditUrl(url: string, options: Partial<AuditOptions> = {}): Promise<AuditReport> {
  const effectiveOptions = {
    ...defaultOptions,
    ...options
  };
  const snapshot =
    effectiveOptions.render && effectiveOptions.renderPage
      ? await effectiveOptions.renderPage(url, { timeoutMs: effectiveOptions.timeoutMs })
      : effectiveOptions.render
        ? await renderPageSnapshot(url, { timeoutMs: effectiveOptions.timeoutMs })
        : await fetchWithRedirects(url, effectiveOptions);
  const origin = new URL(snapshot.finalUrl).origin;

  snapshot.resources = {
    robotsTxt: await fetchResource(new URL("/robots.txt", origin).toString(), effectiveOptions),
    sitemapXml: await fetchResource(new URL("/sitemap.xml", origin).toString(), effectiveOptions)
  };

  if (effectiveOptions.checkLinks) {
    snapshot.internalLinks = await Promise.all(
      collectInternalLinks(snapshot, effectiveOptions.maxPages).map((link) => fetchResource(link, effectiveOptions))
    );
  }

  return auditSnapshot(snapshot);
}
