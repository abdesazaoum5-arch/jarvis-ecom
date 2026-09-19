import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateConfidence, evidenced, evidencePoint, isKnown, unknown } from '../core/util/evidence.ts';

test('a null value is forced to UNKNOWN whatever provenance is claimed', () => {
  const e = evidenced<number>(null, 'FACT');
  assert.equal(e.provenance, 'UNKNOWN');
  assert.equal(e.value, null);
  assert.equal(isKnown(e), false);
});

test('unknown() carries the reason so the interface can explain the gap', () => {
  const e = unknown<number>('no supplier listed a price');
  assert.equal(e.basis, 'no supplier listed a price');
  assert.equal(e.confidence, 'LOW');
});

test('confidence needs independent first-hand sources, not volume', () => {
  const sameHost = Array.from({ length: 8 }, () =>
    evidencePoint({
      claim: 'demand is rising',
      provenance: 'SOURCE_CLAIM',
      agent: 'market',
      source: { url: 'https://one.example.com/a', title: null, retrievedAt: '', via: 'test', excerpt: null },
    }),
  );
  assert.equal(aggregateConfidence(sameHost), 'LOW', 'eight claims from one host is not high confidence');

  const spread = ['a', 'b', 'c', 'd', 'e', 'f'].map((h) =>
    evidencePoint({
      claim: 'demand is rising',
      provenance: 'SOURCE_CLAIM',
      agent: 'market',
      source: { url: `https://${h}.example.com/x`, title: null, retrievedAt: '', via: 'test', excerpt: null },
    }),
  );
  assert.equal(aggregateConfidence(spread), 'HIGH');
});

test('contradicting evidence drags confidence down', () => {
  const points = [
    ...['a', 'b', 'c', 'd'].map((h) =>
      evidencePoint({ claim: 'rising', provenance: 'SOURCE_CLAIM', agent: 'm', source: { url: `https://${h}.x/1`, title: null, retrievedAt: '', via: 't', excerpt: null } }),
    ),
    ...['e', 'f', 'g', 'h'].map((h) =>
      evidencePoint({ claim: 'declining', provenance: 'SOURCE_CLAIM', agent: 'm', polarity: 'CONTRADICTS', source: { url: `https://${h}.x/1`, title: null, retrievedAt: '', via: 't', excerpt: null } }),
    ),
  ];
  assert.equal(aggregateConfidence(points), 'LOW');
});

test('inference never defaults to high confidence', () => {
  assert.equal(evidenced(5, 'INFERENCE').confidence, 'MEDIUM');
  assert.equal(evidenced(5, 'ASSUMPTION').confidence, 'LOW');
  assert.equal(evidenced(5, 'FACT').confidence, 'HIGH');
});
