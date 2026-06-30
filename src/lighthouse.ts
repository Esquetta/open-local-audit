import type { LighthouseCategoryScores, LighthouseSummary } from "./types.js";

type LighthouseModule = typeof import("lighthouse");
type ChromeLauncherModule = typeof import("chrome-launcher");

function normalizeScore(score: number | null | undefined): number | undefined {
  return typeof score === "number" ? Math.round(score * 100) : undefined;
}

function categoryScores(categories: Record<string, { score?: number | null } | undefined>): LighthouseCategoryScores {
  return {
    performance: normalizeScore(categories.performance?.score),
    accessibility: normalizeScore(categories.accessibility?.score),
    bestPractices: normalizeScore(categories["best-practices"]?.score),
    seo: normalizeScore(categories.seo?.score)
  };
}

export function lighthouseChromeFlags(): string[] {
  return ["--headless=new", "--disable-gpu"];
}

export async function runLighthouseAudit(url: string, options: { timeoutMs: number }): Promise<LighthouseSummary> {
  const [{ default: lighthouse }, chromeLauncher]: [LighthouseModule, ChromeLauncherModule] = await Promise.all([
    import("lighthouse"),
    import("chrome-launcher")
  ]);
  let chrome: Awaited<ReturnType<ChromeLauncherModule["launch"]>> | undefined;

  try {
    chrome = await chromeLauncher.launch({
      chromeFlags: lighthouseChromeFlags()
    });
    const result = await lighthouse(url, {
      port: chrome.port,
      logLevel: "error",
      onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
      maxWaitForLoad: options.timeoutMs,
      output: ["json"]
    });

    if (!result) {
      throw new Error("Lighthouse did not return a result");
    }

    const lhr = result.lhr;
    return {
      requestedUrl: lhr.requestedUrl ?? url,
      finalUrl: lhr.finalDisplayedUrl || lhr.finalUrl,
      fetchTime: lhr.fetchTime,
      categories: categoryScores(lhr.categories),
      warnings: lhr.runWarnings.length > 0 ? lhr.runWarnings : undefined
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Lighthouse error";
    throw new Error(`Lighthouse audit failed: ${message}`);
  } finally {
    await chrome?.kill();
  }
}
