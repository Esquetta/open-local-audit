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
  // "monthly" runs the full monitor on the 1st at 09:00; "daily" runs the quick check every day at 08:00.
  frequency?: "monthly" | "daily";
}

interface ScheduleNames {
  file: string;
  log: string;
  task: string;
  when: string;
  missed: string;
  schtasks: string;
  cron: string;
}

function scheduleNames(frequency: "monthly" | "daily"): ScheduleNames {
  return frequency === "daily"
    ? {
        file: "run-monitor-quick",
        log: "quick.log",
        task: "Open Local Audit quick check",
        when: "every day at 08:00",
        missed: "the next day",
        schtasks: "/SC DAILY /ST 08:00",
        cron: "0 8 * * *"
      }
    : {
        file: "run-monitor",
        log: "monitor.log",
        task: "Open Local Audit monitor",
        when: "on the 1st of every month at 09:00",
        missed: "the next month",
        schtasks: "/SC MONTHLY /D 1 /ST 09:00",
        cron: "0 9 1 * *"
      };
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
  const names = scheduleNames(options.frequency ?? "monthly");
  if (options.platform === "win32") {
    const scriptPath = win32.join(options.outDir, `${names.file}.ps1`);
    const log = win32.join(options.outDir, names.log);
    const logName = names.log;
    const ps1 = [
      "# Written by open-local-audit monitor --print-schedule. Regenerate it after changing options or upgrading.",
      "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
      `$log = ${psQuote(log)}`,
      // A toast in the signed-in session, through Windows PowerShell's own app id so Windows shows it without setup.
      "function Show-Notification([string]$text) {",
      "  try {",
      "    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
      "    $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)",
      '    $lines = $template.GetElementsByTagName("text")',
      `    $lines.Item(0).AppendChild($template.CreateTextNode(${psQuote(names.task)})) | Out-Null`,
      "    $lines.Item(1).AppendChild($template.CreateTextNode($text)) | Out-Null",
      "    $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'",
      "    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show([Windows.UI.Notifications.ToastNotification]::new($template))",
      "  } catch {",
      '    "Could not show a desktop notification: $($_.Exception.Message)" | Out-File -LiteralPath $log -Append -Encoding utf8',
      "  }",
      "}",
      `Set-Location -LiteralPath ${psQuote(options.cwd)}`,
      // Task Scheduler starts without a login shell, so say so instead of exiting 0 when npx is missing.
      "if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {",
      '  $message = "npx was not found on PATH; install Node.js for all users or add its folder to the system PATH."',
      "  $message | Out-File -LiteralPath $log -Append -Encoding utf8",
      "  Show-Notification $message",
      "  exit 1",
      "}",
      // Converting each line to text keeps Windows PowerShell from logging stderr lines as errors. npx's exit code,
      // including --fail-on-alerts, becomes the task's result, and a non-zero code shows a notification.
      `$output = @(& npx --yes ${packageSpec} monitor ${options.args.map(psQuote).join(" ")} 2>&1 | ForEach-Object { "$_" })`,
      "$code = $LASTEXITCODE",
      "$output | Out-File -LiteralPath $log -Append -Encoding utf8",
      "if ($code -ne 0) {",
      "  $summary = @($output | Where-Object { $_ -match '^ALERT|attention|open-local-audit:' } | Select-Object -First 4) -join [Environment]::NewLine",
      `  if (-not $summary) { $summary = 'The check failed with exit code ' + $code + ${psQuote(`; see ${logName}.`)} }`,
      "  Show-Notification $summary",
      "}",
      "exit $code",
      ""
    ].join("\r\n");
    const run = `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`;
    // schtasks needs the script path quoted inside the /TR value. In `"... \"path\""` the path sits outside cmd's own
    // quotes, so cmd's special characters in it are escaped with ^. PowerShell 7 rewrites the inner quotes, even
    // after --%, so PowerShell users hand the whole line to cmd as one single-quoted string.
    const task = `schtasks /Create ${names.schtasks} /TN "${names.task}" /TR "${run.replace(/"/g, '\\"').replace(/[&|<>^]/g, "^$&")}"`;
    return {
      scriptPath,
      // Windows PowerShell 5.1 reads a script without a byte order mark in the ANSI code page.
      files: [{ path: scriptPath, content: `\uFEFF${ps1}` }],
      instructions: [
        `Wrote ${scriptPath}`,
        ...(run.length > taskCommandLimit
          ? [`Warning: Task Scheduler accepts at most ${taskCommandLimit} characters for the task command, and this one has ${run.length}. Use a shorter --out-dir path.`]
          : []),
        `Schedule it ${names.when} by running one of these once.`,
        "In Command Prompt:",
        task,
        "In PowerShell:",
        `cmd /c '${psEscape(task)}'`,
        `Each run appends its output to ${log}, and a run that ends with a non-zero exit code (alerts with --fail-on-alerts, or an error) shows a Windows notification. The task runs while you are signed in to Windows and opens a console window; if the computer is off or you are signed out at that time, the run waits until ${names.missed}, or start one by hand with: schtasks /Run /TN "${names.task}"`,
        `Remove the task with: schtasks /Delete /TN "${names.task}"`
      ].join("\n")
    };
  }

  const scriptPath = posix.join(options.outDir, `${names.file}.sh`);
  const log = posix.join(options.outDir, names.log);
  const command = ["npx", "--yes", packageSpec, "monitor", ...options.args];
  // The message reaches osascript as an argument, never as script text, so alert text cannot change the script.
  const script = [
    "#!/bin/sh",
    "# Written by open-local-audit monitor --print-schedule. Regenerate it after changing options or upgrading.",
    `log=${shQuote(log)}`,
    "notify() {",
    "  if command -v osascript >/dev/null 2>&1; then",
    "    osascript - \"$1\" >/dev/null 2>&1 <<'APPLESCRIPT'",
    "on run argv",
    `  display notification (item 1 of argv) with title "${names.task}"`,
    "end run",
    "APPLESCRIPT",
    "  elif command -v notify-send >/dev/null 2>&1; then",
    `    notify-send ${shQuote(names.task)} "$1" >/dev/null 2>&1`,
    "  fi",
    "}",
    `cd ${shQuote(options.cwd)} || { notify 'The working folder for this check was not found; regenerate the script.'; exit 1; }`,
    "if ! command -v npx >/dev/null 2>&1; then",
    "  message='npx was not found on PATH; add your Node.js folder to PATH at the top of this script.'",
    "  printf '%s\\n' \"$message\" >> \"$log\"",
    "  notify \"$message\"",
    "  exit 1",
    "fi",
    `output=$(${command.map(shQuote).join(" ")} 2>&1)`,
    "code=$?",
    "printf '%s\\n' \"$output\" >> \"$log\"",
    "if [ \"$code\" -ne 0 ]; then",
    "  summary=$(printf '%s\\n' \"$output\" | grep -iE '^ALERT|attention|open-local-audit:' | head -n 4)",
    `  notify "\${summary:-The check failed with exit code $code; see ${names.log}.}"`,
    "fi",
    "exit \"$code\"",
    ""
  ].join("\n");
  return {
    scriptPath,
    files: [{ path: scriptPath, content: script }],
    instructions: [
      `Wrote ${scriptPath}`,
      `Schedule it ${names.when} by adding this line with crontab -e:`,
      // cron reads an unescaped % as a newline.
      `${names.cron} ${shQuote(scriptPath).replace(/%/g, "\\%")}`,
      `cron starts with a short PATH; if npx is not found there, add your Node.js directory to PATH at the top of the script. Each run appends its output to ${log}. When a run ends with a non-zero exit code, the script shows a desktop notification with osascript (macOS) or notify-send (Linux, which needs a graphical session; cron jobs often have none).`
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
