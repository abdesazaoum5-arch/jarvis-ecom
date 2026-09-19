import type { Agent, AgentContext } from '../../core/agent/base.ts';
import type { ProductCandidate, TrendProfile } from '../../core/types/index.ts';
import { evidenced, unknown } from '../../core/util/evidence.ts';
import { parseAnswer, questionFor, str, list } from '../../core/research/extract.ts';
import { sourceFrom } from '../../core/research/types.ts';

/**
 * Trend momentum.
 *
 * Reads direction out of observable signals over a stated window. It does not
 * forecast: the momentum value describes what the sources show, and everything
 * forward-looking is recorded separately as a signal with its own provenance.
 */
export const trendAgent: Agent<ProductCandidate, ProductCandidate> = {
  id: 'trend',
  label: 'Trend Agent',
  stage: 'trend',
  async run(candidate, ctx: AgentContext) {
    await ctx.checkControl();
    ctx.say(`Analysing trend momentum for ${candidate.name}.`);

    const hits = await ctx.research.search(`${candidate.name} search interest trend 2025 2026 growth`, {
      limit: 4,
      purpose: `Establish whether interest in "${candidate.name}" is rising, flat or declining, over an explicit time window.`,
      agent: 'trend',
      missionId: candidate.missionId,
    });

    const profile: TrendProfile = {
      momentum: unknown('No trend source was retrieved.'),
      observedWindow: null,
      seasonality: unknown('Not established.'),
      futureSignals: [],
    };

    for (const hit of hits.slice(0, 3)) {
      await ctx.checkControl();
      const page = await ctx.research.read(
        hit.url,
        questionFor(`Assess interest over time in "${candidate.name}" using only what this page states.`, [
          { name: 'direction', describe: 'RISING, FLAT or DECLINING according to this page', type: 'string' },
          { name: 'window', describe: 'the time window the page covers, e.g. "Jan 2025 - Aug 2026"', type: 'string' },
          { name: 'seasonality', describe: 'any seasonal pattern the page describes', type: 'string' },
          { name: 'forwardSignals', describe: 'observable signals about future demand the page reports (creator adoption, category growth, new entrants)', type: 'string[]' },
        ]),
        { purpose: 'trend momentum', agent: 'trend', missionId: candidate.missionId },
      );
      if (!page) continue;
      const o = parseAnswer(page);
      const dir = str(o, 'direction')?.toUpperCase();
      if (dir === 'RISING' || dir === 'FLAT' || dir === 'DECLINING') {
        profile.momentum = evidenced(dir, 'SOURCE_CLAIM', {
          basis: `Reported by ${page.url}`,
          sources: [sourceFrom(page)],
        });
        profile.observedWindow = str(o, 'window');
        ctx.note(candidate, {
          claim: `Interest is ${dir.toLowerCase()}${profile.observedWindow ? ` over ${profile.observedWindow}` : ''}.`,
          provenance: 'SOURCE_CLAIM',
          source: sourceFrom(page),
          polarity: dir === 'DECLINING' ? 'CONTRADICTS' : 'SUPPORTS',
        });
      }
      const season = str(o, 'seasonality');
      if (season) profile.seasonality = evidenced(season, 'SOURCE_CLAIM', { sources: [sourceFrom(page)] });
      for (const s of list(o, 'forwardSignals')) {
        profile.futureSignals.push({ signal: s, reading: evidenced(s, 'SOURCE_CLAIM', { sources: [sourceFrom(page)] }) });
      }
      if (profile.momentum.value) break;
    }

    if (!profile.momentum.value) ctx.warn(`${candidate.name}: trend direction could not be established; recorded as UNKNOWN.`);
    candidate.trend = profile;
    return candidate;
  },
};
