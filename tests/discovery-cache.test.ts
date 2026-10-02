import { describe, expect, it } from "vitest";
import { discoveryCacheKey, defaultDiscoveryCacheDirectory } from "../src/discovery-cache.js";

describe("Overture discovery cache identity", () => {
  it("changes identity when an exact query dimension changes", () => {
    const base = {
      category: "dental",
      bbox: [28.9, 40.9, 29.1, 41.1] as [number, number, number, number],
      limit: 25,
      release: "2026-09-23.1"
    };

    expect(discoveryCacheKey(base)).toMatch(/^[a-f0-9]{64}$/);
    expect(discoveryCacheKey({ ...base, category: "restaurant" })).not.toBe(discoveryCacheKey(base));
    expect(discoveryCacheKey({ ...base, bbox: [28.91, 40.9, 29.1, 41.1] })).not.toBe(discoveryCacheKey(base));
    expect(discoveryCacheKey({ ...base, limit: 26 })).not.toBe(discoveryCacheKey(base));
    expect(discoveryCacheKey({ ...base, release: "2026-10-01.0" })).not.toBe(discoveryCacheKey(base));
  });

  it("uses an absolute platform cache directory", () => {
    expect(defaultDiscoveryCacheDirectory()).toMatch(/open-local-audit[\\/]cache[\\/]discovery$/);
  });
});
