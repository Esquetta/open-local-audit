import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export async function writeWorkflowOutputFile(path: string, content: string): Promise<void> {
  const temporaryPath = join(dirname(path), `.${basename(path)}-${randomUUID()}.tmp`);

  try {
    await writeFile(temporaryPath, content, "utf8");
    await rename(temporaryPath, path);
  } finally {
    try {
      await rm(temporaryPath, { force: true });
    } catch {
      // Preserve the write or replacement failure when its temporary cleanup also fails.
    }
  }
}
