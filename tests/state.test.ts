import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as store from '../core/state/store.ts';
import { PATHS } from '../core/util/paths.ts';

const file = path.join(PATHS.state, 'analytics.json');
let saved: string | null = null;

before(() => {
  saved = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
});
after(async () => {
  await store.flush();
  if (saved !== null) fs.writeFileSync(file, saved);
  else if (fs.existsSync(file)) fs.rmSync(file);
});

test('a missing document reads as the fallback rather than throwing', async () => {
  const value = await store.read('analytics', { counter: 0 });
  assert.equal(typeof value, 'object');
});

test('concurrent updates are serialised, not lost', async () => {
  await store.write('analytics', { counter: 0 });
  // Fifty racing read-modify-writes: every one must land.
  await Promise.all(
    Array.from({ length: 50 }, () =>
      store.update<{ counter: number }>('analytics', { counter: 0 }, (s) => {
        s.counter += 1;
        return s;
      }),
    ),
  );
  const final = await store.read<{ counter: number }>('analytics', { counter: -1 });
  assert.equal(final.counter, 50, 'a lost update would mean agents silently clobber each other');
});

test('the mutator receives a copy, so a thrown update cannot corrupt state', async () => {
  await store.write('analytics', { counter: 7 });
  await assert.rejects(() =>
    store.update<{ counter: number }>('analytics', { counter: 0 }, (s) => {
      s.counter = 999;
      throw new Error('agent crashed mid-write');
    }),
  );
  const after = await store.read<{ counter: number }>('analytics', { counter: -1 });
  assert.equal(after.counter, 7, 'a crashed agent must leave the document as it was');
});

test('writes land as complete JSON, never truncated', async () => {
  await store.write('analytics', { counter: 3, nested: { a: [1, 2, 3] } });
  await store.flush();
  const raw = fs.readFileSync(file, 'utf8');
  assert.doesNotThrow(() => JSON.parse(raw));
});
