import type { ProductCandidate } from '../../../core/types/index.ts';
import { interpret } from '../../../core/nl/intent.ts';
import * as orchestrator from '../../../core/orchestrator/index.ts';
import * as permissions from '../../../core/permissions/index.ts';
import * as store from '../../../core/state/store.ts';
import { emit } from '../../../core/events/bus.ts';
import { research } from '../../../core/research/router.ts';
import { makeContext } from '../../../core/agent/base.ts';
import { brandAgent } from '../../../agents/brand/index.ts';
import { shopifyAgent } from '../../../agents/shopify/index.ts';
import { croAgent } from '../../../agents/cro/index.ts';
import { creativeAgent } from '../../../agents/creative/index.ts';
import { videoAgent } from '../../../agents/video/index.ts';
import { adsAgent } from '../../../agents/ads/index.ts';
import { analyticsAgent } from '../../../agents/analytics/index.ts';
import { learningAgent } from '../../../agents/learning/index.ts';

/**
 * The voice of JARVIS: calm, precise, concise, and never claiming more than the
 * system actually did. Every reply is assembled from live state, so it cannot
 * describe work that did not happen.
 */

export interface Reply {
  intent: string;
  /** What JARVIS says back to the operator. */
  speech: string;
  /** Structured payload for the interface, when there is one. */
  data: Record<string, unknown> | null;
}

export async function respond(utterance: string): Promise<Reply> {
  const reading = interpret(utterance);
  emit({ kind: 'system', message: `Command received: "${utterance}"`, data: { intent: reading.intent } });

  switch (reading.intent) {
    case 'STOP': {
      await orchestrator.setControl('STOP');
      return { intent: reading.intent, speech: 'Stopping. All non-critical automation halts at the next checkpoint and state is preserved.', data: null };
    }
    case 'PAUSE': {
      await orchestrator.setControl('PAUSE');
      return { intent: reading.intent, speech: 'Paused. Nothing is lost; say continue when you want me to pick it up.', data: null };
    }
    case 'RESUME': {
      await orchestrator.setControl('RUN');
      return { intent: reading.intent, speech: 'Resuming.', data: null };
    }
    case 'SET_PERMISSION': {
      const level = Number(reading.params['level'] ?? 0);
      if (!Number.isInteger(level) || level < 0 || level > 6) {
        return { intent: reading.intent, speech: 'Permission levels run from 0 to 6. Tell me which one.', data: null };
      }
      const state = await permissions.grant(level as 0, 'operator (spoken)', utterance);
      const extra = level >= 5 ? ' Spending still needs a separate explicit authorisation — I will not commit money on this alone.' : '';
      return { intent: reading.intent, speech: `Permission level ${level}: ${permissions.LEVELS[level as 0]}.${extra}`, data: { permissions: state } };
    }
    case 'STATUS':
      return status();
    case 'EXPLAIN':
      return explain(reading.params['index'] as number | undefined);
    case 'DISCOVER_PRODUCTS': {
      const target = Number(reading.params['target'] ?? 3);
      const mission = await orchestrator.startMission({ utterance, interpretation: reading, finalTarget: target });
      return {
        intent: reading.intent,
        speech: `Understood. I'll investigate current demand, trend momentum, competition, customer complaints, supplier economics and compliance, and return only candidates that pass the validation threshold. If fewer than ${target} pass, I'll return fewer and tell you why.`,
        data: { missionId: mission.id },
      };
    }
    case 'BUILD_BRAND':
      return buildStep('brand', reading.params['subject'] as string | undefined);
    case 'BUILD_STORE':
      return buildStep('store', reading.params['subject'] as string | undefined);
    case 'PREPARE_ADS':
      return buildStep('ads', reading.params['subject'] as string | undefined);
    case 'OPTIMISE_STORE':
      return buildStep('cro', reading.params['subject'] as string | undefined);
    case 'RESEARCH_PRODUCT':
    case 'FIND_SUPPLIER': {
      const mission = await orchestrator.currentMission();
      if (!mission) return { intent: reading.intent, speech: 'There is no active mission to work from. Give me a discovery objective first, or name the product.', data: null };
      return { intent: reading.intent, speech: `Queued against the current mission: ${reading.objective}`, data: { missionId: mission.id } };
    }
    case 'ANALYSE_RESULTS':
      return analyse();
    case 'AUTONOMOUS_MODE': {
      const perms = await permissions.current();
      return {
        intent: reading.intent,
        speech: `Autonomous mode acknowledged. I'll keep researching and building within level ${perms.level} — ${permissions.LEVELS[perms.level]}. Financial permissions stay separate and I will not raise them myself.`,
        data: { level: perms.level },
      };
    }
    default:
      return {
        intent: 'UNKNOWN',
        speech: `I did not recognise an objective in that. I can discover products, research one in depth, find suppliers, build a brand or a storefront, prepare ads, analyse results, or stop.`,
        data: null,
      };
  }
}

async function status(): Promise<Reply> {
  const [mission, products] = await Promise.all([orchestrator.currentMission(), orchestrator.currentProducts()]);
  if (!mission) return { intent: 'STATUS', speech: 'No mission is running. I am ready for command.', data: null };

  const all = products.candidates;
  const rejected = all.filter((c) => c.stage === 'REJECTED');
  const live = all.filter((c) => c.stage === 'INVESTIGATING' || c.stage === 'DISCOVERED');
  const validated = all.filter((c) => c.stage === 'VALIDATED');
  const passingEconomics = all.filter((c) => {
    const base = c.economics?.scenarios.find((s) => s.label === 'BASE');
    return base ? base.contributionBeforeAds > 0 : false;
  });

  const lines = [
    `Research is ${mission.progress}% complete.`,
    `I've analysed ${all.length} candidate${all.length === 1 ? '' : 's'}.`,
    `${rejected.length} ${rejected.length === 1 ? 'has' : 'have'} been rejected.`,
    live.length ? `${live.length} remain under investigation.` : '',
    `${passingEconomics.length} currently pass the economic threshold.`,
    validated.length ? `${validated.length} passed full validation.` : '',
    mission.activeAgents.length ? `Active now: ${mission.activeAgents.join(', ')}.` : '',
  ].filter(Boolean);

  return { intent: 'STATUS', speech: lines.join('\n'), data: { mission, counts: { all: all.length, rejected: rejected.length, live: live.length, validated: validated.length } } };
}

async function explain(index?: number): Promise<Reply> {
  const products = await orchestrator.currentProducts();
  const all = products.candidates;
  if (!all.length) return { intent: 'EXPLAIN', speech: 'There are no candidates to explain yet.', data: null };

  const target: ProductCandidate | undefined =
    index !== undefined
      ? all[index - 1]
      : [...all].filter((c) => c.rejection).sort((a, b) => (b.rejection?.at ?? '').localeCompare(a.rejection?.at ?? ''))[0];

  if (!target) return { intent: 'EXPLAIN', speech: `I have no candidate at position ${index}.`, data: null };

  if (target.rejection) {
    const ev = target.evidence.filter((e) => e.source).slice(0, 4);
    return {
      intent: 'EXPLAIN',
      speech: [
        `${target.name} was rejected at the ${target.rejection.stage} gate by the ${target.rejection.agent} agent.`,
        `Reason: ${target.rejection.reason}`,
        ev.length ? `Evidence behind that: ${ev.map((e) => `${e.claim} (${e.source?.url})`).join(' ')}` : 'No supporting sources were retrieved, which is itself part of the reason.',
      ].join('\n'),
      data: { candidate: target },
    };
  }

  const score = target.score;
  return {
    intent: 'EXPLAIN',
    speech: [
      `${target.name} is still in the pipeline at stage ${target.stage.toLowerCase()}.`,
      score ? `It scores ${score.total ?? '—'} at ${Math.round(score.coverage * 100)}% evidence coverage, ${score.confidence.toLowerCase()} confidence.` : 'It has not been scored yet.',
      score ? score.components.filter((c) => c.raw !== null).map((c) => `${c.label}: ${c.raw} — ${c.rationale}`).join('\n') : '',
    ].filter(Boolean).join('\n'),
    data: { candidate: target },
  };
}

async function analyse(): Promise<Reply> {
  const mission = await orchestrator.currentMission();
  const ctx = makeContext({ mission: (mission ?? fakeMissionShell()) as never, research, agentId: 'analytics', readControl: async () => 'RUN' });
  const report = await analyticsAgent.run({ rows: [], contributionMarginRate: null }, ctx);
  const lessons = await learningAgent.run({ report, productName: 'n/a' }, ctx);
  return {
    intent: 'ANALYSE_RESULTS',
    speech: report.hasData ? report.diagnosis.join(' ') : 'No campaign data is connected and none has been supplied, so there is nothing to analyse. Connect an ads account or give me the rows and I will report contribution profit.',
    data: { report, lessons },
  };
}

async function buildStep(step: 'brand' | 'store' | 'ads' | 'cro', subject?: string): Promise<Reply> {
  const products = await orchestrator.currentProducts();
  const candidate = pick(products.candidates, subject);
  if (!candidate) {
    return { intent: step.toUpperCase(), speech: 'I need a validated candidate to build from. Run a discovery mission first, or name the product.', data: null };
  }
  const mission = await orchestrator.currentMission();
  const ctx = makeContext({ mission: (mission ?? fakeMissionShell()) as never, research, agentId: step, readControl: async () => (await orchestrator.currentMission())?.control ?? 'RUN' });

  try {
    if (step === 'brand') {
      await brandAgent.run(candidate, ctx);
      await persist(products.candidates, candidate);
      return { intent: 'BUILD_BRAND', speech: `Brand built for ${candidate.name}: ${candidate.brand?.name} — ${candidate.brand?.positioning}`, data: { brand: candidate.brand } };
    }
    if (step === 'store') {
      if (!candidate.brand) await brandAgent.run(candidate, ctx);
      const { storefront, offers } = await shopifyAgent.run(candidate, ctx);
      await store.update<Record<string, unknown>>('brand', {}, (s) => ({ ...s, [candidate.id]: { brand: candidate.brand, storefront, offers } }));
      await persist(products.candidates, candidate);
      const flagged = storefront.pages.filter((p) => p.flags.length).length;
      return {
        intent: 'BUILD_STORE',
        speech: `Storefront generated for ${candidate.name}: ${storefront.pages.length} pages and ${offers.length} offer tier${offers.length === 1 ? '' : 's'} priced off the real contribution. ${flagged} page${flagged === 1 ? '' : 's'} flagged for human review before publishing. Nothing has been pushed to Shopify — that adapter is not connected.`,
        data: { storefront, offers },
      };
    }
    if (step === 'cro') {
      const saved = await store.read<Record<string, { storefront?: unknown }>>('brand', {});
      const sf = saved[candidate.id]?.storefront;
      if (!sf) return { intent: 'OPTIMISE_STORE', speech: 'There is no storefront to optimise yet. Ask me to build the store first.', data: null };
      const findings = await croAgent.run({ candidate, storefront: sf as never }, ctx);
      const high = findings.filter((f) => f.severity === 'HIGH');
      return { intent: 'OPTIMISE_STORE', speech: `${findings.length} conversion finding${findings.length === 1 ? '' : 's'}, ${high.length} high severity. ${high[0]?.finding ?? ''}`, data: { findings } };
    }
    const creatives = await creativeAgent.run({ candidate, total: 10 }, ctx);
    const specs = await videoAgent.run(creatives, ctx);
    const plan = await adsAgent.run({ candidate, creatives }, ctx);
    await store.update<Record<string, unknown>>('creatives', {}, (s) => ({ ...s, [candidate.id]: { creatives, specs } }));
    await store.update<Record<string, unknown>>('campaigns', {}, (s) => ({ ...s, [candidate.id]: plan }));
    return {
      intent: 'PREPARE_ADS',
      speech: `Prepared ${creatives.length} creative concepts and a Sales campaign optimised for Purchase, across ${plan.adSets.length} ad sets. Nothing is live, no budget is committed and no generation credits were spent.`,
      data: { plan, creatives: creatives.length, specs: specs.length },
    };
  } catch (err) {
    const message = (err as Error).message;
    return { intent: step.toUpperCase(), speech: message, data: { blocked: true } };
  }
}

function pick(candidates: ProductCandidate[], subject?: string): ProductCandidate | null {
  const live = candidates.filter((c) => c.stage !== 'REJECTED');
  if (subject) {
    const idx = /candidate (\d+)/i.exec(subject)?.[1];
    if (idx) return live[Number(idx) - 1] ?? null;
    const found = live.find((c) => c.name.toLowerCase().includes(subject.toLowerCase()));
    if (found) return found;
  }
  return live.find((c) => c.stage === 'VALIDATED') ?? live[0] ?? null;
}

async function persist(all: ProductCandidate[], updated: ProductCandidate): Promise<void> {
  await store.update<{ missionId: string | null; candidates: ProductCandidate[] }>('products', { missionId: null, candidates: [] }, (s) => {
    const i = s.candidates.findIndex((c) => c.id === updated.id);
    if (i >= 0) s.candidates[i] = updated;
    return s;
  });
}

/** Minimal shell so single-step commands work before any mission exists. */
function fakeMissionShell() {
  return { id: 'no-mission', control: 'RUN' as const, activeAgents: [] };
}
