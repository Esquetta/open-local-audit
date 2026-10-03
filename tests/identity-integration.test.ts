import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { auditSnapshot } from "../src/audit.js";
import { runBatchReports } from "../src/batch.js";
import { buildProspectRows, type PlaceCandidate, type ProspectRowInput } from "../src/discovery.js";
import { runDiscovery } from "../src/discovery-runner.js";
import * as overture from "../src/overture.js";
import * as enrichment from "../src/website-enrichment.js";

afterEach(() => vi.restoreAllMocks());

describe("business identity integration", () => {
  it("requires manual review when another fetched page identifies a different business", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ola-mixed-identity-"));
    try {
      const url = "https://shared.test/";
      vi.spyOn(overture, "fetchOvertureCandidates").mockResolvedValue([{ source: "overture", sourceId: "a", label: "Pacific Smiles", websiteUri: url, sourceMetadata: { country: "US", phones: ["+12133734253"] } }]);
      vi.spyOn(enrichment, "enrichWebsite").mockResolvedValue({ status: "success", pagesFetched: 2, durationMs: 1, sourceUrls: [url, `${url}contact`], snapshot: { url, finalUrl: url, statusCode: 200, headers: {}, html: "<title>Pacific Smiles</title>" }, contact: { publicEmail: "other@shared.test", publicPhone: "+442079460000", socialProfiles: [], contactConfidence: "High" }, businessIdentities: [
        { pageUrl: url, kind: "structured", name: "Pacific Smiles", phones: ["+12133734253"] },
        { pageUrl: `${url}contact`, kind: "structured", name: "London Hardware", phones: ["+442079460000"] }
      ] });
      const result = await runDiscovery({ provider: "overture", query: "dental", bbox: "-118.3,34,-118.2,34.1", profile: "dental", outDir: dir, exportCsv: join(dir, "leads.csv"), dryRun: false, maxAudits: 1, concurrency: 1 });
      expect(result.rows[0]).toMatchObject({ identityStatus: "uncertain", contactConfidence: "Low", preferredContactChannel: "manual-review" });
      expect(result.rows[0].identityEvidence?.some((item) => item.state === "different" && item.pageUrl?.endsWith("/contact"))).toBe(true);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("does not promote conflicting site contacts or opportunity scores", () => {
    const input = {
      candidate: { source: "overture", sourceId: "a", label: "Pacific Smiles", sourceMetadata: { emails: ["source@sample.test"], phones: ["+12133734253"] } },
      resolution: { status: "resolved", hasWebsite: true, websiteUrl: "https://other.test/" },
      audit: { status: "success", score: 5, topFinding: "Broken site", reportPath: "wrong/report.html", contact: { publicEmail: "wrong@other.test", publicPhone: "+442079460000", socialProfiles: [], contactConfidence: "High" }, identity: { status: "conflict", reasons: ["Business name and phone differ"], evidence: [] } }
    } as ProspectRowInput;
    const row = buildProspectRows([input])[0];
    expect(row).toMatchObject({ identityStatus: "conflict", publicEmail: "source@sample.test", publicPhone: "+12133734253", hasWebsite: "unknown", opportunityScore: 0, estimatedNeed: "Unknown", auditStatus: "failed", preferredContactChannel: "manual-review" });
    expect(row.score).toBeUndefined();
    expect(row.reportPath).toBeUndefined();
    expect(row.topFinding).toBeUndefined();
    expect(input.audit?.score).toBe(5);
  });

  it("routes uncertain website identity contacts to manual review without changing unselected status", () => {
    const [uncertain, failedFetch, unselected] = buildProspectRows([
      {
        candidate: { source: "overture", sourceId: "uncertain", sourceMetadata: {} },
        resolution: { status: "resolved", hasWebsite: true, websiteUrl: "https://sample.test/" },
        audit: { status: "success", contact: { publicEmail: "site@sample.test", socialProfiles: [], contactConfidence: "High" }, identity: { status: "uncertain", reasons: ["Only a shared brand phone was found"], evidence: [] } }
      },
      {
        candidate: { source: "overture", sourceId: "failed", sourceMetadata: {} },
        resolution: { status: "resolved", hasWebsite: true, websiteUrl: "https://failed.test/" },
        audit: { status: "failed", error: "website timed out", identity: { status: "uncertain", reasons: ["No website business identity evidence was found."], evidence: [] } }
      },
      {
        candidate: { source: "overture", sourceId: "unselected", sourceMetadata: {} },
        resolution: { status: "resolved", hasWebsite: true, websiteUrl: "https://later.test/" }
      }
    ] as ProspectRowInput[]);

    expect(uncertain).toMatchObject({ identityStatus: "uncertain", contactConfidence: "Low", preferredContactChannel: "manual-review" });
    expect(failedFetch.identityStatus).toBe("uncertain");
    expect(unselected.identityStatus).toBe("not-checked");
  });

  it("preserves each source identity when businesses share a URL", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ola-batch-source-"));
    try {
      const seen: string[] = [];
      await runBatchReports([{ url: "https://shared.test/", sourceId: "a" }, { url: "https://shared.test/", sourceId: "b" }], {
        format: "json", outDir: dir, concurrency: 2,
        audit: async (url, context) => { seen.push(context.sourceId ?? "missing"); return auditSnapshot({ url, finalUrl: url, statusCode: 200, headers: {}, html: "<title>Shared</title>" }); }
      });
      expect(seen.sort()).toEqual(["a", "b"]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("exports conflict evidence without attributing the other site to the candidate", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ola-identity-conflict-"));
    try {
      vi.spyOn(overture, "fetchOvertureCandidates").mockResolvedValue([{ source: "overture", sourceId: "a", label: "Pacific Smiles", websiteUri: "https://other.test/", sourceMetadata: { country: "US", locality: "Los Angeles", address: "10 Sunset Boulevard", phones: ["+12133734253"], emails: ["source@sample.test"] } }]);
      vi.spyOn(enrichment, "enrichWebsite").mockResolvedValue({ status: "success", pagesFetched: 1, durationMs: 1, sourceUrls: ["https://other.test/"], snapshot: { url: "https://other.test/", finalUrl: "https://other.test/", statusCode: 200, headers: {}, html: "<title>London Hardware</title>" }, contact: { publicEmail: "wrong@other.test", socialProfiles: [], contactConfidence: "High" }, businessIdentities: [{ pageUrl: "https://other.test/", kind: "structured", name: "London Hardware", phones: ["+442079460000"], address: { street: "99 Baker Street", locality: "London", country: "GB" } }] });
      const result = await runDiscovery({ provider: "overture", query: "dental", bbox: "-118.3,34,-118.2,34.1", profile: "dental", outDir: join(dir, "reports"), exportCsv: join(dir, "leads.csv"), dryRun: false, maxAudits: 1, concurrency: 1 });
      expect(result.rows[0]).toMatchObject({ identityStatus: "conflict", auditStatus: "failed", publicEmail: "source@sample.test", opportunityScore: 0 });
      expect(result.rows[0].identityEvidence?.length).toBeGreaterThan(0);
      expect(await readFile(join(dir, "leads.csv"), "utf8")).not.toContain("wrong@other.test");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("keeps same-URL branch identity evidence scoped to each candidate", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ola-identity-branches-"));
    try {
      const candidates: PlaceCandidate[] = [
        { source: "overture", sourceId: "downtown", label: "Mavi Dental Clinic", websiteUri: "https://mavi.test/", sourceMetadata: { country: "TR", locality: "Istanbul", address: "Ataturk Cad. 12", phones: ["0212 555 00 00"] } },
        { source: "overture", sourceId: "branch", label: "Mavi Dental Clinic", websiteUri: "https://mavi.test/", sourceMetadata: { country: "TR", locality: "Istanbul", address: "Bagdat Cad. 88", phones: ["0212 555 00 00"] } }
      ];
      vi.spyOn(overture, "fetchOvertureCandidates").mockResolvedValue(candidates);
      vi.spyOn(enrichment, "enrichWebsite").mockImplementation(async (url) => ({
        status: "success", pagesFetched: 1, durationMs: 1, sourceUrls: [url],
        snapshot: { url, finalUrl: url, statusCode: 200, headers: {}, html: "<title>Mavi Dental Clinic</title>" },
        businessIdentities: [{ pageUrl: url, kind: "structured", name: "Mavi Dental Clinic", phones: ["0212 555 00 00"], address: { street: "Ataturk Cad. 12", locality: "Istanbul", country: "TR" } }]
      }));

      const result = await runDiscovery({ provider: "overture", query: "dental", bbox: "28.9,41,29,41.1", profile: "dental", outDir: dir, exportCsv: join(dir, "leads.csv"), dryRun: false, maxAudits: 2, concurrency: 2 });

      expect(Object.fromEntries(result.rows.map((row) => [row.sourceId, row.identityStatus]))).toEqual({
        branch: "uncertain",
        downtown: "matched"
      });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("spends the selected audit budget on missing contacts while preserving output order", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ola-audit-priority-"));
    try {
      const candidates: PlaceCandidate[] = [
        { source: "overture", sourceId: "a", websiteUri: "https://a.test/", sourceMetadata: { emails: ["a@a.test"], phones: ["+12133734253"] } },
        { source: "overture", sourceId: "b", websiteUri: "https://b.test/", sourceMetadata: { phones: ["+12133734253"] } },
        { source: "overture", sourceId: "c", websiteUri: "https://c.test/", sourceMetadata: {} }
      ];
      vi.spyOn(overture, "fetchOvertureCandidates").mockResolvedValue(candidates);
      const enrich = vi.spyOn(enrichment, "enrichWebsite").mockImplementation(async (url) => ({ status: "success", pagesFetched: 1, durationMs: 1, sourceUrls: [url], businessIdentities: [], snapshot: { url, finalUrl: url, statusCode: 200, headers: {}, html: "<title>Sample</title>" } }));
      const result = await runDiscovery({ provider: "overture", query: "dental", bbox: "-118.3,34,-118.2,34.1", profile: "dental", outDir: dir, exportCsv: join(dir, "leads.csv"), dryRun: false, maxAudits: 1, concurrency: 1, auditPriority: "missing-contact" });
      expect(enrich).toHaveBeenCalledOnce();
      expect(enrich).toHaveBeenCalledWith("https://c.test/");
      expect(result.rows.map((row) => row.sourceId)).toEqual(["a", "b", "c"]);
      expect(result.rows.map((row) => row.auditSelected)).toEqual([false, false, true]);
      expect(result.rows[2].auditSelectionReason).toMatch(/email|phone/i);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
