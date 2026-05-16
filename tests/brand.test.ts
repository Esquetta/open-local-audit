import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readBrandConfig } from "../src/brand.js";

describe("brand config", () => {
  it("reads and validates report branding JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-local-audit-brand-"));
    try {
      const path = join(dir, "brand.json");
      await writeFile(
        path,
        JSON.stringify({
          name: "TORUT Audit Studio",
          primaryColor: "#123456",
          accentColor: "#abcdef",
          footerText: "Prepared for outreach review",
          contact: "hello@example.com"
        }),
        "utf8"
      );

      await expect(readBrandConfig(path)).resolves.toEqual({
        name: "TORUT Audit Studio",
        primaryColor: "#123456",
        accentColor: "#abcdef",
        footerText: "Prepared for outreach review",
        contact: "hello@example.com"
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("accepts UTF-8 BOM brand files written by Windows tools", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-local-audit-brand-"));
    try {
      const path = join(dir, "brand.json");
      await writeFile(path, `\uFEFF${JSON.stringify({ name: "TORUT Audit Studio" })}`, "utf8");

      await expect(readBrandConfig(path)).resolves.toMatchObject({
        name: "TORUT Audit Studio"
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });


  it("rejects invalid color values", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-local-audit-brand-"));
    try {
      const path = join(dir, "brand.json");
      await writeFile(path, JSON.stringify({ name: "Bad Brand", primaryColor: "red" }), "utf8");

      await expect(readBrandConfig(path)).rejects.toThrow("Brand colors must be hex values");
      await expect(readFile(path, "utf8")).resolves.toContain("Bad Brand");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
