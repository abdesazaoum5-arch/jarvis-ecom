/**
 * Research bridge console.
 *
 * `pending` prints the request waiting to be fulfilled; `answer <id> <file>`
 * writes back what was actually retrieved. This is the seam where a real web
 * search or page read enters the system, with its sources and timestamps.
 */
import fs from 'node:fs';
import { pendingRequests, answer } from '../core/research/bridge.ts';

const [cmd, id, file] = process.argv.slice(2);

if (cmd === 'pending') {
  const pending = pendingRequests();
  if (!pending.length) {
    console.log('NONE');
  } else {
    const r = pending[0];
    console.log(JSON.stringify({ id: r?.id, kind: r?.kind, query: r?.query, url: r?.url, purpose: r?.purpose, agent: r?.agent, question: r?.question }, null, 2));
    if (pending.length > 1) console.log(`\n(${pending.length - 1} more queued)`);
  }
} else if (cmd === 'answer' && id && file) {
  await answer(id, JSON.parse(fs.readFileSync(file, 'utf8')));
  console.log('answered', id);
} else {
  console.log('usage: bridge.ts pending | bridge.ts answer <id> <payload.json>');
}
