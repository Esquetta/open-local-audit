# CRM Import Quality Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local CRM CSV validation command for the v0.19 CRM export preset.

**Architecture:** Add a focused validator module that reads CRM preset CSV files, checks required columns and row-level import risks, and returns a summary with issues. Wire it into a new `validate-export` CLI command with JSON or Markdown output.

**Tech Stack:** TypeScript, Commander, Vitest, existing CSV parser and npm release workflow.

---

### Task 1: CRM Export Validator

**Files:**
- Create: `src/export-validation.ts`
- Test: `tests/export-validation.test.ts`

- [ ] **Step 1: Write validator tests**

Cover missing required columns, duplicate `leadKey`, missing company or website, low contact confidence, and clean rows.

- [ ] **Step 2: Implement validator**

Read CSV with the existing parser, require the v0.19 CRM columns, and return `{ summary, issues }`.

- [ ] **Step 3: Run targeted tests**

Run: `npm test -- --run tests/export-validation.test.ts`

### Task 2: CLI Command

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/index.ts`
- Test: `tests/cli-behavior.test.ts`

- [ ] **Step 1: Add CLI behavior tests**

Cover `validate-export --input file --preset crm`, JSON output, Markdown output, clean exit code `0`, and issue exit code `1`.

- [ ] **Step 2: Wire command**

Add `validate-export` before the root action. Keep `--preset crm` explicit and local-only.

- [ ] **Step 3: Run targeted CLI tests**

Run: `npm test -- --run tests/export-validation.test.ts tests/cli-behavior.test.ts`

### Task 3: Release Docs

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/mvp-roadmap.md`
- Modify: `docs/release/release-readiness.md`
- Create: `docs/release/v0.20.0.md`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Document command and limits**

Document that validation is local-only and does not sync to a CRM.

- [ ] **Step 2: Bump version**

Run: `npm version 0.20.0 --no-git-tag-version`

- [ ] **Step 3: Run release checks**

Run: `npm run release-check`, `npm pack`, and tarball CLI smoke.

### Task 4: Publish

**Files:**
- Git metadata only

- [ ] **Step 1: Commit feature and release separately**

Commit feature code/tests, then docs/version/release plan.

- [ ] **Step 2: Push and verify CI**

Push `master`, then watch GitHub Actions.

- [ ] **Step 3: Create GitHub Release and publish npm**

Create `v0.20.0`, run `npm publish --access public`, and verify `npm view open-local-audit version dist-tags --json`.
