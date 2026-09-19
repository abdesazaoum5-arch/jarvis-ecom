import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOffers } from '../agents/shopify/index.ts';
import { mixFor } from '../agents/creative/index.ts';
import { higgsfieldStatus } from '../agents/video/index.ts';
import { computeEconomics } from '../agents/economics/index.ts';
import { candidate, supplier, competitor } from './helpers.ts';

function priced() {
  const c = candidate({
    suppliers: [supplier(6, 2)],
    competition: { competitors: [competitor(40)], saturation: { value: 'LOW', provenance: 'INFERENCE', confidence: 'LOW', basis: null, sources: [] }, gaps: [] },
  });
  c.economics = computeEconomics(c);
  return c;
}

test('three offer tiers are produced and every one contributes positively', () => {
  const offers = buildOffers(priced());
  assert.equal(offers.length, 3);
  for (const o of offers) assert.ok(o.contribution > 0, `${o.name} would lose money`);
  assert.deepEqual(offers.map((o) => o.tier), ['STARTER', 'BEST_VALUE', 'COMPLETE_SYSTEM']);
});

test('a tier that would lose money is dropped, not offered at a loss', () => {
  const c = priced();
  const base = c.economics?.scenarios.find((s) => s.label === 'BASE');
  assert.ok(base);
  // Force a cost base that makes every tier unprofitable.
  base.productCost = base.sellingPrice * 3;
  assert.deepEqual(buildOffers(c), []);
});

test('no offer is generated without grounded economics', () => {
  assert.deepEqual(buildOffers(candidate()), []);
});

test('no offer is priced against an invented reference price', () => {
  for (const o of buildOffers(priced())) {
    // A fake discount asserts a former price. Look for that assertion, with a figure.
    assert.doesNotMatch(o.rationale, /\b(was|rrp|msrp|originally|instead of|normally)\b[^.]*\d/i, o.rationale);
    assert.doesNotMatch(o.name, /\d+\s*%\s*off/i);
  }
  // A multi-unit saving must be covered by the extra units' own margin.
  const best = buildOffers(priced()).find((o) => o.tier === 'BEST_VALUE');
  assert.ok(best && best.contribution > 0, 'the discounted tier still has to make money');
});

test('the creative mix is 60/30/10 with sane minimums', () => {
  const m = mixFor(10);
  assert.equal(m.videos, 6);
  assert.equal(m.statics, 3);
  assert.equal(m.carousels, 1);
  const small = mixFor(2);
  assert.ok(small.videos >= 3 && small.statics >= 3 && small.carousels >= 1, 'an ad set always gets a testable spread');
});

test('Higgsfield reports NOT_CONNECTED without a key and never purchases credits', () => {
  delete process.env['HIGGSFIELD_API_KEY'];
  const s = higgsfieldStatus();
  assert.equal(s.status, 'NOT_CONNECTED');
  assert.match(s.note, /No credits will be purchased/i);
});
