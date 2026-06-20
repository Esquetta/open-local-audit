# Shortlist Reviewed-Before Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `shortlist --reviewed-before <YYYY-MM-DD>` and release it as `open-local-audit` v0.39.0.

**Architecture:** Extend the existing shortlist option object and flat eligibility predicate. `src/shortlist.ts` owns strict threshold validation and lead timestamp comparison so module and CLI callers receive identical behavior; Commander only exposes and forwards the option.

**Tech Stack:** TypeScript, Commander, Vitest, npm, GitHub Actions, GitHub CLI.

---

## File Structure

- Modify `src/shortlist.ts`: define the option, strict date parsers, validation, and filtering.
- Modify `src/cli.ts`: expose and forward `--reviewed-before`.
- Modify `tests/shortlist.test.ts`: cover threshold validation and core filtering semantics.
- Modify `tests/cli-behavior.test.ts`: cover successful JSON output and CLI error behavior.
- Modify `README.md`: document usage, comparison rules, and local-only behavior.
- Modify `CHANGELOG.md`: add v0.39.0.
- Modify `docs/mvp-roadmap.md`: add Milestone 35.
- Modify `docs/release/release-readiness.md`: add readiness checks and update the release recommendation.
- Create `docs/release/v0.39.0.md`: add GitHub Release notes.
- Modify `package.json` and `package-lock.json`: set version 0.39.0.

### Task 1: Add Failing Core Tests

**Files:**
- Modify: `tests/shortlist.test.ts`

- [ ] **Step 1: Add the reviewed-before filtering test**

Add near the existing unreviewed test:

```ts
it("filters leads reviewed before a date after suppression", () => {
  const result = buildLeadShortlist(
    [
      "companyName,website,priority,score,opportunityScore,topFinding,contactConfidence,lastReviewedAt,leadKey",
      "Older Lead,https://older.test,high,80,96,Missing CTA,High,2026-06-18,older-lead",
      "Older Timestamp Lead,https://timestamp.test,high,80,94,Missing CTA,High,2026-06-18T23:59:59.000Z,timestamp-lead",
      "Equal Lead,https://equal.test,high,80,92,Missing CTA,High,2026-06-19,equal-lead",
      "Newer Lead,https://newer.test,high,80,90,Missing CTA,High,2026-06-20,newer-lead",
      "Blank Lead,https://blank.test,high,80,88,Missing CTA,High,,blank-lead",
      "Invalid Lead,https://invalid.test,high,80,86,Missing CTA,High,not-a-date,invalid-lead",
      "Suppressed Older Lead,https://suppressed.test,high,80,99,Missing CTA,High,2026-06-17,suppressed-lead"
    ].join("\n"),
    {
      reviewedBefore: "2026-06-19",
      reviewRows: readShortlistReviewCsv(
        "leadKey,reviewStatus,reviewReason,lastReviewedAt\nsuppressed-lead,contacted,Already contacted,2026-06-17\n"
      )
    }
  );

  expect(result.suppressedRows).toBe(1);
  expect(result.filteredRows).toBe(4);
  expect(result.leads.map((lead) => lead.companyName)).toEqual([
    "Older Lead",
    "Older Timestamp Lead"
  ]);
});
```

- [ ] **Step 2: Add strict threshold validation cases**

```ts
it.each(["2026/06/19", "2026-6-19", "2026-02-30", "not-a-date"])(
  "rejects invalid reviewed-before threshold %s",
  (reviewedBefore) => {
    expect(() =>
      buildLeadShortlist(
        "companyName,website,priority,score,opportunityScore,topFinding,contactConfidence\nLead,https://lead.test,high,80,90,Missing CTA,High\n",
        { reviewedBefore }
      )
    ).toThrow("shortlist --reviewed-before must be a valid date in YYYY-MM-DD format");
  }
);
```

- [ ] **Step 3: Add the `--unreviewed` interaction test**

```ts
it("combines reviewed-before and unreviewed with AND semantics", () => {
  const result = buildLeadShortlist(
    [
      "companyName,website,priority,score,opportunityScore,topFinding,contactConfidence,lastReviewedAt",
      "Reviewed Lead,https://reviewed.test,high,80,92,Missing CTA,High,2026-06-18",
      "Unreviewed Lead,https://unreviewed.test,high,80,90,Missing CTA,High,"
    ].join("\n"),
    { reviewedBefore: "2026-06-19", unreviewed: true }
  );

  expect(result.filteredRows).toBe(2);
  expect(result.leads).toEqual([]);
});
```

- [ ] **Step 4: Run the core tests and verify RED**

Run:

```powershell
npx vitest run tests/shortlist.test.ts
```

Expected: TypeScript or assertion failures because `ShortlistOptions.reviewedBefore` and its behavior do not exist.

### Task 2: Implement Strict Core Date Filtering

**Files:**
- Modify: `src/shortlist.ts`
- Test: `tests/shortlist.test.ts`

- [ ] **Step 1: Add the option**

Add to `ShortlistOptions`:

```ts
reviewedBefore?: string;
```

- [ ] **Step 2: Add strict date parsing helpers**

Add near the existing date-sort helper:

```ts
const dateOnlyPattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const isoTimestampPattern = /^(\d{4})-(\d{2})-(\d{2})T/;

function parseCalendarDate(value: string): number | undefined {
  const match = dateOnlyPattern.exec(value);
  if (!match) {
    return undefined;
  }

  const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : undefined;
}

function parseReviewTimestamp(value: string): number | undefined {
  const dateOnly = parseCalendarDate(value);
  if (dateOnly !== undefined) {
    return dateOnly;
  }

  const timestampMatch = isoTimestampPattern.exec(value);
  if (!timestampMatch) {
    return undefined;
  }

  const datePrefix = `${timestampMatch[1]}-${timestampMatch[2]}-${timestampMatch[3]}`;
  if (parseCalendarDate(datePrefix) === undefined) {
    return undefined;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function reviewedBeforeThreshold(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const timestamp = parseCalendarDate(value);
  if (timestamp === undefined) {
    throw new Error("shortlist --reviewed-before must be a valid date in YYYY-MM-DD format");
  }

  return timestamp;
}
```

- [ ] **Step 3: Validate once and apply the predicate**

In `buildLeadShortlist`, after opportunity-score validation:

```ts
const reviewedBefore = reviewedBeforeThreshold(options.reviewedBefore);
```

In the existing eligibility predicate after review-status filters:

```ts
(reviewedBefore === undefined ||
  (parseReviewTimestamp(lead.lastReviewedAt) ?? Number.POSITIVE_INFINITY) < reviewedBefore) &&
```

Keep the existing `unreviewed` predicate after this condition so both options naturally use `AND` semantics.

- [ ] **Step 4: Run the core tests and verify GREEN**

```powershell
npx vitest run tests/shortlist.test.ts
```

Expected: all shortlist module tests pass.

### Task 3: Add CLI Tests and Wiring

**Files:**
- Modify: `tests/cli-behavior.test.ts`
- Modify: `src/cli.ts`
- Test: `tests/shortlist.test.ts`

- [ ] **Step 1: Add the successful CLI test before production wiring**

```ts
it("filters a lead shortlist to rows reviewed before a date", () => {
  const tmp = mkdtempSync(join(tmpdir(), "open-local-audit-cli-shortlist-reviewed-before-"));
  try {
    const inputPath = join(tmp, "leads.csv");
    const outPath = join(tmp, "shortlist.json");
    writeFileSync(
      inputPath,
      [
        "companyName,website,priority,score,opportunityScore,topFinding,contactConfidence,lastReviewedAt",
        "Older Lead,https://older.test,high,80,92,Missing CTA,High,2026-06-18",
        "Equal Lead,https://equal.test,high,80,90,Missing CTA,High,2026-06-19",
        "Blank Lead,https://blank.test,high,80,88,Missing CTA,High,"
      ].join("\n"),
      "utf8"
    );

    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/cli.ts",
        "shortlist",
        "--input",
        inputPath,
        "--out",
        outPath,
        "--format",
        "json",
        "--reviewed-before",
        "2026-06-19"
      ],
      { cwd: process.cwd(), encoding: "utf8" }
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Shortlisted 1 of 3 leads");
    expect(result.stdout).toContain("Filtered: 2");
    expect(JSON.parse(readFileSync(outPath, "utf8"))).toMatchObject({
      filteredRows: 2,
      selected: 1,
      leads: [{ companyName: "Older Lead", lastReviewedAt: "2026-06-18" }]
    });
  } finally {
    removeTempDir(tmp);
  }
});
```

- [ ] **Step 2: Add the invalid CLI threshold test**

```ts
it("rejects invalid reviewed-before dates", () => {
  const tmp = mkdtempSync(join(tmpdir(), "open-local-audit-cli-shortlist-reviewed-before-invalid-"));
  try {
    const inputPath = join(tmp, "leads.csv");
    writeFileSync(
      inputPath,
      "companyName,website,priority,score,opportunityScore,topFinding,contactConfidence\nLead,https://lead.test,high,80,90,Missing CTA,High\n",
      "utf8"
    );

    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/cli.ts",
        "shortlist",
        "--input",
        inputPath,
        "--out",
        join(tmp, "shortlist.json"),
        "--reviewed-before",
        "2026-02-30"
      ],
      { cwd: process.cwd(), encoding: "utf8" }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "shortlist --reviewed-before must be a valid date in YYYY-MM-DD format"
    );
  } finally {
    removeTempDir(tmp);
  }
});
```

- [ ] **Step 3: Run CLI tests and verify RED**

```powershell
npx vitest run tests/cli-behavior.test.ts -t "reviewed-before"
```

Expected: CLI exits with an unknown-option error because Commander does not expose the flag.

- [ ] **Step 4: Wire the CLI option**

Add to the shortlist command:

```ts
.option("--reviewed-before <date>", "include only leads reviewed before a YYYY-MM-DD date")
```

Add to the typed Commander options:

```ts
reviewedBefore?: string;
```

Pass to `buildLeadShortlist`:

```ts
reviewedBefore: options.reviewedBefore,
```

- [ ] **Step 5: Run targeted tests and verify GREEN**

```powershell
npx vitest run tests/shortlist.test.ts tests/cli-behavior.test.ts
```

Expected: both test files pass.

- [ ] **Step 6: Inspect and commit the feature**

```powershell
git diff --check
git diff -- src\shortlist.ts src\cli.ts tests\shortlist.test.ts tests\cli-behavior.test.ts
git add src\shortlist.ts src\cli.ts tests\shortlist.test.ts tests\cli-behavior.test.ts
git commit -m "feat: add shortlist reviewed-before filter"
```

### Task 4: Prepare v0.39.0 Documentation and Metadata

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/mvp-roadmap.md`
- Modify: `docs/release/release-readiness.md`
- Create: `docs/release/v0.39.0.md`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Update README**

Add:

```bash
open-local-audit shortlist --input leads.csv --reviewed-before 2026-06-20 --out shortlist.json --format json
```

Document strict `YYYY-MM-DD` validation, strictly-earlier comparison, exclusion of blank/invalid row dates, AND semantics, and local-only behavior. Add corresponding feature and known-limit bullets.

- [ ] **Step 2: Add changelog entry**

```markdown
## v0.39.0 - 2026-06-20

- Added `shortlist --reviewed-before <date>` for local re-review shortlist queues.
- Added strict `YYYY-MM-DD` threshold validation and strictly-earlier review-date filtering.
- Kept reviewed-before filtering local-only with no source CSV mutation, review CSV mutation, API calls, outreach sending, or CRM sync.
```

- [ ] **Step 3: Add Milestone 35**

```markdown
## Milestone 35: Shortlist reviewed-before filter

Target release:
- `v0.39.0`.

Deliverables:
- `--reviewed-before <date>` for local shortlist output.
- Strict `YYYY-MM-DD` threshold validation and filtering of valid review dates strictly before the threshold.
- Clear docs that reviewed-before filtering affects local report output only.

Exit criteria:
- Module tests cover threshold validation, comparison boundaries, malformed row dates, suppression, and filter interactions.
- CLI tests cover JSON output and invalid threshold errors.
- Existing filters, sort modes, summary JSON, report formats, and top-N behavior remain compatible.
```

- [ ] **Step 4: Add readiness and release notes**

Add a checked `Shortlist reviewed-before filtering readiness` section, update the current recommendation to `v0.39.0`, and add the capability to the verified list.

Create `docs/release/v0.39.0.md` with release date `2026-06-20`, summary, changes, example, verification commands, and known limits matching the design.

- [ ] **Step 5: Bump package version**

```powershell
npm version 0.39.0 --no-git-tag-version
```

- [ ] **Step 6: Commit release prep**

```powershell
git add CHANGELOG.md README.md docs\mvp-roadmap.md docs\release\release-readiness.md docs\release\v0.39.0.md package.json package-lock.json
git commit -m "chore: prepare v0.39.0 release"
```

### Task 5: Verify, Merge, and Release

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run release gate**

```powershell
npm run release-check
```

Expected: lint, all tests, build, audit, and dry-run packaging pass.

- [ ] **Step 2: Smoke-test the real tarball**

```powershell
npm pack
npx --yes --package .\open-local-audit-0.39.0.tgz open-local-audit shortlist --help
Remove-Item -LiteralPath .\open-local-audit-0.39.0.tgz
```

Expected: help output contains `--reviewed-before <date>`.

- [ ] **Step 3: Push branch and create PR**

```powershell
git push -u origin feature/shortlist-reviewed-before
gh pr create --base master --head feature/shortlist-reviewed-before --title "Add shortlist reviewed-before filter"
```

- [ ] **Step 4: Wait for checks and merge**

```powershell
gh pr checks --watch
gh pr merge --merge --delete-branch
```

Expected: CI and security checks pass before merge.

- [ ] **Step 5: Verify merged master**

```powershell
git fetch origin
git merge --ff-only origin/master
npm install
npm run release-check
```

- [ ] **Step 6: Create GitHub Release and publish npm**

```powershell
gh release create v0.39.0 --target master --title "v0.39.0" --notes-file docs\release\v0.39.0.md
npm publish --access public
```

- [ ] **Step 7: Verify published state**

```powershell
gh release view v0.39.0 --json tagName,name,isDraft,isPrerelease,url,targetCommitish,publishedAt
npm view open-local-audit version dist-tags --json
npx --yes open-local-audit@0.39.0 shortlist --help
git status --short --branch
```

Expected: GitHub Release is public, npm latest is 0.39.0, published help contains `--reviewed-before`, and master is clean.
