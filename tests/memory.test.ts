import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as memory from '../core/memory/index.ts';
import * as store from '../core/state/store.ts';

// Resolved through the store so a sandboxed JARVIS_STATE_DIR is honoured.
const file = path.join(store.stateDir(), 'memory.json');
let saved: string | null = null;

before(() => {
  saved = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (fs.existsSync(file)) fs.rmSync(file);
});
after(async () => {
  await store.flush();
  if (saved !== null) fs.writeFileSync(file, saved);
  else if (fs.existsSync(file)) fs.rmSync(file);
});

test('a rejection is found again under a differently formatted name', async () => {
  await memory.recordRejection({
    name: 'LED Face Mask',
    reason: 'Depends on medical claims that cannot be substantiated.',
    stage: 'screen',
    agent: 'screening',
    reopenIf: 'A version sold on function alone with no health claim.',
  });
  const found = await memory.priorRejection('led  face   mask!');
  assert.ok(found, 'the slug must match across spacing and punctuation');
  assert.match(found.reason, /medical claims/);
  assert.match(found.reopenIf, /no health claim/);
});

test('a rejection always records what would reopen it', async () => {
  const m = await memory.load();
  for (const r of m.rejections) assert.ok(r.reopenIf.length > 0, 'a permanent rejection with no reopen condition is a dead end');
});

test('re-encountering a rejected product increments rather than duplicating', async () => {
  await memory.recordRejection({ name: 'LED Face Mask', reason: 'same reason', stage: 'screen', agent: 'screening', reopenIf: 'x' });
  const m = await memory.load();
  const matches = m.rejections.filter((r) => r.slug === 'led-face-mask');
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.timesSeen, 2);
});

test('an unrelated product is not treated as rejected', async () => {
  assert.equal(await memory.priorRejection('Adjustable laptop stand'), null);
});

test('lessons are retrievable by topic, newest first', async () => {
  await memory.recordLesson({ topic: 'hook', lesson: 'older', outcome: 'FAILED', confidence: 'LOW', basis: [] });
  await new Promise((r) => setTimeout(r, 5));
  await memory.recordLesson({ topic: 'hook', lesson: 'newer', outcome: 'WORKED', confidence: 'MEDIUM', basis: [] });
  const hooks = await memory.lessonsFor('hook');
  assert.equal(hooks[0]?.lesson, 'newer');
  assert.equal((await memory.lessonsFor('offer')).length, 0);
});
