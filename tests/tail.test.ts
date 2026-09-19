import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Tests must not write into the log the operator reads. `npm test` sets
// JARVIS_LOG_DIR for the whole run; this keeps the file isolated even when the
// test is run on its own.
const SANDBOX = process.env['JARVIS_LOG_DIR'] ?? fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-log-'));
fs.mkdirSync(SANDBOX, { recursive: true });
process.env['JARVIS_LOG_DIR'] = SANDBOX;

const { emit, recent, subscribe } = await import('../core/events/bus.ts');
const { followLog } = await import('../core/events/tail.ts');

const LOG = path.join(SANDBOX, 'events.ndjson');

test('the live stream carries events emitted by other processes', async () => {
  // Emit locally first so the log file and the stream both exist.
  emit({ kind: 'system', message: 'tail test: local event' });

  const tail = followLog(60);
  const seen: string[] = [];
  const off = subscribe((e) => seen.push(e.message));

  // Stands in for a mission process: a line appended by someone else entirely.
  const foreign = {
    id: `evt_tail_${Date.now()}`,
    at: new Date().toISOString(),
    kind: 'agent',
    message: 'tail test: event from another process',
    agent: 'research',
    missionId: null,
    target: null,
    data: null,
    level: 'info',
  };
  fs.appendFileSync(LOG, `${JSON.stringify(foreign)}\n`, 'utf8');

  await new Promise((r) => setTimeout(r, 400));
  off();
  tail.stop();

  assert.ok(seen.includes(foreign.message), 'an event from another process must reach the live stream');
  assert.ok(
    recent(50).some((e) => e.id === foreign.id),
    'and must be in the recent buffer the interface loads on connect',
  );
});

test('an event is never delivered twice, however it arrives', async () => {
  const tail = followLog(60);
  const seen: string[] = [];
  const off = subscribe((e) => seen.push(e.id));

  // A locally emitted event is written to the log, so the tail will read the
  // same event back: it must be recognised rather than shown again.
  const local = emit({ kind: 'system', message: 'tail test: no duplicates' });
  await new Promise((r) => setTimeout(r, 400));
  off();
  tail.stop();

  assert.equal(seen.filter((id) => id === local.id).length, 1);
});
