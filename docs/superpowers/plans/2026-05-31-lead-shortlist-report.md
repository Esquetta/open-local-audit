# Lead Shortlist Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local command that turns discovery or CRM CSV exports into a ranked lead shortlist report.

**Architecture:** Add a focused `shortlist` module that reads CSV content, normalizes common discovery and CRM export columns, ranks rows deterministically, and renders Markdown or JSON output. Wire it into a `shortlist` CLI command without changing audit, discovery, report-pack, CRM validation, or outreach behavior.

**Tech Stack:** TypeScript, Node.js filesystem APIs, Commander, Vitest, existing CSV parser.

---

### Task 1: Shortlist Module

**Files:**
- Create: `src/shortlist.ts`
- Test: `tests/shortlist.test.ts`

- [ ] **Step 1: Write module tests**

Cover ranking by `opportunityScore`, `priority`, `contactConfidence`, and `score`; Markdown output; JSON output; empty CSV failure.

- [ ] **Step 2: Implement module**

Parse CSV with the existing parser, support discovery and CRM column names, sort leads, and render shortlist reports.

- [ ] **Step 3: Run targeted tests**

Run: `npm test -- --run tests/shortlist.test.ts`.

### Task 2: CLI Command

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/index.ts`
- Test: `tests/cli-behavior.test.ts`

- [ ] **Step 1: Add CLI tests**

Cover `shortlist --input leads.csv --out shortlist.md --top 2` and JSON output.

- [ ] **Step 2: Wire command**

Add `shortlist` before the root action. Keep it local-only and file-based.

- [ ] **Step 3: Run targeted CLI tests**

Run: `npm test -- --run tests/shortlist.test.ts tests/cli-behavior.test.ts`.

### Task 3: Release Docs

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/mvp-roadmap.md`
- Modify: `docs/release/release-readiness.md`
- Create: `docs/release/v0.22.0.md`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Document command and limits**

Document `shortlist`, generated formats, and local-only behavior.

- [ ] **Step 2: Bump version**

Run: `npm version 0.22.0 --no-git-tag-version`.

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

Create `v0.22.0`, run `npm publish --access public`, and verify `npm view open-local-audit version dist-tags --json`.
