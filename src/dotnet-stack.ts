import { load } from "cheerio";
import type { DotnetStack, DotnetStackEvidence, PageSnapshot } from "./types.js";

const frameworkCookies = new Map(["ASP.NET_SessionId", ".ASPXAUTH", ".ASPXANONYMOUS"].map((name) => [name.toLowerCase(), name]));
const webFormsInputs = ["__VIEWSTATE", "__EVENTVALIDATION", "__VIEWSTATEGENERATOR"];
const webFormsHandlers = ["webresource.axd", "scriptresource.axd"];
const blazorScripts = ["blazor.web.js", "blazor.server.js", "blazor.webassembly.js"];

function lowerCaseHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
}

// Set-Cookie values may be joined by newlines or commas; only the cookie names are kept.
function cookieNames(setCookie: string | undefined): string[] {
  if (!setCookie) {
    return [];
  }

  return Array.from(setCookie.matchAll(/(?:^|[\n,])\s*([^=;,\s]+)=/g), (match) => match[1]);
}

function sameSite(url: URL, pageUrl: URL): boolean {
  return url.hostname.replace(/^www\./i, "").toLowerCase() === pageUrl.hostname.replace(/^www\./i, "").toLowerCase();
}

export function detectDotnetStack(snapshot: Pick<PageSnapshot, "finalUrl" | "headers" | "html">): DotnetStack {
  const evidence: DotnetStackEvidence[] = [];
  const signals = new Set<string>();
  const add = (source: DotnetStackEvidence["source"], signal: string, value: string): void => {
    if (!signals.has(signal)) {
      signals.add(signal);
      evidence.push({ source, signal, value });
    }
  };

  const headers = lowerCaseHeaders(snapshot.headers);
  const aspNetVersion = headers["x-aspnet-version"]?.trim();
  const mvcVersion = headers["x-aspnetmvc-version"]?.trim();
  if (aspNetVersion) {
    add("header", "X-AspNet-Version", aspNetVersion);
  }
  if (mvcVersion) {
    add("header", "X-AspNetMvc-Version", mvcVersion);
  }
  if (/asp\.net/i.test(headers["x-powered-by"] ?? "")) {
    add("header", "X-Powered-By", headers["x-powered-by"]);
  }
  if (/microsoft-iis\//i.test(headers.server ?? "")) {
    add("header", "Server", headers.server);
  }

  for (const name of cookieNames(headers["set-cookie"])) {
    const lowerName = name.toLowerCase();
    const canonical = frameworkCookies.get(lowerName);
    if (canonical) {
      add("cookie", canonical, name);
    } else if (lowerName.startsWith(".aspnetcore.")) {
      add("cookie", ".AspNetCore.*", name);
    }
  }

  const $ = load(snapshot.html);
  for (const name of webFormsInputs) {
    if ($(`input[name="${name}"], input[id="${name}"]`).length > 0) {
      add("html", name, `input name="${name}"`);
    }
  }
  if ($('input[name="__RequestVerificationToken"]').length > 0) {
    add("html", "__RequestVerificationToken", 'input name="__RequestVerificationToken"');
  }

  let pageUrl: URL | undefined;
  try {
    pageUrl = new URL(snapshot.finalUrl);
  } catch {
    pageUrl = undefined;
  }

  for (const element of $("a[href], form[action], script[src], link[href]").toArray()) {
    const raw = ($(element).attr("href") ?? $(element).attr("action") ?? $(element).attr("src") ?? "").trim();
    let url: URL;
    try {
      url = new URL(raw, pageUrl);
    } catch {
      continue;
    }

    const path = url.pathname.toLowerCase();
    const file = path.slice(path.lastIndexOf("/") + 1);
    if (element.tagName === "script" && blazorScripts.includes(file)) {
      add("html", "Blazor script", raw);
    } else if (webFormsHandlers.includes(file) && pageUrl && sameSite(url, pageUrl)) {
      add("html", file === "webresource.axd" ? "WebResource.axd" : "ScriptResource.axd", raw);
    } else if (path.endsWith(".aspx") && pageUrl && sameSite(url, pageUrl)) {
      add("html", ".aspx path", raw);
    }
  }

  const has = (signal: string): boolean => signals.has(signal);
  const webFormsMarker = [...webFormsInputs, "WebResource.axd", "ScriptResource.axd"].some(has);
  const frameworkCookie = Array.from(frameworkCookies.values()).some(has);

  let stack: DotnetStack["stack"];
  let confidence: DotnetStack["confidence"];
  if (has("Blazor script")) {
    stack = "blazor";
    confidence = "high";
  } else if (has(".AspNetCore.*")) {
    stack = "aspnet-core";
    confidence = "high";
  } else if (webFormsMarker) {
    stack = "aspnet-webforms";
    confidence = "high";
  } else if (has("X-AspNetMvc-Version")) {
    stack = "aspnet-mvc";
    confidence = "high";
  } else if (has(".aspx path")) {
    stack = "aspnet-webforms";
    confidence = has("X-AspNet-Version") || frameworkCookie ? "high" : "medium";
  } else if (has("X-AspNet-Version") || frameworkCookie) {
    stack = "aspnet-framework";
    confidence = has("X-AspNet-Version") ? "high" : "medium";
  } else if (evidence.length > 0) {
    stack = "aspnet-unknown";
    confidence = "low";
  } else {
    stack = "none";
    confidence = "none";
  }

  // X-AspNetMvc-Version is the MVC version, not the .NET version; it stays in evidence only.
  const frameworkVersion = aspNetVersion;
  return {
    detected: stack !== "none",
    stack,
    legacyFramework: stack === "aspnet-webforms" || stack === "aspnet-mvc" || stack === "aspnet-framework",
    confidence,
    ...(frameworkVersion ? { frameworkVersion } : {}),
    evidence
  };
}
