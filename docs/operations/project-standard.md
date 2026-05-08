# Project Operating Standard

## Working standard

Open Local Audit should be managed like a professional software product, even before implementation starts.

## Source of truth

- Product decisions: `docs/product-brief.md`
- Architecture: `docs/technical-architecture.md`
- Roadmap: `docs/mvp-roadmap.md`
- Security boundaries: `docs/security-and-ethics.md`
- Release process: `docs/release/`
- Decision history: `docs/operations/decision-log.md`

## Definition of done

A feature is done only when:

- behavior is implemented,
- tests pass,
- CLI output is reviewed,
- docs are updated if behavior changed,
- release impact is known.

## Documentation rules

- Avoid vague promises.
- Mark future features as future work.
- Keep examples executable once code exists.
- Update the decision log when selecting package name, license, stack, or release process.

## Engineering rules

- Keep rule checks independent and testable.
- Prefer structured report data over string-only output.
- Avoid network-heavy defaults.
- Do not add persistence before there is a concrete need.
- Do not add external APIs before the CLI proves value.
