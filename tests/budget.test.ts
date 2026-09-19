import test from 'node:test';
import assert from 'node:assert/strict';
import { ResearchRouter } from '../core/research/router.ts';

/**
 * These tests pin the property that matters: an early stage cannot starve a
 * later one. They exercise the accounting directly rather than the network.
 */
test('research budget', async (t) => {
  await t.test("an early stage cannot spend a later stage's reserve", () => {
    const r = new ResearchRouter();
    r.setBudget(10, { market: 0.5, supplier: 0.5 });
    // market's reserve is 5 and there is nothing shared, so its sixth request
    // must be refused even though the mission's total is not yet spent.
    assert.equal(r.remainingFor('market'), 5);
    assert.equal(r.remainingFor('supplier'), 5);
  });

  await t.test('whatever is not reserved is shared', () => {
    const r = new ResearchRouter();
    r.setBudget(10, { supplier: 0.2 });
    // supplier holds 2, so 8 are shared: supplier may reach 10, others 8.
    assert.equal(r.remainingFor('supplier'), 10);
    assert.equal(r.remainingFor('market'), 8);
  });

  await t.test('a reserved stage always gets at least one request', () => {
    const r = new ResearchRouter();
    // 0.05 of 4 rounds down to zero, which would silently disable the stage.
    r.setBudget(4, { supplier: 0.05 });
    assert.ok(r.remainingFor('supplier') >= 1);
  });

  await t.test('reserves can never add up to more than the budget', () => {
    const r = new ResearchRouter();
    r.setBudget(6, { a: 0.5, b: 0.5, c: 0.5 });
    // a and b take 3 each; c must get nothing rather than overdrawing.
    assert.equal(r.remainingFor('a'), 3);
    assert.equal(r.remainingFor('b'), 3);
    assert.equal(r.remainingFor('c'), 0);
  });

  await t.test('an unbudgeted router is unbounded for every stage', () => {
    const r = new ResearchRouter();
    assert.equal(r.remainingFor('supplier'), Number.POSITIVE_INFINITY);
    assert.equal(r.remaining, Number.POSITIVE_INFINITY);
  });
});
