import type { Agent, AgentContext } from '../../core/agent/base.ts';
import type { DemandProfile, ProductCandidate } from '../../core/types/index.ts';
import { evidenced, unknown } from '../../core/util/evidence.ts';
import { parseAnswer, questionFor, str, list } from '../../core/research/extract.ts';
import { sourceFrom } from '../../core/research/types.ts';

/**
 * Market and demand signals. Collects concrete demand evidence — search volume,
 * marketplace activity, category growth — and refuses to summarise a market it
 * has no sources for.
 */
export const marketAgent: Agent<ProductCandidate, ProductCandidate> = {
  id: 'market',
  label: 'Market Agent',
  stage: 'demand',
  async run(candidate, ctx: AgentContext) {
    await ctx.checkControl();
    ctx.say(`Investigating demand signals for ${candidate.name}.`);

    const hits = await ctx.research.search(`${candidate.name} market demand sales volume buyers 2026`, {
      limit: 5,
      purpose: `Find concrete demand evidence for "${candidate.name}": search volume, marketplace sales activity, category size or growth.`,
      agent: 'market',
      missionId: candidate.missionId,
    });

    const profile: DemandProfile = { signals: [], summary: unknown('No demand source was retrieved.') };

    for (const hit of hits.slice(0, 4)) {
      await ctx.checkControl();
      const page = await ctx.research.read(
        hit.url,
        questionFor(`Extract demand evidence for "${candidate.name}" from this page.`, [
          { name: 'demandStatement', describe: 'one sentence stating what this page shows about demand, quoting its figures', type: 'string' },
          { name: 'figures', describe: 'specific numbers the page gives (volumes, revenue, growth rates) with their units', type: 'string[]' },
          { name: 'audience', describe: 'who the page says buys this', type: 'string' },
        ]),
        { purpose: 'demand evidence', agent: 'market', missionId: candidate.missionId },
      );
      if (!page) continue;
      const o = parseAnswer(page);
      const statement = str(o, 'demandStatement');
      if (statement) {
        profile.signals.push({ label: 'Demand', detail: evidenced(statement, 'SOURCE_CLAIM', { sources: [sourceFrom(page)] }) });
        ctx.note(candidate, {
          claim: `Demand signal — ${statement}`,
          provenance: 'SOURCE_CLAIM',
          source: sourceFrom(page, statement.slice(0, 300)),
        });
      }
      for (const f of list(o, 'figures')) {
        profile.signals.push({ label: 'Figure', detail: evidenced(f, 'SOURCE_CLAIM', { sources: [sourceFrom(page)] }) });
        ctx.note(candidate, { claim: `Reported figure — ${f}`, provenance: 'SOURCE_CLAIM', source: sourceFrom(page, f) });
      }
      const audience = str(o, 'audience');
      if (audience) profile.signals.push({ label: 'Audience', detail: evidenced(audience, 'SOURCE_CLAIM', { sources: [sourceFrom(page)] }) });
    }

    if (profile.signals.length) {
      profile.summary = evidenced(
        `${profile.signals.length} demand data point(s) retrieved across ${new Set(profile.signals.flatMap((s) => s.detail.sources.map((x) => x.url))).size} source(s).`,
        'INFERENCE',
        { basis: 'Count of retrieved demand evidence; not a market size estimate.' },
      );
    } else {
      ctx.warn(`${candidate.name}: no demand evidence retrieved; demand recorded as UNKNOWN.`);
    }
    candidate.demand = profile;
    return candidate;
  },
};
