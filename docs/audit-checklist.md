# Audit Checklist

## Technical basics

- The site is a real website, not a maintenance, placeholder, or parked page.
  - Finding `website-placeholder` replaces the whole audit when a page with at most 600 characters of title and visible text says the website itself is down or under maintenance (for example "Website temporarily down" or a leading "Under maintenance"), or that the domain is parked or for sale. A short page that says only one feature, such as online booking, is unavailable keeps the normal audit. All category scores are set to 0, and discovery ranks the lead as a website-build opportunity (opportunity score 95, high priority). Longer pages that mention the same phrases get the normal audit.
- HTTP status is successful.
- HTTPS is enabled.
- HTTPS certificate is trusted and not about to expire.
  - Rule `tls-certificate-valid` opens one TLS connection to the final HTTPS host and flags a certificate that is not trusted (for example `DEPTH_ZERO_SELF_SIGNED_CERT`), has expired, or has fewer than 14 days left. Automated issuers such as Let's Encrypt renew at 30 days left, so fewer than 14 days means automatic renewal is failing. The rule is skipped for HTTP pages and when the connection fails.
- Secure pages load their files over HTTPS.
  - Rule `mixed-content-absent` flags scripts, stylesheets, icons, images (including `srcset` candidates), media, iframes, and embeds loaded over plain HTTP on a page served over HTTPS. Links to HTTP pages are not mixed content and are not flagged.
- Redirect chain is reasonable.
  - Rule `redirect-chain-short` flags pages reached through more than one redirect and lists every hop with its status code. One redirect, such as HTTP to HTTPS, is accepted. Rendered audits (`--render`, `--screenshot`) do not record redirect hops, so the rule is skipped there.
- Final URL is stable.
- Page can be indexed by search engines.
  - Rule `page-indexable` flags a `noindex` or `none` directive in a `robots` or `googlebot` meta tag or in the `X-Robots-Tag` response header. Directives aimed only at other crawlers are ignored, and `robots.txt` rules are not evaluated.
- Page has title.
- Page has meta description.
- Page has viewport tag.
- Page has one clear H1.
- robots.txt exists.
- sitemap.xml exists.

## Local conversion

- Phone action exists.
- WhatsApp action exists when relevant.
- Email action exists when relevant.
- Visitors can send an enquiry without calling: an enquiry form, a contact or booking page link, or an email link (a newsletter signup does not count).
- Address is visible.
- Map or directions link exists.
- Opening hours are visible.
- Primary call to action is clear on mobile.

## Local trust

- Services are listed clearly.
- Photos are current and useful.
- Team, owner, or business proof is visible where relevant.
- Reviews/testimonials are not misleading.
- Social links work.

## Structured data

- LocalBusiness schema exists where relevant.
- Organization schema exists where relevant.
- ContactPoint data is present where relevant.
- Address data is consistent with visible page content.
  - Rule `localbusiness-schema-nap-consistency` compares LocalBusiness `telephone` and `streetAddress` with the phone numbers and address shown on the page. It only flags a mismatch when the page shows a phone number or address to compare against; missing visible details are left to the presence rules.

## Content quality

- Copy explains what the business does.
- Service area or location is clear.
- Important services have enough detail.
- No obvious outdated dates.
- No broken or placeholder text.

## Report severity guidance

High:
- Missing website basics that block contact or trust.
- Broken contact links.
- No mobile-friendly contact path.

Medium:
- Missing metadata, schema, sitemap, or weak content.
- Poor local trust signals.

Low:
- Minor copy, image, or formatting improvements.
