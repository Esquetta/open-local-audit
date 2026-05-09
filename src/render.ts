import { createRequire } from "node:module";
import { join } from "node:path";
import type { PageSnapshot } from "./types.js";

type PlaywrightLike = {
  chromium: {
    launch: (options: { headless: boolean }) => Promise<{
      newPage: () => Promise<{
        goto: (
          url: string,
          options: { timeout: number; waitUntil: "networkidle" }
        ) => Promise<{ status: () => number; headers: () => Record<string, string> } | null>;
        content: () => Promise<string>;
        url: () => string;
      }>;
      close: () => Promise<void>;
    }>;
  };
};

function loadPlaywright(): PlaywrightLike {
  const requireFromProject = createRequire(join(process.cwd(), "package.json"));
  const requireFromPackage = createRequire(import.meta.url);

  try {
    return requireFromProject("playwright") as PlaywrightLike;
  } catch {
    try {
      return requireFromPackage("playwright") as PlaywrightLike;
    } catch {
      throw new Error("Playwright is required for --render. Install it with: npm install -D playwright");
    }
  }
}

export async function renderPageSnapshot(url: string, options: { timeoutMs: number }): Promise<PageSnapshot> {
  const playwright = loadPlaywright();
  const browser = await playwright.chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    const response = await page.goto(url, {
      timeout: options.timeoutMs,
      waitUntil: "networkidle"
    });

    return {
      url,
      finalUrl: page.url(),
      statusCode: response?.status() ?? 0,
      headers: response?.headers() ?? {},
      html: await page.content()
    };
  } finally {
    await browser.close();
  }
}
