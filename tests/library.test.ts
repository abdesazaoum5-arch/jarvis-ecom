import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepValidated, library, recoverInterrupted } from '../core/orchestrator/index.ts';
import * as store from '../core/state/store.ts';
import { candidate } from './helpers.ts';

/*
 * A mission clears the working set. Before the library existed, the next
 * command destroyed a validated product outright — hours of real research
 * gone — so these pin the rule that validation survives its own mission.
 */

test('a validated candidate survives the mission that found it', async () => {
  await store.write('library', []);
  const passed = candidate({ name: 'Passed' });
  passed.stage = 'VALIDATED';
  const rejected = candidate({ name: 'Rejected' });
  rejected.stage = 'REJECTED';
  const midFlight = candidate({ name: 'Mid-flight' });
  midFlight.stage = 'INVESTIGATING';

  await keepValidated({ missionId: 'msn_1', candidates: [passed, rejected, midFlight] });
  await store.flush();

  assert.deepEqual((await library()).map((c) => c.name), ['Passed'], 'only what actually passed is kept');
});

test('re-validating the same product replaces it rather than duplicating it', async () => {
  await store.write('library', []);
  const first = candidate({ name: 'Chair' });
  first.stage = 'VALIDATED';
  await keepValidated({ missionId: 'msn_1', candidates: [first] });
  await store.flush();

  const again: typeof first = { ...first, name: 'Chair (re-scored)' };
  await keepValidated({ missionId: 'msn_2', candidates: [again] });
  await store.flush();

  const lib = await library();
  assert.equal(lib.length, 1, 'the same product id must not appear twice');
  assert.equal(lib[0]?.name, 'Chair (re-scored)', 'the newer evaluation wins');
});

test('a mission that validated nothing leaves the library untouched', async () => {
  await store.write('library', []);
  const kept = candidate({ name: 'Chair' });
  kept.stage = 'VALIDATED';
  await keepValidated({ missionId: 'msn_1', candidates: [kept] });
  await store.flush();

  const failing = candidate({ name: 'Nothing passed' });
  failing.stage = 'REJECTED';
  await keepValidated({ missionId: 'msn_2', candidates: [failing] });
  await store.flush();

  assert.deepEqual((await library()).map((c) => c.name), ['Chair']);
});

test('a mission left running by a dead process is closed, not reported as live', async () => {
  await store.write('library', []);
  const kept = candidate({ name: 'Chair' });
  kept.stage = 'VALIDATED';
  await store.write('products', { missionId: 'msn_dead', candidates: [kept] });
  await store.write('mission', {
    id: 'msn_dead',
    utterance: 'find products',
    objective: 'find products',
    intent: 'DISCOVER_PRODUCTS',
    params: {},
    status: 'RESEARCHING',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    finishedAt: null,
    stages: [],
    activeAgents: ['research'],
    sourcesConsulted: 3,
    progress: 40,
    control: 'RUN',
    failure: null,
  });
  await store.flush();

  const recovered = await recoverInterrupted();
  await store.flush();

  assert.equal(recovered?.status, 'STOPPED');
  assert.equal(recovered?.control, 'STOP');
  assert.deepEqual(recovered?.activeAgents, []);
  assert.match(recovered?.failure ?? '', /Interrupted/);
  assert.deepEqual((await library()).map((c) => c.name), ['Chair'], 'validated work survives the recovery');
});

test('a finished mission is left exactly as it was', async () => {
  await store.write('mission', {
    id: 'msn_done', utterance: 'x', objective: 'x', intent: 'DISCOVER_PRODUCTS', params: {},
    status: 'COMPLETE', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(), stages: [], activeAgents: [], sourcesConsulted: 9,
    progress: 100, control: 'RUN', failure: null,
  });
  await store.flush();
  assert.equal((await recoverInterrupted())?.status, 'COMPLETE');
});
