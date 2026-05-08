# npm Publishing Plan

## Package name candidates

Preferred:
- `open-local-audit`

Alternatives:
- `@scope/open-local-audit`
- `local-presence-audit`
- `local-site-audit`

Recommendation:
- Use `open-local-audit` if available.
- Use a scoped package only if maintainers need namespace ownership and brand control.

## Package metadata

Required before publish:
- name,
- version,
- description,
- license,
- repository,
- bugs URL,
- homepage,
- keywords,
- bin entry,
- files allowlist.

Suggested keywords:
- local-seo,
- website-audit,
- small-business,
- cli,
- seo,
- accessibility,
- structured-data,
- local-business.

Current license:
- MIT.

## Publishing sequence

1. Finish release checklist.
2. Run tests, lint, and build.
3. Run `npm pack --dry-run`.
4. Inspect package file list.
5. Commit release changes.
6. Tag release.
7. Create GitHub release.
8. Publish to npm.
9. Verify npm package install and CLI execution.

## Do not publish if

- example commands do not work,
- package includes unwanted files,
- report output has placeholders,
- license is undecided,
- README promises features not implemented,
- CLI has no tests.
