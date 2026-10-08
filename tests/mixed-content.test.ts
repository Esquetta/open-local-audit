import { describe, expect, it } from "vitest";
import { auditSnapshot } from "../src/audit.js";
import type { PageSnapshot } from "../src/types.js";

function snapshot(body: string, finalUrl = "https://example.test/"): PageSnapshot {
  return {
    url: finalUrl,
    finalUrl,
    statusCode: 200,
    headers: {},
    html: `<html><head><title>Example</title></head><body>${body}</body></html>`
  };
}

function mixedFinding(body: string, finalUrl?: string) {
  return auditSnapshot(snapshot(body, finalUrl)).findings.find((finding) => finding.id === "mixed-content-absent");
}

describe("mixed content checks", () => {
  it("allows HTTPS, protocol-relative, relative, and data resources", () => {
    expect(
      mixedFinding(
        '<img src="https://cdn.test/a.png"><script src="//cdn.test/app.js"></script><img src="/logo.png"><img src="data:image/png;base64,AAAA">'
      )
    ).toBeUndefined();
  });

  it("ignores plain HTTP links and pages that are not served over HTTPS", () => {
    expect(mixedFinding('<a href="http://partner.test/">Partner</a>')).toBeUndefined();
    expect(mixedFinding('<img src="http://cdn.test/a.png">', "http://example.test/")).toBeUndefined();
  });

  it("flags HTTP scripts, stylesheets, images, srcset candidates, and embeds", () => {
    const finding = mixedFinding(
      [
        '<script src="http://cdn.test/app.js"></script>',
        '<link rel="stylesheet" href="http://cdn.test/site.css">',
        '<link rel="canonical" href="http://example.test/">',
        '<img src="http://cdn.test/a.png">',
        '<img src="/b.png" srcset="/b.png 1x, http://cdn.test/b@2x.png 2x">',
        '<iframe src="http://maps.test/embed"></iframe>'
      ].join("")
    );

    expect(finding?.severity).toBe("medium");
    expect(finding?.evidence[0]?.value).toBe(
      "http://cdn.test/app.js; http://cdn.test/a.png; http://maps.test/embed; http://cdn.test/site.css; http://cdn.test/b@2x.png"
    );
  });

  it("lists each URL once and summarizes long lists", () => {
    const images = Array.from({ length: 7 }, (_, index) => `<img src="http://cdn.test/${index}.png">`).join("");

    expect(mixedFinding(`${images}<img src="http://cdn.test/0.png">`)?.evidence[0]?.value).toBe(
      "http://cdn.test/0.png; http://cdn.test/1.png; http://cdn.test/2.png; http://cdn.test/3.png; http://cdn.test/4.png; and 2 more"
    );
  });
});
