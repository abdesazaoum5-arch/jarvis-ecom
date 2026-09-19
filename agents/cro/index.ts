import type { Agent, AgentContext } from '../../core/agent/base.ts';
import type { ProductCandidate, Storefront } from '../../core/types/index.ts';

/**
 * Conversion review. Audits the generated storefront against the objections and
 * complaints that research actually surfaced, and refuses to recommend any
 * pressure tactic that is not true.
 */

export interface CroFinding {
  section: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  finding: string;
  action: string;
}

export const croAgent: Agent<{ candidate: ProductCandidate; storefront: Storefront }, CroFinding[]> = {
  id: 'cro',
  label: 'CRO Agent',
  stage: null,
  async run(input, ctx: AgentContext) {
    await ctx.checkControl();
    const { candidate, storefront } = input;
    ctx.say(`Auditing the storefront for ${candidate.name}.`);
    const findings: CroFinding[] = [];

    const objections = candidate.customer?.objections ?? [];
    const faq = storefront.pages.find((p) => p.slug === 'faq')?.body ?? '';
    for (const o of objections) {
      if (!faq.toLowerCase().includes(o.toLowerCase().slice(0, 20))) {
        findings.push({ section: 'FAQ', severity: 'HIGH', finding: `A researched objection is unanswered: "${o}".`, action: 'Answer it directly on the product page, above the fold if it blocks the purchase.' });
      }
    }

    const proof = storefront.productPageSections.find((s) => s.section === 'PROOF');
    if (proof && /\[/.test(proof.copy)) {
      findings.push({ section: 'PROOF', severity: 'HIGH', finding: 'The proof section is a placeholder and no verified proof exists yet.', action: 'Publish without the section rather than filling it with claims you cannot evidence. Add it once you have your own test or verified reviews.' });
    }

    const base = candidate.economics?.scenarios.find((s) => s.label === 'BASE');
    if (base && base.contributionBeforeAds < base.aov * 0.35) {
      findings.push({ section: 'OFFERS', severity: 'MEDIUM', finding: `Contribution is only ${Math.round((base.contributionBeforeAds / base.aov) * 100)}% of AOV, which leaves little room to buy a customer.`, action: 'Raise AOV with a genuine multi-unit or complementary bundle before spending on ads.' });
    }

    const shipping = candidate.suppliers.find((s) => s.deliveryDays.value);
    if (!shipping) {
      findings.push({ section: 'SHIPPING', severity: 'HIGH', finding: 'No supplier delivery time is known, so the shipping page cannot state a real one.', action: 'Confirm the delivered time with the chosen supplier before publishing; a wrong promise here drives refunds.' });
    }

    if (!candidate.brand) {
      findings.push({ section: 'HERO', severity: 'MEDIUM', finding: 'No brand positioning exists, so the hero has nothing to say beyond the product name.', action: 'Run the brand agent first.' });
    }

    findings.push({
      section: 'CTA',
      severity: 'LOW',
      finding: 'No urgency mechanism is present, by design.',
      action: 'Keep it that way unless a deadline is real. Fake scarcity converts once and costs the brand afterwards.',
    });

    ctx.say(`${findings.length} conversion finding(s): ${findings.filter((f) => f.severity === 'HIGH').length} high severity.`, { data: { candidateId: candidate.id } });
    return findings;
  },
};
