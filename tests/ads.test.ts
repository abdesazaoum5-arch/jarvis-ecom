import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adsAgent } from '../agents/ads/index.ts';
import { creativeAgent } from '../agents/creative/index.ts';
import { computeEconomics } from '../agents/economics/index.ts';
import { candidate, supplier, competitor } from './helpers.ts';
import type { AgentContext } from '../core/agent/base.ts';

/** A context that grants everything, so the test exercises the agent, not the gate. */
const ctx = {
  mission: { id: 'msn_test' },
  research: null,
  async checkControl() {},
  say() {},
  warn() {},
  note: (_c: unknown, p: unknown) => p,
  async requirePermission() {},
  async allows() {
    return true;
  },
} as unknown as AgentContext;

function priced() {
  const c = candidate({
    suppliers: [supplier(6, 2)],
    competition: { competitors: [competitor(40)], saturation: { value: 'LOW', provenance: 'INFERENCE', confidence: 'LOW', basis: null, sources: [] }, gaps: ['no guarantee'] },
    customer: { segment: { value: 'remote workers', provenance: 'SOURCE_CLAIM', confidence: 'MEDIUM', basis: null, sources: [] }, desires: ['comfort'], problems: ['neck pain'], objections: ['will it hold my laptop'], complaintThemes: ['wobble'] },
  });
  c.economics = computeEconomics(c);
  return c;
}

test('the campaign is Sales optimised for Purchase, never Traffic', async () => {
  const c = priced();
  const creatives = await creativeAgent.run({ candidate: c, total: 10 }, ctx);
  const plan = await adsAgent.run({ candidate: c, creatives }, ctx);
  assert.equal(plan.objective, 'SALES');
  assert.equal(plan.optimisation, 'PURCHASE');
});

test('nothing is ever launched and the budget is tied to break-even CPA', async () => {
  const c = priced();
  const creatives = await creativeAgent.run({ candidate: c, total: 10 }, ctx);
  const plan = await adsAgent.run({ candidate: c, creatives }, ctx);
  assert.equal(plan.status, 'PREPARED');
  const be = c.economics?.scenarios.find((s) => s.label === 'BASE')?.breakEvenCpa ?? 0;
  assert.equal(plan.adSets[0]?.dailyBudgetSuggestion, Math.round(be * 3));
  assert.ok(plan.preLaunchChecklist.some((x) => /permission level 5/.test(x)));
  assert.ok(plan.preLaunchChecklist.some((x) => /current Meta interface/.test(x)), 'the operator is told to check the live interface, not trust remembered settings');
});

test('one to two ad sets, each with at least three ads', async () => {
  const c = priced();
  const creatives = await creativeAgent.run({ candidate: c, total: 10 }, ctx);
  const plan = await adsAgent.run({ candidate: c, creatives }, ctx);
  assert.ok(plan.adSets.length >= 1 && plan.adSets.length <= 2);
  for (const s of plan.adSets) assert.ok(s.ads.length >= 3, `${s.name} has only ${s.ads.length} ads`);
});

test('concepts that could mislead carry an explicit truthfulness condition', async () => {
  const creatives = await creativeAgent.run({ candidate: priced(), total: 12 }, ctx);
  const risky = creatives.filter((x) => ['before/after', 'UGC-style', 'transformation', 'comparison'].includes(x.angle));
  assert.ok(risky.length > 0);
  for (const r of risky) {
    assert.ok(r.truthfulnessNotes.length > 0, `${r.angle} has no truthfulness condition`);
  }
  const beforeAfter = creatives.find((x) => x.angle === 'before/after');
  assert.match(beforeAfter?.truthfulnessNotes[0] ?? '', /real, unedited result/i);
});

test('no creative is reported as rendered when nothing was rendered', async () => {
  const creatives = await creativeAgent.run({ candidate: priced(), total: 10 }, ctx);
  for (const c of creatives) assert.equal(c.renderedAsset, null);
});
