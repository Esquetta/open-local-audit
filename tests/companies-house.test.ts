import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CompaniesHouseKeyError,
  companiesHouseClient,
  matchCompany,
  readCompaniesHouseLeads,
  runCompaniesHouse,
  type CompaniesHouseGet,
  type CompaniesHouseLead
} from "../src/companies-house.js";
import { legalSkipReason, readLegalStatus } from "../src/outreach.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

function lead(label: string, address: string, locality = "Nottingham"): CompaniesHouseLead {
  return { leadKey: `overture:${label}`, label, address, locality };
}

// A search result whose town is its address snippet without the first part and the parts holding numbers.
function item(title: string, address: string, companyStatus = "active", companyNumber = title.slice(0, 8)) {
  const town = address.split(",").slice(1).filter((part) => !/\d/.test(part)).join(",");
  return { title, companyNumber, companyStatus, companyType: "ltd", address, town };
}

describe("Companies House matching", () => {
  it("matches a company by name and the listed street address and town", () => {
    expect(
      matchCompany(lead("Baldwin Cox Ltd", "15 Foster Ave", "Beeston"), [
        item("BALDWIN COX LIMITED", "15 Foster Avenue, Beeston, Nottingham, Notts, NG9 1AE"),
        item("OVER SQUARE LEG LIMITED", "15 Foster Avenue, Beeston, Nottingham, NG9 1AE")
      ]).match
    ).toMatchObject({ item: { title: "BALDWIN COX LIMITED" }, reason: "same name and address" });
    // Only the exact name counts when the listed name is one word.
    expect(
      matchCompany(lead("Devello", "15 WELLINGTON CIRCUS"), [
        item("DEVELLO GROUP HOLDINGS LIMITED", "Wellington House, 15 Wellington Circus, Nottingham, NG1 5AL"),
        item("DEVELLO LIMITED", "Wellington House, 15 Wellington Circus, Nottingham, NG1 5AL")
      ]).match
    ).toMatchObject({ item: { title: "DEVELLO LIMITED" } });
    // Spacing, "&", and legal suffixes do not matter.
    expect(matchCompany(lead("R M Tax & Accountancy", "27 York Rd", "Long Eaton"), [item("RM TAX AND ACCOUNTANCY LTD", "27 York Road, Long Eaton, NG10 4NJ")]).match).toBeDefined();
  });

  it("takes the one active company whose name includes the listed name at the listed address", () => {
    expect(
      matchCompany(lead("Phipp & Co", "6 NOTTINGHAM ROAD"), [
        item("PHIPP & CO (ACCOUNTANTS) LIMITED", "6 Nottingham Road, Long Eaton, Nottingham, NG10 1HP", "active", "02177482"),
        item("PHIPP & CO FINANCIAL SERVICES LIMITED", "6 Nottingham Road, Long Eaton, Nottingham, Nottinghamshire, NG10 1HP", "dissolved", "04432587")
      ]).match
    ).toMatchObject({ item: { companyNumber: "02177482" }, reason: "name includes the listed name, same address" });
  });

  it("leaves the same name at another address, in another town, or several candidates to check by hand", () => {
    // A sole trader can trade under a company's name in the same town, so the name and town are not enough.
    expect(matchCompany(lead("Smart I T Development", "1 Johnson Close Holly Lodge"), [item("SMART I T DEVELOPMENT LIMITED", "15 Barley Close, Kimberley, Nottingham, England, NG16 2PL")])).toEqual({
      check: [{ item: expect.objectContaining({ title: "SMART I T DEVELOPMENT LIMITED" }), reason: "check: same name, another address in the town" }]
    });
    // The same street address in another town is another place.
    expect(matchCompany(lead("J Smith Plumbing", "12 High Street", "Leeds"), [item("J SMITH PLUMBING LTD", "12 High Street, Bristol, BS1 1AA")]).check).toEqual([
      expect.objectContaining({ reason: "check: same name and street, another town" })
    ]);
    // A town named in a street ("Nottingham Road") is not the company's town.
    expect(matchCompany(lead("R M Tax & Accountancy", "6 Ashfield Ave"), [item("RM TAX & ACCOUNTANCY LIMITED", "27 Nottingham Road, Long Eaton, Derbyshire, England, NG10 4NJ")])).toEqual({
      check: [{ item: expect.objectContaining({ title: "RM TAX & ACCOUNTANCY LIMITED" }), reason: "check: same name, address and town differ" }]
    });
    // Every word of the street counts: a road is not a street.
    expect(matchCompany(lead("High Builders", "12 High Street", "Leeds"), [item("HIGH BUILDERS LTD", "12 High Road, Leeds, LS1 1AA")]).match).toBeUndefined();
    expect(
      matchCompany(lead("Turner & Co.", "8 Experian Way"), [item("TURNER ACCOUNTANTS LTD", "8 Experian Way, Nottingham, NG2 1EP"), item("TURNER & CO LIMITED", "1 Main Street, Bristol, BS1 1AA")])
    ).toEqual({
      check: [
        { item: expect.objectContaining({ title: "TURNER & CO LIMITED" }), reason: "check: same name, address and town differ" },
        { item: expect.objectContaining({ title: "TURNER ACCOUNTANTS LTD" }), reason: "check: same address, different name" }
      ]
    });
    expect(
      matchCompany(lead("Brooks Mayfield", "12 Bridgford Road"), [
        item("BROOKS MAYFIELD AUDIT LIMITED", "12 Bridgford Road, West Bridgford, Nottingham, NG2 6AB", "active", "07205447"),
        item("BROOKS MAYFIELD SERVICES LIMITED", "12 Bridgford Road, West Bridgford, Nottingham, NG2 6AB", "active", "07205448")
      ]).check.map((candidate) => candidate.reason)
    ).toEqual(["check: several companies with name includes the listed name, same address", "check: several companies with name includes the listed name, same address"]);
    expect(matchCompany(lead("Nobody", "1 Nowhere Lane"), [])).toEqual({ check: [] });
  });
});

describe("Companies House client", () => {
  function respond(status: number, body: unknown = {}, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  }

  it("sends the key as basic auth and reads a missing record as undefined", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const answers = [respond(200, { items: [] }), respond(404)];
    const get = companiesHouseClient("test-key", { fetch: async (url, init) => (calls.push([String(url), init]), answers.shift()!) });

    expect(await get("/search/companies?q=Smith")).toEqual({ items: [] });
    expect(await get("/company/00000000")).toBeUndefined();
    expect(calls[0][0]).toBe("https://api.company-information.service.gov.uk/search/companies?q=Smith");
    expect((calls[0][1]?.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("test-key:").toString("base64")}`);
  });

  it("waits out the rate limit, retries server and network errors, and stops on a rejected key", async () => {
    const waits: number[] = [];
    const sleep = async (ms: number) => void waits.push(ms);
    const now = () => 1_000_000;
    const answers: Array<Response | Error> = [respond(429, {}, { "x-ratelimit-reset": "1030" }), respond(500), new TypeError("fetch failed"), respond(200, { ok: true })];
    const fetch = async () => {
      const answer = answers.shift()!;
      if (answer instanceof Error) {
        throw answer;
      }
      return answer;
    };
    expect(await companiesHouseClient("k", { fetch, sleep, now })("/x")).toEqual({ ok: true });
    expect(waits).toEqual([31_000, 4000, 6000]);

    const failing = companiesHouseClient("k", { fetch: async () => respond(503), sleep, now });
    await expect(failing("/x")).rejects.toThrow("Companies House answered HTTP 503");
    await expect(companiesHouseClient("bad", { fetch: async () => respond(401) })("/x")).rejects.toBeInstanceOf(CompaniesHouseKeyError);
  });
});

describe("companies-house command", () => {
  const header = "leadKey,label,publicEmail,address,locality,country";
  const legalHeader = "leadKey,label,companyNumber,companyName,companyType,companyStatus,statusDetail,overdue,registeredAddress,match";

  function setup(rows: string[]): { dir: string; input: string; out: string } {
    const dir = mkdtempSync(join(tmpdir(), "open-local-audit-companies-house-"));
    tempDirs.push(dir);
    writeFileSync(join(dir, "leads.csv"), `${[header, ...rows].join("\n")}\n`);
    return { dir, input: join(dir, "leads.csv"), out: join(dir, "legal-status.csv") };
  }

  // Search results by query, company records by number; anything else is missing.
  function fake(search: Record<string, unknown[]>, companies: Record<string, unknown>, failing: string[] = []): { get: CompaniesHouseGet; paths: string[] } {
    const paths: string[] = [];
    return {
      paths,
      get: async (path) => {
        paths.push(path);
        const query = new URL(path, "https://x").searchParams.get("q");
        if (query && failing.includes(query)) {
          throw new Error("Companies House answered HTTP 502");
        }
        return query ? { items: search[query] ?? [] } : companies[path.replace("/company/", "")];
      }
    };
  }

  const brooks = {
    title: "BROOKS MAYFIELD LIMITED",
    company_number: "10246051",
    company_status: "active",
    company_type: "ltd",
    address_snippet: "12 Bridgford Road, West Bridgford, Nottingham, NG2 6AB",
    address: { address_line_1: "12 Bridgford Road", address_line_2: "West Bridgford", locality: "Nottingham", postal_code: "NG2 6AB" }
  };

  it("writes matched companies as rows, close candidates as commented rows, and reasons for the rest", async () => {
    const { input, out } = setup([
      "overture:5,No Email,,1 Main Street,Nottingham,GB",
      "overture:1,Brooks Mayfield,info@brooks.test,12 Bridgford Road,Nottingham,GB",
      "overture:2,R M Tax & Accountancy,rob@rm.test,6 Ashfield Ave,Beeston,GB",
      "overture:3,Jo Bloggs Plumbing,jo@bloggs.test,3 Mill Lane,Nottingham,GB",
      "overture:4,\"Broken, =Search\",info@broken.test,1 Main Street,Nottingham,GB",
      "overture:5,No Email,hello@noemail.test,1 Main Street,Nottingham,GB",
      "overture:6,Paris Cafe,bonjour@cafe.test,1 Rue,Paris,FR",
      // Another business listed under the same name at another address.
      "overture:7,Brooks Mayfield,hello@other.test,40 Derby Road,Nottingham,GB",
      "overture:1,Brooks Mayfield,info@brooks.test,12 Bridgford Road,Nottingham,GB"
    ]);
    const { get } = fake(
      {
        "Brooks Mayfield": [brooks],
        "R M Tax & Accountancy": [
          { title: "RM TAX & ACCOUNTANCY LIMITED", company_number: "08862887", company_status: "active", company_type: "ltd", address_snippet: "27 York Road, Long Eaton, NG10 4NJ" }
        ]
      },
      {
        "10246051": {
          company_name: "BROOKS MAYFIELD LIMITED",
          company_status: "active",
          type: "ltd",
          accounts: { overdue: true },
          confirmation_statement: { overdue: false },
          registered_office_address: { address_line_1: "12 Bridgford Road", locality: "Nottingham", postal_code: "NG2 6AB" }
        },
        "08862887": { company_name: "RM TAX & ACCOUNTANCY LIMITED", company_status: "active", company_status_detail: "active-proposal-to-strike-off", type: "ltd" }
      },
      ["Broken, =Search"]
    );

    const result = await runCompaniesHouse({ input, out, get, now: new Date("2026-11-07T10:00:00.000Z") });

    // No Email is checked from its later row with an address.
    expect(result).toEqual({ checked: 6, matched: 1, check: 2, notFound: 2, errors: 1, kept: 0, withoutEmail: 0, outsideUk: 1 });
    const csv = readFileSync(out, "utf8");
    expect(csv.split("\n")).toEqual([
      '# Companies House results, 2026-11-07T10:00:00.000Z. shortlist --legal-status reads the rows; lines starting with "#" are ignored.',
      '# A "# check:" line was not matched with confidence: confirm the company\'s name and address, then delete "# check: " to use it.',
      legalHeader,
      "# not found: No Email (overture:5): no company with this name; it may be a sole trader or partnership",
      'overture:1,Brooks Mayfield,10246051,BROOKS MAYFIELD LIMITED,ltd,active,,accounts,"12 Bridgford Road, Nottingham, NG2 6AB",same name and address',
      '# check: overture:2,R M Tax & Accountancy,08862887,RM TAX & ACCOUNTANCY LIMITED,ltd,active,active-proposal-to-strike-off,,"27 York Road, Long Eaton, NG10 4NJ","check: same name, address and town differ"',
      "# not found: Jo Bloggs Plumbing (overture:3): no company with this name; it may be a sole trader or partnership",
      "# error: Broken  =Search (overture:4): Companies House answered HTTP 502",
      '# check: overture:7,Brooks Mayfield,10246051,BROOKS MAYFIELD LIMITED,ltd,active,,accounts,"12 Bridgford Road, Nottingham, NG2 6AB","check: same name, another address in the town"',
      ""
    ]);
    // shortlist --legal-status reads only the confirmed row, and the other Brooks Mayfield does not take it.
    const legal = readLegalStatus(csv);
    expect([...legal.byKey.entries()]).toEqual([["overture:1", { companyNumber: "10246051", companyType: "ltd", companyStatus: "active" }]]);
    expect(legalSkipReason({ leadKey: "overture:7", companyName: "Brooks Mayfield" }, legal)).toBe(
      "legal form not confirmed: add the lead to --legal-status after a Companies House check"
    );
  });

  it("keeps the rows already in the file and checks only the leads without one", async () => {
    const { input, out } = setup([
      "overture:1,Brooks Mayfield,info@brooks.test,12 Bridgford Road,Nottingham,GB",
      "overture:2,R M Tax & Accountancy,rob@rm.test,6 Ashfield Ave,Beeston,GB",
      "overture:3,Jones & Partners,info@jones.test,3 Mill Lane,Nottingham,GB"
    ]);
    // The operator confirmed one commented row by hand and added a partnership by its label.
    const confirmed = 'overture:2,R M Tax & Accountancy,08862887,RM TAX & ACCOUNTANCY LIMITED,ltd,active,,,"27 York Road, Long Eaton, NG10 4NJ",checked by hand';
    const partnership = ",Jones & Partners,,,partnership,active,,,,checked by hand";
    writeFileSync(out, ["# old header comment", legalHeader, confirmed, partnership, ""].join("\n"));
    const { get, paths } = fake({}, {});

    const result = await runCompaniesHouse({ input, out, get });

    expect(paths).toEqual(["/search/companies?q=Brooks%20Mayfield&items_per_page=20"]);
    expect(result).toMatchObject({ checked: 1, kept: 2, notFound: 1 });
    expect(readFileSync(out, "utf8")).toContain(`${legalHeader}\n${confirmed}\n${partnership}\n# not found: Brooks Mayfield (overture:1)`);
  });

  it("does not merge into a file with other columns", async () => {
    const { input, out } = setup(["overture:1,Brooks Mayfield,info@brooks.test,12 Bridgford Road,Nottingham,GB"]);
    const handMade = "leadKey,label,companyNumber,companyType,companyStatus\noverture:1,Brooks Mayfield,10246051,ltd,active\n";
    writeFileSync(out, handMade);
    const { get, paths } = fake({}, {});

    await expect(runCompaniesHouse({ input, out, get })).rejects.toThrow("has other columns than companies-house writes; use another --out file");
    expect(paths).toEqual([]);
    expect(readFileSync(out, "utf8")).toBe(handMade);
  });

  it("stops without writing when the key is rejected", async () => {
    const { input, out } = setup(["overture:1,Brooks Mayfield,info@brooks.test,12 Bridgford Road,Nottingham,GB"]);
    await expect(
      runCompaniesHouse({
        input,
        out,
        get: async () => {
          throw new CompaniesHouseKeyError("Companies House rejected the API key (HTTP 401); check COMPANIES_HOUSE_API_KEY");
        }
      })
    ).rejects.toThrow("rejected the API key");
    expect(() => readFileSync(out, "utf8")).toThrow();
  });

  it("needs the lead columns and an API key", () => {
    expect(() => readCompaniesHouseLeads("leadKey,label\noverture:1,Smith\n")).toThrow("companies-house --input needs leadKey, label, and publicEmail columns");
    const { input, out } = setup(["overture:1,Brooks Mayfield,info@brooks.test,12 Bridgford Road,Nottingham,GB"]);
    const result = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "companies-house", "--input", input, "--out", out], {
      encoding: "utf8",
      env: { ...process.env, COMPANIES_HOUSE_API_KEY: "", OPEN_LOCAL_AUDIT_DISABLE_WINDOWS_ENV_FALLBACK: "1" }
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("companies-house needs a Companies House API key in COMPANIES_HOUSE_API_KEY");
  }, 30_000);
});
