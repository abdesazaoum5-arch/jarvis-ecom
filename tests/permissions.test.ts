import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from '../core/util/paths.ts';

const file = path.join(PATHS.state, 'permissions.json');
let saved: string | null = null;

before(() => {
  saved = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (fs.existsSync(file)) fs.rmSync(file);
});
after(() => {
  if (saved !== null) fs.writeFileSync(file, saved);
  else if (fs.existsSync(file)) fs.rmSync(file);
});

test('the system starts at level 0 and refuses everything above it', async () => {
  const permissions = await import('../core/permissions/index.ts');
  const state = await permissions.current();
  assert.equal(state.level, 0);
  assert.equal(state.spendingAuthorised, false);

  await assert.rejects(() => permissions.require('file.write'), /needs permission level 1/);
  await assert.rejects(() => permissions.require('ads.launch'), /needs permission level 5/);
  await assert.rejects(() => permissions.require('payment.execute'), /needs permission level 6/);
  // Research is the one thing level 0 allows.
  await permissions.require('research.web');
});

test('an env var cannot raise the level', async () => {
  process.env['JARVIS_PERMISSION_LEVEL'] = '6';
  const permissions = await import('../core/permissions/index.ts');
  assert.equal((await permissions.current()).level, 0, 'a stray env var must never unlock spending');
  delete process.env['JARVIS_PERMISSION_LEVEL'];
});

test('level 6 alone does not authorise spending', async () => {
  const permissions = await import('../core/permissions/index.ts');
  await permissions.grant(6, 'test', 'raised for the test');
  assert.equal((await permissions.current()).spendingAuthorised, false);
  await assert.rejects(() => permissions.require('ads.launch'), /spending has not been authorised/i);

  await permissions.authoriseSpending('explicitly authorised in the test');
  await permissions.require('ads.launch');
});

test('dropping below level 6 revokes the spending authorisation', async () => {
  const permissions = await import('../core/permissions/index.ts');
  await permissions.grant(6, 'test', 'up');
  await permissions.authoriseSpending('ok');
  assert.notEqual((await permissions.current()).spendingAuthorised, false);
  await permissions.grant(4, 'test', 'down');
  assert.equal((await permissions.current()).spendingAuthorised, false);
  await permissions.grant(0, 'test', 'reset');
});

test('every change is written to an audit trail', async () => {
  const permissions = await import('../core/permissions/index.ts');
  const state = await permissions.current();
  assert.ok(state.history.length > 0);
  for (const h of state.history) {
    assert.ok(h.authorisedBy.length > 0, 'a permission change must name who authorised it');
    assert.ok(h.at.length > 0);
  }
});
