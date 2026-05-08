# Contributing

Open Local Audit is early-stage open-source software. Contributions should keep the CLI small, testable, and evidence-backed.

## Expected contribution style

- Keep checks small and testable.
- Add evidence for every finding.
- Avoid broad scraping behavior.
- Update docs when behavior changes.
- Add tests for new rules.

## Local development

Requirements:
- Node.js 20 or newer.
- npm.

Setup and verification:

```bash
npm install
npm test
npm run lint
npm run build
```

Run the CLI during development:

```bash
npm start -- https://example.com --format markdown
```
