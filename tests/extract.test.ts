import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bool, list, num, parseAnswer, questionFor, str } from '../core/research/extract.ts';
import type { PageRead } from '../core/research/types.ts';

function page(answer: string | null): PageRead {
  return { url: 'https://example.com', title: null, text: '', answer, retrievedAt: '', via: 'test', screenshot: null };
}

test('the question spells out that unsupported fields must come back null', () => {
  const q = questionFor('Read this listing.', [{ name: 'price', describe: 'the price', type: 'number' }]);
  assert.match(q, /must be null/);
  assert.match(q, /Do not estimate, infer or fill in a plausible value/);
  assert.match(q, /"price": number \| null/);
});

test('JSON is parsed out of fenced blocks and surrounding prose', () => {
  assert.equal(str(parseAnswer(page('```json\n{"a":"x"}\n```')), 'a'), 'x');
  assert.equal(str(parseAnswer(page('Here is what I found:\n{"a":"y"}\nHope that helps.')), 'a'), 'y');
});

test('a null field stays null rather than becoming a string', () => {
  const o = parseAnswer(page('{"price": null, "name": "  ", "moq": "not stated"}'));
  assert.equal(num(o, 'price'), null);
  assert.equal(str(o, 'name'), null, 'whitespace is not a value');
  assert.equal(num(o, 'moq'), null, 'prose with no number is not a number');
});

test('numbers survive currency symbols and comma decimals', () => {
  const o = parseAnswer(page('{"a": "€ 12,50", "b": "US$7.99", "c": 3}'));
  assert.equal(num(o, 'a'), 12.5);
  assert.equal(num(o, 'b'), 7.99);
  assert.equal(num(o, 'c'), 3);
});

test('booleans accept yes/no and Dutch ja/nee, and nothing else', () => {
  const o = parseAnswer(page('{"a": "yes", "b": "nee", "c": "maybe", "d": true}'));
  assert.equal(bool(o, 'a'), true);
  assert.equal(bool(o, 'b'), false);
  assert.equal(bool(o, 'c'), null, 'ambiguity resolves to unknown, never to false');
  assert.equal(bool(o, 'd'), true);
});

test('lists drop empty entries and non-strings', () => {
  const o = parseAnswer(page('{"xs": ["a", "", null, 5, "  b  "]}'));
  assert.deepEqual(list(o, 'xs'), ['a', 'b']);
});

test('unparseable answers yield null rather than a partial guess', () => {
  assert.equal(parseAnswer(page('not json at all')), null);
  assert.equal(parseAnswer(page(null)), null);
  assert.equal(parseAnswer(null), null);
  assert.equal(parseAnswer(page('{broken json')), null);
});
