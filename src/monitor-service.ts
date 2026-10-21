import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseCsvLine } from "./csv.js";

// What the operator did for clients between checks: the daily check log (quick-history.jsonl) and the hand-kept
// work log (work-log.csv), both in the monitoring output folder.

export const quickHistoryFile = "quick-history.jsonl";
export const workLogFile = "work-log.csv";

export interface SiteAvailability {
  // Daily checks in the period and how many of them found the site loading.
  checks: number;
  up: number;
  // Local calendar days (YYYY-MM-DD) with at least one check that found the site down.
  downDays: string[];
}

export interface WorkLogEntry {
  date: string;
  site: string;
  minutes: number;
  description: string;
}

export interface SiteWork {
  entries: Array<Omit<WorkLogEntry, "site">>;
  minutes: number;
  includedMinutes?: number;
}

export interface ServiceSection {
  title: string;
  items: string[];
  lines: string[];
}

interface QuickHistoryRecord {
  runId: string;
  sites: Array<{ url: string; up: boolean }>;
}

const runIdPattern = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{3}))?Z$/;

// A plain ASCII address such as owner@clinic.co.uk: no display name, spaces, or anything else that could reach the
// headers of an email draft.
export function isPlainEmailAddress(value: string): boolean {
  return /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(value);
}

export function runIdDate(runId: unknown): Date | undefined {
  const match = typeof runId === "string" ? runIdPattern.exec(runId) : null;
  if (!match) {
    return undefined;
  }
  const date = new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5] ?? "000"}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

// A bare host such as "clinic.co.uk" is read as an https address, which is how the work log is usually written.
function siteUrl(value: string): URL | undefined {
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    return /^https?:$/.test(parsed.protocol) && parsed.hostname ? parsed : undefined;
  } catch {
    return undefined;
  }
}

// The same identity monitor uses for its site folders: host without "www.", port, path, and query.
export function siteIdentity(url: string): string {
  const parsed = siteUrl(url);
  return parsed
    ? `${parsed.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "")}${parsed.port ? `:${parsed.port}` : ""}${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`
    : url;
}

export function localDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function longDay(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

// One line per quick check, so a month of daily checks can be summed up in the monthly report.
export async function appendQuickHistory(outDir: string, runId: string, sites: Array<{ url: string; up: boolean }>): Promise<void> {
  await appendFile(join(outDir, quickHistoryFile), `${JSON.stringify({ runId, sites })}\n`);
}

// Lines that cannot be read, such as one cut short by a crash, are skipped.
export async function readQuickHistory(outDir: string): Promise<QuickHistoryRecord[]> {
  let content: string;
  try {
    content = await readFile(join(outDir, quickHistoryFile), "utf8");
  } catch {
    return [];
  }
  return content.split(/\r?\n/).flatMap((line) => {
    try {
      const record = JSON.parse(line) as Partial<QuickHistoryRecord>;
      if (!runIdDate(record.runId) || !Array.isArray(record.sites)) {
        return [];
      }
      const sites = record.sites.filter((site) => site && typeof site.url === "string" && typeof site.up === "boolean");
      return [{ runId: record.runId as string, sites }];
    } catch {
      return [];
    }
  });
}

// Checks after `since` up to and including `until`; undefined when the site had no check in that period.
export function siteAvailability(records: QuickHistoryRecord[], url: string, since: Date, until: Date): SiteAvailability | undefined {
  const identity = siteIdentity(url);
  let checks = 0;
  let up = 0;
  const downDays = new Set<string>();
  for (const record of records) {
    const checkedAt = runIdDate(record.runId);
    if (!checkedAt || checkedAt <= since || checkedAt > until) {
      continue;
    }
    for (const site of record.sites) {
      if (siteIdentity(site.url) !== identity) {
        continue;
      }
      checks += 1;
      if (site.up) {
        up += 1;
      } else {
        downDays.add(localDay(checkedAt));
      }
    }
  }
  return checks === 0 ? undefined : { checks, up, downDays: [...downDays].sort() };
}

// Reads work-log.csv: a header with date, site, minutes, and description columns, then one row per piece of work.
// A missing file is an empty log. Rows that cannot be read are returned as errors with their line numbers.
export async function readWorkLog(outDir: string): Promise<{ entries: WorkLogEntry[]; errors: string[] }> {
  let content: string;
  try {
    content = (await readFile(join(outDir, workLogFile), "utf8")).replace(/^\uFEFF/, "");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { entries: [], errors: [] };
    }
    throw error;
  }
  const lines = content.split(/\r?\n/).map((line, index) => ({ line: line.trim(), number: index + 1 }));
  const rows = lines.filter(({ line }) => line.length > 0 && !line.startsWith("#"));
  const [header, ...data] = rows;
  if (!header) {
    return { entries: [], errors: [] };
  }
  const columns = parseCsvLine(header.line).map((column) => column.trim().toLowerCase());
  const index = (name: string) => columns.indexOf(name);
  const missing = ["date", "site", "minutes"].filter((name) => index(name) < 0);
  if (missing.length > 0) {
    return { entries: [], errors: [`${workLogFile} needs date, site, and minutes columns (missing ${missing.join(", ")})`] };
  }
  const entries: WorkLogEntry[] = [];
  const errors: string[] = [];
  for (const { line, number } of data) {
    const cells = parseCsvLine(line);
    // Spreadsheets often save empty rows as commas only.
    if (cells.every((cell) => cell === "")) {
      continue;
    }
    const date = cells[index("date")] ?? "";
    const site = cells[index("site")] ?? "";
    const minutes = cells[index("minutes")] ?? "";
    const description = index("description") < 0 ? "" : (cells[index("description")] ?? "");
    const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00`) : undefined;
    if (!parsedDate || Number.isNaN(parsedDate.getTime()) || localDay(parsedDate) !== date) {
      errors.push(`${workLogFile} line ${number}: date must be YYYY-MM-DD, got "${date}"`);
    } else if (!siteUrl(site)) {
      errors.push(`${workLogFile} line ${number}: site must be the client's website, got "${site}"`);
    } else if (!/^\d{1,5}$/.test(minutes) || Number(minutes) === 0) {
      errors.push(`${workLogFile} line ${number}: minutes must be a whole number above 0, got "${minutes}"`);
    } else {
      entries.push({ date, site, minutes: Number(minutes), description });
    }
  }
  return { entries, errors };
}

// Work on the site dated from `sinceDay` up to the day before `untilDay` (local days, YYYY-MM-DD). Each monthly report
// covers the days from the previous run up to its own run day, so no entry is counted twice or left out.
export function siteWork(entries: WorkLogEntry[], url: string, sinceDay: string, untilDay: string | undefined, includedMinutes?: number): SiteWork | undefined {
  const identity = siteIdentity(url);
  const matching = entries
    .filter((entry) => siteIdentity(entry.site) === identity && entry.date >= sinceDay && (untilDay === undefined || entry.date < untilDay))
    .sort((left, right) => left.date.localeCompare(right.date))
    .map(({ date, minutes, description }) => ({ date, minutes, description }));
  if (matching.length === 0 && includedMinutes === undefined) {
    return undefined;
  }
  return {
    entries: matching,
    minutes: matching.reduce((total, entry) => total + entry.minutes, 0),
    ...(includedMinutes === undefined ? {} : { includedMinutes })
  };
}

export function workTotal(work: SiteWork): string {
  if (work.includedMinutes === undefined) {
    return `Time spent: ${work.minutes} minutes.`;
  }
  const over = work.minutes - work.includedMinutes;
  return over > 0
    ? `Time used: ${work.minutes} minutes, ${over} more than the ${work.includedMinutes} included.`
    : `Time used: ${work.minutes} of ${work.includedMinutes} included minutes.`;
}

// The availability and work sections shared by the client email and the comparison reports.
export function serviceSections(input: { since: Date; availability?: SiteAvailability; work?: SiteWork }): ServiceSection[] {
  const since = input.since.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const sections: ServiceSection[] = [];
  const { availability, work } = input;
  if (availability) {
    sections.push({
      title: "Availability",
      items: [],
      lines: [
        availability.checks === 1
          ? `The site ${availability.up === 1 ? "loaded" : "did not load"} on the only daily check since ${since}.`
          : availability.up === availability.checks
            ? `The site loaded on all ${availability.checks} daily checks since ${since}.`
            : `The site loaded on ${availability.up} of ${availability.checks} daily checks since ${since}.`,
        ...(availability.downDays.length > 0 ? [`It did not load on ${availability.downDays.map(longDay).join(", ")}.`] : [])
      ]
    });
  }
  if (work && (work.entries.length > 0 || work.includedMinutes)) {
    sections.push({
      title: "Work Done",
      items: work.entries.map((entry) => `${longDay(entry.date)}: ${entry.description || "Website work"} (${entry.minutes} min)`),
      lines: [work.entries.length === 0 ? "No work was needed in this period." : workTotal(work)]
    });
  }
  return sections;
}
