import type { Agent, AgentContext } from '../../core/agent/base.ts';
import type { PerformanceReport } from '../analytics/index.ts';
import type { LessonRecord } from '../../core/memory/index.ts';
import * as memory from '../../core/memory/index.ts';

/**
 * Learning loop. Turns measured outcomes into lessons that future missions
 * read. A lesson is only recorded where there is enough data to support it —
 * a single conversion is an anecdote, not a finding.
 */

const MIN_PURCHASES_FOR_A_LESSON = 5;

export const learningAgent: Agent<{ report: PerformanceReport; productName: string }, LessonRecord[]> = {
  id: 'learning',
  label: 'Learning Agent',
  stage: null,
  async run(input, ctx: AgentContext) {
    await ctx.checkControl();
    if (!input.report.hasData) {
      ctx.warn('No measured outcomes, so there is nothing to learn yet. No lesson recorded.');
      return [];
    }

    const lessons: LessonRecord[] = [];
    for (const c of input.report.byCreative) {
      if (c.purchases < MIN_PURCHASES_FOR_A_LESSON) continue;
      const worked = (c.contributionProfit ?? 0) > 0;
      lessons.push(
        await memory.recordLesson({
          topic: 'creative',
          lesson: `${input.productName}: creative ${c.creativeId} reached a CPA of ${c.cpa ?? 'n/a'} over ${c.purchases} purchases and ${worked ? 'contributed profit' : 'lost money'}.`,
          outcome: worked ? 'WORKED' : 'FAILED',
          confidence: c.purchases >= 25 ? 'MEDIUM' : 'LOW',
          basis: [c.creativeId],
        }),
      );
    }

    if (!lessons.length) {
      ctx.warn(`No creative reached ${MIN_PURCHASES_FOR_A_LESSON} purchases, so nothing is conclusive enough to record as a lesson.`);
    } else {
      ctx.say(`${lessons.length} lesson(s) recorded to memory and available to future missions.`);
    }
    return lessons;
  },
};
