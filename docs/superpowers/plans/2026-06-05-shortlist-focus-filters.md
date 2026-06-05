# Shortlist Focus Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add case-insensitive focus filters to local shortlist generation.

**Architecture:** Extend `ShortlistOptions` and apply one combined eligibility predicate after review suppression. Expose matching CLI flags and preserve the existing shared Markdown, JSON, and CSV result model.

**Tech Stack:** TypeScript, Commander, Vitest, npm

---

### Task 1: Define Filter Behavior

**Files:**
- Modify: `tests/shortlist.test.ts`
- Modify: `tests/cli-behavior.test.ts`

- [x] Add a module test combining segment, profile, priority, and contact-confidence filters.
- [x] Add a CLI test confirming filtered counts and JSON output.
- [x] Run targeted tests and confirm they fail because the options are not implemented.

### Task 2: Implement Filters

**Files:**
- Modify: `src/shortlist.ts`
- Modify: `src/cli.ts`

- [x] Add optional focus fields to `ShortlistOptions`.
- [x] Add case-insensitive exact matching with `AND` semantics.
- [x] Add the four CLI options and pass them to `buildLeadShortlist`.
- [x] Isolate shortlist options from root command defaults.
- [x] Run targeted tests and lint until they pass.

### Task 3: Release v0.26.0

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/mvp-roadmap.md`
- Modify: `docs/release/release-readiness.md`
- Create: `docs/release/v0.26.0.md`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] Document filter behavior and local-only boundaries.
- [ ] Bump the package version to `0.26.0`.
- [ ] Run `npm run release-check` and packed CLI smoke tests.
- [ ] Commit feature and release preparation separately.
- [ ] Push, verify GitHub CI, create the GitHub Release, publish to npm, and verify registry state.
