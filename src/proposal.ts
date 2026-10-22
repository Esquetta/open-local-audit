import { readFile } from "node:fs/promises";
import { z } from "zod";
import { maxPoints, pitchPoints, type PitchPoint } from "./pitch-brief.js";
import { escapeHtml, overallScore } from "./reporters.js";
import type { AuditReport, ReportBrandConfig } from "./types.js";

// The operator's own offer: plan names, prices, and wording come from this file, never from the tool.
const text = (max: number) => z.string().trim().min(1).max(max);
const offerSchema = z
  .object({
    title: text(120).optional(),
    intro: text(1000).optional(),
    includes: z.array(text(300)).min(1).max(10).optional(),
    plans: z
      .array(
        z
          .object({
            name: text(60),
            price: text(60),
            features: z.array(text(200)).max(10).default([])
          })
          .strict()
      )
      .min(1)
      .max(4),
    nextStep: text(600).optional(),
    validDays: z.number().int().min(1).max(365).optional()
  })
  .strict();

export type OfferConfig = z.infer<typeof offerSchema>;

export async function readOfferConfig(path: string): Promise<OfferConfig> {
  let raw: unknown;
  try {
    raw = JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`Offer config ${path} could not be read: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  const parsed = offerSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Offer config ${path}: ${issue.path.join(".") || "file"}: ${issue.message}`);
  }
  return parsed.data;
}

// What a monthly `monitor` run delivers on its own, used when the offer does not list its own inclusions. The daily
// check is left out because it only runs when the operator schedules it; an offer that includes it says so.
const defaultIncludes = [
  "A monthly check of the website with a report: the score, what was fixed, and anything new that needs attention.",
  "A warning in that month's report when the HTTPS certificate or the domain registration is close to running out.",
  "A history page that shows the site's score month by month."
];

export interface Proposal {
  name: string;
  url: string;
  checkedOn: string;
  issuedOn: string;
  validUntil?: string;
  score: number;
  points: PitchPoint[];
  morePoints: number;
  offer: OfferConfig & { includes: string[] };
}

// Only hex colors reach the stylesheet; anything else falls back to the default.
function color(value: string | undefined, fallback: string): string {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function longDate(date: Date): string {
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

// A one-page monthly care proposal for a business from its audit: the problems an owner would notice, what monthly
// care includes, and the operator's plans.
export function buildProposal(report: AuditReport, offer: OfferConfig, options: { name?: string; now?: Date } = {}): Proposal {
  const now = options.now ?? new Date();
  const points = pitchPoints(report);
  return {
    name: options.name?.trim() || new URL(report.finalUrl).hostname.replace(/^www\./, ""),
    url: report.finalUrl,
    checkedOn: longDate(new Date(report.scannedAt)),
    issuedOn: longDate(now),
    ...(offer.validDays ? { validUntil: longDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offer.validDays, 12)) } : {}),
    score: overallScore(report),
    points: points.slice(0, maxPoints),
    morePoints: Math.max(0, points.length - maxPoints),
    offer: { ...offer, includes: offer.includes ?? defaultIncludes }
  };
}

function headline(proposal: Proposal): string {
  return proposal.offer.title ?? `Website care proposal for ${proposal.name}`;
}

// The line under the title: who it is from (when the brand config names the business), the date, and how long it holds.
function subtitle(proposal: Proposal, brand: ReportBrandConfig | undefined): string {
  return [brand?.name, proposal.issuedOn, proposal.validUntil ? `Valid until ${proposal.validUntil}` : undefined].filter(Boolean).join(" · ");
}

function findingsIntro(proposal: Proposal): string {
  return proposal.points.length === 0
    ? `The check of ${proposal.url} on ${proposal.checkedOn} scored ${proposal.score}/100 and found nothing urgent. Monthly care keeps it that way.`
    : `The check of ${proposal.url} on ${proposal.checkedOn} scored ${proposal.score}/100. These are the problems a visitor is most likely to notice:`;
}

function moreText(proposal: Proposal): string {
  return proposal.morePoints > 0 ? `The full report lists ${proposal.morePoints} more point${proposal.morePoints === 1 ? "" : "s"}.` : "";
}

const defaultNextStep = "Get in touch to get started.";

const disclaimer = "Based on an automated check of the public website; each point is confirmed on the live site before any work starts.";

export function renderProposalHtml(proposal: Proposal, brand?: ReportBrandConfig): string {
  const primary = color(brand?.primaryColor, "#145a73");
  const accent = color(brand?.accentColor, "#2f7d5f");
  const { offer } = proposal;
  const footer = [brand?.footerText, brand?.contact].filter(Boolean).join(" | ");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(headline(proposal))}</title>
    <style>
      :root { color-scheme: light; --primary: ${primary}; --accent: ${accent}; --ink: #172026; --muted: #5f6b75; --line: #dde3e8; --surface: #f6f8f9; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #ffffff; color: var(--ink); font: 15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; overflow-wrap: anywhere; }
      header { background: var(--primary); color: #ffffff; padding: 28px 16px; }
      header > div, main { max-width: 760px; margin: 0 auto; }
      header p { margin: 4px 0 0; opacity: 0.9; overflow-wrap: anywhere; }
      h1 { margin: 0; font-size: 1.6rem; line-height: 1.25; overflow-wrap: anywhere; }
      main { padding: 8px 16px 40px; }
      h2 { margin: 28px 0 8px; font-size: 1.15rem; color: var(--primary); }
      .muted { color: var(--muted); }
      ol, ul { padding-left: 20px; }
      li { margin: 0 0 10px; }
      .point strong { display: block; }
      .plans { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr)); gap: 12px; }
      .plan { border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; background: var(--surface); }
      .plan h3 { margin: 0; font-size: 1.05rem; }
      .price { margin: 2px 0 8px; font-size: 1.2rem; font-weight: 700; color: var(--accent); }
      .plan ul { margin: 0; }
      .plan li { margin: 0 0 4px; }
      footer { margin-top: 32px; border-top: 1px solid var(--line); padding-top: 12px; font-size: 0.85rem; }
      @media print { header { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .plan { break-inside: avoid; } }
    </style>
  </head>
  <body>
    <header>
      <div>
        <h1>${escapeHtml(headline(proposal))}</h1>
        <p>${escapeHtml(subtitle(proposal, brand))}</p>
      </div>
    </header>
    <main>
${offer.intro ? `      <p>${escapeHtml(offer.intro)}</p>\n` : ""}      <h2>What we found</h2>
      <p>${escapeHtml(findingsIntro(proposal))}</p>
${
  proposal.points.length > 0
    ? `      <ol>
${proposal.points
  .map((point) => `        <li class="point"><strong>${escapeHtml(point.title)}</strong>${escapeHtml(point.whyItMatters)} <span class="muted">Fix: ${escapeHtml(point.fix)}</span></li>`)
  .join("\n")}
      </ol>
`
    : ""
}${moreText(proposal) ? `      <p class="muted">${escapeHtml(moreText(proposal))}</p>\n` : ""}      <h2>What monthly care includes</h2>
      <ul>
${offer.includes.map((item) => `        <li>${escapeHtml(item)}</li>`).join("\n")}
      </ul>
      <h2>Plans</h2>
      <div class="plans">
${offer.plans
  .map(
    (plan) => `        <section class="plan">
          <h3>${escapeHtml(plan.name)}</h3>
          <p class="price">${escapeHtml(plan.price)}</p>
${plan.features.length > 0 ? `          <ul>${plan.features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join("")}</ul>\n` : ""}        </section>`
  )
  .join("\n")}
      </div>
      <h2>Next step</h2>
      <p>${escapeHtml(offer.nextStep ?? defaultNextStep)}</p>
      <footer class="muted">
        <p>${escapeHtml(disclaimer)}</p>
${footer ? `        <p>${escapeHtml(footer)}</p>\n` : ""}      </footer>
    </main>
  </body>
</html>
`;
}

export async function renderProposalPdf(proposal: Proposal, brand?: ReportBrandConfig): Promise<Buffer> {
  const primary = brand?.primaryColor ?? "#145a73";
  const accent = brand?.accentColor ?? "#2f7d5f";
  const { offer } = proposal;
  // pdfkit is loaded on demand so the CLI does not pay for it on every start.
  const { default: PDFDocument } = await import("pdfkit");
  const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: headline(proposal), ...(brand?.name ? { Author: brand.name } : {}) } });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolveBuffer, reject) => {
    doc.on("end", () => resolveBuffer(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const width = doc.page.width - 96;
  const section = (title: string) => {
    doc.moveDown(1);
    doc.font("Helvetica-Bold").fontSize(14).fillColor(primary).text(title, { width });
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(10).fillColor("#172026");
  };

  // The band grows with the title, so a long business name wraps inside it instead of running into the subtitle.
  const titleHeight = doc.font("Helvetica-Bold").fontSize(20).heightOfString(headline(proposal), { width });
  const subtitleHeight = doc.font("Helvetica").fontSize(10).heightOfString(subtitle(proposal, brand) || " ", { width });
  const bandHeight = Math.max(92, 28 + titleHeight + 6 + subtitleHeight + 20);
  doc.rect(0, 0, doc.page.width, bandHeight).fill(primary);
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(20).text(headline(proposal), 48, 28, { width });
  doc.font("Helvetica").fontSize(10).text(subtitle(proposal, brand), 48, doc.y + 6, { width });
  doc.fillColor("#172026").fontSize(10).text("", 48, bandHeight + 20);
  if (offer.intro) {
    doc.text(offer.intro, { width });
  }

  section("What we found");
  doc.text(findingsIntro(proposal), { width });
  proposal.points.forEach((point, index) => {
    doc.moveDown(0.4);
    doc.font("Helvetica-Bold").text(`${index + 1}. ${point.title}`, { width });
    doc.font("Helvetica").text(point.whyItMatters, { width });
    doc.fillColor("#5f6b75").text(`Fix: ${point.fix}`, { width }).fillColor("#172026");
  });
  if (moreText(proposal)) {
    doc.moveDown(0.4).fillColor("#5f6b75").text(moreText(proposal), { width }).fillColor("#172026");
  }

  section("What monthly care includes");
  for (const item of offer.includes) {
    doc.text(`- ${item}`, { width });
  }

  section("Plans");
  for (const plan of offer.plans) {
    doc.moveDown(0.3);
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#172026").text(plan.name, { width, continued: true });
    doc.fillColor(accent).text(`   ${plan.price}`, { width });
    doc.font("Helvetica").fontSize(10).fillColor("#172026");
    for (const feature of plan.features) {
      doc.text(`- ${feature}`, { width });
    }
  }

  section("Next step");
  doc.text(offer.nextStep ?? defaultNextStep, { width });

  doc.moveDown(1.5);
  doc.fontSize(8).fillColor("#5f6b75").text(disclaimer, { width });
  const footer = [brand?.footerText, brand?.contact].filter(Boolean).join(" | ");
  if (footer) {
    doc.text(footer, { width });
  }
  doc.end();
  return await finished;
}
