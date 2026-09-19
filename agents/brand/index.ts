import type { Agent, AgentContext } from '../../core/agent/base.ts';
import type { BrandProfile, ProductCandidate } from '../../core/types/index.ts';
import { isKnown } from '../../core/util/evidence.ts';

/**
 * Brand engine.
 *
 * Brand work is creative rather than factual, but it is still derived: the
 * positioning answers a gap the competitor research actually found, and the
 * audience is the segment the customer research actually read. Nothing here
 * asserts a fact about the world, so nothing here needs a source — but it also
 * never invents market data to justify itself.
 */

const PALETTES = [
  { key: 'precision', colors: [ { name: 'Ink', hex: '#0B1014', use: 'Primary surface' }, { name: 'Signal', hex: '#3DE0C8', use: 'Accent and calls to action' }, { name: 'Mist', hex: '#E8EEF2', use: 'Text on dark' }, { name: 'Slate', hex: '#5A6B76', use: 'Secondary text' } ], tone: ['precise', 'calm', 'technical'] },
  { key: 'warmth', colors: [ { name: 'Clay', hex: '#2A211C', use: 'Primary surface' }, { name: 'Ember', hex: '#E0703D', use: 'Accent and calls to action' }, { name: 'Linen', hex: '#F3ECE4', use: 'Light surface' }, { name: 'Moss', hex: '#5E6B4F', use: 'Support' } ], tone: ['warm', 'human', 'reassuring'] },
  { key: 'clinical', colors: [ { name: 'Paper', hex: '#FBFBFC', use: 'Primary surface' }, { name: 'Deep', hex: '#14243A', use: 'Text and structure' }, { name: 'Pulse', hex: '#2E6BE6', use: 'Accent' }, { name: 'Ash', hex: '#8A94A3', use: 'Secondary text' } ], tone: ['clear', 'credible', 'unfussy'] },
];

const TYPE_PAIRS = [
  { display: 'Inter Tight', body: 'Inter', rationale: 'A single family at two optical sizes: fast to load and legible at small mobile sizes.' },
  { display: 'Fraunces', body: 'Source Sans 3', rationale: 'A warm display face against a neutral body for a product sold on feel rather than spec.' },
  { display: 'Space Grotesk', body: 'IBM Plex Sans', rationale: 'A technical pairing for a product whose argument is how it works.' },
];

/** Derives a name from the product's function rather than a generic word pool. */
function proposeNames(candidate: ProductCandidate): string[] {
  const words = candidate.name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP.has(w));
  const root = words[0] ?? 'form';
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return [
    `${cap(root)}wise`,
    `${cap(root.slice(0, 4))}ora`,
    `North ${cap(root)}`,
    `${cap(root)} & Co`,
    `Averly`,
  ];
}

const STOP = new Set(['with', 'that', 'this', 'from', 'your', 'best', 'product', 'device', 'system']);

export const brandAgent: Agent<ProductCandidate, ProductCandidate> = {
  id: 'brand',
  label: 'Brand Agent',
  stage: null,
  async run(candidate, ctx: AgentContext) {
    await ctx.requirePermission('brand.generate');
    await ctx.checkControl();
    ctx.say(`Building brand architecture for ${candidate.name}.`);

    const gap = candidate.competition?.gaps[0] ?? null;
    const segment = isKnown(candidate.customer?.segment ?? null) ? (candidate.customer?.segment.value as string) : null;
    const problem = candidate.customer?.problems[0] ?? null;
    const objection = candidate.customer?.objections[0] ?? null;

    // Pick a direction that answers the gap rather than a house style.
    const palette = gap && /guarantee|trust|proof|quality/i.test(gap) ? PALETTES[2] : problem && /comfort|sleep|stress|tired/i.test(problem) ? PALETTES[1] : PALETTES[0];
    const type = palette === PALETTES[1] ? TYPE_PAIRS[1] : palette === PALETTES[2] ? TYPE_PAIRS[0] : TYPE_PAIRS[2];
    const names = proposeNames(candidate);

    const brand: BrandProfile = {
      name: names[0] as string,
      rationale: `Built from the product's function rather than a category word, so it stays usable if the range widens.${gap ? ` It claims the gap the research found: ${gap}` : ''}`,
      positioning: gap
        ? `The option that fixes what buyers complain about: ${gap}`
        : `A considered version of ${candidate.name}, sold on how it works rather than on price.`,
      audience: segment ?? 'Not established from customer sources yet — define this before writing final copy.',
      tone: (palette?.tone ?? ['clear']) as string[],
      typography: type as BrandProfile['typography'],
      palette: (palette?.colors ?? []) as BrandProfile['palette'],
      packaging: 'Unbranded mailer with a printed insert card: the lowest-cost step that makes the unboxing feel deliberate, with no supplier tooling commitment.',
      productNaming: names.slice(1),
      slogan: problem ? `For ${problem.toLowerCase().replace(/\.$/, '')}.` : 'Built to be used, not admired.',
      story: [
        problem ? `It starts with a problem buyers describe themselves: ${problem}` : `It starts with a product that is usually sold badly.`,
        objection ? `The objection worth answering directly is: ${objection}` : `The brand answers doubt with demonstration rather than adjectives.`,
        gap ? `Competitors leave a gap here: ${gap}` : `Competitors compete on price; this does not.`,
      ].join(' '),
      photographyDirection: 'Natural light, real surroundings, the product in use rather than floating on white. No stock imagery and no borrowed lifestyle shots.',
      videoDirection: 'Handheld, close, showing the mechanism working in one continuous take. The proof is the demonstration, not the voiceover.',
    };

    candidate.brand = brand;
    if (!segment) candidate.risks.push('Brand audience is undefined because customer research produced no segment.');
    ctx.say(`Brand direction set: ${brand.name} — ${brand.positioning}`, { data: { candidateId: candidate.id } });
    return candidate;
  },
};
