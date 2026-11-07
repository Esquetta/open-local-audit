import { execFileSync } from "node:child_process";

type ExecFileSyncLike = typeof execFileSync;

const safeEnvironmentVariableName = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function readWindowsUserEnvironmentVariable(
  name: string,
  execFile: ExecFileSyncLike = execFileSync,
  platform: NodeJS.Platform = process.platform
): string | undefined {
  if (platform !== "win32" || !safeEnvironmentVariableName.test(name)) {
    return undefined;
  }

  try {
    const output = execFile("reg", ["query", "HKCU\\Environment", "/v", name], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true
    });
    const line = output
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find((item) => item.startsWith(name));
    const match = line?.match(new RegExp(`^${name}\\s+REG_(?:SZ|EXPAND_SZ)\\s+(.+)$`));
    const value = match?.[1]?.trim();

    return value || undefined;
  } catch {
    return undefined;
  }
}

function resolveApiKey(name: string): string | undefined {
  if (process.env.OPEN_LOCAL_AUDIT_DISABLE_WINDOWS_ENV_FALLBACK === "1") {
    return process.env[name];
  }

  return process.env[name] || readWindowsUserEnvironmentVariable(name);
}

export function resolveGoogleMapsApiKey(): string | undefined {
  return resolveApiKey("GOOGLE_MAPS_API_KEY");
}

export function resolveCompaniesHouseApiKey(): string | undefined {
  return resolveApiKey("COMPANIES_HOUSE_API_KEY");
}
