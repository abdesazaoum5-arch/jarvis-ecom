import type { Agent, AgentContext } from '../../core/agent/base.ts';
import type { CampaignPlan, CreativeConcept, ProductCandidate } from '../../core/types/index.ts';

/**
 * Campaign preparation.
 *
 * Produces a Sales campaign optimised for Purchase — never Traffic — with the
 * 60/30/10 creative mix. It prepares, it does not launch: status is always
 * PREPARED, and launching needs level 5 plus an explicit spending authorisation
 * that no code path can grant itself.
 */
export const adsAgent: Agent<{ candidate: ProductCandidate; creatives: CreativeConcept[] }, CampaignPlan> = {
  id: 'ads',
  label: 'Ad Agent',
  stage: null,
  async run(input, ctx: AgentContext) {
    await ctx.requirePermission('ads.prepare');
    await ctx.checkControl();
    const { candidate, creatives } = input;
    ctx.say(`Preparing campaign structure for ${candidate.name}.`);

    const base = candidate.economics?.scenarios.find((s) => s.label === 'BASE');
    const breakEvenCpa = base?.breakEvenCpa ?? null;
    // A sensible test budget is a few break-even CPAs, so a losing ad set is
    // identified before it spends beyond what the margin can absorb.
    const daily = breakEvenCpa && breakEvenCpa > 0 ? Math.round(breakEvenCpa * 3) : null;

    const byFormat = {
      VIDEO: creatives.filter((c) => c.format === 'VIDEO'),
      STATIC: creatives.filter((c) => c.format === 'STATIC'),
      CAROUSEL: creatives.filter((c) => c.format === 'CAROUSEL'),
    };

    const adsFor = (slice: CreativeConcept[]) =>
      slice.map((c) => ({
        creativeId: c.id,
        primaryText: `${c.hook}\n\n${candidate.brand?.positioning ?? candidate.description ?? ''}`.trim(),
        headline: candidate.brand?.slogan ?? candidate.name,
      }));

    const plan: CampaignPlan = {
      productId: candidate.id,
      objective: 'SALES',
      optimisation: 'PURCHASE',
      adSets: [
        {
          name: 'Broad — no interest targeting',
          audienceNote: 'Broad by country and age band, letting delivery find buyers. Interest stacks are a second test, not the first.',
          dailyBudgetSuggestion: daily,
          ads: adsFor([...byFormat.VIDEO.slice(0, 3), ...byFormat.STATIC.slice(0, 2)]),
        },
        {
          name: 'Angle test — objection and comparison',
          audienceNote: 'Same audience definition, isolating creative angle as the only variable.',
          dailyBudgetSuggestion: daily,
          ads: adsFor([...byFormat.VIDEO.slice(3, 5), ...byFormat.STATIC.slice(2, 4), ...byFormat.CAROUSEL.slice(0, 1)]),
        },
      ],
      status: 'PREPARED',
      preLaunchChecklist: [
        'Objective is Sales and optimisation is Purchase, not Traffic or Landing Page Views.',
        'Purchase event verified as firing through the Conversions API, not just the browser pixel.',
        breakEvenCpa !== null
          ? `Break-even CPA is ${candidate.economics?.currency ?? ''} ${breakEvenCpa} — anything above it loses money on the first order.`
          : 'Break-even CPA is unknown because the economics are not grounded. Do not launch until they are.',
        'Open the current Meta interface and check the creative enhancement toggles by hand; the available settings change without notice.',
        'Every claim in every ad traces to researched evidence or your own testing.',
        'Compliance flags on this product are resolved.',
        'Launching spends money and requires permission level 5 plus explicit spending authorisation.',
      ],
    };

    ctx.say(`Campaign prepared: ${plan.adSets.length} ad set(s), ${plan.adSets.reduce((n, s) => n + s.ads.length, 0)} ad(s). Nothing is live and no budget is committed.`, {
      data: { candidateId: candidate.id },
    });
    return plan;
  },
};
