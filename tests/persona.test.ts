import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inCharacter } from '../apps/command-center/src/persona.ts';

/*
 * Register only. The point of these is that character never edits substance:
 * the numbers, the refusals and the "ik heb niets gevonden" survive intact.
 */

test('the operator is addressed', () => {
  assert.match(inCharacter('DISCOVER_PRODUCTS', 'Ik onderzoek de vraag.'), /\bmeneer\b/);
});

test('the facts of a reply are carried through untouched', () => {
  const body = 'De break-even ROAS is 1,43 en de aanvoerkosten zijn ONBEKEND.';
  assert.ok(inCharacter('STATUS', body).includes(body), 'the sentence itself must survive');
});

test('bad news keeps its claims and gains no reassurance', () => {
  const out = inCharacter('STATUS', 'Niets heeft de validatie gehaald. Er wordt geen kandidaat gepresenteerd.');
  // The address may join the sentence; the two statements it makes may not change.
  assert.match(out, /Niets heeft de validatie gehaald/);
  assert.match(out, /Er wordt geen kandidaat gepresenteerd\./);
  assert.doesNotMatch(out, /geen zorgen|geen probleem|prima|uitstekend/i);
});

test('a refusal is delivered straight, with no flourish in front of it', () => {
  const body = 'Daar herken ik geen opdracht in.';
  assert.equal(inCharacter('UNKNOWN', body), body);
});

test('an acknowledgement already in the sentence is not doubled', () => {
  const out = inCharacter('DISCOVER_PRODUCTS', 'Begrepen. Ik onderzoek de vraag.');
  assert.equal(out.match(/Begrepen/gi)?.length, 1);
  assert.match(out, /^Begrepen, meneer\./);
});

test('a reply that already addresses the operator is left alone', () => {
  const body = 'Het is gebeurd, meneer.';
  assert.equal(inCharacter('BUILD_STORE', body), body);
});

test('the same opener is not used twice in a row', () => {
  const a = inCharacter('DISCOVER_PRODUCTS', 'Eerste opdracht.');
  const b = inCharacter('DISCOVER_PRODUCTS', 'Tweede opdracht.');
  assert.notEqual(a.split(',')[0], b.split(',')[0], 'a system that repeats one word all day sounds broken');
});

test('an empty reply stays empty rather than becoming a flourish', () => {
  assert.equal(inCharacter('STATUS', '   '), '');
});

test('an obstacle is never announced as though it were an action taken', () => {
  const out = inCharacter('BUILD_STORE', 'Ik heb een gevalideerde kandidaat nodig om op te bouwen. Laat me eerst zoeken.');
  assert.doesNotMatch(out, /komt in orde|meteen|doe ik|aan de slag/i);
  assert.match(out, /^Ik heb een gevalideerde kandidaat nodig om op te bouwen, meneer\./);
  assert.match(out, /Laat me eerst zoeken\./);
});

test('an empty mission report is addressed, not celebrated', () => {
  const out = inCharacter('STATUS', 'Er draait geen missie. Ik wacht op uw opdracht.');
  assert.doesNotMatch(out, /komt in orde|stand van zaken/i);
  assert.match(out, /^Er draait geen missie, meneer\./);
});

test('an obstacle is recognised however the sentence is hedged', () => {
  for (const body of [
    'Er zijn nog geen kandidaten om uit te leggen.',
    'Er is geen actieve missie om op voort te bouwen.',
    'Er staat nog geen winkel klaar om te optimaliseren.',
  ]) {
    const out = inCharacter('EXPLAIN', body);
    assert.doesNotMatch(out, /komt in orde|meteen|doe ik|aan de slag/i, `acknowledged an obstacle: ${out}`);
    assert.match(out, /\bmeneer\b/);
  }
});
