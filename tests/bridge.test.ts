import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// The bridge queue is live operational state, so the tests get their own.
const SANDBOX = process.env['JARVIS_BRIDGE_DIR'] ?? fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-bridge-'));
fs.mkdirSync(SANDBOX, { recursive: true });
process.env['JARVIS_BRIDGE_DIR'] = SANDBOX;

const { ClaudeBridgeProvider, answer, pendingRequests } = await import('../core/research/bridge.ts');

const REQ = path.join(SANDBOX, 'requests');

test('an unanswered request returns nothing rather than inventing a result', async () => {
  // A deliberately short deadline: the point is what happens when nobody answers.
  const provider = new ClaudeBridgeProvider(1200);
  const hits = await provider.search('a query nobody will answer', { purpose: 'test' });
  assert.deepEqual(hits, [], 'the only honest answer to an unanswered request is nothing');
});

test('an expired request is marked EXPIRED, leaving an audit trail', () => {
  const files = fs.readdirSync(REQ).filter((f) => f.endsWith('.json'));
  const expired = files
    .map((f) => JSON.parse(fs.readFileSync(path.join(REQ, f), 'utf8')) as { status: string; query: string })
    .filter((r) => r.query === 'a query nobody will answer');
  assert.ok(expired.length > 0);
  assert.equal(expired[0]?.status, 'EXPIRED');
});

test('an answered request returns exactly what was written back', async () => {
  const provider = new ClaudeBridgeProvider(8000);
  const pending = provider.search('answerable query', { purpose: 'test' });
  // Simulate the fulfiller picking the request up and answering it.
  await new Promise((r) => setTimeout(r, 900));
  const req = pendingRequests().find((r) => r.query === 'answerable query');
  assert.ok(req, 'the request must be visible to whoever fulfils it');
  await answer(req.id, { hits: [{ title: 'Example', url: 'https://example.com/a', snippet: null }] });
  const hits = await pending;
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.url, 'https://example.com/a');
});

test('a declined request yields nothing, not a placeholder', async () => {
  const provider = new ClaudeBridgeProvider(8000);
  const pending = provider.read('https://example.com/blocked', 'what does this say?');
  await new Promise((r) => setTimeout(r, 900));
  const req = pendingRequests().find((r) => r.url === 'https://example.com/blocked');
  assert.ok(req);
  await answer(req.id, { unavailable: 'the site refused automated access' });
  assert.equal(await pending, null);
});

test('the request carries its purpose so the fulfiller can stay on target', async () => {
  const provider = new ClaudeBridgeProvider(1200);
  void provider.search('purposeful query', { purpose: 'establish demand evidence', agent: 'market' });
  await new Promise((r) => setTimeout(r, 400));
  const req = pendingRequests().find((r) => r.query === 'purposeful query');
  assert.equal(req?.purpose, 'establish demand evidence');
  assert.equal(req?.agent, 'market');
});
