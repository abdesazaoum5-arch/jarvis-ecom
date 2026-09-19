import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inCharacter } from '../apps/command-center/src/persona.ts';

/*
 * Register only. The point of these is that character never edits substance:
 * the numbers, the refusals and the "I could not find it" survive intact.
 */

test('the operator is addressed', () => {
  assert.match(inCharacter('DISCOVER_PRODUCTS', 'I will investigate demand.'), /\bsir\b/);
});

test('the facts of a reply are carried through untouched', () => {
  const body = 'Break-even ROAS is 1.43 and inbound freight is UNKNOWN.';
  assert.ok(inCharacter('STATUS', body).includes(body), 'the sentence itself must survive');
});

test('bad news keeps its claims and gains no reassurance', () => {
  const out = inCharacter('STATUS', 'Nothing passed validation. No candidate is being presented.');
  // The address may join the sentence; the two statements it makes may not change.
  assert.match(out, /Nothing passed validation/);
  assert.match(out, /No candidate is being presented\./);
  assert.doesNotMatch(out, /don't worry|no problem|great|excellent/i);
});

test('a refusal is delivered straight, with no flourish in front of it', () => {
  const body = 'I did not recognise an objective in that.';
  assert.equal(inCharacter('UNKNOWN', body), body);
});

test('an acknowledgement already in the sentence is not doubled', () => {
  const out = inCharacter('DISCOVER_PRODUCTS', 'Understood. I will investigate demand.');
  assert.equal(out.match(/Understood/gi)?.length, 1);
  assert.match(out, /^Understood, sir\./);
});

test('a reply that already addresses the operator is left alone', () => {
  const body = 'It is done, sir.';
  assert.equal(inCharacter('BUILD_STORE', body), body);
});

test('the same opener is not used twice in a row', () => {
  const a = inCharacter('DISCOVER_PRODUCTS', 'First order.');
  const b = inCharacter('DISCOVER_PRODUCTS', 'Second order.');
  assert.notEqual(a.split(',')[0], b.split(',')[0], 'a system that repeats one word all day sounds broken');
});

test('an empty reply stays empty rather than becoming a flourish', () => {
  assert.equal(inCharacter('STATUS', '   '), '');
});

test('an obstacle is never announced as though it were an action taken', () => {
  const out = inCharacter('BUILD_STORE', 'I need a validated candidate to build from. Run a discovery mission first.');
  assert.doesNotMatch(out, /consider it done|at once|right away|on it/i);
  assert.match(out, /^I need a validated candidate to build from, sir\./);
  assert.match(out, /Run a discovery mission first\./);
});

test('an empty mission report is addressed, not celebrated', () => {
  const out = inCharacter('STATUS', 'No mission is running. I am ready for command.');
  assert.doesNotMatch(out, /consider it done|standing report/i);
  assert.match(out, /^No mission is running, sir\./);
});
