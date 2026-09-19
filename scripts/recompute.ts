/**
 * Recomputes economics and scoring for the candidates already in state.
 *
 * It performs no research: it only re-derives the figures that are computed
 * from evidence already gathered. That makes it the right tool after a fix to
 * how a figure is derived — the evidence does not change, the arithmetic on top
 * of it does — without spending a fresh research budget to learn the same facts
 * twice.
 */
import * as store from '../core/state/store.ts';
import { computeEconomics } from '../agents/economics/index.ts';
import { marketplaceOf } from '../agents/supplier/index.ts';
import { scoreCandidate } from '../core/scoring/index.ts';
import { emit } from '../core/events/bus.ts';
import type { ProductCandidate } from '../core/types/index.ts';

interface Products {
  missionId: string | null;
  candidates: ProductCandidate[];
}

const products = await store.read<Products>('products', { missionId: null, candidates: [] });
if (products.candidates.length === 0) {
  console.log('No candidates in state; nothing to recompute.');
  process.exit(0);
}

for (const c of products.candidates) {
  // A supplier's marketplace is derived from the listing's own URL. Records
  // written before that derivation was fixed carry the marketplace that was
  // searched rather than the one the listing is on, which misnames a real
  // company; re-deriving it from the stored URL corrects that without
  // inventing anything.
  for (const s of c.suppliers ?? []) {
    if (s.url === null) continue;
    const actual = marketplaceOf(s.url, s.marketplace);
    if (actual !== s.marketplace) {
      console.log(`  supplier ${s.supplierName.value ?? s.id}: marketplace ${s.marketplace} -> ${actual}`);
      s.marketplace = actual;
    }
  }

  const before = c.economics?.inputs.sellingPrice;
  c.economics = computeEconomics(c);
  c.score = scoreCandidate(c);
  const after = c.economics?.inputs.sellingPrice;
  console.log(
    `${c.name}: price ${before?.value ?? '—'} (${before?.provenance ?? '—'}) -> ${after?.value ?? '—'} (${after?.provenance ?? '—'}), score ${c.score.total ?? '—'} at ${Math.round(c.score.coverage * 100)}% coverage`,
  );
  emit({
    kind: 'economics',
    message: `${c.name}: economics and score recomputed from existing evidence. Selling price is now ${after?.provenance ?? 'UNKNOWN'}.`,
    data: { sellingPrice: after?.value ?? null, provenance: after?.provenance ?? 'UNKNOWN', score: c.score.total },
  });
}

await store.write('products', products);
await store.flush();
console.log('State updated.');
