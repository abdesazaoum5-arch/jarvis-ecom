import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreCandidate, WEIGHTS } from '../core/scoring/index.ts';
import { candidate, supplier, competitor } from './helpers.ts';
import { evidencePoint } from '../core/util/evidence.ts';

test('the weights are the specified ones and sum to 1', () => {
  const total = WEIGHTS.reduce((s, w) => s + w.weight, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `weights sum to ${total}`);
  assert.equal(WEIGHTS.find((w) => w.key === 'demandEvidence')?.weight, 0.2);
  assert.equal(WEIGHTS.find((w) => w.key === 'complianceRisk')?.weight, 0.02);
});

test('a candidate with no research scores almost nothing and says why', () => {
  const s = scoreCandidate(candidate());
  assert.ok(s.coverage < 0.1, 'nearly every component should be unevidenced');
  assert.equal(s.confidence, 'LOW');
  const unscored = s.components.filter((c) => c.raw === null);
  assert.ok(unscored.length >= 8);
  for (const c of unscored) assert.ok(c.rationale.length > 0, 'every null component still explains itself');
});

test('every scored component carries a rationale', () => {
  const c = candidate({
    suppliers: [supplier(6, 2)],
    customer: { segment: { value: 'remote workers', provenance: 'SOURCE_CLAIM', confidence: 'MEDIUM', basis: null, sources: [] }, desires: ['less neck pain'], problems: ['neck pain from laptop use'], objections: ['will it hold my laptop'], complaintThemes: ['wobbles'] },
    marketingAngles: ['Problem/solution: neck pain'],
  });
  const s = scoreCandidate(c);
  for (const comp of s.components) {
    assert.ok(comp.rationale.trim().length > 0, `${comp.key} has no rationale`);
  }
});

test('coverage excludes unevidenced weight rather than scoring it zero', () => {
  const c = candidate({ marketingAngles: ['a', 'b'] });
  const s = scoreCandidate(c);
  const scored = s.components.filter((x) => x.raw !== null);
  const expected = Math.round(scored.reduce((sum, x) => sum + x.weight, 0) * 100) / 100;
  assert.equal(s.coverage, expected);
  // Score is the weighted mean of the covered components only.
  const manual = Math.round(scored.reduce((sum, x) => sum + (x.raw as number) * x.weight, 0) / expected);
  assert.equal(s.total, manual);
});

test('high confidence needs broad coverage AND first-hand evidence', () => {
  const c = candidate({
    suppliers: [supplier(6, 2)],
    competition: { competitors: [competitor(40), competitor(45)], saturation: { value: 'LOW', provenance: 'INFERENCE', confidence: 'MEDIUM', basis: null, sources: [] }, gaps: ['no guarantee'] },
    customer: { segment: { value: 'remote workers', provenance: 'SOURCE_CLAIM', confidence: 'MEDIUM', basis: null, sources: [] }, desires: ['x'], problems: ['y'], objections: ['z'], complaintThemes: ['w'] },
    marketingAngles: ['a', 'b', 'c'],
    compliance: { jurisdiction: 'EU', checks: [], humanReviewRequired: false },
  });
  // Coverage is broad but there is no evidence behind it yet.
  assert.equal(scoreCandidate(c).confidence, 'LOW');
  for (let i = 0; i < 12; i += 1) {
    c.evidence.push(
      evidencePoint({ claim: `demand point ${i}`, provenance: 'SOURCE_CLAIM', agent: 'market', source: { url: `https://h${i}.example.com/p`, title: null, retrievedAt: '', via: 't', excerpt: null } }),
    );
  }
  const s2 = scoreCandidate(c);
  assert.ok(s2.coverage >= 0.85, `coverage was ${s2.coverage}`);
  assert.equal(s2.confidence, 'HIGH');
});
