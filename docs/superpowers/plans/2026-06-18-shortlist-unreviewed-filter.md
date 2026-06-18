# Shortlist Unreviewed Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `shortlist --unreviewed` and release it as `open-local-audit` v0.38.0.

**Architecture:** Extend the existing shortlist option object and eligibility predicate without adding a new abstraction. Commander exposes the boolean flag and passes it to `buildLeadShortlist`; the existing normalized `lastReviewedAt` value determines whether a lead is unreviewed after review suppression and before sorting and top-N selection.

**Tech Stack:** TypeScript, Commander, Vitest, npm, GitHub Actions, GitHub CLI.

---

## File Structure

- Modify `src/shortlist.ts`: define and apply the `unreviewed` shortlist option.
- Modify `src/cli.ts`: expose `--unreviewed` and pass it to shortlist construction.
- Modify `tests/shortlist.test.ts`: verify suppression order, whitespace normalization, and filtered counts.
- Modify `tests/cli-behavior.test.ts`: verify the public CLI flag and JSON output.
- Modify `README.md`: document usage, behavior, feature inventory, and local-only boundary.
- Modify `CHANGELOG.md`: add the v0.38.0 release entry.
- Modify `docs/mvp-roadmap.md`: add Milestone 34.
- Modify `docs/release/release-readiness.md`: add release readiness checks and update the recommendation.
- Create `docs/release/v0.38.0.md`: provide GitHub Release notes.
- Modify `package.json` and `package-lock.json`: set version 0.38.0.

### Task 1: Add Failing Core and CLI Tests

**Files:**
- Modify: `tests/shortlist.test.ts`
- Modify: `tests/cli-behavior.test.ts`

- [ ] **Step 1: Add the core failing test after the existing review-status exclusion tests**

```ts
it("filters leads without a review date after suppression", () => {
  const result = buildLeadShortlist(
    [
      "companyName,website,priority,score,opportunityScore,topFinding,contactConfidence,lastReviewedAt,leadKey",
      "Reviewed Lead,https://reviewed.test,high,80,92,Missing CTA,High,2026-06-17,reviewed-lead",
      "Unreviewed Lead,https://unreviewed.test,high,80,90,Missing CTA,High,,unreviewed-lead",
      "Whitespace Review Lead,https://whitespace.test,high,80,88,Missing CTA,High,   ,whitespace-lead",
      "Suppressed Unreviewed Lead,https://suppressed.test,high,80,95,Missing CTA,High,,suppressed-lead"
    ].join("\n"),
    {
      unreviewed: true,
      reviewRows: readShortlistReviewCsv(
        "leadKey,reviewStatus,reviewReason,lastReviewedAt\nsuppressed-lead,contacted,Already contacted,\n"
      )
    }
  );

  expect(result.suppressedRows).toBe(1);
  expect(result.filteredRows).toBe(1);
  expect(result.leads.map((lead) => lead.companyName)).toEqual([
    "Unreviewed Lead",
    "Whitespace Review Lead"
  ]);
});
```

- [ ] **Step 2: Add the CLI failing test near the other shortlist review filters**

```ts
it("filters a lead shortlist to unreviewed rows", () => {
  const tmp = mkdtempSync(join(tmpdir(), "open-local-audit-cli-shortlist-unreviewed-"));
  try {
    const inputPath = join(tmp, "leads.csv");
    const outPath = join(tmp, "shortlist.json");
    writeFileSync(
      inputPath,
      [
        "companyName,website,priority,score,opportunityScore,topFinding,contactConfidence,lastReviewedAt",
        "Reviewed Lead,https://reviewed.test,high,80,92,Missing CTA,High,2026-06-17",
        "Unreviewed Lead,https://unreviewed.test,high,80,90,Missing CTA,High,"
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
        "--unreviewed"
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8"
      }
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Shortlisted 1 of 2 leads");
    expect(result.stdout).toContain("Filtered: 1");
    expect(JSON.parse(readFileSync(outPath, "utf8"))).toMatchObject({
      filteredRows: 1,
      selected: 1,
      leads: [{ companyName: "Unreviewed Lead", lastReviewedAt: "" }]
    });
  } finally {
    removeTempDir(tmp);
  }
});
```

- [ ] **Step 3: Run targeted tests and verify RED**

Run:

```powershell
npx vitest run tests/shortlist.test.ts tests/cli-behavior.test.ts
```

Expected: two failures because `ShortlistOptions` does not apply `unreviewed` and Commander does not recognize `--unreviewed`.

### Task 2: Implement the Minimal Unreviewed Filter

**Files:**
- Modify: `src/shortlist.ts`
- Modify: `src/cli.ts`
- Test: `tests/shortlist.test.ts`
- Test: `tests/cli-behavior.test.ts`

- [ ] **Step 1: Add the option and eligibility condition in `src/shortlist.ts`**

Add to `ShortlistOptions`:

```ts
unreviewed?: boolean;
```

Add to the existing eligibility predicate after review-status filters:

```ts
(!options.unreviewed || lead.lastReviewedAt === "") &&
```

- [ ] **Step 2: Add and pass the Commander option in `src/cli.ts`**

Add to the shortlist command:

```ts
.option("--unreviewed", "include only leads without a review date")
```

Add to the typed Commander options:

```ts
unreviewed?: boolean;
```

Pass to `buildLeadShortlist`:

```ts
unreviewed: options.unreviewed,
```

- [ ] **Step 3: Run targeted tests and verify GREEN**

Run:

```powershell
npx vitest run tests/shortlist.test.ts tests/cli-behavior.test.ts
```

Expected: both test files pass.

- [ ] **Step 4: Check the feature diff**

Run:

```powershell
git diff --check
git diff -- src\shortlist.ts src\cli.ts tests\shortlist.test.ts tests\cli-behavior.test.ts
```

Expected: no whitespace errors and only the option, predicate, CLI wiring, and two tests.

- [ ] **Step 5: Commit the feature**

```powershell
git add src\shortlist.ts src\cli.ts tests\shortlist.test.ts tests\cli-behavior.test.ts
git commit -m "feat: add shortlist unreviewed filter"
```

### Task 3: Prepare v0.38.0 Documentation and Package Metadata

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/mvp-roadmap.md`
- Modify: `docs/release/release-readiness.md`
- Create: `docs/release/v0.38.0.md`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Document the CLI behavior in `README.md`**

Add the example:

```bash
open-local-audit shortlist --input leads.csv --unreviewed --out shortlist.json --format json
```

State that `--unreviewed` keeps rows whose normalized `lastReviewedAt` is empty, works with other filters using `AND` semantics, and affects local report output only.

- [ ] **Step 2: Add the changelog entry**

```markdown
## v0.38.0 - 2026-06-18

- Added `shortlist --unreviewed` for local first-review shortlist queues.
- Applied unreviewed filtering after review suppression and before sorting and top-N selection.
- Kept unreviewed filtering local-only with no source CSV mutation, review CSV mutation, API calls, outreach sending, or CRM sync.
```

- [ ] **Step 3: Add Milestone 34 to `docs/mvp-roadmap.md`**

```markdown
## Milestone 34: Shortlist unreviewed filter

Target release:
- `v0.38.0`.

Deliverables:
- `--unreviewed` for local shortlist output.
- Filtering of rows with empty `lastReviewedAt` values after review suppression and before sorting and top-N selection.
- Clear docs that unreviewed filtering affects local report output only.

Exit criteria:
- Module tests cover unreviewed filtering after suppression and whitespace normalization.
- CLI tests cover filtered counts with JSON output.
- Existing filters, sort modes, summary JSON, report formats, and top-N behavior remain compatible.
```

- [ ] **Step 4: Add release readiness and release notes**

Add a checked `Shortlist unreviewed filtering readiness` section to `docs/release/release-readiness.md`, update the current recommendation to `v0.38.0`, and add unreviewed filtering to the verified capabilities list.

Create `docs/release/v0.38.0.md`:

```markdown
# Open Local Audit v0.38.0

Release date: 2026-06-18

## Summary

`v0.38.0` adds unreviewed filtering to local shortlist reports. Operators can build a first-review queue from active leads whose `lastReviewedAt` value is empty while preserving review suppression, filters, sorting, summary JSON, and report formats.

## Changes

- Added `shortlist --unreviewed`.
- Filtered rows without a review date after review-state suppression and before sorting and top-N selection.
- Kept Markdown, JSON, CSV, and summary JSON output on the same filtered result set.

## Example

```bash
open-local-audit shortlist --input leads.csv --unreviewed --out shortlist.json --format json
```

## Verification

```bash
npm run release-check
npm pack
npx --yes --package ./open-local-audit-0.38.0.tgz open-local-audit shortlist --help
```

## Known limits

- Unreviewed filtering checks only whether `lastReviewedAt` is empty; it does not parse dates or apply an age threshold.
- Filtering does not mutate source files, mutate review CSV files, call APIs, send outreach, or sync CRM records.
```

- [ ] **Step 5: Bump the package version**

Run:

```powershell
npm version 0.38.0 --no-git-tag-version
```

Expected: `package.json` and `package-lock.json` both report version `0.38.0`.

- [ ] **Step 6: Commit release preparation**

```powershell
git add CHANGELOG.md README.md docs\mvp-roadmap.md docs\release\release-readiness.md docs\release\v0.38.0.md package.json package-lock.json
git commit -m "chore: prepare v0.38.0 release"
```

### Task 4: Verify the Release Candidate

**Files:**
- Verify all modified files.

- [ ] **Step 1: Run the release gate**

```powershell
npm run release-check
```

Expected: TypeScript lint passes, all Vitest tests pass, build succeeds, `npm audit` reports zero vulnerabilities, and dry-run packaging succeeds.

- [ ] **Step 2: Pack and smoke-test the actual tarball**

```powershell
npm pack
npx --yes --package .\open-local-audit-0.38.0.tgz open-local-audit shortlist --help
```

Expected: help output contains `--unreviewed`.

- [ ] **Step 3: Remove the temporary tarball and verify repository cleanliness**

```powershell
Remove-Item -LiteralPath .\open-local-audit-0.38.0.tgz
git status --short --branch
```

Expected: no uncommitted files and `master` is ahead of `origin/master` only by the intended commits.

### Task 5: Push, Release, Publish, and Verify

**Files:**
- No file changes expected.

- [ ] **Step 1: Push the commits**

```powershell
git push origin master
```

Expected: the design, feature, and release-prep commits reach `origin/master`.

- [ ] **Step 2: Wait for CI on the pushed head**

```powershell
$head = git rev-parse HEAD
$run = gh run list --branch master --limit 10 --json databaseId,headSha,status,workflowName,url |
  ConvertFrom-Json |
  Where-Object { $_.headSha -eq $head -and $_.workflowName -eq "CI" } |
  Select-Object -First 1
gh run watch $run.databaseId --exit-status
```

Expected: the CI test job completes successfully.

- [ ] **Step 3: Create the GitHub Release**

```powershell
gh release create v0.38.0 --target master --title "v0.38.0" --notes-file docs\release\v0.38.0.md
```

Expected: GitHub returns the public v0.38.0 release URL.

- [ ] **Step 4: Publish to npm**

```powershell
npm publish --access public
```

Expected: npm reports `+ open-local-audit@0.38.0`. If browser authentication pauses, press Enter and complete the npm browser flow.

- [ ] **Step 5: Verify GitHub, npm, the published CLI, and the working tree**

```powershell
gh release view v0.38.0 --json tagName,name,isDraft,isPrerelease,url,targetCommitish,publishedAt
npm view open-local-audit version dist-tags --json
npx --yes open-local-audit@0.38.0 shortlist --help
git status --short --branch
```

Expected:

- GitHub Release is public, non-draft, and non-prerelease.
- npm `version` and `dist-tags.latest` are `0.38.0`.
- Published CLI help contains `--unreviewed`.
- Working tree is clean and `master` matches `origin/master`.
