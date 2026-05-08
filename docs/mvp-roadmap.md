# MVP Roadmap

## MVP definition

The MVP is a CLI that audits one public website and generates JSON and Markdown reports with evidence-backed recommendations.

## Milestone 0: Project setup

Deliverables:
- Git repository.
- `package.json`.
- TypeScript config.
- Lint and test setup.
- Basic CLI entrypoint.
- License decision.
- GitHub Actions skeleton.

Exit criteria:
- `npm test` runs.
- CLI help command works.
- README explains the project honestly.

## Milestone 1: Single URL audit

Deliverables:
- URL normalization.
- HTTP fetch.
- Redirect handling.
- HTML parser.
- Initial report schema.

Checks:
- HTTPS.
- Status code.
- Redirect chain.
- Title.
- Meta description.
- Viewport.
- H1.

Exit criteria:
- CLI can scan a simple static site.
- JSON report is valid against schema.
- Unit tests cover parser and report model.

## Milestone 2: Local business checks

Deliverables:
- Contact signal checks.
- LocalBusiness schema check.
- Address/map signal checks.
- Social link detection.

Checks:
- `tel:` link.
- `mailto:` link.
- WhatsApp link.
- Address-like text.
- Google Maps or directions link.
- LocalBusiness schema.

Exit criteria:
- Markdown report is owner-readable.
- Example local-business report exists.

## Milestone 3: Quality and release candidate

Deliverables:
- CLI flags.
- Error handling.
- Timeouts.
- Basic docs.
- Changelog.
- Release checklist completed.

Exit criteria:
- Tests pass.
- Example reports are committed.
- Package dry-run succeeds.
- First GitHub release candidate can be created.

## Milestone 4: npm release

Deliverables:
- Package metadata.
- Public package name check.
- `npm pack --dry-run` review.
- Versioned release notes.
- npm publish.

Exit criteria:
- npm package installs.
- CLI runs through `npx`.
- GitHub release and npm version match.

## Deferred work

- Web UI.
- CSV batch mode.
- Screenshots.
- Lighthouse integration.
- Branded PDF reports.
- SaaS dashboard.
