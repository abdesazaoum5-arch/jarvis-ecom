import type { Agent, AgentContext } from '../../core/agent/base.ts';
import type { ProductCandidate } from '../../core/types/index.ts';
import { newId, nowIso, slug } from '../../core/util/id.ts';
import * as memory from '../../core/memory/index.ts';
import { emit } from '../../core/events/bus.ts';

/**
 * Discovery.
 *
 * Searches for problems, desires and behaviours rather than "best dropshipping
 * products" lists, then extracts named candidates from what it actually read.
 * Candidates are recorded with the query that surfaced them, so the funnel can
 * always be traced back to a source.
 */

export interface DiscoveryInput {
  missionId: string;
  niche: string | null;
  /** How many candidates to try to collect before filtering. */
  poolTarget: number;
}

/** Query families that look for demand signals, not for listicles. */
export function discoveryQueries(niche: string | null): Array<{ query: string; purpose: string }> {
  const scope = niche ? ` in ${niche}` : '';
  return [
    { query: `what problem are people complaining about most${scope} this year`, purpose: 'surface articulated problems' },
    { query: `"I wish there was a product that" ${niche ?? ''} reddit`, purpose: 'unmet desire in the operator’s own words' },
    { query: `fastest growing consumer product categories${scope} 2026`, purpose: 'category-level growth signal' },
    { query: `rising search interest consumer products${scope} 2026 google trends`, purpose: 'trend momentum' },
    { query: `new consumer brands launched${scope} 2026 funding`, purpose: 'competitor and ecosystem formation' },
    { query: `most returned products${scope} reasons customers complain`, purpose: 'reject-list signal: what disappoints buyers' },
    { query: `products people buy repeatedly${scope} subscription refill`, purpose: 'repeat purchase potential' },
    { query: `home and daily-life frustrations people post about${scope} 2026`, purpose: 'behaviour-level demand' },
  ];
}

export const researchAgent: Agent<DiscoveryInput, ProductCandidate[]> = {
  id: 'research',
  label: 'Research Agent',
  stage: 'discover',
  async run(input, ctx: AgentContext) {
    const found = new Map<string, ProductCandidate>();
    const queries = discoveryQueries(input.niche);

    for (const q of queries) {
      await ctx.checkControl();
      ctx.say(`Searching: "${q.query}".`, { target: { site: 'web', url: null, action: 'search' } });
      const hits = await ctx.research.search(q.query, {
        limit: 8,
        purpose: `${q.purpose}. Return results that name specific physical consumer products or clearly described product needs.`,
        agent: 'research',
        missionId: input.missionId,
      });
      if (!hits.length) {
        ctx.warn(`No results returned for "${q.query}".`);
        continue;
      }
      ctx.say(`${hits.length} result(s) for "${q.query}".`, { data: { sources: hits.map((h) => h.url) } });

      for (const hit of hits) {
        await ctx.checkControl();
        if (found.size >= input.poolTarget) break;
        const page = await ctx.research.read(
          hit.url,
          [
            'List the specific physical consumer products this page names or clearly implies as unmet needs.',
            '',
            'Answer with a single JSON object and nothing else:',
            '{ "products": [ { "name": string, "category": string | null, "why": string } ] }',
            '',
            'Rules: only products this page actually discusses. If it names none, return an empty array.',
            'Do not add products from your own knowledge. "why" must paraphrase what this page says.',
          ].join('\n'),
          { purpose: q.purpose, agent: 'research', missionId: input.missionId },
        );
        if (!page) continue;

        for (const p of parseProducts(page.answer)) {
          const key = slug(p.name);
          if (!key || found.has(key)) continue;
          const prior = await memory.priorRejection(p.name);
          if (prior) {
            emit({
              kind: 'rejection',
              agent: 'research',
              missionId: input.missionId,
              message: `Skipping "${p.name}" — already rejected: ${prior.reason}. Reopens if: ${prior.reopenIf}.`,
              data: { name: p.name, priorRejectionId: prior.id },
            });
            continue;
          }
          await memory.noteSeen(p.name);
          const candidate: ProductCandidate = {
            id: newId('prd'),
            missionId: input.missionId,
            name: p.name,
            category: p.category,
            description: p.why,
            stage: 'DISCOVERED',
            lifecycle: 'RESEARCHING',
            discoveredAt: nowIso(),
            updatedAt: nowIso(),
            discoveredVia: [q.query],
            demand: null,
            trend: null,
            competition: null,
            customer: null,
            suppliers: [],
            economics: null,
            compliance: null,
            brand: null,
            score: null,
            evidence: [],
            rejection: null,
            risks: [],
            marketingAngles: [],
          };
          ctx.note(candidate, {
            claim: `Surfaced on ${hostOf(page.url)}: ${p.why}`,
            provenance: 'SOURCE_CLAIM',
            source: { url: page.url, title: page.title, retrievedAt: page.retrievedAt, via: page.via, excerpt: p.why.slice(0, 300) },
          });
          found.set(key, candidate);
          emit({
            kind: 'discovery',
            agent: 'research',
            missionId: input.missionId,
            message: `Candidate discovered: ${p.name}.`,
            target: { site: hostOf(page.url), url: page.url, action: 'discovered' },
            data: { candidateId: candidate.id, name: p.name, category: p.category },
          });
        }
      }
      if (found.size >= input.poolTarget) break;
    }

    ctx.say(`Discovery produced ${found.size} distinct candidate(s) from ${queries.length} query families.`);
    return [...found.values()];
  },
};

function parseProducts(answer: string | null): Array<{ name: string; category: string | null; why: string }> {
  if (!answer) return [];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(answer)?.[1];
  const body = (fenced ?? answer).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(body.slice(start, end + 1)) as { products?: unknown };
    if (!Array.isArray(parsed.products)) return [];
    return parsed.products
      .map((raw) => {
        const o = raw as Record<string, unknown>;
        const name = typeof o['name'] === 'string' ? o['name'].trim() : '';
        if (!name || name.length > 90) return null;
        return {
          name,
          category: typeof o['category'] === 'string' && o['category'].trim() ? o['category'].trim() : null,
          why: typeof o['why'] === 'string' ? o['why'].trim() : '',
        };
      })
      .filter((x): x is { name: string; category: string | null; why: string } => x !== null);
  } catch {
    return [];
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
