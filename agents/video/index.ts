import type { Agent, AgentContext } from '../../core/agent/base.ts';
import type { CreativeConcept } from '../../core/types/index.ts';

/**
 * Video production specifications, and the Higgsfield adapter.
 *
 * If a generation API key is present the concept can be rendered. Without one
 * the adapter is NOT_CONNECTED and JARVIS writes a production-ready spec
 * instead. It never buys credits and never reports a render that did not run.
 */

export interface VideoSpec {
  creativeId: string;
  durationSeconds: number;
  aspect: '9:16' | '1:1' | '4:5';
  frameRate: number;
  shots: Array<{ at: string; description: string; camera: string; duration: number }>;
  audio: { voiceover: string | null; music: string; soundDesign: string[] };
  subtitles: { burnedIn: boolean; style: string };
  deliverables: string[];
  generation: { provider: string; status: 'NOT_CONNECTED' | 'READY'; note: string };
}

export function higgsfieldStatus(): { status: 'NOT_CONNECTED' | 'READY'; note: string } {
  const key = (process.env['HIGGSFIELD_API_KEY'] ?? '').trim();
  if (!key) {
    return {
      status: 'NOT_CONNECTED',
      note: 'No HIGGSFIELD_API_KEY is configured. No credits will be purchased; the specification below is the deliverable.',
    };
  }
  return { status: 'READY', note: 'An API key is present. Generation still requires an explicit instruction and will not spend credits on its own.' };
}

export const videoAgent: Agent<CreativeConcept[], VideoSpec[]> = {
  id: 'video',
  label: 'Video Agent',
  stage: null,
  async run(concepts, ctx: AgentContext) {
    await ctx.checkControl();
    const gen = higgsfieldStatus();
    const videos = concepts.filter((c) => c.format === 'VIDEO');
    ctx.say(`Writing production specifications for ${videos.length} video concept(s). Generation backend: ${gen.status}.`);

    const specs = videos.map<VideoSpec>((c) => ({
      creativeId: c.id,
      durationSeconds: 22,
      aspect: '9:16',
      frameRate: 30,
      shots: c.shotList.map((s, i) => ({
        at: `0:${String(i * 4).padStart(2, '0')}`,
        description: s,
        camera: c.cameraDirections[i % Math.max(c.cameraDirections.length, 1)] ?? 'Handheld, natural light',
        duration: 4,
      })),
      audio: {
        voiceover: c.voiceover,
        music: 'Low, unobtrusive bed. It must survive being muted — the edit carries itself without it.',
        soundDesign: ['Real product sound recorded on set', 'No stock whooshes'],
      },
      subtitles: { burnedIn: true, style: 'High contrast, two lines maximum, positioned clear of platform UI.' },
      deliverables: ['9:16 master', '1:1 crop', '4:5 crop', 'Hook-only 6s cutdown'],
      generation: { provider: 'higgsfield', ...gen },
    }));

    if (gen.status === 'NOT_CONNECTED') ctx.warn('Higgsfield is NOT_CONNECTED — specifications produced, nothing rendered, nothing purchased.');
    return specs;
  },
};
