import type { Agent, AgentContext } from '../../core/agent/base.ts';
import type { ProductCandidate, SupplierOption } from '../../core/types/index.ts';
import { evidenced, unknown } from '../../core/util/evidence.ts';
import { bool, list, num, parseAnswer, questionFor, str } from '../../core/research/extract.ts';
import { sourceFrom } from '../../core/research/types.ts';
import { newId } from '../../core/util/id.ts';

/**
 * Supplier research.
 *
 * Every field is what the supplier's own page states. Nothing about price,
 * delivery, MOQ or compliance documentation is ever filled in from expectation
 * — an unread field stays UNKNOWN, and the economics agent refuses to compute a
 * margin without a real cost.
 */

const MARKETPLACES = [
  { name: 'AliExpress', host: 'aliexpress.com' },
  { name: 'Alibaba', host: 'alibaba.com' },
  { name: 'CJdropshipping', host: 'cjdropshipping.com' },
  { name: 'European / local suppliers', host: null },
];

export const supplierAgent: Agent<ProductCandidate, ProductCandidate> = {
  id: 'supplier',
  label: 'Supplier Agent',
  stage: 'supplier',
  async run(candidate, ctx: AgentContext) {
    await ctx.checkControl();
    ctx.say(`Comparing suppliers for ${candidate.name}.`);
    const found: SupplierOption[] = [];

    for (const mp of MARKETPLACES) {
      await ctx.checkControl();
      const query = mp.host
        ? `${candidate.name} supplier wholesale price site:${mp.host}`
        : `${candidate.name} wholesale supplier Europe MOQ shipping`;
      const hits = await ctx.research.search(query, {
        limit: 4,
        purpose: `Find supplier listings for "${candidate.name}" on ${mp.name} with a stated unit price and shipping terms.`,
        agent: 'supplier',
        missionId: candidate.missionId,
      });

      for (const hit of hits.slice(0, 2)) {
        await ctx.checkControl();
        const page = await ctx.research.read(
          hit.url,
          questionFor(`Read this supplier listing for "${candidate.name}".`, [
            { name: 'supplierName', describe: 'the supplier or store name', type: 'string' },
            { name: 'unitPrice', describe: 'the per-unit price as a plain number', type: 'number' },
            { name: 'currency', describe: 'the currency code', type: 'string' },
            { name: 'shippingCost', describe: 'shipping cost per unit as a plain number', type: 'number' },
            { name: 'deliveryDays', describe: 'quoted delivery time', type: 'string' },
            { name: 'tracking', describe: 'whether tracked shipping is offered', type: 'boolean' },
            { name: 'reviewSignal', describe: 'supplier rating and order count as stated', type: 'string' },
            { name: 'moq', describe: 'minimum order quantity as a plain number', type: 'number' },
            { name: 'warehouses', describe: 'warehouse or dispatch locations listed', type: 'string[]' },
            { name: 'branding', describe: 'whether custom branding or private label is offered', type: 'boolean' },
            { name: 'returns', describe: 'the stated return or refund policy', type: 'string' },
            { name: 'complianceDocs', describe: 'certifications or compliance documents mentioned (CE, RoHS, test reports)', type: 'string' },
          ]),
          { purpose: 'supplier comparison', agent: 'supplier', missionId: candidate.missionId },
        );
        if (!page) continue;
        // A site:-scoped search does not guarantee the page came from that
        // site: search engines return near matches, and the fulfiller may
        // substitute a readable equivalent. Naming the marketplace from the
        // query rather than the page would attribute a supplier to a
        // marketplace it is not on, which is a false statement about a real
        // company. The host of the page Claude actually read decides.
        const marketplace = marketplaceOf(page.url, mp.name);
        const o = parseAnswer(page);
        const name = str(o, 'supplierName');
        if (!name) continue;
        const src = [sourceFrom(page)];
        const price = num(o, 'unitPrice');
        const option: SupplierOption = {
          id: newId('sup'),
          marketplace,
          supplierName: evidenced(name, 'SOURCE_CLAIM', { sources: src }),
          url: page.url,
          unitPrice: price !== null ? evidenced(price, 'SOURCE_CLAIM', { sources: src }) : unknown('No unit price stated on the listing.'),
          currency: str(o, 'currency'),
          shippingCost: num(o, 'shippingCost') !== null ? evidenced(num(o, 'shippingCost'), 'SOURCE_CLAIM', { sources: src }) : unknown('No shipping cost stated.'),
          deliveryDays: evidenced(str(o, 'deliveryDays'), 'SOURCE_CLAIM', { sources: src }),
          tracking: bool(o, 'tracking') !== null ? evidenced(bool(o, 'tracking'), 'SOURCE_CLAIM', { sources: src }) : unknown('Tracking not stated.'),
          reviewSignal: evidenced(str(o, 'reviewSignal'), 'SOURCE_CLAIM', { sources: src }),
          moq: num(o, 'moq') !== null ? evidenced(num(o, 'moq'), 'SOURCE_CLAIM', { sources: src }) : unknown('MOQ not stated.'),
          warehouses: list(o, 'warehouses'),
          brandingSupport: bool(o, 'branding') !== null ? evidenced(bool(o, 'branding'), 'SOURCE_CLAIM', { sources: src }) : unknown('Branding support not stated.'),
          returnHandling: evidenced(str(o, 'returns'), 'SOURCE_CLAIM', { sources: src }),
          complianceDocs: evidenced(str(o, 'complianceDocs'), 'SOURCE_CLAIM', { sources: src }),
          reliabilityNotes: [],
        };
        if (!str(o, 'complianceDocs')) option.reliabilityNotes.push('No compliance documentation is mentioned on the listing — verify before importing.');
        if (price === null) option.reliabilityNotes.push('No unit price could be read, so this supplier cannot support a margin calculation.');
        found.push(option);
        ctx.note(candidate, {
          claim: `${marketplace} supplier ${name}${price !== null ? ` quotes ${str(o, 'currency') ?? ''} ${price} per unit` : ' lists no unit price'}.`,
          provenance: 'SOURCE_CLAIM',
          source: sourceFrom(page),
        });
        ctx.say(`Supplier read: ${name} (${marketplace}).`, { target: { site: hostOf(page.url), url: page.url, action: 'supplier' } });
      }
    }

    candidate.suppliers = found;
    const priced = found.filter((s) => s.unitPrice.value !== null).length;
    if (!priced) ctx.warn(`${candidate.name}: no supplier with a readable unit price; economics cannot be grounded.`);
    else ctx.say(`${candidate.name}: ${found.length} supplier(s) compared, ${priced} with a readable unit price.`);
    return candidate;
  },
};

/**
 * Names the marketplace a listing is actually on. A known host gets its proper
 * name; anything else is reported by its hostname, which is at least true. The
 * marketplace we were searching is used only when the URL cannot be parsed.
 */
export function marketplaceOf(url: string, intended: string): string {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    // Nothing truthful can be said about an address that will not parse, so the
    // marketplace we set out to search is the honest label.
    return intended;
  }
  if (!host) return intended;
  const known = MARKETPLACES.find((m) => m.host !== null && (host === m.host || host.endsWith(`.${m.host}`)));
  return known ? known.name : host;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
