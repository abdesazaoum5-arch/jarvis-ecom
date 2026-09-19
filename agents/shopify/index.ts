import type { Agent, AgentContext } from '../../core/agent/base.ts';
import type { Offer, ProductCandidate, Storefront, StorefrontPage } from '../../core/types/index.ts';

/**
 * Offer and storefront engine.
 *
 * Offers are priced off the product's real contribution economics, so a tier
 * that would lose money is not offered at all. There are no invented discounts
 * and no manufactured scarcity: a "was" price that was never charged is a lie
 * the system will not write.
 */

export function buildOffers(candidate: ProductCandidate): Offer[] {
  const base = candidate.economics?.scenarios.find((s) => s.label === 'BASE');
  if (!base) return [];
  const currency = candidate.economics?.currency ?? 'EUR';
  const unit = base.productCost + base.shippingCost;
  const tiers: Array<{ tier: Offer['tier']; name: string; units: number; discount: number; contents: string[] }> = [
    { tier: 'STARTER', name: 'Single', units: 1, discount: 0, contents: [`1 × ${candidate.name}`] },
    { tier: 'BEST_VALUE', name: 'Pair', units: 2, discount: 0.12, contents: [`2 × ${candidate.name}`, 'Free shipping'] },
    { tier: 'COMPLETE_SYSTEM', name: 'Complete set', units: 3, discount: 0.2, contents: [`3 × ${candidate.name}`, 'Free shipping', 'Extended 2-year cover'] },
  ];
  return tiers
    .map((t) => {
      const price = round2(base.sellingPrice * t.units * (1 - t.discount));
      const cost = round2(unit * t.units);
      const fees = round2(price * 0.029 + 0.3 + 1.2);
      const contribution = round2(price - cost - fees);
      return {
        tier: t.tier,
        name: t.name,
        contents: t.contents,
        price,
        currency,
        contribution,
        rationale:
          t.discount > 0
            ? `${Math.round(t.discount * 100)}% multi-unit price, which the extra units' margin covers. The saving is real, not a struck-through fiction.`
            : 'Entry price at the researched market level.',
      } satisfies Offer;
    })
    // A tier that does not contribute is not an offer; it is a loss.
    .filter((o) => o.contribution > 0);
}

function page(slug: string, title: string, body: string, flags: string[] = []): StorefrontPage {
  return { slug, title, body, flags };
}

export const shopifyAgent: Agent<ProductCandidate, { storefront: Storefront; offers: Offer[] }> = {
  id: 'shopify',
  label: 'Shopify Agent',
  stage: null,
  async run(candidate, ctx: AgentContext) {
    await ctx.requirePermission('storefront.generate');
    await ctx.checkControl();
    ctx.say(`Generating storefront assets for ${candidate.name}.`);

    const brand = candidate.brand;
    const offers = buildOffers(candidate);
    const problem = candidate.customer?.problems[0] ?? null;
    const proofAvailable = candidate.evidence.some((e) => e.provenance === 'SOURCE_CLAIM' && /review|rating|tested/i.test(e.claim));

    const pages: StorefrontPage[] = [
      page('home', 'Home', [
        `# ${brand?.name ?? candidate.name}`,
        '',
        brand?.positioning ?? `A considered ${candidate.name}.`,
        '',
        problem ? `## The problem\n\n${problem}` : '',
        '',
        '## What it does\n\n' + (candidate.description ?? 'Describe the mechanism here once product photography exists.'),
      ].join('\n')),
      page('product', candidate.name, productPage(candidate, offers), proofAvailable ? [] : ['No verified review or test proof exists yet — the proof section must not be published until real proof is available.']),
      page('about', 'About', brand?.story ?? 'Write the brand story once positioning is confirmed.'),
      page('faq', 'FAQ', faq(candidate)),
      page('contact', 'Contact', '## Contact\n\nEmail: [set a monitored address]\n\nWe answer within one business day.', ['A real, monitored contact address is a legal requirement for EU distance selling.']),
      page('shipping', 'Shipping', shipping(candidate), ['Delivery times must match what the chosen supplier actually quotes.']),
      page('returns', 'Returns', returns(), ['Verify the 14-day withdrawal wording against current Belgian consumer law before publishing.']),
      page('privacy', 'Privacy', '## Privacy\n\n[Insert a GDPR-compliant privacy notice covering the data you collect, its purpose, retention and the processors you use.]', ['Requires legal review; this is a placeholder, not a policy.']),
      page('terms', 'Terms', '## Terms of sale\n\n[Insert terms covering the contract, pricing, delivery, withdrawal and liability.]', ['Requires legal review; this is a placeholder, not a policy.']),
      page('cookies', 'Cookie information', '## Cookies\n\n[List each cookie, its purpose and duration, behind a consent banner that blocks non-essential cookies until consent.]', ['Requires legal review and a working consent mechanism.']),
      page('track-order', 'Track your order', '## Track your order\n\nEnter your order number and email. Tracking becomes available once the parcel is scanned by the carrier.', []),
    ];

    const storefront: Storefront = {
      productId: candidate.id,
      pages,
      productPageSections: sections(candidate, offers),
      generatedAt: new Date().toISOString(),
    };

    const flagged = pages.filter((p) => p.flags.length).length;
    ctx.say(`Storefront generated: ${pages.length} pages, ${offers.length} offer tier(s), ${flagged} page(s) flagged for human review before publishing.`, { data: { candidateId: candidate.id } });
    return { storefront, offers };
  },
};

function productPage(c: ProductCandidate, offers: Offer[]): string {
  const b = c.brand;
  return [
    `# ${c.name}`,
    '',
    b?.slogan ?? '',
    '',
    '## The problem',
    c.customer?.problems[0] ?? '[Insert the problem in the buyer’s own words once customer research returns one.]',
    '',
    '## How it works',
    c.description ?? '[Describe the mechanism.]',
    '',
    '## Proof',
    '[Only real proof goes here: your own test results, verified reviews, or a demonstration video. Do not write claims you cannot evidence.]',
    '',
    '## Offers',
    ...offers.map((o) => `- **${o.name}** — ${o.currency} ${o.price}. ${o.contents.join(', ')}.`),
    '',
    '## Questions',
    ...(c.customer?.objections.slice(0, 4).map((o) => `**${o}**\n\n[Answer this directly.]`) ?? []),
  ].join('\n');
}

function sections(c: ProductCandidate, offers: Offer[]): Array<{ section: string; copy: string }> {
  return [
    { section: 'HERO', copy: `${c.brand?.slogan ?? c.name} — ${c.brand?.positioning ?? ''}` },
    { section: 'PROBLEM', copy: c.customer?.problems[0] ?? '[Problem, in the buyer’s words.]' },
    { section: 'SOLUTION', copy: c.description ?? '[What the product does.]' },
    { section: 'DEMONSTRATION', copy: 'A single continuous shot of the mechanism working. No cuts that hide the result.' },
    { section: 'BENEFITS', copy: (c.marketingAngles.slice(0, 4).join('\n') || '[Derive benefits from customer research.]') },
    { section: 'HOW IT WORKS', copy: '[Three steps, one line each.]' },
    { section: 'PROOF', copy: '[Real proof only.]' },
    { section: 'OFFERS', copy: offers.map((o) => `${o.name}: ${o.currency} ${o.price}`).join(' | ') || '[No offer contributes positively at the current economics.]' },
    { section: 'FAQ', copy: (c.customer?.objections.slice(0, 5).join('\n') || '[Answer the objections research surfaced.]') },
    { section: 'CTA', copy: 'One action, repeated. No countdown timers and no fake stock counters.' },
  ];
}

function faq(c: ProductCandidate): string {
  const qs = c.customer?.objections.slice(0, 6) ?? [];
  if (!qs.length) return '## FAQ\n\n[Populate from the objections customer research surfaces.]';
  return ['## FAQ', '', ...qs.map((q) => `**${q}**\n\n[Answer honestly, including when the answer is "no".]`)].join('\n');
}

function shipping(c: ProductCandidate): string {
  const s = c.suppliers.find((x) => x.deliveryDays.value);
  return [
    '## Shipping',
    '',
    s?.deliveryDays.value ? `Current supplier quotes: ${s.deliveryDays.value}. State the real delivered time, not the dispatch time.` : '[State the real delivery window once a supplier is chosen.]',
    '',
    'Orders are dispatched on business days. Tracking is sent by email when the carrier scans the parcel.',
  ].join('\n');
}

function returns(): string {
  return [
    '## Returns',
    '',
    'EU distance selling gives you 14 days from delivery to withdraw, for any reason.',
    '',
    '[Confirm the current wording and who pays return postage before publishing.]',
  ].join('\n');
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
