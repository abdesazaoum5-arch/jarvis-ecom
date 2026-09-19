import type { EvidencePoint, Mission, ProductCandidate, StageId } from '../types/index.ts';
import type { ResearchRouter } from '../research/router.ts';
import { emit } from '../events/bus.ts';
import { evidencePoint } from '../util/evidence.ts';
import type { Capability } from '../permissions/index.ts';
import * as permissions from '../permissions/index.ts';

/** Raised when the operator interrupts; unwinds the pipeline cleanly. */
export class Interrupted extends Error {
  readonly control: 'STOP' | 'PAUSE';
  constructor(control: 'STOP' | 'PAUSE') {
    super(`Mission ${control === 'STOP' ? 'stopped' : 'paused'} by the operator.`);
    this.name = 'Interrupted';
    this.control = control;
  }
}

export interface AgentContext {
  mission: Mission;
  research: ResearchRouter;
  /** Re-reads the live mission control flag; agents call this between units of work. */
  checkControl(): Promise<void>;
  say(message: string, extra?: { target?: { site: string | null; url: string | null; action: string | null }; data?: Record<string, unknown> }): void;
  warn(message: string, data?: Record<string, unknown>): void;
  /** Records evidence against a candidate and emits it to the timeline. */
  note(candidate: ProductCandidate, point: Omit<Parameters<typeof evidencePoint>[0], 'agent'>): EvidencePoint;
  requirePermission(cap: Capability): Promise<void>;
  allows(cap: Capability): Promise<boolean>;
}

export interface Agent<In = unknown, Out = unknown> {
  readonly id: string;
  readonly label: string;
  readonly stage: StageId | null;
  run(input: In, ctx: AgentContext): Promise<Out>;
}

export function makeContext(opts: {
  mission: Mission;
  research: ResearchRouter;
  agentId: string;
  readControl: () => Promise<Mission['control']>;
}): AgentContext {
  const { mission, research, agentId } = opts;
  return {
    mission,
    research,
    async checkControl() {
      const c = await opts.readControl();
      if (c === 'STOP') throw new Interrupted('STOP');
      if (c === 'PAUSE') {
        emit({ kind: 'mission', agent: agentId, missionId: mission.id, message: 'Holding — the operator paused the mission.' });
        // Park here until the operator resumes or stops; never busy-spin.
        for (;;) {
          await new Promise((r) => setTimeout(r, 500));
          const next = await opts.readControl();
          if (next === 'STOP') throw new Interrupted('STOP');
          if (next === 'RUN') {
            emit({ kind: 'mission', agent: agentId, missionId: mission.id, message: 'Resuming.' });
            return;
          }
        }
      }
    },
    say(message, extra) {
      emit({
        kind: 'agent',
        agent: agentId,
        missionId: mission.id,
        message,
        target: extra?.target ?? null,
        data: extra?.data ?? null,
      });
    },
    warn(message, data) {
      emit({ kind: 'agent', level: 'warn', agent: agentId, missionId: mission.id, message, data: data ?? null });
    },
    note(candidate, point) {
      const ev = evidencePoint({ ...point, agent: agentId });
      candidate.evidence.push(ev);
      emit({
        kind: 'evidence',
        agent: agentId,
        missionId: mission.id,
        message: `${candidate.name}: ${ev.claim}`,
        target: ev.source ? { site: hostname(ev.source.url), url: ev.source.url, action: 'evidence' } : null,
        data: { candidateId: candidate.id, provenance: ev.provenance, polarity: ev.polarity },
      });
      return ev;
    },
    async requirePermission(cap) {
      await permissions.require(cap);
    },
    async allows(cap) {
      return permissions.allows(cap);
    },
  };
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
