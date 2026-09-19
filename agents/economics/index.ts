import type { Agent, AgentContext } from '../../core/agent/base.ts';
import type { EconomicsScenario, Evidenced, ProductCandidate, SupplierOption, UnitEconomics } from '../../core/types/index.ts';
import { evidenced, isKnown, unknown } from '../../core/util/evidence.ts';

/**
 * Unit economics.
 *
 * Every input is an Evidenced number. Measured costs come from supplier and
 * competitor research; the remainder are explicit ASSUMPTIONs with a stated
 * rationale, and `fullyGrounded` is true only when nothing was assumed. The UI
 * shows that flag, so a margin built on assumptions can never read as measured.
 */

export interface EconomicsAssumptions {
  currency: string;
  /** Payment processing, as a fraction of order value, plus a fixed fee. */
  paymentRate: number;
  paymentFixed: number;
  /** Platform/subscription cost amortised per order. */
  platformPerOrder: number;
  /** Expected refund rate as a fraction of orders. */
  refundRate: number;
  /** Customer service cost per order. */
  supportPerOrder: number;
  /** Units per order, used to derive AOV from the selling price. */
  unitsPerOrder: number;
  /** Price multiple over landed cost used when no competitor price is known. */
  fallbackMarkup: number;
}

export const DEFAULT_ASSUMPTIONS: EconomicsAssumptions = {
  currency: 'EUR',
  paymentRate: 0.029,
  paymentFixed: 0.3,
  platformPerOrder: 1.2,
  refundRate: 0.04,
  supportPerOrder: 0.6,
  unitsPerOrder: 1.15,
  fallbackMarkup: 3.0,
};

export interface ScenarioShape {
  label: EconomicsScenario['label'];
  priceFactor: number;
  refundFactor: number;
  costFactor: number;
}

const SHAPES: ScenarioShape[] = [
  { label: 'BASE', priceFactor: 1.0, refundFactor: 1.0, costFactor: 1.0 },
  { label: 'BEST', priceFactor: 1.12, refundFactor: 0.6, costFactor: 0.92 },
  { label: 'WORST', priceFactor: 0.88, refundFactor: 1.8, costFactor: 1.12 },
];

/** Picks the cheapest supplier whose unit price is actually known. */
export function bestGroundedSupplier(suppliers: SupplierOption[]): SupplierOption | null {
  const priced = suppliers.filter((s) => isKnown(s.unitPrice));
  if (!priced.length) return null;
  return priced.reduce((a, b) => ((a.unitPrice.value ?? Infinity) <= (b.unitPrice.value ?? Infinity) ? a : b));
}

export function computeEconomics(
  candidate: ProductCandidate,
  assumptions: EconomicsAssumptions = DEFAULT_ASSUMPTIONS,
): UnitEconomics | null {
  const supplier = bestGroundedSupplier(candidate.suppliers);
  const productCost: Evidenced<number> = supplier
    ? { ...supplier.unitPrice }
    : unknown('No supplier with a retrievable unit price was found.');
  const inboundShipping: Evidenced<number> = supplier && isKnown(supplier.shippingCost)
    ? { ...supplier.shippingCost }
    : unknown('No supplier shipping cost was retrievable.');

  // Without a real cost base there is no honest margin to report.
  if (!isKnown(productCost)) return null;

  const competitorPrices = (candidate.competition?.competitors ?? [])
    .map((c) => c.price)
    .filter(isKnown)
    .map((p) => p.value);

  const landed = productCost.value + (isKnown(inboundShipping) ? inboundShipping.value : 0);

  const sellingPrice: Evidenced<number> = competitorPrices.length
    ? evidenced(median(competitorPrices), 'INFERENCE', {
        basis: `Median of ${competitorPrices.length} retrieved competitor prices; positioning at market rather than undercutting.`,
        confidence: competitorPrices.length >= 3 ? 'MEDIUM' : 'LOW',
      })
    : evidenced(round2(landed * assumptions.fallbackMarkup), 'ASSUMPTION', {
        basis: `No competitor price was retrievable, so a ${assumptions.fallbackMarkup}x markup on landed cost is assumed. Replace this before acting on it.`,
        confidence: 'LOW',
      });

  const inputs: Record<string, Evidenced<number>> = {
    productCost,
    inboundShipping,
    sellingPrice,
    paymentRate: evidenced(assumptions.paymentRate, 'ASSUMPTION', { basis: 'Typical card processing rate; verify against the actual provider agreement.' }),
    refundRate: evidenced(assumptions.refundRate, 'ASSUMPTION', { basis: 'Category-typical refund rate; no measured data for this product yet.' }),
    supportPerOrder: evidenced(assumptions.supportPerOrder, 'ASSUMPTION', { basis: 'Estimated service cost per order.' }),
    platformPerOrder: evidenced(assumptions.platformPerOrder, 'ASSUMPTION', { basis: 'Platform subscription amortised per order at an assumed volume.' }),
  };

  const scenarios: EconomicsScenario[] = SHAPES.map((shape) => {
    const price = round2((sellingPrice.value ?? 0) * shape.priceFactor);
    const aov = round2(price * assumptions.unitsPerOrder);
    const cost = round2(productCost.value * assumptions.unitsPerOrder * shape.costFactor);
    const ship = round2((isKnown(inboundShipping) ? inboundShipping.value : 0) * assumptions.unitsPerOrder * shape.costFactor);
    const paymentFees = round2(aov * assumptions.paymentRate + assumptions.paymentFixed);
    const platformFees = round2(assumptions.platformPerOrder);
    const refundRate = Math.min(assumptions.refundRate * shape.refundFactor, 0.5);
    // A refund costs the gross margin on that order plus the goods already shipped.
    const refundCost = round2(refundRate * (aov + cost + ship));
    const supportCost = round2(assumptions.supportPerOrder);
    const contributionBeforeAds = round2(aov - cost - ship - paymentFees - platformFees - refundCost - supportCost);
    return {
      label: shape.label,
      sellingPrice: price,
      aov,
      productCost: cost,
      shippingCost: ship,
      paymentFees,
      platformFees,
      refundCost,
      supportCost,
      contributionBeforeAds,
      // Break-even CPA is exactly the contribution available to buy a customer.
      breakEvenCpa: contributionBeforeAds,
      breakEvenRoas: contributionBeforeAds > 0 ? round2(aov / contributionBeforeAds) : Infinity,
      assumedAdCost: null,
      contributionAfterAds: null,
    };
  });

  const fullyGrounded = isKnown(productCost) && isKnown(inboundShipping) && sellingPrice.provenance !== 'ASSUMPTION';

  return {
    currency: supplier?.currency ?? assumptions.currency,
    inputs,
    scenarios,
    fullyGrounded,
    notes: [
      fullyGrounded
        ? 'Cost base and price are taken from retrieved sources.'
        : 'At least one input is an assumption — treat these figures as a model, not a measurement.',
      // Freight is treated as zero only because it could not be read. It is
      // never actually zero, so the contribution below is an upper bound and
      // must be labelled as one: an operator reading a margin should not have
      // to work out for themselves which costs are missing from it.
      ...(isKnown(inboundShipping)
        ? []
        : ['Inbound freight, import duty and any last-mile surcharge are NOT included: no supplier quoted them, so they are counted as zero. Every contribution figure here is therefore an upper bound, and the gap is larger for bulky or heavy goods.']),
      'Break-even CPA is the contribution left before advertising: spend above it loses money on the first order.',
      'Break-even ROAS is AOV divided by that contribution.',
    ],
  };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return round2(s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const economicsAgent: Agent<ProductCandidate, ProductCandidate> = {
  id: 'economics',
  label: 'Economics Agent',
  stage: 'economics',
  async run(candidate, ctx: AgentContext) {
    await ctx.checkControl();
    const econ = computeEconomics(candidate);
    candidate.economics = econ;
    if (!econ) {
      ctx.warn(`${candidate.name}: no supplier cost could be retrieved, so no margin can be calculated.`);
      return candidate;
    }
    const base = econ.scenarios.find((s) => s.label === 'BASE');
    ctx.say(
      `${candidate.name}: landed economics computed — contribution ${econ.currency} ${base?.contributionBeforeAds ?? 0} per order, break-even CPA ${econ.currency} ${base?.breakEvenCpa ?? 0}.` +
        (econ.fullyGrounded ? '' : ' Some inputs are assumptions.'),
      { data: { candidateId: candidate.id, fullyGrounded: econ.fullyGrounded } },
    );
    return candidate;
  },
};
