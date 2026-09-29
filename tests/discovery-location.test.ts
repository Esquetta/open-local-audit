import { describe, expect, it } from "vitest";
import { cityBoundingBox, findDiscoveryCity, parseDiscoveryBbox } from "../src/discovery-location.js";

const cities = [
  "745044\tİstanbul\tIstanbul\tConstantinople,İstanbul\t41.0138\t28.9497\tP\tPPLA\tTR\t\t34\t\t\t\t15000000",
  "2950159\tBerlin\tBerlin\tBerlín\t52.5244\t13.4105\tP\tPPLC\tDE\t\t16\t\t\t\t3400000",
  "1\tBerlin\tBerlin\t\t44\t-71\tP\tPPL\tUS\t\tNH\t\t\t\t10000"
].join("\n");

describe("discovery location", () => {
  it("resolves localized city names with an explicit country", () => {
    expect(findDiscoveryCity(cities, "istanbul", "tr")).toMatchObject({ name: "İstanbul", country: "TR", latitude: 41.0138, longitude: 28.9497 });
    expect(findDiscoveryCity(cities, "Berlín", "DE").name).toBe("Berlin");
  });
  it("does not guess an ambiguous city or a nonexistent city", () => {
    expect(() => findDiscoveryCity(cities + "\n2\tBerlin\tBerlin\t\t45\t-70\tP\tPPL\tUS\t\tVT\t\t\t\t2000", "Berlin", "US")).toThrow(/ambiguous/i);
    expect(() => findDiscoveryCity(cities, "unknown", "TR")).toThrow(/not found/i);
  });
  it("validates bounds and produces a bounded city search area", () => {
    expect(parseDiscoveryBbox("28.8,40.9,29.1,41.1")).toEqual([28.8, 40.9, 29.1, 41.1]);
    for (const value of ["1,2,3", "3,2,1,4", "0,-91,1,1", "0,0,NaN,1", "0,0,200,1", "0,0,6,1"]) {
      expect(() => parseDiscoveryBbox(value)).toThrow();
    }
    const bbox = cityBoundingBox(findDiscoveryCity(cities, "Istanbul", "TR"), 10);
    expect(bbox[0]).toBeLessThan(28.9497);
    expect(bbox[2]).toBeGreaterThan(28.9497);
    expect(bbox[2] - bbox[0]).toBeLessThan(0.3);
    expect(() => cityBoundingBox(findDiscoveryCity(cities, "Istanbul", "TR"), 0)).toThrow();
  });
});
