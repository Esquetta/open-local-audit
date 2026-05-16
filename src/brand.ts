import { readFile } from "node:fs/promises";
import type { ReportBrandConfig } from "./types.js";

const hexColorPattern = /^#[0-9a-f]{6}$/i;

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readColor(value: unknown): string | undefined {
  const color = optionalString(value);
  if (!color) {
    return undefined;
  }

  if (!hexColorPattern.test(color)) {
    throw new Error("Brand colors must be hex values like #145a73");
  }

  return color;
}

export async function readBrandConfig(path: string): Promise<ReportBrandConfig> {
  const content = (await readFile(path, "utf8")).replace(/^\uFEFF/, "");
  const parsed = JSON.parse(content) as Record<string, unknown>;

  return {
    name: optionalString(parsed.name),
    primaryColor: readColor(parsed.primaryColor),
    accentColor: readColor(parsed.accentColor),
    footerText: optionalString(parsed.footerText),
    contact: optionalString(parsed.contact)
  };
}
