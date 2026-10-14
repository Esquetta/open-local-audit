import { describe, expect, it } from "vitest";
import { auditSnapshot } from "../src/audit.js";
import type { PageSnapshot } from "../src/types.js";

function snapshot(robots: string | undefined, finalUrl = "https://clinic.test/services/implants", statusCode = 200): PageSnapshot {
  return {
    url: finalUrl,
    finalUrl,
    statusCode: 200,
    headers: {},
    html: "<html><head><title>Clinic</title></head><body></body></html>",
    resources: {
      robotsTxt: { url: "https://clinic.test/robots.txt", finalUrl: "https://clinic.test/robots.txt", statusCode, ...(robots === undefined ? {} : { content: robots }) }
    }
  };
}

function robotsFinding(page: PageSnapshot) {
  return auditSnapshot(page).findings.find((finding) => finding.id === "robots-txt-allows-page");
}

describe("robots.txt crawl checks", () => {
  it("passes pages that robots.txt allows, missing robots.txt files, and failed fetches", () => {
    expect(robotsFinding(snapshot("User-agent: *\nDisallow: /admin\n"))).toBeUndefined();
    expect(robotsFinding(snapshot("User-agent: *\nDisallow: /\nAllow: /services/\n"))).toBeUndefined();
    expect(robotsFinding(snapshot("User-agent: Bingbot\nDisallow: /\n"))).toBeUndefined();
    expect(robotsFinding(snapshot(undefined, undefined, 404))).toBeUndefined();
    expect(robotsFinding(snapshot("User-agent: *\nDisallow: /\n", undefined, 404))).toBeUndefined();
  });

  it("flags pages blocked for every crawler and shows the matching line", () => {
    const finding = robotsFinding(snapshot("# staging copy\r\nUser-agent: *\r\nDisallow: /\r\n"));

    expect(finding?.severity).toBe("high");
    expect(finding?.category).toBe("search-basics");
    expect(finding?.evidence[0]?.value).toBe("robots.txt blocks Googlebot from https://clinic.test/services/implants (line 3: Disallow: /)");
    expect(robotsFinding(snapshot("# old Mac file\rUser-agent: *\rDisallow: /services\r"))?.evidence[0]?.value).toBe(
      "robots.txt blocks Googlebot from https://clinic.test/services/implants (line 3: Disallow: /services)"
    );
  });

  it("uses the Googlebot group when robots.txt has one", () => {
    expect(robotsFinding(snapshot("User-agent: *\nAllow: /\n\nUser-agent: Googlebot\nDisallow: /services\n"))?.evidence[0]?.value).toBe(
      "robots.txt blocks Googlebot from https://clinic.test/services/implants (line 5: Disallow: /services)"
    );
    expect(robotsFinding(snapshot("User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nAllow: /\n"))).toBeUndefined();
  });
});
