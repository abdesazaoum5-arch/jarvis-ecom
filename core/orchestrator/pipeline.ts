import type { Mission, ProductCandidate, StageId, StageState } from '../types/index.ts';

/**
 * The discovery funnel. Each gate narrows the pool for a stated reason; the
 * counts are whatever the work actually produces. If only two candidates clear
 * the final gate, two come out — the numbers are never padded to hit a target.
 */

export interface Gate {
  id: StageId;
  label: string;
  /** Cap applied after this stage, or null for "no cap, evidence decides". */
  keep: number | null;
  description: string;
}

export const FUNNEL: Gate[] = [
  { id: 'interpret', label: 'Interpret objective', keep: null, description: 'Turn the operator’s words into a mission.' },
  { id: 'discover', label: 'Discover candidates', keep: null, description: 'Search demand, problems and behaviour across source families.' },
  { id: 'deduplicate', label: 'Deduplicate', keep: null, description: 'Collapse the same product found under different names.' },
  { id: 'screen', label: 'Hard screening', keep: 50, description: 'Drop prohibited, non-physical and unworkable candidates.' },
  { id: 'demand', label: 'Demand analysis', keep: null, description: 'Gather concrete demand evidence.' },
  { id: 'trend', label: 'Trend momentum', keep: 20, description: 'Read direction of interest over an observed window.' },
  { id: 'customer', label: 'Customer research', keep: null, description: 'Read what buyers say they want and complain about.' },
  { id: 'supplier', label: 'Supplier sourcing', keep: null, description: 'Compare suppliers and retrieve real unit costs.' },
  // Competition runs before economics on purpose: the selling price in the
  // margin calculation should be what the market actually charges. With the
  // order reversed, economics never had a competitor price to read and fell
  // back to an assumed markup on every single run, which is exactly the kind of
  // invented number the system exists to avoid.
  { id: 'competition', label: 'Competitive analysis', keep: 10, description: 'Read competitor offers and find the gaps.' },
  { id: 'economics', label: 'Financial validation', keep: 5, description: 'Compute landed cost, contribution, break-even CPA and ROAS.' },
  { id: 'compliance', label: 'Compliance triage', keep: null, description: 'Flag EU/Belgian obligations and anything needing human review.' },
  { id: 'score', label: 'Scoring', keep: null, description: 'Score each candidate over evidenced components only.' },
  { id: 'deep-research', label: 'Deep research on finalists', keep: null, description: 'Close evidence gaps on the surviving candidates.' },
  { id: 'finalise', label: 'Final validation', keep: null, description: 'Apply the validation threshold; return only what passes.' },
];

/** Thresholds a candidate must clear to be presented as an opportunity. */
export interface ValidationThreshold {
  minScore: number;
  minEvidencePoints: number;
  minDistinctSources: number;
  /** Contribution before ads must be positive at the BASE scenario. */
  requirePositiveContribution: boolean;
  requireGroundedCost: boolean;
  allowHumanReviewFlags: boolean;
}

export const DEFAULT_THRESHOLD: ValidationThreshold = {
  minScore: 62,
  minEvidencePoints: 10,
  minDistinctSources: 4,
  requirePositiveContribution: true,
  requireGroundedCost: true,
  allowHumanReviewFlags: true,
};

export interface ValidationResult {
  pass: boolean;
  failures: string[];
}

export function validate(c: ProductCandidate, t: ValidationThreshold = DEFAULT_THRESHOLD): ValidationResult {
  const failures: string[] = [];
  const score = c.score?.total ?? null;
  if (score === null) failures.push('No score could be computed.');
  else if (score < t.minScore) failures.push(`Score ${score} is below the ${t.minScore} threshold.`);

  const firstHand = c.evidence.filter((e) => e.provenance === 'FACT' || e.provenance === 'SOURCE_CLAIM');
  if (firstHand.length < t.minEvidencePoints) {
    failures.push(`Only ${firstHand.length} first-hand evidence point(s); ${t.minEvidencePoints} required.`);
  }
  const hosts = new Set<string>();
  for (const e of firstHand) {
    if (!e.source) continue;
    try {
      hosts.add(new URL(e.source.url).hostname);
    } catch {
      /* ignore */
    }
  }
  if (hosts.size < t.minDistinctSources) {
    failures.push(`Evidence comes from ${hosts.size} distinct source(s); ${t.minDistinctSources} required.`);
  }
  if (t.requireGroundedCost && !c.economics) failures.push('No supplier cost could be retrieved, so the economics are unproven.');
  const base = c.economics?.scenarios.find((s) => s.label === 'BASE');
  if (t.requirePositiveContribution && base && base.contributionBeforeAds <= 0) {
    failures.push(`Contribution before advertising is ${base.contributionBeforeAds} — there is no room to buy a customer.`);
  }
  if (!t.allowHumanReviewFlags && c.compliance?.humanReviewRequired) failures.push('Compliance requires human review.');
  return { pass: failures.length === 0, failures };
}

export function initialStages(): StageState[] {
  return FUNNEL.map((g) => ({
    id: g.id,
    label: g.label,
    status: 'PENDING',
    startedAt: null,
    finishedAt: null,
    inCount: null,
    outCount: null,
    note: null,
  }));
}

/** Progress is stage completion, not an invented percentage. */
export function progressOf(mission: Mission): number {
  const done = mission.stages.filter((s) => s.status === 'DONE' || s.status === 'SKIPPED').length;
  return Math.round((done / mission.stages.length) * 100);
}
