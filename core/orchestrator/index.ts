import type { Mission, ProductCandidate, StageId } from '../types/index.ts';
import type { Interpretation } from '../nl/intent.ts';
import { interpret } from '../nl/intent.ts';
import * as store from '../state/store.ts';
import { emit } from '../events/bus.ts';
import { newId, nowIso, slug } from '../util/id.ts';
import { makeContext, Interrupted } from '../agent/base.ts';
import { research } from '../research/router.ts';
import { DEFAULT_THRESHOLD, FUNNEL, initialStages, progressOf, validate } from './pipeline.ts';
import { scoreCandidate } from '../scoring/index.ts';
import * as memory from '../memory/index.ts';

import { researchAgent } from '../../agents/research/index.ts';
import { marketAgent } from '../../agents/market/index.ts';
import { trendAgent } from '../../agents/trend/index.ts';
import { customerAgent } from '../../agents/customer/index.ts';
import { supplierAgent } from '../../agents/supplier/index.ts';
import { competitorAgent } from '../../agents/competitor/index.ts';
import { complianceAgent } from '../../agents/compliance/index.ts';
import { economicsAgent } from '../../agents/economics/index.ts';
import { screen } from '../../agents/screening/index.ts';

/**
 * The orchestrator owns the mission: it advances the funnel, keeps shared state
 * current after every stage, honours interrupts between every unit of work, and
 * records why each candidate left the pipeline.
 */

const EMPTY_MISSION: Mission | null = null;
type Products = { missionId: string | null; candidates: ProductCandidate[] };
const EMPTY_PRODUCTS: Products = { missionId: null, candidates: [] };

let running: Promise<void> | null = null;

export async function currentMission(): Promise<Mission | null> {
  return store.read<Mission | null>('mission', EMPTY_MISSION);
}

export async function currentProducts(): Promise<Products> {
  return store.read<Products>('products', EMPTY_PRODUCTS);
}

async function readControl(): Promise<Mission['control']> {
  const m = await currentMission();
  return m?.control ?? 'RUN';
}

export async function setControl(control: Mission['control']): Promise<Mission | null> {
  const m = await store.update<Mission | null>('mission', EMPTY_MISSION, (mission) => {
    if (!mission) return mission;
    mission.control = control;
    mission.status = control === 'PAUSE' ? 'PAUSED' : control === 'STOP' ? 'STOPPED' : mission.status;
    mission.updatedAt = nowIso();
    return mission;
  });
  emit({
    kind: 'mission',
    message:
      control === 'STOP'
        ? 'Stopping. All non-critical automation halts at the next checkpoint.'
        : control === 'PAUSE'
          ? 'Pausing. State is held and nothing is lost.'
          : 'Resuming.',
    missionId: m?.id ?? null,
  });
  return m;
}

async function patchMission(fn: (m: Mission) => void): Promise<Mission | null> {
  return store.update<Mission | null>('mission', EMPTY_MISSION, (m) => {
    if (!m) return m;
    fn(m);
    m.updatedAt = nowIso();
    m.progress = progressOf(m);
    return m;
  });
}

async function stage(id: StageId, patch: Partial<{ status: 'ACTIVE' | 'DONE' | 'SKIPPED' | 'FAILED'; inCount: number; outCount: number; note: string }>): Promise<void> {
  await patchMission((m) => {
    const s = m.stages.find((x) => x.id === id);
    if (!s) return;
    if (patch.status) {
      s.status = patch.status;
      if (patch.status === 'ACTIVE') s.startedAt = nowIso();
      if (patch.status === 'DONE' || patch.status === 'SKIPPED' || patch.status === 'FAILED') s.finishedAt = nowIso();
    }
    if (patch.inCount !== undefined) s.inCount = patch.inCount;
    if (patch.outCount !== undefined) s.outCount = patch.outCount;
    if (patch.note !== undefined) s.note = patch.note;
  });
  const gate = FUNNEL.find((g) => g.id === id);
  if (patch.status === 'ACTIVE') {
    emit({ kind: 'mission', message: `${gate?.label ?? id}: starting.`, data: { stage: id } });
  }
  if (patch.status === 'DONE') {
    emit({
      kind: 'mission',
      message: `${gate?.label ?? id}: ${patch.outCount ?? '—'} of ${patch.inCount ?? '—'} carried forward.${patch.note ? ` ${patch.note}` : ''}`,
      data: { stage: id, in: patch.inCount ?? null, out: patch.outCount ?? null },
    });
  }
}

async function saveCandidates(missionId: string, candidates: ProductCandidate[]): Promise<void> {
  await store.write<Products>('products', { missionId, candidates });
}

async function reject(c: ProductCandidate, stageId: StageId, reason: string, agent: string, reopenIf: string): Promise<void> {
  c.stage = 'REJECTED';
  c.lifecycle = 'KILLED';
  c.rejection = { at: nowIso(), stage: stageId, reason, agent };
  c.updatedAt = nowIso();
  await memory.recordRejection({ name: c.name, reason, stage: stageId, agent, reopenIf, evidence: c.evidence });
  emit({
    kind: 'rejection',
    agent,
    missionId: c.missionId,
    message: `Rejecting ${c.name}: ${reason}`,
    data: { candidateId: c.id, stage: stageId, reason },
  });
}

/** Keeps the highest-scoring `n`, rejecting the rest with the real reason. */
async function narrow(candidates: ProductCandidate[], n: number | null, stageId: StageId, agent: string): Promise<ProductCandidate[]> {
  const live = candidates.filter((c) => c.stage !== 'REJECTED');
  if (n === null || live.length <= n) return live;
  const ranked = [...live].sort((a, b) => (b.score?.total ?? -1) - (a.score?.total ?? -1) || b.evidence.length - a.evidence.length);
  const keep = ranked.slice(0, n);
  for (const c of ranked.slice(n)) {
    await reject(c, stageId, `Ranked below the top ${n} at this gate on evidence and score.`, agent, 'New evidence that materially changes its score.');
  }
  return keep;
}

export interface StartOptions {
  utterance: string;
  interpretation?: Interpretation;
  poolTarget?: number;
  finalTarget?: number;
  /** Caps the mission's research requests. Omit for unbounded research. */
  researchBudget?: number;
  /**
   * Share of the budget reserved per agent. Omit to use DEFAULT_ALLOCATION,
   * which keeps enough back for the stages that decide whether a candidate is
   * actually sellable.
   */
  researchAllocation?: Record<string, number>;
}

/**
 * Discovery and demand come first and would otherwise consume everything, so
 * the stages that establish a real cost and a real competitive price hold their
 * own reserves. Without this a mission reliably ends with UNKNOWN economics,
 * which is honest but useless: it cannot tell the operator whether anything is
 * worth selling.
 */
export const DEFAULT_ALLOCATION: Record<string, number> = {
  research: 0.2,
  market: 0.2,
  trend: 0.1,
  competitor: 0.2,
  supplier: 0.2,
};

export async function startMission(opts: StartOptions): Promise<Mission> {
  const interpretation = opts.interpretation ?? interpret(opts.utterance);
  const finalTarget = opts.finalTarget ?? Number(interpretation.params['target'] ?? 3);
  const niche = String(interpretation.params['niche'] ?? '') || null;
  const mission: Mission = {
    id: newId('msn'),
    utterance: opts.utterance,
    objective: interpretation.objective,
    intent: interpretation.intent,
    params: { ...interpretation.params, finalTarget },
    status: 'INTERPRETING',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    finishedAt: null,
    stages: initialStages(),
    activeAgents: [],
    sourcesConsulted: 0,
    progress: 0,
    control: 'RUN',
    failure: null,
  };
  await store.write('mission', mission);
  await store.write<Products>('products', { missionId: mission.id, candidates: [] });
  emit({ kind: 'mission', missionId: mission.id, message: `Mission accepted: ${mission.objective}`, data: { intent: mission.intent } });

  if (opts.researchBudget !== undefined) {
    research.setBudget(opts.researchBudget, opts.researchAllocation ?? DEFAULT_ALLOCATION);
  }
  running = runDiscovery(mission, { poolTarget: opts.poolTarget ?? 100, finalTarget, niche }).catch(async (err) => {
    if (err instanceof Interrupted) {
      await patchMission((m) => {
        m.status = err.control === 'STOP' ? 'STOPPED' : 'PAUSED';
        m.finishedAt = err.control === 'STOP' ? nowIso() : null;
      });
      return;
    }
    emit({ kind: 'error', level: 'error', missionId: mission.id, message: `Mission failed: ${(err as Error).message}` });
    await patchMission((m) => {
      m.status = 'FAILED';
      m.failure = (err as Error).message;
      m.finishedAt = nowIso();
    });
  });
  return mission;
}

export function isRunning(): boolean {
  return running !== null;
}

export async function waitForMission(): Promise<void> {
  if (running) await running;
  running = null;
}

async function runDiscovery(mission: Mission, opts: { poolTarget: number; finalTarget: number; niche: string | null }): Promise<void> {
  const ctxFor = (agentId: string) => makeContext({ mission, research, agentId, readControl });

  await research.init();
  await stage('interpret', { status: 'DONE', note: mission.objective });
  await patchMission((m) => {
    m.status = 'RESEARCHING';
    m.activeAgents = ['research'];
  });

  // ---- Discovery -------------------------------------------------------
  await stage('discover', { status: 'ACTIVE' });
  let candidates = await researchAgent.run({ missionId: mission.id, niche: opts.niche, poolTarget: opts.poolTarget }, ctxFor('research'));
  await saveCandidates(mission.id, candidates);
  await stage('discover', { status: 'DONE', inCount: 0, outCount: candidates.length });

  if (!candidates.length) {
    emit({
      kind: 'mission',
      missionId: mission.id,
      level: 'warn',
      message: 'Discovery returned no candidates. No products are being presented; the research path returned nothing to work with.',
    });
    await patchMission((m) => {
      m.status = 'COMPLETE';
      m.finishedAt = nowIso();
    });
    return;
  }

  // ---- Deduplicate -----------------------------------------------------
  await stage('deduplicate', { status: 'ACTIVE', inCount: candidates.length });
  const bySlug = new Map<string, ProductCandidate>();
  for (const c of candidates) {
    const key = slug(c.name);
    const existing = bySlug.get(key);
    if (existing) {
      existing.discoveredVia.push(...c.discoveredVia);
      existing.evidence.push(...c.evidence);
    } else {
      bySlug.set(key, c);
    }
  }
  candidates = [...bySlug.values()];
  await saveCandidates(mission.id, candidates);
  await stage('deduplicate', { status: 'DONE', outCount: candidates.length });

  // ---- Hard screening --------------------------------------------------
  await stage('screen', { status: 'ACTIVE', inCount: candidates.length });
  for (const c of candidates) {
    await ctxFor('screening').checkControl();
    const result = screen(c);
    if (!result.pass) await reject(c, 'screen', result.reason, 'screening', result.reopenIf);
    else c.stage = 'INVESTIGATING';
  }
  candidates = await narrow(candidates, FUNNEL.find((g) => g.id === 'screen')?.keep ?? null, 'screen', 'screening');
  await saveCandidates(mission.id, candidates);
  await stage('screen', { status: 'DONE', outCount: candidates.length });

  // ---- Per-candidate research -----------------------------------------
  const perCandidate: Array<{ id: StageId; run: (c: ProductCandidate) => Promise<ProductCandidate>; agent: string }> = [
    { id: 'demand', agent: 'market', run: (c) => marketAgent.run(c, ctxFor('market')) },
    { id: 'trend', agent: 'trend', run: (c) => trendAgent.run(c, ctxFor('trend')) },
    { id: 'customer', agent: 'customer', run: (c) => customerAgent.run(c, ctxFor('customer')) },
    { id: 'supplier', agent: 'supplier', run: (c) => supplierAgent.run(c, ctxFor('supplier')) },
    { id: 'competition', agent: 'competitor', run: (c) => competitorAgent.run(c, ctxFor('competitor')) },
    { id: 'economics', agent: 'economics', run: (c) => economicsAgent.run(c, ctxFor('economics')) },
    { id: 'compliance', agent: 'compliance', run: (c) => complianceAgent.run(c, ctxFor('compliance')) },
  ];

  for (const step of perCandidate) {
    const live = candidates.filter((c) => c.stage !== 'REJECTED');
    await stage(step.id, { status: 'ACTIVE', inCount: live.length });
    await patchMission((m) => {
      m.activeAgents = [step.agent];
    });
    for (const c of live) {
      await ctxFor(step.agent).checkControl();
      await step.run(c);
      c.updatedAt = nowIso();
      await saveCandidates(mission.id, candidates);
    }

    // Gate-specific rejections, each with a stated reason.
    if (step.id === 'trend') {
      for (const c of candidates.filter((x) => x.stage !== 'REJECTED')) {
        if (c.trend?.momentum.value === 'DECLINING') {
          await reject(c, 'trend', 'Interest is declining over the observed window.', 'trend', 'A new trend reading showing renewed growth.');
        }
      }
    }
    if (step.id === 'economics') {
      for (const c of candidates.filter((x) => x.stage !== 'REJECTED')) {
        if (!c.economics) {
          await reject(c, 'economics', 'No supplier unit cost could be retrieved, so no margin can be proven.', 'economics', 'A supplier listing with a readable unit price.');
          continue;
        }
        const base = c.economics.scenarios.find((s) => s.label === 'BASE');
        if (base && base.contributionBeforeAds <= 0) {
          await reject(c, 'economics', `Contribution before advertising is ${c.economics.currency} ${base.contributionBeforeAds} — there is nothing left to buy a customer with.`, 'economics', 'A cheaper cost base or a defensible higher price.');
        }
      }
    }

    // Score early so gate narrowing is evidence-driven rather than arbitrary.
    for (const c of candidates.filter((x) => x.stage !== 'REJECTED')) c.score = scoreCandidate(c);
    const gate = FUNNEL.find((g) => g.id === step.id);
    candidates = await narrow(candidates, gate?.keep ?? null, step.id, step.agent);
    await saveCandidates(mission.id, candidates);
    await stage(step.id, { status: 'DONE', outCount: candidates.filter((c) => c.stage !== 'REJECTED').length });
  }

  // ---- Scoring ---------------------------------------------------------
  await stage('score', { status: 'ACTIVE', inCount: candidates.length });
  for (const c of candidates) {
    c.score = scoreCandidate(c);
    emit({
      kind: 'discovery',
      agent: 'orchestrator',
      missionId: mission.id,
      message: `${c.name} scores ${c.score.total ?? '—'} at ${Math.round(c.score.coverage * 100)}% evidence coverage (${c.score.confidence.toLowerCase()} confidence).`,
      data: { candidateId: c.id, score: c.score.total, coverage: c.score.coverage },
    });
  }
  await saveCandidates(mission.id, candidates);
  await stage('score', { status: 'DONE', outCount: candidates.filter((c) => c.stage !== 'REJECTED').length });

  // ---- Deep research on the survivors ---------------------------------
  await stage('deep-research', { status: 'ACTIVE' });
  const survivors = candidates.filter((c) => c.stage !== 'REJECTED');
  for (const c of survivors) {
    await ctxFor('research').checkControl();
    const v = validate(c, DEFAULT_THRESHOLD);
    if (!v.pass && v.failures.some((f) => /evidence point|distinct source/.test(f))) {
      emit({ kind: 'agent', agent: 'research', missionId: mission.id, message: `Closing evidence gaps on ${c.name}: ${v.failures.join(' ')}` });
      await marketAgent.run(c, ctxFor('market'));
      c.score = scoreCandidate(c);
      await saveCandidates(mission.id, candidates);
    }
  }
  await stage('deep-research', { status: 'DONE', inCount: survivors.length, outCount: survivors.length });

  // ---- Final validation ------------------------------------------------
  await stage('finalise', { status: 'ACTIVE', inCount: survivors.length });
  const finalists: ProductCandidate[] = [];
  for (const c of survivors) {
    const v = validate(c, DEFAULT_THRESHOLD);
    if (v.pass) {
      c.stage = 'VALIDATED';
      c.lifecycle = 'PROMISING';
      finalists.push(c);
      emit({ kind: 'discovery', agent: 'orchestrator', missionId: mission.id, message: `${c.name} passes validation.`, data: { candidateId: c.id } });
    } else {
      await reject(c, 'finalise', v.failures.join(' '), 'orchestrator', 'Evidence that closes the gaps listed above.');
    }
  }
  // Honour the requested count without ever inventing one to reach it.
  const presented = finalists
    .sort((a, b) => (b.score?.total ?? 0) - (a.score?.total ?? 0))
    .slice(0, opts.finalTarget);
  await saveCandidates(mission.id, candidates);
  const shortfall =
    presented.length < opts.finalTarget
      ? `${presented.length} of the ${opts.finalTarget} requested passed the threshold. The shortfall is real, not a placeholder.`
      : `All ${opts.finalTarget} requested passed the threshold.`;
  await stage('finalise', { status: 'DONE', outCount: presented.length, note: shortfall });

  emit({
    kind: 'mission',
    missionId: mission.id,
    message:
      presented.length === 0
        ? 'No candidate passed the validation threshold. Nothing is being presented as an opportunity.'
        : `${presented.length} candidate(s) passed validation${presented.length < opts.finalTarget ? ` of the ${opts.finalTarget} requested` : ''}.`,
    data: { finalists: presented.map((c) => ({ id: c.id, name: c.name, score: c.score?.total ?? null })) },
  });

  await patchMission((m) => {
    m.status = 'COMPLETE';
    m.activeAgents = [];
    m.finishedAt = nowIso();
  });
}
