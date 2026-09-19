import type { Agent, AgentContext } from '../../core/agent/base.ts';
import type { CustomerProfile, ProductCandidate } from '../../core/types/index.ts';
import { evidenced, unknown } from '../../core/util/evidence.ts';
import { list, parseAnswer, questionFor, str } from '../../core/research/extract.ts';
import { sourceFrom } from '../../core/research/types.ts';

/**
 * Customer psychology. Works from what buyers actually wrote — reviews, forum
 * posts, complaints — rather than from a persona invented for the deck.
 */
export const customerAgent: Agent<ProductCandidate, ProductCandidate> = {
  id: 'customer',
  label: 'Customer Agent',
  stage: 'customer',
  async run(candidate, ctx: AgentContext) {
    await ctx.checkControl();
    ctx.say(`Reading what buyers say about ${candidate.name}.`);

    const hits = await ctx.research.search(`${candidate.name} reviews complaints problems "didn't work" reddit forum`, {
      limit: 6,
      purpose: `Find what real buyers of "${candidate.name}" say: what they wanted, what disappointed them, what stopped them buying.`,
      agent: 'customer',
      missionId: candidate.missionId,
    });

    const profile: CustomerProfile = {
      segment: unknown('Not established from sources.'),
      desires: [],
      problems: [],
      objections: [],
      complaintThemes: [],
    };

    for (const hit of hits.slice(0, 4)) {
      await ctx.checkControl();
      const page = await ctx.research.read(
        hit.url,
        questionFor(`Read what customers say about "${candidate.name}" on this page.`, [
          { name: 'segment', describe: 'who these buyers are, in their own terms', type: 'string' },
          { name: 'desires', describe: 'outcomes buyers say they want', type: 'string[]' },
          { name: 'problems', describe: 'problems buyers say they have', type: 'string[]' },
          { name: 'objections', describe: 'reasons people give for not buying', type: 'string[]' },
          { name: 'complaints', describe: 'complaints about products of this kind', type: 'string[]' },
        ]),
        { purpose: 'customer psychology', agent: 'customer', missionId: candidate.missionId },
      );
      if (!page) continue;
      const o = parseAnswer(page);
      const seg = str(o, 'segment');
      if (seg && !profile.segment.value) {
        profile.segment = evidenced(seg, 'SOURCE_CLAIM', { sources: [sourceFrom(page)] });
      }
      profile.desires.push(...list(o, 'desires'));
      profile.problems.push(...list(o, 'problems'));
      profile.objections.push(...list(o, 'objections'));
      profile.complaintThemes.push(...list(o, 'complaints'));
      for (const p of list(o, 'problems').slice(0, 3)) {
        ctx.note(candidate, { claim: `Buyers report: ${p}`, provenance: 'SOURCE_CLAIM', source: sourceFrom(page, p) });
      }
    }

    profile.desires = dedupe(profile.desires);
    profile.problems = dedupe(profile.problems);
    profile.objections = dedupe(profile.objections);
    profile.complaintThemes = dedupe(profile.complaintThemes);

    // Marketing angles are derived from researched problems and objections, so
    // every angle traces to something a real buyer said.
    candidate.marketingAngles = dedupe([
      ...profile.problems.slice(0, 3).map((p) => `Problem/solution: ${p}`),
      ...profile.desires.slice(0, 2).map((d) => `Desired outcome: ${d}`),
      ...profile.objections.slice(0, 2).map((o) => `Objection handling: ${o}`),
      ...profile.complaintThemes.slice(0, 2).map((c) => `Comparison against what disappoints buyers: ${c}`),
    ]);

    if (!profile.problems.length && !profile.complaintThemes.length) {
      ctx.warn(`${candidate.name}: no customer voice retrieved; problem strength cannot be scored.`);
    } else {
      ctx.say(`${candidate.name}: ${profile.problems.length} problem(s), ${profile.objections.length} objection(s), ${candidate.marketingAngles.length} angle(s) derived.`);
    }
    candidate.customer = profile;
    return candidate;
  },
};

function dedupe(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const k = x.toLowerCase().trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(x.trim());
  }
  return out;
}
