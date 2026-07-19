import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const npm = process.env.npm_execpath ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
const npmArgsPrefix = process.env.npm_execpath ? [process.env.npm_execpath] : [];
const shell = !process.env.npm_execpath && process.platform === "win32";
const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const tempRoot = mkdtempSync(join(tmpdir(), "open-local-audit-release-"));
const cacheDir = join(tempRoot, "npm-cache");
const consumerDir = join(tempRoot, "consumer");

function run(args, options = {}) {
  return execFileSync(npm, [...npmArgsPrefix, ...args], {
    cwd: options.cwd ?? root,
    encoding: options.encoding ?? "utf8",
    shell,
    stdio: options.stdio ?? "pipe"
  });
}

try {
  const packOutput = JSON.parse(run(["pack", "--json", "--pack-destination", tempRoot]));
  const tarball = join(tempRoot, packOutput[0].filename);

  mkdirSync(consumerDir);
  writeFileSync(join(consumerDir, "package.json"), JSON.stringify({ private: true }, null, 2));
  run(["install", tarball, "--cache", cacheDir, "--prefer-online"], { cwd: consumerDir, stdio: "inherit" });
  run(["ls", `${pkg.name}@${pkg.version}`, "--depth=0"], { cwd: consumerDir, stdio: "inherit" });
  run(["audit", "--omit=dev", "--cache", cacheDir], { cwd: consumerDir, stdio: "inherit" });
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `const api = await import(${JSON.stringify(pkg.name)});\nfor (const name of ["runWorkflowPreflight", "renderWorkflowPreflightTerminal", "renderWorkflowPreflightJson"]) {\n  if (typeof api[name] !== "function") throw new Error(\`Expected package export \${name} to be a function\`);\n}`
    ],
    { cwd: consumerDir, encoding: "utf8" }
  );
  for (const documentationPath of [
    "docs/architecture/workflow-command.md",
    "docs/architecture/workflow-preflight.md"
  ]) {
    readFileSync(join(consumerDir, "node_modules", pkg.name, documentationPath), "utf8");
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
