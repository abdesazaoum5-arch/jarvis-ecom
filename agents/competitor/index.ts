import type { Agent, AgentContext } from '../../core/agent/base.ts';
import type { CompetitionProfile, CompetitorRecord, ProductCandidate } from '../../core/types/index.ts';
import { evidenced, unknown } from '../../core/util/evidence.ts';
import { list, num, parseAnswer, questionFor, str } from '../../core/research/extract.ts';
import { sourceFrom } from '../../core/research/types.ts';
import { newId } from '../../core/util/id.ts';

/**
 * Competitor research.
 *
 * Reads at least five competitor pages where they exist and records what each
 * one actually says. The output is a map of the field, including the gaps
 * nobody is filling — JARVIS positions against those gaps and never copies a
 * competitor's copy, claims or creative.
 */
export const competitorAgent: Agent<ProductCandidate, ProductCandidate> = {
  id: 'competitor',
  label: 'Competitor Agent',
  stage: 'competition',
  async run(candidate, ctx: AgentContext) {
    await ctx.checkControl();
    ctx.say(`Investigating competitors selling ${candidate.name}.`);

    const hits = await ctx.research.search(`buy ${candidate.name} online store price`, {
      limit: 8,
      purpose: `Find brands and stores actually selling "${candidate.name}", to read their price, offer and positioning.`,
      agent: 'competitor',
      missionId: candidate.missionId,
    });

    const competitors: CompetitorRecord[] = [];
    for (const hit of hits.slice(0, 6)) {
      await ctx.checkControl();
      const page = await ctx.research.read(
        hit.url,
        questionFor(`Read this store or product page for "${candidate.name}".`, [
          { name: 'brand', describe: 'the brand or store name', type: 'string' },
          { name: 'price', describe: 'the advertised price as a plain number', type: 'number' },
          { name: 'currency', describe: 'the currency code', type: 'string' },
          { name: 'positioning', describe: 'how they position the product in one sentence', type: 'string' },
          { name: 'headline', describe: 'the main headline on the page, verbatim', type: 'string' },
          { name: 'benefits', describe: 'benefits they claim', type: 'string[]' },
          { name: 'reviewSignal', describe: 'review count and average rating as stated', type: 'string' },
          { name: 'complaints', describe: 'complaints visible in reviews on this page', type: 'string[]' },
          { name: 'guarantee', describe: 'guarantee or warranty offered', type: 'string' },
          { name: 'shipping', describe: 'shipping terms and delivery time', type: 'string' },
          { name: 'bundles', describe: 'bundle or multi-buy offers', type: 'string' },
          { name: 'upsells', describe: 'upsells or add-ons offered', type: 'string' },
          { name: 'creativeStyle', describe: 'the visual style of their imagery', type: 'string' },
          { name: 'adAngles', describe: 'marketing angles their copy uses', type: 'string[]' },
          { name: 'weaknesses', describe: 'weaknesses visible on this page (thin copy, no proof, poor terms)', type: 'string[]' },
        ]),
        { purpose: 'competitor teardown', agent: 'competitor', missionId: candidate.missionId },
      );
      if (!page) continue;
      const o = parseAnswer(page);
      const brand = str(o, 'brand');
      if (!brand) continue;
      const src = [sourceFrom(page)];
      const record: CompetitorRecord = {
        id: newId('cmp'),
        brand,
        url: page.url,
        price: num(o, 'price') !== null ? evidenced(num(o, 'price'), 'SOURCE_CLAIM', { sources: src }) : unknown('No price stated on the page.'),
        currency: str(o, 'currency'),
        positioning: evidenced(str(o, 'positioning'), 'SOURCE_CLAIM', { sources: src }),
        headline: evidenced(str(o, 'headline'), 'SOURCE_CLAIM', { sources: src }),
        benefits: list(o, 'benefits'),
        reviewSignal: evidenced(str(o, 'reviewSignal'), 'SOURCE_CLAIM', { sources: src }),
        complaints: list(o, 'complaints'),
        guarantee: evidenced(str(o, 'guarantee'), 'SOURCE_CLAIM', { sources: src }),
        shipping: evidenced(str(o, 'shipping'), 'SOURCE_CLAIM', { sources: src }),
        bundles: evidenced(str(o, 'bundles'), 'SOURCE_CLAIM', { sources: src }),
        upsells: evidenced(str(o, 'upsells'), 'SOURCE_CLAIM', { sources: src }),
        creativeStyle: evidenced(str(o, 'creativeStyle'), 'SOURCE_CLAIM', { sources: src }),
        adAngles: list(o, 'adAngles'),
        weaknesses: list(o, 'weaknesses'),
      };
      competitors.push(record);
      ctx.note(candidate, {
        claim: `${brand} sells this${record.price.value !== null ? ` at ${record.currency ?? ''} ${record.price.value}` : ''}.`,
        provenance: 'SOURCE_CLAIM',
        source: sourceFrom(page),
      });
      ctx.say(`Analysed competitor: ${brand}.`, { target: { site: hostOf(page.url), url: page.url, action: 'competitor' } });
    }

    const profile: CompetitionProfile = {
      competitors,
      saturation: saturationFrom(competitors),
      gaps: gapsFrom(competitors),
    };
    if (!competitors.length) ctx.warn(`${candidate.name}: no competitor pages could be read; competition recorded as UNKNOWN.`);
    candidate.competition = profile;
    return candidate;
  },
};

/** Saturation is read off how many distinct sellers were actually found. */
function saturationFrom(competitors: CompetitorRecord[]): CompetitionProfile['saturation'] {
  if (!competitors.length) return unknown('No competitor pages were retrieved.');
  const distinct = new Set(competitors.map((c) => c.brand.toLowerCase())).size;
  const level = distinct >= 6 ? 'HIGH' : distinct >= 3 ? 'MODERATE' : 'LOW';
  return evidenced(level, 'INFERENCE', {
    basis: `${distinct} distinct seller(s) found in a first-page search; this measures visibility, not total market participants.`,
    confidence: distinct >= 3 ? 'MEDIUM' : 'LOW',
  });
}

/**
 * Gaps are derived from what competitors are criticised for and what none of
 * them offer — the honest basis for differentiation.
 */
function gapsFrom(competitors: CompetitorRecord[]): string[] {
  const gaps: string[] = [];
  const complaints = competitors.flatMap((c) => c.complaints);
  const themes = topThemes(complaints, 4);
  for (const t of themes) gaps.push(`Competitors are criticised for: ${t}. Solving it is unclaimed positioning.`);
  if (competitors.length && competitors.every((c) => !c.guarantee.value)) gaps.push('No competitor read here states a guarantee.');
  if (competitors.length && competitors.every((c) => !c.bundles.value)) gaps.push('No competitor read here offers a bundle.');
  if (competitors.length && competitors.filter((c) => c.benefits.length >= 3).length === 0) gaps.push('Competitor pages read here carry thin benefit copy.');
  return gaps;
}

function topThemes(lines: string[], n: number): string[] {
  const counts = new Map<string, number>();
  for (const l of lines) {
    const key = l.toLowerCase().replace(/[^a-z ]/g, '').split(/\s+/).slice(0, 4).join(' ').trim();
    if (key.length < 4) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
