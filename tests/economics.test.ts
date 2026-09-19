import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeEconomics, bestGroundedSupplier } from '../agents/economics/index.ts';
import { candidate, supplier, competitor } from './helpers.ts';

test('no grounded supplier cost means no economics at all', () => {
  const c = candidate({ suppliers: [supplier(null)] });
  assert.equal(computeEconomics(c), null, 'a margin must never be produced without a real cost');
});

test('the cheapest supplier with a readable price is chosen', () => {
  const a = supplier(9);
  const b = supplier(4);
  const c = supplier(null);
  assert.equal(bestGroundedSupplier([a, b, c])?.id, b.id);
});

test('price is inferred from competitor prices when they exist', () => {
  const c = candidate({
    suppliers: [supplier(6, 2)],
    competition: { competitors: [competitor(30), competitor(40), competitor(50)], saturation: { value: 'MODERATE', provenance: 'INFERENCE', confidence: 'MEDIUM', basis: null, sources: [] }, gaps: [] },
  });
  const econ = computeEconomics(c);
  assert.ok(econ);
  assert.equal(econ.inputs['sellingPrice']?.provenance, 'INFERENCE');
  assert.equal(econ.inputs['sellingPrice']?.value, 40, 'median of the retrieved prices');
  assert.equal(econ.fullyGrounded, true);
});

test('without competitor prices the selling price is an ASSUMPTION and the model says so', () => {
  const c = candidate({ suppliers: [supplier(6, 2)] });
  const econ = computeEconomics(c);
  assert.ok(econ);
  assert.equal(econ.inputs['sellingPrice']?.provenance, 'ASSUMPTION');
  assert.equal(econ.fullyGrounded, false);
  assert.match(econ.notes[0] ?? '', /assumption/i);
});

test('break-even ROAS is AOV over contribution, and CPA is the contribution itself', () => {
  const c = candidate({
    suppliers: [supplier(6, 2)],
    competition: { competitors: [competitor(40)], saturation: { value: 'LOW', provenance: 'INFERENCE', confidence: 'LOW', basis: null, sources: [] }, gaps: [] },
  });
  const econ = computeEconomics(c);
  const base = econ?.scenarios.find((s) => s.label === 'BASE');
  assert.ok(base);
  assert.equal(base.breakEvenCpa, base.contributionBeforeAds);
  assert.equal(base.breakEvenRoas, Math.round((base.aov / base.contributionBeforeAds) * 100) / 100);
  assert.ok(base.contributionBeforeAds > 0);
});

test('the worst case is worse than the base case on every axis that matters', () => {
  const c = candidate({
    suppliers: [supplier(6, 2)],
    competition: { competitors: [competitor(40)], saturation: { value: 'LOW', provenance: 'INFERENCE', confidence: 'LOW', basis: null, sources: [] }, gaps: [] },
  });
  const econ = computeEconomics(c);
  const base = econ?.scenarios.find((s) => s.label === 'BASE');
  const worst = econ?.scenarios.find((s) => s.label === 'WORST');
  const best = econ?.scenarios.find((s) => s.label === 'BEST');
  assert.ok(base && worst && best);
  assert.ok(worst.contributionBeforeAds < base.contributionBeforeAds);
  assert.ok(best.contributionBeforeAds > base.contributionBeforeAds);
});

test('a margin that excludes unretrievable freight says so in plain words', () => {
  const c = candidate({ name: 'Bulky item' });
  c.suppliers = [
    {
      id: 'sup_1',
      marketplace: 'made-in-china.com',
      supplierName: { value: 'Test Factory', provenance: 'SOURCE_CLAIM', confidence: 'MEDIUM', basis: null, sources: [] },
      url: 'https://example.com/listing',
      unitPrice: { value: 38, provenance: 'SOURCE_CLAIM', confidence: 'MEDIUM', basis: null, sources: [] },
      currency: 'USD',
      // The listing told us nothing about freight, which is the common case.
      shippingCost: { value: null, provenance: 'UNKNOWN', confidence: 'LOW', basis: 'No shipping cost stated.', sources: [] },
      deliveryDays: { value: null, provenance: 'UNKNOWN', confidence: 'LOW', basis: null, sources: [] },
      tracking: { value: null, provenance: 'UNKNOWN', confidence: 'LOW', basis: null, sources: [] },
      reviewSignal: { value: null, provenance: 'UNKNOWN', confidence: 'LOW', basis: null, sources: [] },
      moq: { value: 200, provenance: 'SOURCE_CLAIM', confidence: 'MEDIUM', basis: null, sources: [] },
      warehouses: [],
      brandingSupport: { value: null, provenance: 'UNKNOWN', confidence: 'LOW', basis: null, sources: [] },
      returnHandling: { value: null, provenance: 'UNKNOWN', confidence: 'LOW', basis: null, sources: [] },
      complianceDocs: { value: null, provenance: 'UNKNOWN', confidence: 'LOW', basis: null, sources: [] },
      reliabilityNotes: [],
    },
  ];
  const econ = computeEconomics(c);
  assert.ok(econ, 'a grounded unit cost is enough to compute a model');
  assert.equal(econ.fullyGrounded, false);
  assert.ok(
    econ.notes.some((n) => /freight/i.test(n) && /not included|NOT included/.test(n) && /upper bound/i.test(n)),
    'the notes must state that freight is excluded and the contribution is an upper bound',
  );
});
