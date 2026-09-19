import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_THRESHOLD, FUNNEL, initialStages, progressOf, validate } from '../core/orchestrator/pipeline.ts';
import { candidate, supplier, competitor } from './helpers.ts';
import { scoreCandidate } from '../core/scoring/index.ts';
import { computeEconomics } from '../agents/economics/index.ts';
import { evidencePoint } from '../core/util/evidence.ts';
import type { Mission } from '../core/types/index.ts';

function wellResearched() {
  const c = candidate({
    suppliers: [supplier(6, 2)],
    competition: { competitors: [competitor(40), competitor(45), competitor(38)], saturation: { value: 'LOW', provenance: 'INFERENCE', confidence: 'MEDIUM', basis: null, sources: [] }, gaps: ['no guarantee offered'] },
    customer: { segment: { value: 'remote workers', provenance: 'SOURCE_CLAIM', confidence: 'MEDIUM', basis: null, sources: [] }, desires: ['less pain'], problems: ['neck pain'], objections: ['stability'], complaintThemes: ['wobble'] },
    marketingAngles: ['a', 'b', 'c', 'd'],
    compliance: { jurisdiction: 'EU', checks: [], humanReviewRequired: false },
  });
  for (let i = 0; i < 12; i += 1) {
    c.evidence.push(
      evidencePoint({ claim: `demand signal ${i}`, provenance: 'SOURCE_CLAIM', agent: 'market', source: { url: `https://src${i}.example.com/p`, title: null, retrievedAt: '', via: 't', excerpt: null } }),
    );
  }
  c.economics = computeEconomics(c);
  c.score = scoreCandidate(c);
  return c;
}

test('a fully researched, profitable candidate passes', () => {
  const r = validate(wellResearched(), DEFAULT_THRESHOLD);
  assert.equal(r.pass, true, r.failures.join(' '));
});

test('thin evidence fails even with a good score', () => {
  const c = wellResearched();
  c.evidence = c.evidence.slice(0, 3);
  const r = validate(c, DEFAULT_THRESHOLD);
  assert.equal(r.pass, false);
  assert.ok(r.failures.some((f) => /first-hand evidence point/.test(f)));
});

test('evidence from a single source fails the independence requirement', () => {
  const c = wellResearched();
  for (const e of c.evidence) if (e.source) e.source.url = 'https://one.example.com/p';
  const r = validate(c, DEFAULT_THRESHOLD);
  assert.equal(r.pass, false);
  assert.ok(r.failures.some((f) => /distinct source/.test(f)));
});

test('no supplier cost fails validation outright', () => {
  const c = wellResearched();
  c.economics = null;
  const r = validate(c, DEFAULT_THRESHOLD);
  assert.equal(r.pass, false);
  assert.ok(r.failures.some((f) => /supplier cost/.test(f)));
});

test('negative contribution fails: there is nothing left to buy a customer', () => {
  const c = wellResearched();
  const base = c.economics?.scenarios.find((s) => s.label === 'BASE');
  assert.ok(base);
  base.contributionBeforeAds = -3;
  const r = validate(c, DEFAULT_THRESHOLD);
  assert.equal(r.pass, false);
  assert.ok(r.failures.some((f) => /buy a customer/.test(f)));
});

test('the funnel caps match the specified narrowing and never pad', () => {
  assert.equal(FUNNEL.find((g) => g.id === 'screen')?.keep, 50);
  assert.equal(FUNNEL.find((g) => g.id === 'trend')?.keep, 20);
  assert.equal(FUNNEL.find((g) => g.id === 'competition')?.keep, 10);
  assert.equal(FUNNEL.find((g) => g.id === 'economics')?.keep, 5);
  // Economics must see the market's prices before it computes a margin.
  assert.ok(
    FUNNEL.findIndex((g) => g.id === 'competition') < FUNNEL.findIndex((g) => g.id === 'economics'),
    'competitive analysis has to run before financial validation',
  );
  // The final stage has no cap: the threshold decides, not a quota.
  assert.equal(FUNNEL.find((g) => g.id === 'finalise')?.keep, null);
});

test('progress is completed stages, not an estimate', () => {
  const stages = initialStages();
  const mission = { stages } as Mission;
  assert.equal(progressOf(mission), 0);
  for (const s of stages.slice(0, 7)) s.status = 'DONE';
  assert.equal(progressOf(mission), Math.round((7 / stages.length) * 100));
});
