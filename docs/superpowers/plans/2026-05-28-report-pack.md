# Report Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local command that turns an existing single-site report directory into a customer-shareable report pack.

**Architecture:** Add a focused `report-pack` module that reads `open-local-audit-report.json`, copies available report artifacts, and writes a small package manifest plus owner-readable markdown summaries. Wire it into a `package-report` CLI command without changing audit, batch, discovery, CRM, or outreach behavior.

**Tech Stack:** TypeScript, Node.js filesystem APIs, Commander, Vitest, existing report JSON shape.

---

### Task 1: Report Pack Module

**Files:**
- Create: `src/report-pack.ts`
- Test: `tests/report-pack.test.ts`

- [ ] **Step 1: Write module tests**

Cover successful package creation from a report folder and a clear failure when `open-local-audit-report.json` is missing.

- [ ] **Step 2: Implement module**

Read the JSON report, copy available `open-local-audit-report.json`, `.md`, `.html`, and `.pdf` files into `reports/`, then write `README.md`, `next-actions.md`, and `manifest.json`.

- [ ] **Step 3: Run targeted tests**

Run: `npm test -- --run tests/report-pack.test.ts`.

### Task 2: CLI Command

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/index.ts`
- Test: `tests/cli-behavior.test.ts`

- [ ] **Step 1: Add CLI tests**

Cover `package-report --input reports/site --out package`, generated files, and missing input errors.

- [ ] **Step 2: Wire command**

Add `package-report` before the root action. Keep it local-only and file-based.

- [ ] **Step 3: Run targeted tests**

Run: `npm test -- --run tests/report-pack.test.ts tests/cli-behavior.test.ts`.

### Task 3: Release Docs

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/mvp-roadmap.md`
- Modify: `docs/release/release-readiness.md`
- Create: `docs/release/v0.21.0.md`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Document command and limits**

Document `package-report`, generated files, and local-only behavior.

- [ ] **Step 2: Bump version**

Run: `npm version 0.21.0 --no-git-tag-version`.

- [ ] **Step 3: Run release checks**

Run `npm run release-check`, `npm pack`, and tarball CLI smoke.

### Task 4: Publish

**Files:**
- Git metadata only

- [ ] **Step 1: Commit feature and release separately**

Commit code/tests, then docs/version/release notes.

- [ ] **Step 2: Push and verify CI**

Push `master`, then watch GitHub Actions.

- [ ] **Step 3: Create GitHub Release and publish npm**

Create `v0.21.0`, run `npm publish --access public`, and verify `npm view open-local-audit version dist-tags --json`.
