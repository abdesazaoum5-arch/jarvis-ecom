import type { IntentName, ProductCandidate } from '../../../core/types/index.ts';
import { interpret } from '../../../core/nl/intent.ts';
import { inCharacter } from './persona.ts';
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
  /**
   * What the operator asked to be shown. The interface obeys this; the system
   * does no work for it, which is why these never touch mission state.
   */
  view?: 'detail' | 'plain' | 'input';
  /** Set when the reply produced something the operator can open. */
  site?: string;
}

export async function respond(utterance: string): Promise<Reply> {
  const reply = await answer(utterance);
  // Register is applied in one place, to the finished sentence, so no branch
  // can drift out of character and none can alter what the sentence claims.
  return { ...reply, speech: inCharacter(reply.intent as IntentName, reply.speech) };
}

async function answer(utterance: string): Promise<Reply> {
  const reading = interpret(utterance);
  emit({ kind: 'system', message: `Command received: "${utterance}"`, data: { intent: reading.intent } });

  switch (reading.intent) {
    case 'STOP': {
      await orchestrator.setControl('STOP');
      return { intent: reading.intent, speech: 'Ik stop. Alle niet-kritieke automatisering valt stil bij het eerstvolgende controlepunt en de stand van zaken blijft bewaard.', data: null };
    }
    case 'PAUSE': {
      await orchestrator.setControl('PAUSE');
      return { intent: reading.intent, speech: 'Gepauzeerd. Er gaat niets verloren. Zeg het wanneer ik verder mag.', data: null };
    }
    case 'RESUME': {
      await orchestrator.setControl('RUN');
      return { intent: reading.intent, speech: 'Ik ga verder.', data: null };
    }
    case 'SET_PERMISSION': {
      const level = Number(reading.params['level'] ?? 0);
      if (!Number.isInteger(level) || level < 0 || level > 6) {
        return { intent: reading.intent, speech: 'Machtigingsniveaus lopen van 0 tot 6. Zeg welk niveau u wilt.', data: null };
      }
      const state = await permissions.grant(level as 0, 'operator (spoken)', utterance);
      const extra = level >= 5 ? ' Uitgaven hebben nog steeds een aparte, uitdrukkelijke toestemming nodig. Hier alleen leg ik geen geld mee vast.' : '';
      return { intent: reading.intent, speech: `Machtigingsniveau ${level}: ${permissions.LEVELS[level as 0]}.${extra}`, data: { permissions: state } };
    }
    case 'SHOW_DETAIL':
      return { intent: reading.intent, speech: 'Ik toon de details.', data: null, view: 'detail' };
    case 'HIDE_DETAIL':
      return { intent: reading.intent, speech: 'Ik ruim het op.', data: null, view: 'plain' };
    case 'OPEN_INPUT':
      return { intent: reading.intent, speech: 'Ga uw gang.', data: null, view: 'input' };
    case 'STATUS':
      return status();
    case 'EXPLAIN':
      return explain(reading.params['index'] as number | undefined);
    case 'DISCOVER_PRODUCTS': {
      const target = Number(reading.params['target'] ?? 3);
      const mission = await orchestrator.startMission({ utterance, interpretation: reading, finalTarget: target });
      return {
        intent: reading.intent,
        speech: `Begrepen. Ik onderzoek de huidige vraag, de trend, de concurrentie, klachten van klanten, de economie bij leveranciers en de regelgeving, en ik lever alleen kandidaten die de validatiedrempel halen. Halen er minder dan ${target} het, dan krijgt u er minder en zeg ik erbij waarom.`,
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
      if (!mission) return { intent: reading.intent, speech: 'Er loopt geen missie om op voort te bouwen. Geef me eerst een zoekopdracht, of noem het product.', data: null };
      return { intent: reading.intent, speech: `In de wachtrij gezet bij de lopende missie: ${reading.objective}`, data: { missionId: mission.id } };
    }
    case 'ANALYSE_RESULTS':
      return analyse();
    case 'AUTONOMOUS_MODE': {
      const perms = await permissions.current();
      return {
        intent: reading.intent,
        speech: `Autonome modus genoteerd. Ik blijf onderzoeken en bouwen binnen niveau ${perms.level}: ${permissions.LEVELS[perms.level]}. Financiële machtigingen staan daar los van en verhoog ik nooit zelf.`,
        data: { level: perms.level },
      };
    }
    default:
      return {
        intent: 'UNKNOWN',
        speech: `Daar herken ik geen opdracht in. Ik kan producten zoeken, er één diep onderzoeken, leveranciers vinden, een merk of een winkel bouwen, advertenties voorbereiden, resultaten analyseren, of stoppen.`,
        data: null,
      };
  }
}

async function status(): Promise<Reply> {
  const [mission, products] = await Promise.all([orchestrator.currentMission(), orchestrator.currentProducts()]);
  if (!mission) return { intent: 'STATUS', speech: 'Er draait geen missie. Ik wacht op uw opdracht.', data: null };

  const all = products.candidates;
  const rejected = all.filter((c) => c.stage === 'REJECTED');
  const live = all.filter((c) => c.stage === 'INVESTIGATING' || c.stage === 'DISCOVERED');
  const validated = all.filter((c) => c.stage === 'VALIDATED');
  const passingEconomics = all.filter((c) => {
    const base = c.economics?.scenarios.find((s) => s.label === 'BASE');
    return base ? base.contributionBeforeAds > 0 : false;
  });

  const lines = [
    `Het onderzoek is ${mission.progress} procent klaar.`,
    `Ik heb ${all.length} ${all.length === 1 ? 'kandidaat' : 'kandidaten'} onderzocht.`,
    `${rejected.length} ${rejected.length === 1 ? 'is' : 'zijn'} afgevallen.`,
    live.length ? `${live.length} worden nog onderzocht.` : '',
    `${passingEconomics.length} halen op dit moment de economische drempel.`,
    validated.length ? `${validated.length} zijn volledig gevalideerd.` : '',
    mission.activeAgents.length ? `Nu actief: ${mission.activeAgents.join(', ')}.` : '',
  ].filter(Boolean);

  return { intent: 'STATUS', speech: lines.join('\n'), data: { mission, counts: { all: all.length, rejected: rejected.length, live: live.length, validated: validated.length } } };
}

async function explain(index?: number): Promise<Reply> {
  const products = await orchestrator.currentProducts();
  const all = products.candidates;
  if (!all.length) return { intent: 'EXPLAIN', speech: 'Er zijn nog geen kandidaten om uit te leggen.', data: null };

  const target: ProductCandidate | undefined =
    index !== undefined
      ? all[index - 1]
      : [...all].filter((c) => c.rejection).sort((a, b) => (b.rejection?.at ?? '').localeCompare(a.rejection?.at ?? ''))[0];

  if (!target) return { intent: 'EXPLAIN', speech: `Ik heb geen kandidaat op plaats ${index}.`, data: null };

  if (target.rejection) {
    const ev = target.evidence.filter((e) => e.source).slice(0, 4);
    return {
      intent: 'EXPLAIN',
      speech: [
        `${target.name} is afgevallen bij de stap ${target.rejection.stage}, door de ${target.rejection.agent}-agent.`,
        `Reden: ${target.rejection.reason}`,
        ev.length ? `Het bewijs daarachter: ${ev.map((e) => `${e.claim} (${e.source?.url})`).join(' ')}` : 'Er zijn geen onderbouwende bronnen gevonden, en dat is zelf een deel van de reden.',
      ].join('\n'),
      data: { candidate: target },
    };
  }

  const score = target.score;
  return {
    intent: 'EXPLAIN',
    speech: [
      `${target.name} zit nog in de pijplijn, bij stap ${target.stage.toLowerCase()}.`,
      score ? `Hij scoort ${score.total ?? '—'} bij ${Math.round(score.coverage * 100)} procent bewijsdekking, met ${score.confidence.toLowerCase()} betrouwbaarheid.` : 'Hij is nog niet gescoord.',
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
    speech: report.hasData ? report.diagnosis.join(' ') : 'Er is geen campagnedata aangesloten en er is niets aangeleverd, dus er valt niets te analyseren. Sluit een advertentieaccount aan of geef me de cijfers, dan reken ik de dekkingsbijdrage voor u uit.',
    data: { report, lessons },
  };
}

async function buildStep(step: 'brand' | 'store' | 'ads' | 'cro', subject?: string): Promise<Reply> {
  const products = await orchestrator.currentProducts();
  // A product validated by an earlier mission is still a product to build on.
  const pool = products.candidates.length ? products.candidates : await orchestrator.library();
  const candidate = pick(pool, subject);
  if (!candidate) {
    return { intent: step.toUpperCase(), speech: 'Ik heb een gevalideerde kandidaat nodig om op te bouwen. Laat me eerst zoeken, of noem het product.', data: null };
  }
  const mission = await orchestrator.currentMission();
  const ctx = makeContext({ mission: (mission ?? fakeMissionShell()) as never, research, agentId: step, readControl: async () => (await orchestrator.currentMission())?.control ?? 'RUN' });

  try {
    if (step === 'brand') {
      await brandAgent.run(candidate, ctx);
      await persist(pool, candidate);
      return { intent: 'BUILD_BRAND', speech: `Merk gebouwd voor ${candidate.name}: ${candidate.brand?.name} — ${candidate.brand?.positioning}`, data: { brand: candidate.brand } };
    }
    if (step === 'store') {
      if (!candidate.brand) await brandAgent.run(candidate, ctx);
      const { storefront, offers } = await shopifyAgent.run(candidate, ctx);
      await store.update<Record<string, unknown>>('brand', {}, (s) => ({ ...s, [candidate.id]: { brand: candidate.brand, storefront, offers } }));
      await persist(pool, candidate);
      const flagged = storefront.pages.filter((p) => p.flags.length).length;
      const site = `/site/${candidate.id}/index.html`;
      return {
        intent: 'BUILD_STORE',
        speech: `Winkel gebouwd voor ${candidate.name}: ${storefront.pages.length} pagina's en ${offers.length} ${offers.length === 1 ? 'aanbieding' : 'aanbiedingen'}, geprijsd op de echte dekkingsbijdrage, in de eigen kleuren en letters van ${candidate.brand?.name ?? 'het merk'}. Hij staat open in uw browser. ${flagged} ${flagged === 1 ? 'pagina is' : "pagina's zijn"} gemarkeerd als nog niet klaar om te publiceren, en er is niets naar Shopify gestuurd: die koppeling staat niet aan.`,
        data: { storefront, offers, site },
        site,
      };
    }
    if (step === 'cro') {
      const saved = await store.read<Record<string, { storefront?: unknown }>>('brand', {});
      const sf = saved[candidate.id]?.storefront;
      if (!sf) return { intent: 'OPTIMISE_STORE', speech: 'Er is nog geen winkel om te optimaliseren. Vraag me eerst de winkel te bouwen.', data: null };
      const findings = await croAgent.run({ candidate, storefront: sf as never }, ctx);
      const high = findings.filter((f) => f.severity === 'HIGH');
      return { intent: 'OPTIMISE_STORE', speech: `${findings.length} ${findings.length === 1 ? 'bevinding' : 'bevindingen'} over conversie, waarvan ${high.length} met hoge urgentie. ${high[0]?.finding ?? ''}`, data: { findings } };
    }
    const creatives = await creativeAgent.run({ candidate, total: 10 }, ctx);
    const specs = await videoAgent.run(creatives, ctx);
    const plan = await adsAgent.run({ candidate, creatives }, ctx);
    await store.update<Record<string, unknown>>('creatives', {}, (s) => ({ ...s, [candidate.id]: { creatives, specs } }));
    await store.update<Record<string, unknown>>('campaigns', {}, (s) => ({ ...s, [candidate.id]: plan }));
    return {
      intent: 'PREPARE_ADS',
      speech: `${creatives.length} creatieve concepten klaargezet en een Sales-campagne geoptimaliseerd op Purchase, verdeeld over ${plan.adSets.length} advertentiesets. Er staat niets live, er is geen budget vastgelegd en er zijn geen credits uitgegeven.`,
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
