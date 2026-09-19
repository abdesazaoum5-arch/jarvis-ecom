import type { Agent, AgentContext } from '../../core/agent/base.ts';
import type { CreativeConcept, CreativeFormat, ProductCandidate } from '../../core/types/index.ts';
import { newId } from '../../core/util/id.ts';

/**
 * Creative system.
 *
 * Produces a 60/30/10 video/static/carousel mix. Every concept carries a
 * truthfulness note naming what must be true before it can run — a
 * before/after only ships if the "after" is a real result, and a UGC concept is
 * a brief for a real person, never a fabricated testimonial.
 */

const ANGLES = [
  'problem/solution',
  'demonstration',
  'before/after',
  'UGC-style',
  'unboxing',
  'comparison',
  'transformation',
  'educational',
  'emotional',
  'lifestyle',
  'objection handling',
  'curiosity',
] as const;

export interface CreativeBrief {
  videos: number;
  statics: number;
  carousels: number;
}

/** 60% video, 30% static, 10% carousel over the requested ad count. */
export function mixFor(total: number): CreativeBrief {
  const videos = Math.max(3, Math.round(total * 0.6));
  const statics = Math.max(3, Math.round(total * 0.3));
  const carousels = Math.max(1, Math.round(total * 0.1));
  return { videos, statics, carousels };
}

function hookFor(angle: string, c: ProductCandidate): string {
  const problem = c.customer?.problems[0] ?? `the usual problem with ${c.name}`;
  const objection = c.customer?.objections[0] ?? 'the reason people hesitate';
  const gap = c.competition?.gaps[0] ?? 'what everyone else leaves out';
  switch (angle) {
    case 'problem/solution':
      return `If ${lower(problem)} — here is what actually fixes it.`;
    case 'demonstration':
      return `No talking. Just watch what it does.`;
    case 'before/after':
      return `Same setup, ten seconds apart.`;
    case 'UGC-style':
      return `I bought this expecting nothing.`;
    case 'unboxing':
      return `What you actually get in the box.`;
    case 'comparison':
      return `The cheap one and this one, side by side.`;
    case 'transformation':
      return `Thirty days of using it, in thirty seconds.`;
    case 'educational':
      return `Why ${lower(problem)} happens in the first place.`;
    case 'emotional':
      return `The small thing that stopped being annoying.`;
    case 'lifestyle':
      return `Where it lives, and why you stop noticing it.`;
    case 'objection handling':
      return `"${objection}" — fair. Here is the honest answer.`;
    default:
      return `${cap(gap)}.`;
  }
}

function truthNotes(angle: string): string[] {
  switch (angle) {
    case 'before/after':
      return ['The "after" must be a real, unedited result from actual use. If no such result exists yet, this concept does not run.'];
    case 'UGC-style':
      return ['Brief a real customer or a disclosed paid creator. Never script a fake testimonial or imply an unpaid endorsement.'];
    case 'transformation':
      return ['Timeframe shown must match the real timeframe. No compressed timelines presented as typical.'];
    case 'comparison':
      return ['Name the comparison honestly and only claim differences you can demonstrate. Do not disparage a named competitor with unverified claims.'];
    default:
      return ['Every on-screen claim must trace to researched evidence or to your own testing.'];
  }
}

export const creativeAgent: Agent<{ candidate: ProductCandidate; total?: number }, CreativeConcept[]> = {
  id: 'creative',
  label: 'Creative Agent',
  stage: null,
  async run(input, ctx: AgentContext) {
    await ctx.requirePermission('creative.generate.local');
    await ctx.checkControl();
    const c = input.candidate;
    const mix = mixFor(input.total ?? 10);
    ctx.say(`Producing creative concepts for ${c.name}: ${mix.videos} video, ${mix.statics} static, ${mix.carousels} carousel.`);

    const concepts: CreativeConcept[] = [];
    const plan: Array<[CreativeFormat, number]> = [
      ['VIDEO', mix.videos],
      ['STATIC', mix.statics],
      ['CAROUSEL', mix.carousels],
    ];
    let angleIndex = 0;
    for (const [format, count] of plan) {
      for (let i = 0; i < count; i += 1) {
        await ctx.checkControl();
        const angle = ANGLES[angleIndex % ANGLES.length] as string;
        angleIndex += 1;
        concepts.push(buildConcept(c, format, angle));
      }
    }

    ctx.say(`${concepts.length} concept(s) written as production-ready specs. No generation credits were spent.`, { data: { candidateId: c.id } });
    return concepts;
  },
};

function buildConcept(c: ProductCandidate, format: CreativeFormat, angle: string): CreativeConcept {
  const hook = hookFor(angle, c);
  const base = {
    id: newId('cre'),
    productId: c.id,
    format,
    angle,
    hook,
    renderedAsset: null,
    truthfulnessNotes: truthNotes(angle),
  };
  if (format === 'VIDEO') {
    return {
      ...base,
      script: [
        `0:00 ${hook}`,
        `0:02 Show the problem happening, in one real shot.`,
        `0:05 Introduce the product without naming a feature yet.`,
        `0:08 Demonstrate the mechanism, uncut.`,
        `0:14 The result, held long enough to read.`,
        `0:18 ${c.brand?.slogan ?? c.name}. One call to action.`,
      ].join('\n'),
      shotList: [
        'Handheld close-up of the problem, natural light',
        'Hands entering frame with the product',
        'Continuous take of the mechanism working',
        'Static hold on the result',
        'Product at rest in its real environment',
      ],
      cameraDirections: ['35mm equivalent, handheld with minimal stabilisation', 'Single light source, no fill', 'Cut on motion, never mid-claim'],
      voiceover: `${hook} Then state only what the demonstration shows.`,
      overlays: [hook, c.marketingAngles[0] ?? '', c.brand?.slogan ?? ''].filter(Boolean),
      editingNotes: ['No stock footage.', 'No countdown or urgency graphics.', 'Subtitles burned in; most of this is watched muted.'],
    };
  }
  if (format === 'STATIC') {
    return {
      ...base,
      script: null,
      shotList: ['Product on a real surface, one clear light direction', 'Detail shot of the part that does the work'],
      cameraDirections: ['Shoot flat, grade afterwards', 'Leave headroom for the overlay'],
      voiceover: null,
      overlays: [hook, c.competition?.gaps[0] ?? ''].filter(Boolean),
      editingNotes: ['One claim per image.', 'Brand colours only; no borrowed visual language.'],
    };
  }
  return {
    ...base,
    script: null,
    shotList: ['Card 1: the problem', 'Card 2: the mechanism', 'Card 3: the result', 'Card 4: what is in the box', 'Card 5: the offer'],
    cameraDirections: ['Consistent crop and light across all cards'],
    voiceover: null,
    overlays: [hook],
    editingNotes: ['Each card must make sense alone; most people see only the first.'],
  };
}

function lower(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
