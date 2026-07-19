import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

interface WorkflowOutputWriteOptions {
  managedOutputRoot?: string;
}

function isMissingPath(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function isContainedPath(root: string, path: string): boolean {
  const relativePath = relative(root, path);
  return relativePath === "" || (!relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath));
}

async function ensureManagedOutputDirectory(directory: string, managedOutputRoot: string): Promise<void> {
  const resolvedRoot = resolve(managedOutputRoot);
  const resolvedDirectory = resolve(directory);
  if (!isContainedPath(resolvedRoot, resolvedDirectory)) {
    throw new Error("Managed output directory escapes managed output root");
  }

  async function inspectDirectory(): Promise<boolean> {
    const rootInfo = await lstat(resolvedRoot);
    if (rootInfo.isSymbolicLink()) {
      throw new Error("Managed output directory must not be linked");
    }
    if (!rootInfo.isDirectory()) {
      throw new Error("Managed output directory must be a directory");
    }

    let directoryInfo;
    try {
      directoryInfo = await lstat(resolvedDirectory);
    } catch (error) {
      if (isMissingPath(error)) {
        return false;
      }
      throw error;
    }

    if (directoryInfo.isSymbolicLink()) {
      throw new Error("Managed output directory must not be linked");
    }
    if (!directoryInfo.isDirectory()) {
      throw new Error("Managed output directory must be a directory");
    }

    const [realRoot, realDirectory] = await Promise.all([realpath(resolvedRoot), realpath(resolvedDirectory)]);
    if (!isContainedPath(realRoot, realDirectory)) {
      throw new Error("Managed output directory escapes managed output root");
    }

    return true;
  }

  if (!(await inspectDirectory())) {
    await mkdir(resolvedDirectory, { recursive: true });
    await inspectDirectory();
  }
}

export async function writeWorkflowOutputFile(
  path: string,
  content: string | Uint8Array,
  options: WorkflowOutputWriteOptions = {}
): Promise<void> {
  if (options.managedOutputRoot) {
    await ensureManagedOutputDirectory(dirname(path), options.managedOutputRoot);
  }
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
