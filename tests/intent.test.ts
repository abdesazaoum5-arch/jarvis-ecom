import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../core/nl/intent.ts';

test('interrupts win over everything else in the utterance', () => {
  assert.equal(interpret('Jarvis stop.').intent, 'STOP');
  assert.equal(interpret('Jarvis, stop looking for products').intent, 'STOP', 'stop is never swallowed by another intent');
  assert.equal(interpret('Jarvis, pause').intent, 'PAUSE');
  assert.equal(interpret('Jarvis, continue').intent, 'RESUME');
});

test('Dutch is understood as well as English', () => {
  assert.equal(interpret('Jarvis, vind me drie producten').intent, 'DISCOVER_PRODUCTS');
  assert.equal(interpret('Jarvis, vind me drie producten').params['target'], 3);
  assert.equal(interpret('Jarvis, pauzeer').intent, 'PAUSE');
  assert.equal(interpret('Jarvis, ga door').intent, 'RESUME');
  assert.equal(interpret('Jarvis, waarom heb je product 2 afgewezen?').params['index'], 2);
  assert.equal(interpret('Jarvis, zoek een betere leverancier').intent, 'FIND_SUPPLIER');
});

test('counts are read from digits or words', () => {
  assert.equal(interpret('Jarvis, find me 5 products').params['target'], 5);
  assert.equal(interpret('Jarvis, find me three products').params['target'], 3);
  assert.equal(interpret('Jarvis, find products').params['target'], 3, 'defaults to three');
});

test('"why did you reject product number two" resolves the ordinal', () => {
  const r = interpret('Jarvis, show me why you rejected product number two');
  assert.equal(r.intent, 'EXPLAIN');
  assert.equal(r.params['index'], 2);
});

test('build intents are distinguished from each other', () => {
  assert.equal(interpret('Jarvis, build the Shopify store').intent, 'BUILD_STORE');
  assert.equal(interpret('Jarvis, build the brand').intent, 'BUILD_BRAND');
  assert.equal(interpret('Jarvis, prepare the ads').intent, 'PREPARE_ADS');
  assert.equal(interpret('Jarvis, optimize the current store').intent, 'OPTIMISE_STORE');
  assert.equal(interpret("Jarvis, analyze today's results").intent, 'ANALYSE_RESULTS');
});

test('a permission request reads the level and nothing else', () => {
  const r = interpret('Jarvis, permission level 5');
  assert.equal(r.intent, 'SET_PERMISSION');
  assert.equal(r.params['level'], 5);
});

test('an unrecognised utterance says so rather than guessing an action', () => {
  const r = interpret('Jarvis, mumble mumble');
  assert.equal(r.intent, 'UNKNOWN');
  assert.equal(r.confidence, 'LOW');
});

test('a niche change is a discovery mission', () => {
  assert.equal(interpret('Jarvis, find a completely different niche').intent, 'DISCOVER_PRODUCTS');
});
