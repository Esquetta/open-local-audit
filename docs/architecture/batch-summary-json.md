# Batch Summary JSON

`open-local-audit --input <path> --summary-json <path>` writes the aggregate batch index as machine-readable JSON at an explicit path. It works independently of the report `--format`.

## Output

The explicit summary file uses the same object as `open-local-audit-batch-index.json`. An abridged example:

```json
{
  "summary": {
    "total": 2,
    "succeeded": 1,
    "failed": 1,
    "averageScore": 82
  },
  "entries": [
    {
      "url": "https://example.test",
      "status": "success",
      "slug": "example-test",
      "score": 82
    }
  ]
}
```

Batch index filters, sorting, and `--top` are applied before this object is created. The explicit file therefore contains the same selected entries and summary values as the standard batch index outputs.

Failed entries retain their local error message. Successful entries retain the report paths, contact metadata, and outreach handoff already exposed by the batch index.

## Boundaries

- `--summary-json` is accepted only with `--input` batch runs.
- Parent directories for the explicit path are created when needed.
- Writing the explicit file does not replace or disable standard batch index files.
- The option does not change audit execution, source files, outreach, or CRM state.

## Compatibility

The option is additive. Existing batch output paths and JSON fields keep their current behavior.
