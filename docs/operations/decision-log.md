# Decision Log

## 2026-05-08: Project split into standalone workspace

Decision:
- Open Local Audit moved from a venture portfolio folder into `D:\Workstation\open-local-audit`.

Reason:
- It is likely to become its own GitHub repository and npm package.
- It needs dedicated product, technical, security, and release documentation.

## 2026-05-08: CLI-first product shape

Decision:
- Start as a TypeScript CLI.

Reason:
- Fastest route to useful output.
- Fits GitHub/npm distribution.
- Can later share the rule engine with a web UI.

## 2026-05-08: Ethical scanning boundary

Decision:
- Do not build around Google Maps scraping or automated Google Business Profile actions.

Reason:
- Higher platform and compliance risk.
- Operators can still use manual market research and public website audits safely.

## 2026-05-08: Initial open-source license

Decision:
- Use MIT license for the initial open-source package plan.

Reason:
- Familiar for npm users.
- Low friction for freelancers, agencies, and internal usage.
- Can be reviewed before the first public release if maintainers want a different license.
