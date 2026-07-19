import { existsSync, readFileSync } from "node:fs";
import { link, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeWorkflowOutputFile } from "../src/workflow-output.js";

describe("workflow output file writes", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "open-local-audit-workflow-output-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("replaces a destination link installed after its parent directory was prepared", async () => {
    const outputDir = join(directory, "output");
    const destination = join(outputDir, "leads.csv");
    const externalTarget = join(directory, "external.csv");
    await mkdir(outputDir, { recursive: true });
    await writeFile(externalTarget, "outside data\n", "utf8");
    await link(externalTarget, destination);

    await writeWorkflowOutputFile(destination, "managed data\n");

    expect(readFileSync(destination, "utf8")).toBe("managed data\n");
    expect(readFileSync(externalTarget, "utf8")).toBe("outside data\n");
    expect(existsSync(destination)).toBe(true);
    expect((await readdir(outputDir)).filter((name) => name.startsWith(".leads.csv-"))).toEqual([]);
  });
});
