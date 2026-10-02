import { lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import type { DiscoveryRunOptions } from "./discovery-runner.js";
import type { AuditProfile } from "./types.js";

export interface StartPromptIO {
  isTTY: boolean;
  question(prompt: string): Promise<string | null>;
  write(message: string): void;
  close(): void;
  cwd(): string;
  exists(path: string): Promise<boolean>;
  now(): Date;
}

interface CategoryChoice {
  query: string;
  profile: AuditProfile;
}

const categories: CategoryChoice[] = [
  { query: "dental", profile: "dental" },
  { query: "restaurant", profile: "restaurant" },
  { query: "beauty", profile: "beauty" },
  { query: "hotel", profile: "hotel" },
  { query: "gym", profile: "gym" }
];

const overtureCategoryPattern = /^[a-z][a-z0-9_]{0,80}$/i;

function defaultPromptIo(): StartPromptIO {
  const isTTY = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const reader = isTTY ? createInterface({ input: process.stdin, output: process.stdout, terminal: true }) : undefined;
  let closed = false;

  const close = () => {
    if (!closed) {
      closed = true;
      reader?.close();
    }
  };

  reader?.on("SIGINT", close);

  return {
    isTTY,
    question: async (prompt) => {
      if (!reader || closed) return null;

      return new Promise<string | null>((answer) => {
        const finish = (value: string | null) => {
          reader.off("close", onClose);
          answer(value);
        };
        const onClose = () => finish(null);
        reader.once("close", onClose);
        reader.question(prompt).then((value) => finish(value), () => finish(null));
      });
    },
    write: (message) => process.stdout.write(message),
    close,
    cwd: () => process.cwd(),
    exists: async (path) => {
      try {
        await lstat(path);
        return true;
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
        throw error;
      }
    },
    now: () => new Date()
  };
}

async function answer(io: StartPromptIO, prompt: string): Promise<string | null> {
  try {
    return await io.question(prompt);
  } catch {
    return null;
  }
}

function writeLine(io: StartPromptIO, message: string): void {
  io.write(`${message}\n`);
}

function slug(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "search";
}

function timestamp(value: Date): string {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getUTCFullYear()}${pad(value.getUTCMonth() + 1)}${pad(value.getUTCDate())}-${pad(value.getUTCHours())}${pad(value.getUTCMinutes())}${pad(value.getUTCSeconds())}`;
}

async function promptCountry(io: StartPromptIO): Promise<string | null> {
  for (;;) {
    const value = await answer(io, "Country ISO code (two letters): ");
    if (value === null) return null;
    const country = value.trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(country)) return country;
    writeLine(io, "Country must use a two-letter ISO code, for example TR.");
  }
}

async function promptCity(io: StartPromptIO): Promise<string | null> {
  for (;;) {
    const value = await answer(io, "City: ");
    if (value === null) return null;
    const city = value.trim();
    if (city) return city;
    writeLine(io, "City is required.");
  }
}

async function promptCategory(io: StartPromptIO): Promise<CategoryChoice | null> {
  writeLine(io, "Category: 1) dental  2) restaurant  3) beauty  4) hotel  5) gym  6) custom Overture category");
  for (;;) {
    const selected = await answer(io, "Choose a category [1-6]: ");
    if (selected === null) return null;
    if (!/^[1-6]$/.test(selected.trim())) {
      writeLine(io, "Choose a category number from 1 to 6.");
      continue;
    }

    const index = Number(selected.trim()) - 1;
    if (index < categories.length) return categories[index];

    for (;;) {
      const custom = await answer(io, "Custom Overture category: ");
      if (custom === null) return null;
      const query = custom.trim();
      if (overtureCategoryPattern.test(query)) return { query, profile: "generic" };
      writeLine(io, "Use an Overture category identifier beginning with a letter and containing only letters, digits, or underscores.");
    }
  }
}

async function promptWholeNumber(
  io: StartPromptIO,
  prompt: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
  invalidMessage: string
): Promise<number | null> {
  for (;;) {
    const input = await answer(io, `${prompt} [${defaultValue}]: `);
    if (input === null) return null;
    const value = input.trim();
    if (!value) return defaultValue;
    if (/^(?:0|[1-9]\d*)$/.test(value)) {
      const parsed = Number(value);
      if (Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum) return parsed;
    }
    writeLine(io, invalidMessage);
  }
}

async function uniqueDefaultDirectory(io: StartPromptIO, country: string, city: string, category: string): Promise<string> {
  const base = resolve(io.cwd(), "reports", `${country.toLowerCase()}-${slug(city)}-${slug(category)}-${timestamp(io.now())}`);
  let candidate = base;
  let suffix = 2;
  while (await io.exists(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

async function promptOutputDirectory(io: StartPromptIO, defaultDirectory: string): Promise<string | null> {
  for (;;) {
    const input = await answer(io, `Output directory [${defaultDirectory}]: `);
    if (input === null) return null;
    const directory = input.trim() ? resolve(io.cwd(), input.trim()) : defaultDirectory;
    if (!await io.exists(directory)) return directory;
    writeLine(io, "Output path already exists. Choose a new directory so existing results are not overwritten.");
  }
}

function showSummary(io: StartPromptIO, options: Pick<DiscoveryRunOptions, "city" | "country" | "query" | "limit" | "maxAudits" | "outDir">): void {
  writeLine(io, "");
  writeLine(io, "Discovery summary");
  writeLine(io, `  Location: ${options.city}, ${options.country}`);
  writeLine(io, `  Category: ${options.query}`);
  writeLine(io, `  Candidate limit: ${options.limit}`);
  writeLine(io, `  Website audit cap: ${options.maxAudits}`);
  writeLine(io, `  Output: ${options.outDir}`);
  writeLine(io, "  Free API-keyless Overture discovery; results are stored in local files.");
}

export async function collectStartOptions(io: StartPromptIO = defaultPromptIo()): Promise<DiscoveryRunOptions | null> {
  try {
    if (!io.isTTY) {
      throw new Error("Interactive start requires a terminal. Use discover dental --city Istanbul --country TR --dry-run --export-csv leads.csv instead.");
    }

    const country = await promptCountry(io);
    if (country === null) return null;
    const city = await promptCity(io);
    if (city === null) return null;
    const category = await promptCategory(io);
    if (category === null) return null;
    const limit = await promptWholeNumber(io, "Candidate count", 10, 1, 100, "Candidate count must be a whole number from 1 to 100.");
    if (limit === null) return null;
    const maxAudits = await promptWholeNumber(io, "Website audit cap", Math.min(3, limit), 0, limit, `Website audit cap must be a whole number from 0 to ${limit}.`);
    if (maxAudits === null) return null;

    const defaultDirectory = await uniqueDefaultDirectory(io, country, city, category.query);
    let outDir = await promptOutputDirectory(io, defaultDirectory);
    if (outDir === null) return null;

    for (;;) {
      showSummary(io, { city, country, query: category.query, limit, maxAudits, outDir });
      const confirmation = await answer(io, "Start? [Y/n]: ");
      if (confirmation === null) return null;
      const normalized = confirmation.trim().toLowerCase();
      if (!normalized || normalized === "y" || normalized === "yes") {
        if (!await io.exists(outDir)) {
          return {
            provider: "overture",
            query: category.query,
            city,
            country,
            profile: category.profile,
            limit,
            maxAudits,
            concurrency: 3,
            dryRun: maxAudits === 0,
            outDir,
            exportCsv: join(outDir, "leads.csv"),
            summaryJson: join(outDir, "discovery-summary.json")
          };
        }
        writeLine(io, "Output path already exists. Choose a new directory so existing results are not overwritten.");
        outDir = await promptOutputDirectory(io, defaultDirectory);
        if (outDir === null) return null;
        continue;
      }
      if (normalized === "n" || normalized === "no") return null;
      writeLine(io, "Please answer Y or n.");
    }
  } finally {
    io.close();
  }
}
