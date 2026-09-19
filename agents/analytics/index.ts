import type { Agent, AgentContext } from '../../core/agent/base.ts';

/**
 * Performance analysis.
 *
 * The primary metric is contribution profit. With no measured data connected,
 * this agent reports that there is nothing to analyse rather than producing a
 * dashboard of invented numbers.
 */

export interface PerformanceInput {
  /** Rows the operator supplied or an adapter retrieved. Empty means no data. */
  rows: Array<{
    date: string;
    creativeId: string | null;
    spend: number;
    purchases: number;
    revenue: number;
  }>;
  contributionMarginRate: number | null;
}

export interface PerformanceReport {
  hasData: boolean;
  note: string;
  totals: { spend: number; purchases: number; revenue: number; cpa: number | null; roas: number | null; contributionProfit: number | null } | null;
  byCreative: Array<{ creativeId: string; spend: number; purchases: number; cpa: number | null; contributionProfit: number | null }>;
  diagnosis: string[];
}

export const analyticsAgent: Agent<PerformanceInput, PerformanceReport> = {
  id: 'analytics',
  label: 'Analytics Agent',
  stage: null,
  async run(input, ctx: AgentContext) {
    await ctx.checkControl();
    if (!input.rows.length) {
      ctx.warn('No performance data is connected, so there is nothing to analyse.');
      return {
        hasData: false,
        note: 'No campaign data has been supplied and no ads platform is connected. Nothing is being reported, because there is nothing measured.',
        totals: null,
        byCreative: [],
        diagnosis: [],
      };
    }

    const spend = sum(input.rows.map((r) => r.spend));
    const purchases = sum(input.rows.map((r) => r.purchases));
    const revenue = sum(input.rows.map((r) => r.revenue));
    const cpa = purchases > 0 ? round2(spend / purchases) : null;
    const roas = spend > 0 ? round2(revenue / spend) : null;
    const contributionProfit = input.contributionMarginRate !== null ? round2(revenue * input.contributionMarginRate - spend) : null;

    const groups = new Map<string, { spend: number; purchases: number; revenue: number }>();
    for (const r of input.rows) {
      const key = r.creativeId ?? 'unattributed';
      const g = groups.get(key) ?? { spend: 0, purchases: 0, revenue: 0 };
      g.spend += r.spend;
      g.purchases += r.purchases;
      g.revenue += r.revenue;
      groups.set(key, g);
    }

    const byCreative = [...groups.entries()].map(([creativeId, g]) => ({
      creativeId,
      spend: round2(g.spend),
      purchases: g.purchases,
      cpa: g.purchases > 0 ? round2(g.spend / g.purchases) : null,
      contributionProfit: input.contributionMarginRate !== null ? round2(g.revenue * input.contributionMarginRate - g.spend) : null,
    }));

    const diagnosis: string[] = [];
    if (contributionProfit !== null && contributionProfit < 0) {
      diagnosis.push('Contribution profit is negative: the campaign is buying customers above what the margin supports.');
    }
    const thin = byCreative.filter((c) => c.purchases < 3 && c.spend > 0);
    if (thin.length) diagnosis.push(`${thin.length} creative(s) have fewer than 3 purchases — too little data to judge. Do not kill on this alone.`);
    if (!diagnosis.length) diagnosis.push('No structural problem is evident in the data supplied.');

    ctx.say(`Analysed ${input.rows.length} row(s): CPA ${cpa ?? 'n/a'}, ROAS ${roas ?? 'n/a'}, contribution profit ${contributionProfit ?? 'unknown without a margin rate'}.`);
    return {
      hasData: true,
      note: 'Computed from the rows supplied. Contribution profit, not ROAS, is the metric that decides.',
      totals: { spend: round2(spend), purchases, revenue: round2(revenue), cpa, roas, contributionProfit },
      byCreative,
      diagnosis,
    };
  },
};

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
