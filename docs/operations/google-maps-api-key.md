# Google Maps API Key Setup

## When this key is required

`GOOGLE_MAPS_API_KEY` is required only when using the Google Places discovery provider:

```bash
open-local-audit discover "guzellik salonu Umraniye" --provider google-places --export-csv leads.csv --dry-run
```

The key is not required for:

- normal website audits,
- batch website audits,
- `manual-csv` discovery.

## Required Google capability

The key must be able to call the official Google Places Text Search API.

Open Local Audit requests only these fields:

- `places.id`
- `places.displayName`
- `places.websiteUri`

The provider does not request reviews, photos, ratings, or Google Business Profile management data.

## Windows PowerShell usage

Set the key for the current terminal session:

```powershell
$env:GOOGLE_MAPS_API_KEY = "your-google-maps-api-key"
```

Run discovery:

```powershell
open-local-audit discover "guzellik salonu Umraniye" --provider google-places --profile beauty --out-dir reports/umraniye-beauty --export-csv leads.csv
```

Persist the key for future user sessions:

```powershell
[Environment]::SetEnvironmentVariable("GOOGLE_MAPS_API_KEY", "your-google-maps-api-key", "User")
```

Open a new terminal after setting a persistent user environment variable.

## macOS or Linux usage

Set the key for the current terminal session:

```bash
export GOOGLE_MAPS_API_KEY="your-google-maps-api-key"
```

Run discovery:

```bash
open-local-audit discover "guzellik salonu Umraniye" --provider google-places --profile beauty --out-dir reports/umraniye-beauty --export-csv leads.csv
```

## Safety rules

- Do not commit real API keys.
- Do not paste real keys into reports, screenshots, or issue comments.
- Prefer a restricted key in Google Cloud.
- Monitor Google Maps Platform billing and quota usage.
- Use `--dry-run` first when validating discovery behavior.

## Expected missing-key error

If the key is not set and `--provider google-places` is used, the CLI should fail with:

```text
GOOGLE_MAPS_API_KEY is required when --provider google-places is used
```
