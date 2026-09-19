/**
 * Starts a real mission from the command line and prints the outcome.
 * Used to run the pipeline without the interface in front of it.
 */
import { startMission, waitForMission, currentMission, currentProducts } from '../core/orchestrator/index.ts';
import { subscribe } from '../core/events/bus.ts';
import { research } from '../core/research/router.ts';

const utterance = process.argv[2] ?? 'Jarvis, find me 3 products with strong current and future commercial potential.';
const budget = Number(process.argv[3] ?? 60);
const pool = Number(process.argv[4] ?? 12);

subscribe((e) => {
  const tag = `${e.kind}/${e.agent ?? '-'}`.padEnd(22);
  console.log(`${e.at.slice(11, 19)} ${tag} ${e.message}`);
});

await startMission({ utterance, poolTarget: pool, researchBudget: budget });
await waitForMission();

const [mission, products] = await Promise.all([currentMission(), currentProducts()]);
console.log('\n=== OUTCOME ===');
console.log('status:', mission?.status, '| progress:', mission?.progress, '| research requests spent:', research.spent);
for (const c of products.candidates) {
  console.log(`- ${c.stage.padEnd(14)} ${String(c.score?.total ?? '—').padStart(3)} ${c.name}${c.rejection ? ` :: ${c.rejection.reason}` : ''}`);
}
await research.close();
process.exit(0);
