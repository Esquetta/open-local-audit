# Public Documentation Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the tracked `docs/` tree to four public-facing documents and update repository links and security guidance.

**Architecture:** This is a documentation-only repository cleanup. Preserve useful operational content by moving two documents to `docs/` root, remove internal or duplicated documentation from the current tree, then update retained public documents and root entry points without changing Git history, CLI behavior, or package versions.

**Tech Stack:** Markdown, Git, PowerShell, npm verification commands.

---

## Final File Structure

The tracked `docs/` tree must contain exactly:

```text
docs/
  audit-checklist.md
  google-maps-api-key.md
  security-and-ethics.md
  technical-architecture.md
```

Root public governance documents remain:

```text
README.md
CONTRIBUTING.md
SECURITY.md
CODE_OF_CONDUCT.md
LICENSE
CHANGELOG.md
```

### Task 1: Relocate Public Documents and Remove Internal Material

**Files:**
- Move: `docs/research/audit-checklist.md` to `docs/audit-checklist.md`
- Move: `docs/operations/google-maps-api-key.md` to `docs/google-maps-api-key.md`
- Delete: `docs/superpowers/`
- Delete: `docs/release/`
- Delete: `docs/operations/decision-log.md`
- Delete: `docs/operations/project-standard.md`
- Delete: `docs/go-to-market.md`
- Delete: `docs/mvp-roadmap.md`
- Delete: `docs/product-brief.md`

- [ ] **Step 1: Verify source paths and target boundary**

Run:

```powershell
$root = (Resolve-Path .).Path
$docs = (Resolve-Path .\docs).Path
if (-not $docs.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "docs path is outside the repository"
}
git status --short --branch
git ls-files docs
```

Expected: clean worktree and all source documents are tracked.

- [ ] **Step 2: Move the retained operational documents**

Run:

```powershell
git mv docs\research\audit-checklist.md docs\audit-checklist.md
git mv docs\operations\google-maps-api-key.md docs\google-maps-api-key.md
```

- [ ] **Step 3: Remove internal, obsolete, and duplicated documents**

Use `git rm` with the explicit tracked paths:

```powershell
git rm -r docs\superpowers
git rm -r docs\release
git rm docs\operations\decision-log.md
git rm docs\operations\project-standard.md
git rm docs\go-to-market.md
git rm docs\mvp-roadmap.md
git rm docs\product-brief.md
```

The now-empty `docs/operations/` and `docs/research/` directories disappear automatically.

- [ ] **Step 4: Verify the staged public tree**

Run:

```powershell
git diff --cached --name-status
git ls-files docs
```

Expected tracked `docs/` output:

```text
docs/audit-checklist.md
docs/google-maps-api-key.md
docs/security-and-ethics.md
docs/technical-architecture.md
```

- [ ] **Step 5: Commit the structural cleanup**

```powershell
git commit -m "docs: remove internal documentation"
```

### Task 2: Update Public Entry Points and Policies

**Files:**
- Modify: `README.md`
- Modify: `SECURITY.md`
- Modify: `docs/technical-architecture.md`
- Modify: `docs/security-and-ethics.md`
- Verify: `docs/audit-checklist.md`
- Verify: `docs/google-maps-api-key.md`

- [ ] **Step 1: Replace the README documentation index**

Replace the current documentation link list with:

```markdown
## Documentation

- [Technical architecture](./docs/technical-architecture.md)
- [Security and ethics](./docs/security-and-ethics.md)
- [Audit checklist](./docs/audit-checklist.md)
- [Google Maps API key setup](./docs/google-maps-api-key.md)
```

Update the later Google Maps setup link to:

```markdown
See [Google Maps API key setup](./docs/google-maps-api-key.md) for local environment setup.
```

Replace the `GitHub and npm release intent` section with:

```markdown
## Releases

Open Local Audit is published under the MIT license on GitHub and npm. Release history is available in [CHANGELOG.md](./CHANGELOG.md) and GitHub Releases. Every release runs lint, tests, build, audit, and package-content checks through GitHub Actions.
```

Remove the sentence that points release work to `docs/release/release-readiness.md`.

- [ ] **Step 2: Replace stale SECURITY.md content**

Set `SECURITY.md` to:

```markdown
# Security Policy

## Supported versions

Security fixes are provided for the latest published minor release of Open Local Audit.

## Reporting a vulnerability

Report vulnerabilities privately through [GitHub Security Advisories](https://github.com/Esquetta/open-local-audit/security/advisories/new).

Do not include vulnerability details, proof-of-concept payloads, secrets, or affected customer data in public issues.

Maintainers will acknowledge a valid report as soon as practical, investigate impact, and coordinate remediation and disclosure with the reporter.

## Security scope

Open Local Audit audits public websites and writes local reports. Most commands require no secrets or accounts. The optional Google Places provider reads `GOOGLE_MAPS_API_KEY` from the local environment and must not write it to reports, logs, examples, or repository files.

Features that store remote customer data, send messages, manage accounts, or sync external systems require a security review before release.
```

- [ ] **Step 3: Update technical architecture to current-state wording**

Apply these exact wording changes:

- Replace the goal paragraph with:

```markdown
Build a reliable, small, testable CLI that audits public local-business websites and outputs actionable reports. The released product is CLI-first, and the auditing and reporting modules are reusable across its commands.
```

- Replace “Initial command shape” with “Primary command shape.”
- Replace “Initial rule groups” with “Rule groups.”
- Replace “Needed for rendered DOM and screenshots later” with “Used for rendered DOM and screenshot evidence.”
- Replace “Implemented first slice” with “Manual discovery flow.”
- Replace “Implemented provider and control extensions” with “Google Places discovery flow.”
- Replace “summary JSON for release evidence” with “summary JSON for automation and review.”
- Replace “Out of scope for this slice” with “Out of scope.”
- Rename `## Non-goals for MVP` to `## Non-goals`.
- Remove the entire `## Future extension points` section and its bullets.

Do not add new architecture claims.

- [ ] **Step 4: Update security and ethics to current policy wording**

Apply these wording changes:

- Replace “Discovery providers should support” with “Discovery providers support.”
- Replace “The CLI should include” with “The CLI includes.”
- Replace “Reports can support manual outreach” with “Reports support manual outreach.”
- Replace “If future telemetry is added” with “Any telemetry must be.”
- Rewrite the telemetry bullets as:

```markdown
Any telemetry must be:
- opt-in,
- documented with the exact collected fields,
- removable through a disable control.
```

Keep the existing allowed/disallowed behavior and legal review triggers.

- [ ] **Step 5: Verify retained operational documents**

Read `docs/audit-checklist.md` and `docs/google-maps-api-key.md`. Make no content changes unless a relative Markdown link still points to a removed path.

- [ ] **Step 6: Commit public-facing updates**

Run:

```powershell
git diff --check
git add README.md SECURITY.md docs\technical-architecture.md docs\security-and-ethics.md docs\audit-checklist.md docs\google-maps-api-key.md
git commit -m "docs: refresh public project documentation"
```

### Task 3: Verify Documentation Integrity

**Files:**
- Verify all tracked Markdown and configuration files.

- [ ] **Step 1: Verify the final docs tree**

Run:

```powershell
$docsFiles = @(git ls-files docs)
$expected = @(
  "docs/audit-checklist.md",
  "docs/google-maps-api-key.md",
  "docs/security-and-ethics.md",
  "docs/technical-architecture.md"
)
if (Compare-Object $expected $docsFiles) {
  throw "Tracked docs tree does not match the approved public set"
}
```

- [ ] **Step 2: Verify removed path references are gone**

Run:

```powershell
$removedPatterns = @(
  "docs/product-brief.md",
  "docs/mvp-roadmap.md",
  "docs/go-to-market.md",
  "docs/release/",
  "docs/operations/",
  "docs/research/",
  "docs/superpowers/"
)
$trackedText = git ls-files "*.md" "*.json" "*.yml" "*.yaml"
foreach ($pattern in $removedPatterns) {
  $matches = foreach ($file in $trackedText) {
    Select-String -LiteralPath $file -Pattern ([regex]::Escape($pattern))
  }
  if ($matches) {
    throw "Removed documentation path is still referenced: $pattern"
  }
}
```

- [ ] **Step 3: Validate relative Markdown links**

Run this PowerShell check:

```powershell
$repo = (Resolve-Path .).Path
$markdownFiles = git ls-files "*.md"
$missing = @()

foreach ($relativeFile in $markdownFiles) {
  $absoluteFile = Join-Path $repo $relativeFile
  $content = Get-Content -LiteralPath $absoluteFile -Raw
  foreach ($match in [regex]::Matches($content, '\[[^\]]+\]\((?!https?://|mailto:|#)([^)#]+)(?:#[^)]+)?\)')) {
    $target = [Uri]::UnescapeDataString($match.Groups[1].Value)
    $resolved = [System.IO.Path]::GetFullPath((Join-Path (Split-Path $absoluteFile) $target))
    if (-not (Test-Path -LiteralPath $resolved)) {
      $missing += "${relativeFile}: $target"
    }
  }
}

if ($missing.Count -gt 0) {
  throw "Broken Markdown links:`n$($missing -join "`n")"
}
```

- [ ] **Step 4: Run project verification**

```powershell
npm test
npm run lint
npm run build
npm pack --dry-run
```

Expected: all commands pass and package version remains unchanged.

- [ ] **Step 5: Inspect final repository status**

```powershell
git status --short --branch
git log --oneline -4
```

Expected: clean feature branch with two cleanup commits after the design/plan history.

### Task 4: Review and Deliver Through GitHub

**Files:**
- No additional file changes expected.

- [ ] **Step 1: Push the feature branch**

```powershell
git push -u origin docs/public-documentation-cleanup
```

- [ ] **Step 2: Create the pull request**

```powershell
gh pr create --base master --head docs/public-documentation-cleanup --title "Clean up public documentation"
```

The PR summary must state:

- internal plans, duplicated release notes, and commercial planning docs were removed,
- four public documents remain,
- README and security guidance were updated,
- package version and CLI behavior are unchanged.

- [ ] **Step 3: Wait for checks and merge**

```powershell
gh pr checks --watch
gh pr merge --merge --delete-branch
```

- [ ] **Step 4: Verify merged master**

```powershell
git fetch origin
git merge --ff-only origin/master
git status --short --branch
git ls-files docs
```

Expected: clean `master` matching `origin/master`, with exactly four tracked files under `docs/`.

- [ ] **Step 5: Do not publish npm**

This change is documentation-only. Do not update `package.json`, create a GitHub Release, or run `npm publish`.
