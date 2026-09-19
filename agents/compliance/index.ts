import type { Agent, AgentContext } from '../../core/agent/base.ts';
import type { ComplianceProfile, ProductCandidate } from '../../core/types/index.ts';
import { evidenced, unknown } from '../../core/util/evidence.ts';
import { parseAnswer, questionFor, str } from '../../core/research/extract.ts';
import { sourceFrom } from '../../core/research/types.ts';

/**
 * Compliance review for the EU and Belgium.
 *
 * This is a triage, not legal advice. Anything it cannot establish from a
 * source is flagged HUMAN_REVIEW_REQUIRED rather than cleared — JARVIS never
 * manufactures legal certainty.
 */

const AREAS = [
  { area: 'EU product safety and CE marking', query: (p: string) => `${p} CE marking EU product safety requirements importer obligations` },
  { area: 'Labelling and instructions', query: (p: string) => `${p} EU labelling requirements instructions language` },
  { area: 'Belgian consumer rights and returns', query: () => `Belgium EU distance selling 14 day withdrawal right consumer obligations webshop` },
  { area: 'VAT and import duty', query: (p: string) => `${p} import EU VAT OSS duty ecommerce Belgium` },
  { area: 'Advertising claims policy', query: (p: string) => `${p} advertising claims substantiation rules Meta policy` },
  { area: 'Privacy and cookies', query: () => `Belgium GDPR cookie consent webshop requirements` },
  { area: 'Intellectual property', query: (p: string) => `${p} trademark design right check before selling EU` },
];

export const complianceAgent: Agent<ProductCandidate, ProductCandidate> = {
  id: 'compliance',
  label: 'Compliance Agent',
  stage: 'compliance',
  async run(candidate, ctx: AgentContext) {
    await ctx.checkControl();
    ctx.say(`Reviewing compliance exposure for ${candidate.name} (EU / Belgium).`);

    const profile: ComplianceProfile = { jurisdiction: 'EU / Belgium', checks: [], humanReviewRequired: false };

    for (const a of AREAS) {
      await ctx.checkControl();
      const hits = await ctx.research.search(a.query(candidate.name), {
        limit: 2,
        purpose: `Establish the ${a.area} obligations that apply to selling "${candidate.name}" into Belgium/the EU.`,
        agent: 'compliance',
        missionId: candidate.missionId,
      });
      const hit = hits[0];
      if (!hit) {
        profile.checks.push({ area: a.area, finding: unknown('No authoritative source retrieved.'), status: 'HUMAN_REVIEW_REQUIRED' });
        profile.humanReviewRequired = true;
        continue;
      }
      const page = await ctx.research.read(
        hit.url,
        questionFor(`Summarise the ${a.area} obligations this page states, as they apply to selling "${candidate.name}" into the EU/Belgium.`, [
          { name: 'obligation', describe: 'what this page says is required, in one or two sentences', type: 'string' },
          { name: 'severity', describe: 'OK if routine, ATTENTION if it needs specific action, HUMAN_REVIEW if it is legally significant or unclear', type: 'string' },
        ]),
        { purpose: 'compliance triage', agent: 'compliance', missionId: candidate.missionId },
      );
      const o = parseAnswer(page);
      const obligation = str(o, 'obligation');
      if (!obligation || !page) {
        profile.checks.push({ area: a.area, finding: unknown('Could not read an authoritative source.'), status: 'HUMAN_REVIEW_REQUIRED' });
        profile.humanReviewRequired = true;
        continue;
      }
      const sev = (str(o, 'severity') ?? '').toUpperCase();
      const status = sev.startsWith('OK') ? 'OK' : sev.startsWith('ATT') ? 'ATTENTION' : 'HUMAN_REVIEW_REQUIRED';
      if (status === 'HUMAN_REVIEW_REQUIRED') profile.humanReviewRequired = true;
      profile.checks.push({ area: a.area, finding: evidenced(obligation, 'SOURCE_CLAIM', { sources: [sourceFrom(page)] }), status });
      if (status !== 'OK') {
        ctx.note(candidate, { claim: `${a.area}: ${obligation}`, provenance: 'SOURCE_CLAIM', source: sourceFrom(page), polarity: 'NEUTRAL' });
      }
    }

    if (profile.humanReviewRequired) {
      candidate.risks.push('Compliance areas remain unresolved and need human review before this is sold.');
      ctx.warn(`${candidate.name}: compliance flagged for human review.`);
    }
    candidate.compliance = profile;
    return candidate;
  },
};
