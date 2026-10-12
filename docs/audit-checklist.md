# Audit Checklist

## Technical basics

- The site is a real website, not a maintenance, placeholder, or parked page.
  - Finding `website-placeholder` replaces the whole audit when a page with at most 600 characters of title and visible text says the website itself is down or under maintenance (for example "Website temporarily down" or "Under maintenance" opening the title or the page text), or that the domain is parked or for sale. A short page that says only one feature, such as online booking, is unavailable, or that uses conditional copy such as "If our site is offline, call us", keeps the normal audit. All category scores are set to 0, and discovery ranks the lead as a website-build opportunity (opportunity score 95, high priority). Longer pages that mention the same phrases get the normal audit.
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
- Page declares its language.
  - Rule `html-lang-present` flags an `<html>` element without a `lang` attribute or with a value that is not a language code, such as `lang="english"`.
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
- Form fields have labels.
  - Rule `form-labels-present` flags visible inputs, selects, and text areas with no `<label>`, `aria-label`, `aria-labelledby` reference to text, `title`, or `placeholder`. Hidden fields, fields under `aria-hidden` (such as the Mailchimp spam trap), and buttons are ignored. Like Lighthouse, it accepts a placeholder as a name, although a visible label is better.

## Local trust

- Services are listed clearly.
- Photos are current and useful.
- Team, owner, or business proof is visible where relevant.
- Reviews/testimonials are not misleading.
- Social links work.

## Privacy and consent

- A privacy policy is linked from the page.
  - Rule `privacy-policy-link-present` looks for a same-site link whose text or path mentions the privacy policy in English, Turkish (including KVKK), German, French, Spanish, or Dutch, a `rel="privacy-policy"` link, or a policy hosted by iubenda, Termly, PrivacyPolicies.com, or FreePrivacyPolicy. Links to another company's policy, such as Google's reCAPTCHA notice, do not count. The evidence says when the page has an enquiry form or loads trackers.
- Pages that load trackers have a cookie consent tool.
  - Rule `cookie-consent-present` flags pages that load the Google tag (Google Analytics or Ads), Google Tag Manager, Meta Pixel, Hotjar, Microsoft Clarity, the LinkedIn Insight Tag, the TikTok Pixel, or Microsoft Advertising, or whose response sets tracking cookies such as `_ga` or `_fbp`, when the page shows no sign of a consent tool. Any known consent platform (for example Cookiebot, OneTrust, CookieYes, Complianz, iubenda, Civic Cookie Control, Finsweet, HubSpot, Google Funding Choices), IAB TCF, a Google consent mode default, a website builder's consent code (Wix, Squarespace, Shopify), or cookie banner markup counts, so the rule does not check that the banner is switched on or actually blocks the tags. Tags held back as `type="text/plain"` scripts, as consent tools do until visitors accept, do not count as loaded.
  - Static audits only see the HTML the server sends. A banner or privacy link that a tag manager adds later is only visible to rendered audits (`--render`), so re-check these findings on the live site before raising them with a business.

## Structured data

- LocalBusiness schema exists where relevant.
  - Rules `localbusiness-schema-present`, `localbusiness-schema-contact-fields`, and `localbusiness-schema-nap-consistency` accept schema.org LocalBusiness subtypes such as `Dentist`, `Attorney`, `MedicalClinic`, `Restaurant`, and `Plumber`. Opening hours count as either `openingHours` (text or a list) or `openingHoursSpecification`.
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
- Links say where they go.
  - Rule `link-text-descriptive` flags visible links whose only text, image alt text, or `aria-label` is generic, such as "Read more", "Click here", "Learn more", "Devamını oku", or "Mehr erfahren". Fragment and `javascript:` links are skipped.

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
