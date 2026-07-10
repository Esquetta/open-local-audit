# Review Summary JSON

`review --summary-json <path>` writes a machine-readable summary of a local review CSV. The command is read-only and does not modify the review CSV.

## Actionable leads

The summary includes both a compatibility list and a reasoned queue:

```json
{
  "actionableLeadKeys": ["lead-a", "lead-b"],
  "actionableLeads": [
    {
      "leadKey": "lead-a",
      "reasons": ["unreviewed"]
    },
    {
      "leadKey": "lead-b",
      "reasons": ["invalid-reviewed-at", "stale"]
    }
  ]
}
```

`actionableLeadKeys` remains available for existing consumers. `actionableLeads` adds the reason each lead needs attention.

Supported reasons are:

- `unreviewed`: `lastReviewedAt` is empty.
- `invalid-reviewed-at`: `lastReviewedAt` is not a valid date or timestamp.
- `stale`: `lastReviewedAt` is earlier than the supplied `--stale-before` date.

Each lead key appears once. When duplicate review rows give the same lead key multiple reasons, the reasons are combined in the order above. Leads keep their first actionable appearance order.

Rows without a `leadKey` still contribute to summary counts but cannot appear in either actionable lead list.

## Compatibility

The new field is additive. Existing counts, status summaries, date fields, and lead-key arrays keep their current behavior.
