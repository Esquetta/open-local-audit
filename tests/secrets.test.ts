import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { readWindowsUserEnvironmentVariable } from "../src/secrets.js";

describe("secret resolution helpers", () => {
  it("parses Windows user environment values from registry output", () => {
    const execFile = (() =>
      [
        "",
        "HKEY_CURRENT_USER\\Environment",
        "    GOOGLE_MAPS_API_KEY    REG_SZ    test-key",
        ""
      ].join("\r\n")) as unknown as typeof execFileSync;

    expect(readWindowsUserEnvironmentVariable("GOOGLE_MAPS_API_KEY", execFile, "win32")).toBe("test-key");
  });

  it("rejects unsafe registry value names", () => {
    const execFile = (() => {
      throw new Error("should not execute");
    }) as unknown as typeof execFileSync;

    expect(readWindowsUserEnvironmentVariable("GOOGLE_MAPS_API_KEY & whoami", execFile, "win32")).toBeUndefined();
  });
});
