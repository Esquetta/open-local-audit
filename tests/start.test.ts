import { join, resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { collectStartOptions, type StartPromptIO } from "../src/start.js";

const root = resolve("D:/open-local-audit-test");
const now = new Date("2026-10-02T12:34:56.789Z");

function scriptedIo(answers: Array<string | null>, options: {
  isTTY?: boolean;
  exists?: (path: string) => boolean;
} = {}): { io: StartPromptIO; output: string[]; closed: () => number } {
  const output: string[] = [];
  let closeCount = 0;
  return {
    io: {
      isTTY: options.isTTY ?? true,
      question: async (prompt) => {
        output.push(prompt);
        return answers.shift() ?? null;
      },
      write: (message) => output.push(message),
      close: () => { closeCount += 1; },
      cwd: () => root,
      exists: async (path) => options.exists?.(path) ?? false,
      now: () => now
    },
    output,
    closed: () => closeCount
  };
}

describe("interactive discovery start", () => {
  test("collects a conventional Overture run without starting work", async () => {
    const prompt = scriptedIo(["tr", "İstanbul", "1", "", "", "", ""]);
    const fetch = vi.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetch;

    try {
      const result = await collectStartOptions(prompt.io);

      const outDir = join(root, "reports", "tr-istanbul-dental-20261002-123456");
      expect(result).toEqual({
        provider: "overture",
        query: "dental",
        city: "İstanbul",
        country: "TR",
        profile: "dental",
        limit: 10,
        maxAudits: 3,
        concurrency: 3,
        dryRun: false,
        outDir,
        exportCsv: join(outDir, "leads.csv"),
        summaryJson: join(outDir, "discovery-summary.json")
      });
      expect(fetch).not.toHaveBeenCalled();
      expect(prompt.closed()).toBe(1);
      expect(prompt.output.join("\n")).toContain("Free API-keyless Overture discovery");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("uses the generic profile for a custom Overture category", async () => {
    const prompt = scriptedIo(["US", "New York", "6", "pet_grooming", "5", "0", "custom-output", "y"]);

    const result = await collectStartOptions(prompt.io);

    const outDir = join(root, "custom-output");
    expect(result).toMatchObject({
      query: "pet_grooming",
      city: "New York",
      country: "US",
      profile: "generic",
      limit: 5,
      maxAudits: 0,
      dryRun: true,
      outDir
    });
    expect(result?.exportCsv).toBe(join(outDir, "leads.csv"));
  });

  test("maps a selected category to its audit profile", async () => {
    const prompt = scriptedIo(["TR", "Ankara", "2", "1", "0", "results", ""]);

    const result = await collectStartOptions(prompt.io);

    expect(result).toMatchObject({ query: "restaurant", profile: "restaurant", maxAudits: 0, dryRun: true });
  });

  test("re-prompts invalid values and never accepts an existing output path", async () => {
    const existing = join(root, "taken");
    const prompt = scriptedIo([
      "T", "TR", "   ", "İzmir", "0", "6", "bad-category", "pet_grooming",
      "1.5", "5", "9", "2", "taken", "new-output", "yes"
    ], { exists: (path) => path === existing });

    const result = await collectStartOptions(prompt.io);

    expect(result).toMatchObject({ limit: 5, maxAudits: 2, outDir: join(root, "new-output") });
    const output = prompt.output.join("\n");
    expect(output).toContain("Country must use a two-letter ISO code");
    expect(output).toContain("City is required");
    expect(output).toContain("Choose a category number from 1 to 6");
    expect(output).toContain("Use an Overture category identifier");
    expect(output).toContain("Candidate count must be a whole number from 1 to 100");
    expect(output).toContain("Website audit cap must be a whole number from 0 to 5");
    expect(output).toContain("Output path already exists");
  });

  test("generates a different default directory when this second already exists", async () => {
    const defaultPath = join(root, "reports", "tr-istanbul-gym-20261002-123456");
    const prompt = scriptedIo(["TR", "Istanbul", "5", "", "", "", ""], { exists: (path) => path === defaultPath });

    const result = await collectStartOptions(prompt.io);

    expect(result?.outDir).toBe(`${defaultPath}-2`);
  });

  test("cancels explicitly and on EOF without continuing", async () => {
    const declined = scriptedIo(["TR", "Bursa", "4", "", "", "", "maybe", "n"]);
    const eof = scriptedIo([null]);
    const interrupted = scriptedIo([]);
    interrupted.io.question = async () => {
      const error = new Error("interrupted");
      error.name = "AbortError";
      throw error;
    };

    await expect(collectStartOptions(declined.io)).resolves.toBeNull();
    await expect(collectStartOptions(eof.io)).resolves.toBeNull();
    await expect(collectStartOptions(interrupted.io)).resolves.toBeNull();
    expect(declined.closed()).toBe(1);
    expect(eof.closed()).toBe(1);
    expect(interrupted.closed()).toBe(1);
    expect(declined.output.join("\n")).toContain("Please answer Y or n");
  });

  test("refuses to prompt in a non-interactive process", async () => {
    const prompt = scriptedIo([], { isTTY: false });

    await expect(collectStartOptions(prompt.io)).rejects.toThrow(/requires.*terminal/);
    expect(prompt.closed()).toBe(1);
  });
});
