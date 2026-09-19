import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screen } from '../agents/screening/index.ts';
import { candidate } from './helpers.ts';

const cases: Array<[string, string, boolean, RegExp]> = [
  ['Replica Rolex Submariner', 'a 1:1 copy of the luxury watch, indistinguishable', false, /counterfeit|replica/i],
  ['Marvel Iron Man figurine', 'officially inspired collectible figure for fans', false, /trademark/i],
  ['LED therapy mask', 'medical grade device that cures acne in two weeks', false, /medical claims/i],
  ['CBD sleep gummies', 'calming gummies for better rest at night', false, /regulated/i],
  ['Fitted designer jeans', 'slim fit jeans available in sizes 26 to 40', false, /sizing/i],
  ['Dropshipping course', 'learn how to build a store in 30 days', false, /physical product/i],
  ['Glass aquarium centrepiece', 'a large decorative glass aquarium for the living room', false, /breakage|shipping/i],
  ['Adjustable laptop stand', 'people complain about neck pain after a full day on a laptop', true, /passed/i],
];

for (const [name, description, shouldPass, reason] of cases) {
  test(`${shouldPass ? 'passes' : 'rejects'}: ${name}`, () => {
    const r = screen(candidate({ name, description }));
    assert.equal(r.pass, shouldPass, `${name}: ${r.reason}`);
    assert.match(r.reason, reason);
    if (!shouldPass) assert.ok(r.reopenIf.length > 0, 'a rejection must state what would change the answer');
  });
}

test('a candidate no source explained is rejected rather than researched blind', () => {
  const r = screen(candidate({ name: 'Widget', description: 'x' }));
  assert.equal(r.pass, false);
  assert.match(r.reason, /No source explained/i);
});

test('a supplier is named by the marketplace it is actually on', async (t) => {
  const { marketplaceOf } = await import('../agents/supplier/index.ts');
  await t.test('a known marketplace keeps its proper name', () => {
    assert.equal(marketplaceOf('https://www.aliexpress.com/item/123.html', 'Alibaba'), 'AliExpress');
    assert.equal(marketplaceOf('https://www.alibaba.com/product/9.html', 'AliExpress'), 'Alibaba');
  });
  await t.test('any other host is reported as itself, never as the site we searched', () => {
    // The mission searched AliExpress; the page came from elsewhere. Saying
    // "AliExpress supplier X" would be a false statement about a real company.
    assert.equal(
      marketplaceOf('https://bestfurniturefactory.en.made-in-china.com/product/x.html', 'AliExpress'),
      'bestfurniturefactory.en.made-in-china.com',
    );
  });
  await t.test('an unparseable URL falls back to the marketplace searched', () => {
    assert.equal(marketplaceOf('not a url', 'AliExpress'), 'AliExpress');
  });
});
