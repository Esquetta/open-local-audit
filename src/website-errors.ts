// Error text shared by website enrichment and discovery scoring, kept apart so discovery does not load the fetcher.
// A listed website whose domain has no DNS record is down or lapsed: a lead, not a technical audit failure.
export const domainUnresolvedError = "website domain does not resolve";

export function isDomainUnresolved(error: string | undefined): boolean {
  return Boolean(error?.startsWith(domainUnresolvedError));
}
