import type { ProductCandidate, SupplierOption, CompetitorRecord } from '../core/types/index.ts';
import { evidenced, unknown } from '../core/util/evidence.ts';
import { newId, nowIso } from '../core/util/id.ts';

export function candidate(over: Partial<ProductCandidate> = {}): ProductCandidate {
  return {
    id: newId('prd'),
    missionId: 'msn_test',
    name: 'Adjustable laptop stand',
    category: 'home office',
    description: 'People complain about neck pain from working on a laptop all day.',
    stage: 'INVESTIGATING',
    lifecycle: 'RESEARCHING',
    discoveredAt: nowIso(),
    updatedAt: nowIso(),
    discoveredVia: ['test'],
    demand: null,
    trend: null,
    competition: null,
    customer: null,
    suppliers: [],
    economics: null,
    compliance: null,
    brand: null,
    score: null,
    evidence: [],
    rejection: null,
    risks: [],
    marketingAngles: [],
    ...over,
  };
}

export function supplier(unitPrice: number | null, shipping: number | null = 2): SupplierOption {
  return {
    id: newId('sup'),
    marketplace: 'AliExpress',
    supplierName: evidenced('Test Supplier', 'SOURCE_CLAIM'),
    url: 'https://example.com/listing',
    unitPrice: unitPrice === null ? unknown('no price') : evidenced(unitPrice, 'SOURCE_CLAIM'),
    currency: 'EUR',
    shippingCost: shipping === null ? unknown('no shipping') : evidenced(shipping, 'SOURCE_CLAIM'),
    deliveryDays: evidenced('9 days', 'SOURCE_CLAIM'),
    tracking: evidenced(true, 'SOURCE_CLAIM'),
    reviewSignal: evidenced('4.7 / 2000 orders', 'SOURCE_CLAIM'),
    moq: evidenced(1, 'SOURCE_CLAIM'),
    warehouses: ['CN'],
    brandingSupport: evidenced(false, 'SOURCE_CLAIM'),
    returnHandling: evidenced('30 days', 'SOURCE_CLAIM'),
    complianceDocs: evidenced('CE', 'SOURCE_CLAIM'),
    reliabilityNotes: [],
  };
}

export function competitor(price: number | null): CompetitorRecord {
  return {
    id: newId('cmp'),
    brand: `Brand ${Math.random().toString(36).slice(2, 6)}`,
    url: 'https://example.com/product',
    price: price === null ? unknown('no price') : evidenced(price, 'SOURCE_CLAIM'),
    currency: 'EUR',
    positioning: evidenced('premium', 'SOURCE_CLAIM'),
    headline: evidenced('Work without the ache', 'SOURCE_CLAIM'),
    benefits: ['adjustable', 'portable'],
    reviewSignal: evidenced('4.5 / 300', 'SOURCE_CLAIM'),
    complaints: ['wobbles at full height'],
    guarantee: unknown('none stated'),
    shipping: evidenced('3 days', 'SOURCE_CLAIM'),
    bundles: unknown('none'),
    upsells: unknown('none'),
    creativeStyle: evidenced('studio', 'SOURCE_CLAIM'),
    adAngles: ['posture'],
    weaknesses: ['thin copy'],
  };
}
