import { chmod, mkdir, writeFile } from "node:fs/promises";
import { posix, win32 } from "node:path";

export interface MonitorScheduleOptions {
  platform: NodeJS.Platform;
  // Absolute working directory, input path, and output directory, so the task runs the same from anywhere.
  cwd: string;
  outDir: string;
  // The monitor arguments to repeat, such as ["--input", "C:\\clients.csv", "--out-dir", "C:\\monitoring"].
  args: string[];
  // The installed version, pinned so that monthly comparisons use the same rules until you choose to upgrade.
  version: string;
}

export interface MonitorScheduleFile {
  path: string;
  content: string;
}

export interface MonitorSchedule {
  // The file the scheduler runs.
  scriptPath: string;
  files: MonitorScheduleFile[];
  instructions: string;
}

// PowerShell also ends single-quoted strings at typographic apostrophes, so those are doubled too.
function psEscape(value: string): string {
  return value.replace(/['‘-‛]/g, "$&$&");
}

// Task Scheduler rejects a task command longer than this.
const taskCommandLimit = 261;

function psQuote(value: string): string {
  return `'${psEscape(value)}'`;
}

function shQuote(value: string): string {
  return /^[A-Za-z0-9_.:@/=-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

// Builds run scripts for the operating system's scheduler. On Windows the task starts PowerShell on a UTF-8 .ps1
// directly: cmd misreads batch files that contain non-ASCII paths and cannot start a .cmd whose path contains "&",
// and the .ps1 passes every path to npx as a separate argument.
export function buildMonitorSchedule(options: MonitorScheduleOptions): MonitorSchedule {
  const packageSpec = `open-local-audit@${options.version}`;
  if (options.platform === "win32") {
    const scriptPath = win32.join(options.outDir, "run-monitor.ps1");
    const log = win32.join(options.outDir, "monitor.log");
    const ps1 = [
      "# Written by open-local-audit monitor --print-schedule. Regenerate it after changing options or upgrading.",
      "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
      `Set-Location -LiteralPath ${psQuote(options.cwd)}`,
      // Task Scheduler starts without a login shell, so say so in the log instead of exiting 0 when npx is missing.
      "if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {",
      `  "npx was not found on PATH; install Node.js for all users or add its folder to the system PATH." | Out-File -LiteralPath ${psQuote(log)} -Append -Encoding utf8`,
      "  exit 1",
      "}",
      // Converting each line to text keeps Windows PowerShell from logging stderr lines as errors. npx's exit code,
      // including --fail-on-alerts, becomes the task's result.
      `& npx --yes ${packageSpec} monitor ${options.args.map(psQuote).join(" ")} 2>&1 | ForEach-Object { "$_" } | Out-File -LiteralPath ${psQuote(log)} -Append -Encoding utf8`,
      "exit $LASTEXITCODE",
      ""
    ].join("\r\n");
    const run = `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`;
    // schtasks needs the script path quoted inside the /TR value. In `"... \"path\""` the path sits outside cmd's own
    // quotes, so cmd's special characters in it are escaped with ^. PowerShell 7 rewrites the inner quotes, even
    // after --%, so PowerShell users hand the whole line to cmd as one single-quoted string.
    const task = `schtasks /Create /SC MONTHLY /D 1 /ST 09:00 /TN "Open Local Audit monitor" /TR "${run.replace(/"/g, '\\"').replace(/[&|<>^]/g, "^$&")}"`;
    return {
      scriptPath,
      // Windows PowerShell 5.1 reads a script without a byte order mark in the ANSI code page.
      files: [{ path: scriptPath, content: `\uFEFF${ps1}` }],
      instructions: [
        `Wrote ${scriptPath}`,
        ...(run.length > taskCommandLimit
          ? [`Warning: Task Scheduler accepts at most ${taskCommandLimit} characters for the task command, and this one has ${run.length}. Use a shorter --out-dir path.`]
          : []),
        "Schedule it on the 1st of every month at 09:00 by running one of these once.",
        "In Command Prompt:",
        task,
        "In PowerShell:",
        `cmd /c '${psEscape(task)}'`,
        `Each run appends its output to ${log}. The task runs while you are signed in to Windows and opens a console window; if the computer is off or you are signed out at that time, the run waits until the next month, or start one by hand with: schtasks /Run /TN "Open Local Audit monitor"`,
        `Remove the task with: schtasks /Delete /TN "Open Local Audit monitor"`
      ].join("\n")
    };
  }

  const scriptPath = posix.join(options.outDir, "run-monitor.sh");
  const log = posix.join(options.outDir, "monitor.log");
  const command = ["npx", "--yes", packageSpec, "monitor", ...options.args];
  return {
    scriptPath,
    files: [
      {
        path: scriptPath,
        content: ["#!/bin/sh", `cd ${shQuote(options.cwd)} || exit 1`, `${command.map(shQuote).join(" ")} >> ${shQuote(log)} 2>&1`, ""].join("\n")
      }
    ],
    instructions: [
      `Wrote ${scriptPath}`,
      "Schedule it on the 1st of every month at 09:00 by adding this line with crontab -e:",
      // cron reads an unescaped % as a newline.
      `0 9 1 * * ${shQuote(scriptPath).replace(/%/g, "\\%")}`,
      `cron starts with a short PATH; if npx is not found there, add your Node.js directory to PATH at the top of the script. Each run appends its output to ${log}.`
    ].join("\n")
  };
}

export async function writeMonitorSchedule(schedule: MonitorSchedule, outDir: string): Promise<void> {
  await mkdir(outDir, { recursive: true });
  for (const file of schedule.files) {
    await writeFile(file.path, file.content);
    if (file.path.endsWith(".sh")) {
      await chmod(file.path, 0o755);
    }
  }
}
