# Release Readiness

## Purpose

Prepare Open Local Audit for a professional GitHub and npm release. Do not publish until the CLI has real behavior, tests, examples, and reviewed package contents.

## GitHub readiness checklist

- [ ] Repository created.
- [ ] README is accurate and not overstated.
- [ ] Product brief is current.
- [x] License selected.
- [ ] Contributing guide added.
- [ ] Security policy added.
- [ ] Code of conduct decision made.
- [ ] GitHub Actions runs tests.
- [ ] Example reports committed.
- [ ] Changelog started.
- [ ] First release notes drafted.

## npm readiness checklist

- [ ] Package name confirmed available.
- [ ] `package.json` metadata complete.
- [ ] `bin` entry points to compiled CLI.
- [ ] Package exports are intentional.
- [ ] `files` list prevents accidental publishing.
- [ ] `npm pack --dry-run` reviewed.
- [ ] Install test from packed tarball passes.
- [ ] CLI smoke test passes through `npx`.
- [ ] Version matches GitHub release tag.

## Quality gates

Before release:

```bash
npm test
npm run lint
npm run build
npm pack --dry-run
```

Add project-specific commands once implementation starts.

## First release recommendation

Use `v0.1.0` only after:

- single URL scan works,
- JSON and Markdown reports work,
- at least 10 rules exist,
- tests cover rule engine and report generation,
- example report is committed.

Use `v0.0.x` only for private/internal test packages if needed.
