# Public Documentation Cleanup Design

## Goal

Reduce the public `docs/` tree to documentation that helps users, contributors, and security reviewers understand or operate the released project.

## Public Documentation Set

The final `docs/` tree contains exactly:

- `docs/technical-architecture.md`
- `docs/security-and-ethics.md`
- `docs/audit-checklist.md`
- `docs/google-maps-api-key.md`

`audit-checklist.md` moves from `docs/research/`, and `google-maps-api-key.md` moves from `docs/operations/`.

## Removed Documentation

Remove these internal, obsolete, or duplicated materials from the current public tree:

- `docs/superpowers/`
- `docs/release/`
- `docs/operations/decision-log.md`
- `docs/operations/project-standard.md`
- `docs/research/` after moving the audit checklist
- `docs/go-to-market.md`
- `docs/mvp-roadmap.md`
- `docs/product-brief.md`

Release history remains available through `CHANGELOG.md`, Git tags, and GitHub Releases. Existing Git history is not rewritten.

## Content Updates

### README

- Replace the current documentation list with links to the four retained public documents.
- Update the Google Maps API key link to `docs/google-maps-api-key.md`.
- Remove references to the deleted release-readiness checklist.
- Replace first-release planning language with the current published project status.

### SECURITY.md

- State that the current supported line is the latest published minor release.
- Replace pre-publication reporting text with a private GitHub Security Advisory reporting path.
- Keep public issues free of vulnerability details.
- Describe the current security scope rather than the original MVP assumptions.

### Technical Architecture

- Keep the implemented CLI architecture, modules, discovery providers, exports, and local-only boundaries.
- Remove stale “initial”, “MVP”, and speculative future-extension language that no longer describes the released product.
- Do not introduce a new architecture or promise unimplemented features.

### Security and Ethics

- Preserve public data, official Google Places API, outreach, privacy, and local-state boundaries.
- Replace future-facing implementation language with present-tense project policy where behavior already exists.

### Audit Checklist and Google Maps Setup

- Preserve their operational content while updating links or wording required by the new paths.

## Repository Boundaries

- Do not remove root-level `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `LICENSE`, `CHANGELOG.md`, or README.
- Do not delete package tarballs or unrelated project files in this change.
- Do not rewrite Git history.
- Do not change CLI behavior, package metadata, or release versions.

## Verification

- `git ls-files docs` lists only the four approved files.
- No tracked Markdown or configuration file references a removed documentation path.
- All retained relative Markdown links resolve to tracked files.
- `npm test`, `npm run lint`, and `npm run build` remain green.
- `npm pack --dry-run` confirms package contents are unchanged except for README wording, because `docs/` is not part of the npm package.

## Delivery

Use separate commits for:

1. Removing and relocating documentation files.
2. Updating retained docs, README, and `SECURITY.md`.

Push the cleanup through a reviewed pull request. This documentation-only cleanup does not require an npm version bump or npm publish.
