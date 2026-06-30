# Security Policy

## Supported versions

Security fixes are provided for the latest published minor release of Open Local Audit.

## Reporting a vulnerability

Report vulnerabilities privately through [GitHub Security Advisories](https://github.com/Esquetta/open-local-audit/security/advisories/new).

Do not include vulnerability details, proof-of-concept payloads, secrets, or affected customer data in public issues.

Maintainers will acknowledge a valid report as soon as practical, investigate impact, and coordinate remediation and disclosure with the reporter.

## Security scope

Open Local Audit audits public websites and writes local reports. Most commands require no secrets or accounts. The optional Google Places provider reads `GOOGLE_MAPS_API_KEY` from the local environment and must not write it to reports, logs, examples, or repository files.

Features that store remote customer data, send messages, manage accounts, or sync external systems require a security review before release.

## Dependency advisories

If `npm audit` reports a transitive dependency issue from an old `open-local-audit` install, upgrade to the latest release:

```bash
npm install open-local-audit@latest
```

Versions before the current release may keep older transitive dependency locks in consuming projects. Re-run `npm audit` after upgrading the package and refreshing the consuming project's lockfile.
