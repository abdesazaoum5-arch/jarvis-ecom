import type { Confidence, ProductCandidate, ProductScore, ScoreComponent, ScoreKey } from '../types/index.ts';
import { isKnown } from '../util/evidence.ts';
import { nowIso } from '../util/id.ts';

/**
 * Scoring.
 *
 * A component is scored only where evidence exists; otherwise it is null and
 * its weight is removed from the denominator. `coverage` reports how much of
 * the weighting actually had evidence behind it, and confidence is capped by
 * that coverage — a 90 built on two data points cannot present as HIGH.
 */

export const WEIGHTS: Array<{ key: ScoreKey; label: string; weight: number }> = [
  { key: 'demandEvidence', label: 'Demand evidence', weight: 0.2 },
  { key: 'problemStrength', label: 'Problem / desire strength', weight: 0.15 },
  { key: 'creativePotential', label: 'Creative potential', weight: 0.15 },
  { key: 'marginPotential', label: 'Margin potential', weight: 0.15 },
  { key: 'competition', label: 'Competition / saturation', weight: 0.1 },
  { key: 'brandability', label: 'Brandability', weight: 0.1 },
  { key: 'logistics', label: 'Shipping / logistics', weight: 0.05 },
  { key: 'supplierAvailability', label: 'Supplier availability', weight: 0.05 },
  { key: 'repeatPurchase', label: 'Repeat purchase / LTV', weight: 0.03 },
  { key: 'complianceRisk', label: 'Compliance / risk', weight: 0.02 },
];

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function score(key: ScoreKey, c: ProductCandidate): { raw: number | null; rationale: string; evidenceIds: string[] } {
  switch (key) {
    case 'demandEvidence': {
      const points = c.evidence.filter((e) => e.polarity === 'SUPPORTS' && /demand|search|volume|interest|sales|popular/i.test(e.claim));
      const firstHand = points.filter((e) => e.provenance === 'FACT' || e.provenance === 'SOURCE_CLAIM');
      if (!points.length) return { raw: null, rationale: 'No demand evidence was retrieved.', evidenceIds: [] };
      return {
        raw: clamp(30 + firstHand.length * 12),
        rationale: `${firstHand.length} first-hand demand data point(s) across ${distinctHosts(points)} source(s).`,
        evidenceIds: points.map((e) => e.id),
      };
    }
    case 'problemStrength': {
      const problems = c.customer?.problems ?? [];
      const complaints = c.customer?.complaintThemes ?? [];
      if (!problems.length && !complaints.length) return { raw: null, rationale: 'No customer research has been carried out yet.', evidenceIds: [] };
      return {
        raw: clamp(35 + problems.length * 10 + complaints.length * 5),
        rationale: `${problems.length} articulated problem(s) and ${complaints.length} recurring complaint theme(s) found in customer sources.`,
        evidenceIds: [],
      };
    }
    case 'creativePotential': {
      const angles = c.marketingAngles.length;
      if (!angles) return { raw: null, rationale: 'No marketing angles have been derived yet.', evidenceIds: [] };
      const demonstrable = /visible|demonstrat|before|after|transform|result/i.test(c.description ?? '');
      return {
        raw: clamp(40 + angles * 8 + (demonstrable ? 15 : 0)),
        rationale: `${angles} distinct angle(s)${demonstrable ? '; the effect is visually demonstrable' : '; visual demonstrability not established'}.`,
        evidenceIds: [],
      };
    }
    case 'marginPotential': {
      const base = c.economics?.scenarios.find((s) => s.label === 'BASE');
      if (!base) return { raw: null, rationale: 'No grounded cost base, so margin cannot be scored.', evidenceIds: [] };
      const ratio = base.aov > 0 ? base.contributionBeforeAds / base.aov : 0;
      const grounded = c.economics?.fullyGrounded ?? false;
      return {
        // A margin built on assumed inputs is worth less as evidence.
        raw: clamp(ratio * 180 * (grounded ? 1 : 0.8)),
        rationale: `Contribution is ${(ratio * 100).toFixed(0)}% of AOV${grounded ? '' : ' on partly assumed inputs'}.`,
        evidenceIds: [],
      };
    }
    case 'competition': {
      const comp = c.competition;
      if (!comp || !isKnown(comp.saturation)) return { raw: null, rationale: 'Saturation has not been established.', evidenceIds: [] };
      const map = { LOW: 85, MODERATE: 60, HIGH: 30 } as const;
      const gaps = comp.gaps.length;
      return {
        raw: clamp(map[comp.saturation.value] + Math.min(gaps * 4, 12)),
        rationale: `${comp.saturation.value.toLowerCase()} saturation across ${comp.competitors.length} competitor(s); ${gaps} market gap(s) identified.`,
        evidenceIds: [],
      };
    }
    case 'brandability': {
      const gaps = c.competition?.gaps.length ?? 0;
      const segment = c.customer?.segment;
      if (!gaps && !isKnown(segment ?? null)) return { raw: null, rationale: 'No positioning space or defined segment established yet.', evidenceIds: [] };
      return {
        raw: clamp(40 + gaps * 10 + (isKnown(segment ?? null) ? 15 : 0)),
        rationale: `${gaps} unclaimed positioning gap(s)${isKnown(segment ?? null) ? ' and a defined customer segment' : ''}.`,
        evidenceIds: [],
      };
    }
    case 'logistics': {
      const s = c.suppliers.find((x) => isKnown(x.deliveryDays));
      if (!s) return { raw: null, rationale: 'No delivery information was retrievable.', evidenceIds: [] };
      const days = Number(/(\d+)/.exec(String(s.deliveryDays.value))?.[1] ?? '0');
      return { raw: clamp(days > 0 ? 100 - days * 3 : 50), rationale: `Quoted delivery around ${s.deliveryDays.value}.`, evidenceIds: [] };
    }
    case 'supplierAvailability': {
      const priced = c.suppliers.filter((s) => isKnown(s.unitPrice)).length;
      if (!c.suppliers.length) return { raw: null, rationale: 'No supplier research has been carried out yet.', evidenceIds: [] };
      return { raw: clamp(25 + priced * 20), rationale: `${priced} supplier(s) with a retrievable unit price out of ${c.suppliers.length} found.`, evidenceIds: [] };
    }
    case 'repeatPurchase': {
      const consumable = /refill|replace|consumable|subscription|monthly|pack of|cartridge/i.test(`${c.name} ${c.description ?? ''}`);
      return {
        raw: consumable ? 75 : 35,
        rationale: consumable ? 'The product or its description implies a consumable or refill cycle.' : 'No repeat-purchase mechanism is evident; treated as a one-off purchase.',
        evidenceIds: [],
      };
    }
    case 'complianceRisk': {
      const cp = c.compliance;
      if (!cp) return { raw: null, rationale: 'Compliance has not been reviewed yet.', evidenceIds: [] };
      if (cp.humanReviewRequired) return { raw: 25, rationale: 'At least one compliance area needs human review before launch.', evidenceIds: [] };
      const attention = cp.checks.filter((x) => x.status === 'ATTENTION').length;
      return { raw: clamp(90 - attention * 15), rationale: `${attention} compliance area(s) flagged for attention.`, evidenceIds: [] };
    }
  }
}

export function scoreCandidate(c: ProductCandidate): ProductScore {
  const components: ScoreComponent[] = WEIGHTS.map((w) => {
    const r = score(w.key, c);
    return { key: w.key, label: w.label, weight: w.weight, raw: r.raw, rationale: r.rationale, evidenceIds: r.evidenceIds };
  });
  const scored = components.filter((x) => x.raw !== null);
  const coveredWeight = scored.reduce((sum, x) => sum + x.weight, 0);
  const total = coveredWeight > 0 ? Math.round(scored.reduce((sum, x) => sum + (x.raw as number) * x.weight, 0) / coveredWeight) : null;
  const coverage = Math.round(coveredWeight * 100) / 100;
  return { total, coverage, confidence: confidenceFor(coverage, c), components, computedAt: nowIso() };
}

/** Confidence is bounded by how much of the model was actually evidenced. */
export function confidenceFor(coverage: number, c: ProductCandidate): Confidence {
  const firstHand = c.evidence.filter((e) => e.provenance === 'FACT' || e.provenance === 'SOURCE_CLAIM').length;
  if (coverage >= 0.85 && firstHand >= 10) return 'HIGH';
  if (coverage >= 0.6 && firstHand >= 5) return 'MEDIUM';
  return 'LOW';
}

function distinctHosts(points: ProductCandidate['evidence']): number {
  const hosts = new Set<string>();
  for (const p of points) {
    if (!p.source) continue;
    try {
      hosts.add(new URL(p.source.url).hostname);
    } catch {
      /* ignore */
    }
  }
  return hosts.size;
}
