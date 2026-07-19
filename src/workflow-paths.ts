import { lstat, mkdir, realpath } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import type { ResolvedWorkflowConfig } from "./workflow-config.js";

export type WorkflowPathIssueId =
  | "output-linked"
  | "reports-linked"
  | "packages-linked"
  | "reports-escape"
  | "packages-escape";

export interface WorkflowPathIssue {
  id: WorkflowPathIssueId;
  message: string;
  path: string;
}

export interface WorkflowPathInspection {
  status: "safe" | "unsafe";
  issues: WorkflowPathIssue[];
}

interface WorkflowPathDependencies {
  lstat(path: string): ReturnType<typeof lstat>;
  realpath(path: string): Promise<string>;
}

const defaultDependencies: WorkflowPathDependencies = { lstat, realpath };

function isMissingPath(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

async function pathInfo(
  path: string,
  dependencies: WorkflowPathDependencies
): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await dependencies.lstat(path);
  } catch (error) {
    if (isMissingPath(error)) {
      return undefined;
    }
    throw error;
  }
}

export async function inspectWorkflowManagedPaths(
  config: ResolvedWorkflowConfig,
  dependencies: Partial<WorkflowPathDependencies> = {}
): Promise<WorkflowPathInspection> {
  const resolvedDependencies: WorkflowPathDependencies = { ...defaultDependencies, ...dependencies };
  const outputInfo = await pathInfo(config.outDir, resolvedDependencies);
  if (!outputInfo) {
    return { status: "safe", issues: [] };
  }

  if (outputInfo.isSymbolicLink()) {
    return {
      status: "unsafe",
      issues: [
        {
          id: "output-linked",
          message: "Managed output directory must not be linked",
          path: config.outDir
        }
      ]
    };
  }

  const realOutDir = await resolvedDependencies.realpath(config.outDir);
  const directories = [
    {
      id: "reports" as const,
      path: config.paths.reportsDir
    },
    ...(config.packageReports
      ? [
          {
            id: "packages" as const,
            path: config.paths.packagesDir
          }
        ]
      : [])
  ];
  const issues: WorkflowPathIssue[] = [];

  for (const directory of directories) {
    const directoryInfo = await pathInfo(directory.path, resolvedDependencies);
    if (!directoryInfo) {
      continue;
    }

    if (directoryInfo.isSymbolicLink()) {
      issues.push({
        id: `${directory.id}-linked`,
        message: `Managed ${directory.id} directory must not be linked`,
        path: directory.path
      });
      continue;
    }

    const realDirectory = await resolvedDependencies.realpath(directory.path);
    const relativeDirectory = relative(realOutDir, realDirectory);
    if (relativeDirectory.startsWith("..") || isAbsolute(relativeDirectory)) {
      issues.push({
        id: `${directory.id}-escape`,
        message: `Managed ${directory.id} directory escapes output directory`,
        path: directory.path
      });
    }
  }

  return issues.length === 0 ? { status: "safe", issues } : { status: "unsafe", issues };
}

export async function prepareWorkflowManagedDirectories(config: ResolvedWorkflowConfig): Promise<void> {
  await mkdir(config.outDir, { recursive: true });
  const initialInspection = await inspectWorkflowManagedPaths(config);
  if (initialInspection.status === "unsafe") {
    throw new Error(initialInspection.issues[0].message);
  }

  await mkdir(config.paths.reportsDir, { recursive: true });
  if (config.packageReports) {
    await mkdir(config.paths.packagesDir, { recursive: true });
  }

  const inspection = await inspectWorkflowManagedPaths(config);
  if (inspection.status === "unsafe") {
    throw new Error(inspection.issues[0].message);
  }
}
