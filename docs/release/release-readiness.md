# Release Readiness

## Purpose

Prepare Open Local Audit for a professional GitHub and npm release. Do not publish until the CLI has real behavior, tests, examples, and reviewed package contents.

## GitHub readiness checklist

- [x] Repository created.
- [x] README is accurate and not overstated.
- [x] Product brief is current.
- [x] License selected.
- [x] Contributing guide added.
- [x] Security policy added.
- [x] Code of conduct decision made.
- [x] GitHub Actions runs tests.
- [x] Example reports committed.
- [x] Changelog started.
- [x] First release notes drafted.

## npm readiness checklist

- [x] Package name confirmed available.
- [x] `package.json` metadata complete.
- [x] `bin` entry points to compiled CLI.
- [x] Package exports are intentional.
- [x] `files` list prevents accidental publishing.
- [x] `npm pack --dry-run` reviewed.
- [x] Install test from packed tarball passes.
- [x] CLI smoke test passes through `npx`.
- [x] Version matches planned GitHub release tag.

## Quality gates

Before release:

```bash
npm test
npm run lint
npm run build
npm pack --dry-run
```

The preferred single command is:

```bash
npm run release-check
```

## Discovery slice readiness

Before releasing the first `discover` implementation:

- [x] README and CLI help document `discover --input places.csv --provider manual-csv`.
- [x] Manual CSV parsing, website-present audit handoff, website-missing rows, and `leads.csv` columns are covered by tests.
- [x] Output is local operator triage only and does not include outreach sending.
- [x] Docs and help state that Google Maps scraping is not supported.
- [x] Docs and help state that the Google provider is deferred.
- [x] Package review confirms no API keys, fixtures, or generated lead files are included accidentally.

Add project-specific commands once implementation starts.

Current project-specific verification:

```bash
npm audit
node dist/cli.js --help
npm pack
npx --yes --package ./open-local-audit-0.9.0.tgz open-local-audit --help
```

## Current release recommendation

Use `v0.9.0` after:

- single URL, rendered URL, screenshot metadata, profile metadata, and CSV batch paths are covered by tests or smoke checks,
- JSON, Markdown, HTML, and `--format all` outputs build from current code,
- batch index filtering and sorting are verified,
- profile-aware batch input, controlled concurrency, aggregate batch insights, and prospect CSV export are verified,
- dental, beauty, restaurant, and contractor profile-specific findings are covered by regression tests,
- manual CSV discovery, deferred-provider rejection, and local prospect CSV export are verified,
- visual evidence sections render in Markdown and HTML,
- example reports are regenerated from the current build,
- GitHub Actions passes on the pushed commit,
- GitHub Release is created before npm publish.

Use patch releases for documentation, packaging, or narrow rule fixes that do not change CLI behavior.
