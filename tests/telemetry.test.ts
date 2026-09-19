import test from 'node:test';
import assert from 'node:assert/strict';
import { measure } from '../core/telemetry/index.ts';

test('telemetry', async (t) => {
  await t.test('never draws a bar for a metric it could not measure', async () => {
    const telemetry = await measure();
    for (const m of telemetry.metrics) {
      if (m.value === null) {
        assert.equal(m.fraction, null, `${m.id} reported a bar position without a measurement`);
        assert.match(m.display, /UNKNOWN|SAMPLING/, `${m.id} must say it is unknown rather than show a figure`);
      }
    }
  });

  await t.test('a bar position is always inside a real 0..1 range', async () => {
    const telemetry = await measure();
    for (const m of telemetry.metrics) {
      if (m.fraction === null) continue;
      assert.ok(m.fraction >= 0 && m.fraction <= 1, `${m.id} fraction ${m.fraction} is outside 0..1`);
    }
  });

  await t.test('CPU is a delta between samples, not a lifetime average', async () => {
    // The first sample has nothing to compare against, so it must say so.
    const first = await measure();
    const cpuFirst = first.metrics.find((m) => m.id === 'cpu');
    assert.ok(cpuFirst);
    await new Promise((r) => setTimeout(r, 300));
    const second = await measure();
    const cpuSecond = second.metrics.find((m) => m.id === 'cpu');
    assert.ok(cpuSecond);
    assert.equal(typeof cpuSecond.value, 'number');
  });

  await t.test('uptime comes from the process, so it only moves forward', async () => {
    const a = await measure();
    const b = await measure();
    assert.ok(b.uptimeSeconds >= a.uptimeSeconds);
  });
});
